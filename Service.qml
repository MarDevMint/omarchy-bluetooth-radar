import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "Model.js" as Model

// The one scanner behind every radar widget. The bar mounts a widget per
// monitor; they all read this service, so there is only ever one scan.
//
// Scanning is the helper process being alive: bin/m-radar-scan owns the
// BlueZ discovery session and the adapter power, and gives both back when it
// exits. Stopping the scan is therefore just stopping the process.
//
// IPC (target m.radar), e.g. for a keybinding:
//   omarchy-shell m.radar scanToggle | scanOn | scanOff | status | show
//   omarchy-shell m.radar find "galaxy watch" | findStop | guardToggle
//   omarchy-shell m.radar proximityArm "my watch" | proximityOff | proximityStatus
Item {
  id: root

  property var shell: null
  // The shell gives settings to widgets, not services; BarWidget forwards them.
  property var settings: ({})

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }

  readonly property real maxMeters: Math.max(3, Math.min(30, Number(setting("maxRangeMeters", 10))))
  // 0 keeps scanning until switched off.
  readonly property int autoStopMinutes: Math.max(0, Math.min(30, Number(setting("autoStopMinutes", 5))))
  // Per-kind 1 m references from the C key; see Model.calibrate. Applied
  // locally at once, then persisted to shell.json, which flows back here.
  property var calibrationOverride: null
  readonly property var calibration: calibrationOverride || setting("calibration", {})
  // Also listen for classic Bluetooth devices (B in the popout). They only
  // answer while discoverable, and the inquiry shares the radio with
  // Bluetooth audio, which is why it can be switched off.
  property var classicOverride: null
  readonly property bool classic: classicOverride !== null ? classicOverride : setting("classicScan", true) === true
  // The Wi-Fi layer (W in the popout), same apply-then-persist pattern.
  property var showWifiOverride: null
  readonly property bool showWifi: showWifiOverride !== null ? showWifiOverride : setting("showWifi", true) === true
  // List and radar filters (F, U in the popout), same pattern.
  property var rangeFilterOverride: null
  readonly property int rangeFilter: rangeFilterOverride !== null ? rangeFilterOverride : Number(setting("rangeFilter", 0)) || 0
  property var hideUnknownOverride: null
  readonly property bool hideUnknown: hideUnknownOverride !== null ? hideUnknownOverride : setting("hideUnknown", false) === true
  // Guard (G in the popout): tracker and camera-glasses alerts, scanning in
  // short bursts while the radar itself is off. Same pattern.
  property var guardOverride: null
  readonly property bool guard: guardOverride !== null ? guardOverride : setting("guard", false) === true
  // Proximity lock (K in the popout): { key, label, baseline } of the device
  // you carry, or null. Only a salted hash of its address is kept (pkey).
  property var proximityOverride: undefined
  readonly property var proximity: proximityOverride !== undefined ? proximityOverride : setting("proximity", null)
  readonly property bool proximityArmed: !!proximity && typeof proximity.key === "string" && proximity.key !== ""

  // What the user asked for; the helper may still be starting.
  property bool wanted: false
  readonly property bool running: helper.running
  // The helper's own report, refreshed once a second.
  property bool scanning: false
  property var devices: []
  property var networks: []
  property string error: ""
  // When the auto-stop will fire, for the countdown in the popout (0 = never).
  property double stopsAtMs: 0
  // When this scan started, so "new" means arrived rather than first sweep.
  property double startedMs: 0
  property var firstSeenMemory: ({})

  // Asks the bar widgets to open or close the popout (IPC "show").
  signal showRequested()

  // ---- Find mode (L in the popout): walk around to locate one device.
  // The helper restarts its scan every second meanwhile (fast mode) for
  // ~5x the readings, and the auto-stop waits until you are done.
  property string findId: ""
  property var findTarget: null      // last placed copy, to re-find it by
  property real findLevel: 0         // 0 cold – 1 hot (Model.findLevel)
  property real findBest: 0          // hottest so far this search
  property bool findLost: false
  property bool findSound: false     // Geiger clicks (M)
  readonly property bool finding: findId !== ""
  readonly property string clickPath: Qt.resolvedUrl("assets/click.wav").toString().replace(/^file:\/\//, "")

  // Seconds of silence before the target counts as lost and an address
  // change is suspected.
  // A device that is here comes through every ~3 s, 90 % within 7 s.
  readonly property int findLostAfterS: 10

  function startFind(device) {
    if (!device || device.source !== "bt") return
    findId = device.id
    findTarget = device
    findBest = 0
    findLevel = Model.findLevel(device)
    findLost = false
    if (!wanted) start()
    autoStop.stop()
    stopsAtMs = 0
    if (helper.running) helper.write("fast on\n")  // else onRunningChanged sends it
  }

  function stopFind() {
    if (!finding) return
    findId = ""
    findTarget = null
    findLost = false
    if (helper.running) helper.write("fast off\n")
    if (wanted) armAutoStop()
  }

  function toggleFindSound() {
    findSound = !findSound
  }

  // After each snapshot: update the meter, and follow the device if it came
  // back under a new address.
  function followTarget() {
    var current = null
    for (var i = 0; i < devices.length; i++) if (devices[i].id === findId) current = devices[i]
    if (current && Number(current.age) <= findLostAfterS) {
      findTarget = current
      findLost = false
      findLevel = Model.findLevel(current)
      findBest = Math.max(findBest, findLevel)
      return
    }
    var stand = Model.reacquire(findTarget, devices.filter(function(d) { return Number(d.age) <= 3 }))
    if (stand) {
      findId = stand.id
      findTarget = stand
      findLost = false
      findLevel = Model.findLevel(stand)
      return
    }
    findLost = true
    findLevel = 0
  }

  Timer {
    interval: Model.clickInterval(root.findLevel)
    running: root.finding && root.findSound && !root.findLost
    repeat: true
    onTriggered: Quickshell.execDetached(["pw-play", "--volume", "0.5", root.clickPath])
  }

  function start() {
    error = ""
    if (!wanted && !bursting) startedMs = Date.now()
    wanted = true
    armAutoStop()
  }

  function armAutoStop() {
    if (autoStopMinutes > 0) {
      stopsAtMs = Date.now() + autoStopMinutes * 60000
      autoStop.restart()
    } else {
      stopsAtMs = 0
      autoStop.stop()
    }
  }

  function stop() {
    stopFind()
    wanted = false
    stopsAtMs = 0
    autoStop.stop()
  }

  function toggle() {
    wanted ? stop() : start()
  }

  function ingest(line) {
    var snapshot = Model.parseLine(line)
    if (!snapshot) return
    if (snapshot.error) {
      error = snapshot.error
      stopFind()
      wanted = false
      return
    }
    scanning = snapshot.scanning
    var now = Date.now()
    var placed = Model.place(snapshot.devices, devices, maxMeters, now, calibration)
    // A device that drops out for a few seconds and comes back is not new:
    // remember when each was first seen, for 10 minutes after it was last.
    var memory = {}
    for (var id in firstSeenMemory) if (now - firstSeenMemory[id].last < 600000) memory[id] = firstSeenMemory[id]
    placed.forEach(function(d) {
      if (memory[d.id] && memory[d.id].first < d.firstSeen) d.firstSeen = memory[d.id].first
      memory[d.id] = { first: d.firstSeen, last: now }
    })
    firstSeenMemory = memory
    devices = Model.sortBySignal(placed)
    if (finding) followTarget()
    if (guard) guardCheck()
  }

  // "This device is one metre away": learn its kind's 1 m signal.
  function calibrate(device) {
    if (!device) return
    saveCalibration(Model.calibrate(calibration, device))
  }

  function clearCalibration(kind) {
    saveCalibration(Model.clearCalibration(calibration, kind))
  }

  function saveCalibration(next) {
    calibrationOverride = next
    persist("calibration", JSON.stringify(next))
  }

  // A change is applied here at once and written to shell.json in the
  // background; the override holds until shell.json says the same thing.
  // Clearing it on any settings reload let an older write that landed late
  // undo a newer change (proximity lock re-armed after switching it off).
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

  // Writes to shell.json run one at a time, newest value per key, so they
  // land in the order they were made.
  property var pendingWrites: ({})

  function persist(key, value) {
    var next = Object.assign({}, pendingWrites)
    next[key] = value
    pendingWrites = next
    if (!writer.running) writeNext()
  }

  function writeNext() {
    var keys = Object.keys(pendingWrites)
    if (!keys.length) return
    var key = keys[0], next = Object.assign({}, pendingWrites)
    writer.command = ["omarchy", "bar", "set", "m.radar", key, next[key], "--json"]
    delete next[key]
    pendingWrites = next
    writer.running = true
  }

  Process {
    id: writer
    onExited: root.writeNext()
  }
  onSettingsChanged: {
    if (calibrationOverride !== null && same(setting("calibration", {}), calibrationOverride)) calibrationOverride = null
    if (showWifiOverride !== null && same(setting("showWifi", true), showWifiOverride)) showWifiOverride = null
    if (classicOverride !== null && same(setting("classicScan", true), classicOverride)) classicOverride = null
    if (rangeFilterOverride !== null && same(Number(setting("rangeFilter", 0)) || 0, rangeFilterOverride)) rangeFilterOverride = null
    if (hideUnknownOverride !== null && same(setting("hideUnknown", false), hideUnknownOverride)) hideUnknownOverride = null
    if (guardOverride !== null && same(setting("guard", false), guardOverride)) guardOverride = null
    if (proximityOverride !== undefined && same(setting("proximity", null), proximityOverride)) proximityOverride = undefined
  }
  onAutoStopMinutesChanged: if (wanted && !finding) armAutoStop()
  // Settings can flip classic mode too (shell.json edits): tell a live helper.
  onClassicChanged: if (helper.running) helper.write("classic " + (classic ? "on" : "off") + "\n")

  // Hashes access-point addresses for this session only (see m-radar-wifi).
  readonly property string wifiSalt: Math.random().toString(36).slice(2) + Date.now().toString(36)

  // nmcli rescans only when its results are stale, so a 20 s poll costs
  // little and doesn't keep the Wi-Fi card off-channel.
  Timer {
    interval: 20000
    running: root.wanted && root.showWifi
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!wifi.running) wifi.running = true
  }

  Process {
    id: wifi
    command: ["/usr/bin/python3", "-I", Qt.resolvedUrl("bin/m-radar-wifi").toString().replace(/^file:\/\//, "")]
    environment: ({ "M_RADAR_SALT": root.wifiSalt })
    stdout: SplitParser {
      onRead: function(line) { root.ingestWifi(line) }
    }
  }

  Timer {
    id: autoStop
    interval: Math.max(1, root.autoStopMinutes) * 60000
    onTriggered: root.stop()
  }

  IpcHandler {
    target: "m.radar"

    function scanOn(): void { root.start() }
    function scanOff(): void { root.stop() }
    function scanToggle(): void { root.toggle() }
    function show(): void { root.showRequested() }
    function findStop(): void { root.stopFind() }
    function guardToggle(): string { root.toggleGuard(); return root.guard ? "guard on" : "guard off" }
    function proximityStatus(): string {
      return JSON.stringify({ armed: root.proximityArmed, device: root.proximityArmed ? root.proximity.label : "",
                              state: root.proximityState ? root.proximityState.phase : "", text: root.proximityText,
                              heard: !!root.proximityTarget, idle: idle.isIdle })
    }
    function proximityOff(): void { root.disarmProximity() }
    // Arms the lock on the strongest device matching `query`; "" or why not.
    function proximityArm(query: string): string {
      var q = String(query).trim().toLowerCase(), best = null
      if (q === "") return "empty query"
      for (var i = 0; i < root.devices.length; i++) {
        var d = root.devices[i]
        if ([d.name, d.model, Model.label(d)].join(" ").toLowerCase().indexOf(q) >= 0 && (!best || d.smoothed > best.smoothed)) best = d
      }
      if (!best) return "not found"
      var problem = root.armProximity(best)
      return problem || "armed on " + Model.label(best)
    }
    // Starts find mode on the strongest device whose name, model or label
    // contains `query` (any case). Returns its label, or why not.
    function find(query: string): string {
      var q = String(query).trim().toLowerCase(), best = null
      if (q === "") return "empty query"
      for (var i = 0; i < root.devices.length; i++) {
        var d = root.devices[i]
        var text = [d.name, d.model, Model.label(d)].join(" ").toLowerCase()
        if (text.indexOf(q) >= 0 && (!best || d.smoothed > best.smoothed)) best = d
      }
      if (!best) return root.wanted ? "not found" : "scan is off"
      root.startFind(best)
      return Model.label(best)
    }
    function status(): string {
      return JSON.stringify({ scanning: root.wanted, devices: root.devices.length, networks: root.networks.length, error: root.error,
                              proximity: root.proximityArmed, finding: root.finding ? Model.label(root.findTarget) : "",
                              guard: root.guard, bursting: root.bursting, watched: Object.keys(root.guardLog).length })
    }
  }

  function reset() {
    scanning = false
    devices = []
    networks = []
  }

  function toggleClassic() {
    classicOverride = !classic
    helper.write("classic " + (classic ? "on" : "off") + "\n")
    persist("classicScan", String(classic))
  }

  function cycleRangeFilter() {
    rangeFilterOverride = Model.nextRangeFilter(rangeFilter)
    persist("rangeFilter", String(rangeFilter))
  }

  function toggleGuard() {
    guardOverride = !guard
    if (!guard) { bursting = false; guardLog = ({}) }
    persist("guard", String(guard))
  }

  // ---- Guard bursts: 20 s of scanning every 2 minutes while the radar is
  // off, which is plenty for "3 sightings over 30 minutes" and spares the
  // battery and Bluetooth audio a continuous scan.
  property bool bursting: false
  property var guardLog: ({})

  Timer {
    interval: 120000
    running: root.guard && !root.wanted
    repeat: true
    triggeredOnStart: true
    onTriggered: { root.startedMs = Date.now(); root.bursting = true; burstEnd.restart() }
  }

  Timer {
    id: burstEnd
    interval: 20000
    onTriggered: root.bursting = false
  }

  function guardCheck() {
    var step = Model.guardStep(guardLog, devices, Date.now())
    guardLog = step.log
    step.alerts.forEach(function(a) {
      Quickshell.execDetached(["notify-send", "-a", "Radar", "-u", a.kind === "tracker" ? "critical" : "normal",
                               "-i", "dialog-warning", a.title, a.body])
    })
  }

  // ---- Proximity lock. Keeps the scan running while armed (that is the
  // cost: the radio listens all the time), checks once a second.
  property var proximityState: null
  readonly property var proximityTarget: {
    if (!proximityArmed) return null
    for (var i = 0; i < devices.length; i++) if (devices[i].pkey === proximity.key) return devices[i]
    return null
  }
  readonly property string proximityText: proximityArmed ? Model.proximityText(proximityState, proximity.label, nowTick) : ""
  property double nowTick: Date.now()
  // The helper failed while the lock was armed: wait before trying again
  // rather than respawning it in a loop. The lock pauses meanwhile.
  property bool proximityPaused: false

  Timer {
    id: proximityRetry
    interval: 30000
    onTriggered: root.proximityPaused = false
  }

  // Returns "" when armed, else why not.
  function armProximity(device) {
    var problem = Model.lockProblem(device)
    if (problem) return problem
    saveProximity({ key: device.pkey, label: Model.label(device), baseline: Math.round(device.smoothed) })
    proximityState = { phase: "near", since: Date.now() }
    return ""
  }

  function disarmProximity() {
    saveProximity(null)
    proximityState = null
  }

  function saveProximity(next) {
    proximityOverride = next
    persist("proximity", JSON.stringify(next))
  }

  IdleMonitor {
    id: idle
    enabled: root.proximityArmed
    timeout: 10
    respectInhibitors: true
  }

  Timer {
    interval: 1000
    running: root.proximityArmed
    repeat: true
    onTriggered: {
      root.nowTick = Date.now()
      var live = helper.running && root.scanning
      var step = Model.proximityStep(root.proximityState, root.proximityTarget, root.nowTick, idle.isIdle, live, root.proximity.baseline)
      root.proximityState = { phase: step.phase, since: step.since }
      if (step.action === "warn")
        Quickshell.execDetached(["notify-send", "-a", "Radar", "-u", "critical", "-t", "5000", "-i", "system-lock-screen",
                                 "Locking in 5 seconds", root.proximity.label + " has left. Move the mouse or press a key to cancel."])
      else if (step.action === "lock")
        Quickshell.execDetached(["omarchy-system-lock"])
    }
  }

  function toggleHideUnknown() {
    hideUnknownOverride = !hideUnknown
    persist("hideUnknown", String(hideUnknown))
  }

  function toggleWifi() {
    showWifiOverride = !showWifi
    if (!showWifi) networks = []
    persist("showWifi", String(showWifi))
  }

  function ingestWifi(line) {
    var result = Model.parseWifi(line)
    // A failed nmcli run just leaves the last picture; Wi-Fi is the extra layer.
    if (!result || result.error || !wanted || !showWifi) return
    networks = Model.sortBySignal(Model.placeNetworks(result.networks, networks, maxMeters, Date.now()))
  }

  readonly property string helperPath: Qt.resolvedUrl("bin/m-radar-scan").toString().replace(/^file:\/\//, "")
  // Anonymises device ids for this shell session only (never stored), so the
  // same device keeps its id across scans and Guard's bursts.
  readonly property string scanSalt: {
    var hex = ""
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16)
    return hex
  }

  // If a previous scan was killed outright (shell crash, SIGKILL) it could
  // not switch Bluetooth back off; the helper left a marker and this cleans up.
  Process {
    command: ["/usr/bin/python3", "-I", root.helperPath, "--restore"]
    running: true
  }

  Process {
    id: helper
    // --classic only sets the starting mode; B changes it live over stdin.
    command: ["/usr/bin/python3", "-I", root.helperPath].concat(root.classic ? ["--classic"] : [])
    // In the environment, not argv: /proc/<pid>/environ is readable only by
    // you, cmdline by every local user, and the salt is what keeps ids anonymous.
    environment: ({ "M_RADAR_SALT": root.scanSalt })
    running: root.wanted || root.bursting || (root.proximityArmed && !root.proximityPaused)
    stdinEnabled: true
    stdout: SplitParser {
      onRead: function(line) { root.ingest(line) }
    }
    // A restarted helper starts in normal mode; put a search back in fast.
    onRunningChanged: if (running && root.finding) write("fast on\n")
    onExited: function(code) {
      root.reset()
      root.bursting = false
      if (code !== 0 && root.proximityArmed) { root.proximityPaused = true; proximityRetry.restart() }
      // An exit we didn't ask for (crash, adapter gone) turns the radar off
      // rather than retrying in a loop behind the user's back.
      if (root.wanted) {
        if (root.error === "") root.error = "Scanner stopped unexpectedly (exit " + code + ")"
        root.stopFind()
        root.wanted = false
      }
    }
  }
}
