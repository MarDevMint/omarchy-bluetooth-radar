.pragma library
.import "Vendors.js" as Vendors
.import "Decode.js" as Decode

// Pure logic for the radar: turns the helper's JSON snapshots into rows the
// UI can draw. No QML and no I/O here, so it stays easy to read and to test
// (see test/model.test.js).
//
// A snapshot line from bin/m-radar-scan looks like:
//   {"powered": true, "scanning": true, "devices": [
//     {"id": "3fa1…", "rssi": -72, "peak": -68, "n": 4, "age": 0.3,
//      "name": "", "addrType": "random",
//      "icon": "", "appearance": 0, "makers": {"76": 16}, "uuids": ["fef3"],
//      "connected": false, "txPower": 12}]}
// rssi is the median of the n readings heard in the last second (n = 0: none,
// rssi is then the last one); age is seconds since anything was heard.
// or, when the helper cannot run: {"error": "…"}

// Parses one helper line. Returns null for anything that isn't a snapshot
// or an error report, so a stray line can never wipe the current picture.
function parseLine(line) {
  var data
  try {
    data = JSON.parse(String(line || ""))
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object") return null
  if (typeof data.error === "string") return { error: data.error }
  if (!Array.isArray(data.devices)) return null
  return {
    powered: data.powered === true,
    scanning: data.scanning === true,
    devices: data.devices.filter(isDevice)
  }
}

function isDevice(d) {
  return !!d && typeof d.id === "string" && d.id !== "" && isFinite(Number(d.rssi))
}

// What to call a device in the list: its advertised name, else what we
// could work out ("Apple · Find My"), else something honest.
function label(device) {
  var name = String(device.name || "").trim()
  if (name !== "") return name
  var c = device.kind ? device : classify(device)
  if (c.model) return c.vendor && c.model.indexOf(c.vendor) < 0 && c.vendor !== "Apple" ? c.vendor + " " + c.model : c.model
  if (c.vendor && c.detail && c.detail !== c.vendor) return c.vendor + " · " + c.detail
  if (c.vendor) return c.vendor + " " + kindLabel(c.kind).toLowerCase()
  if (c.kind !== "unknown") return kindLabel(c.kind)
  return device.addrType === "random" ? "Anonymous device" : "Unknown device"
}

// ------------------------------------------------------------- identity
//
// Works out what a device probably is from what it advertises, most
// specific evidence first. Returns { kind, vendor, detail, services } plus
// whatever Decode.decode read from the payloads (model, battery, sensor,
// tracker, glasses, activity): kind is a key of Vendors.KINDS, detail names
// the strongest clue.

function makerIds(device) {
  return Object.keys(device.makers || {}).map(Number)
}

function serviceNames(device) {
  var out = []
  var uuids = device.uuids || []
  for (var i = 0; i < uuids.length; i++) {
    var known = Vendors.SERVICES[uuids[i]]
    if (known && out.indexOf(known[0]) < 0) out.push(known[0])
  }
  return out
}

function classify(device) {
  var makers = makerIds(device)
  var company = makers.length ? Vendors.COMPANIES[makers[0]] : null
  var vendor = company ? company[0] : ""
  var decoded = Decode.decode(device)
  var result = Object.assign({ kind: "unknown", vendor: vendor, detail: "", services: serviceNames(device) }, decoded)
  result.kind = "unknown"

  function settle(kind, detail) {
    if (result.kind === "unknown" && kind) {
      result.kind = kind
      if (detail && !result.detail) result.detail = detail
    }
  }

  // 0. What the payload itself spells out (AirPods model, Windows laptop…).
  if (decoded.kind) settle(decoded.kind, decoded.activity || "")
  // 1. Apple says which Continuity feature is talking.
  if (device.makers && device.makers["76"] !== undefined) {
    var apple = Vendors.APPLE[device.makers["76"]]
    if (apple) settle(apple[1], apple[0])
  }
  // 2. Microsoft's beacon type 1 is a Windows PC announcing itself.
  if (device.makers && device.makers["6"] === 1) settle("computer", "Windows PC")
  // 3. A classic device's declared class (phone, headset, printer…).
  var declared = device.class ? classInfo(device.class) : null
  if (declared) settle(declared[0], declared[1])
  // 3b. The device's declared appearance.
  settle(Vendors.APPEARANCE[Number(device.appearance || 0) >> 6] || "", "")
  // 4. BlueZ's own guess.
  settle(Vendors.BLUEZ_ICONS[device.icon] || "", "")
  // 5. Its name.
  var name = String(device.name || "").toLowerCase()
  for (var i = 0; i < Vendors.NAME_HINTS.length && name; i++)
    if (Vendors.NAME_HINTS[i][0].test(name)) { settle(Vendors.NAME_HINTS[i][1], ""); break }
  // 6. Services it offers.
  var uuids = device.uuids || []
  for (var j = 0; j < uuids.length; j++) {
    var service = Vendors.SERVICES[uuids[j]]
    if (service) {
      if (!result.vendor && service[2]) result.vendor = service[2]
      settle(service[1], service[0])
    }
  }
  // 7. What the company usually makes.
  if (company) settle(company[1], "")
  if (!result.detail && result.services.length) result.detail = result.services[0]
  return result
}

// Reads a classic Bluetooth class of device into [kind, detail], or null
// when the device didn't declare one.
function classInfo(cls) {
  cls = Number(cls) || 0
  var majorId = (cls >> 8) & 0x1f
  var minor = (cls >> 2) & 0x3f
  var major = Vendors.CLASS_MAJOR[majorId]
  if (!major) return null
  if (majorId === 4 && Vendors.CLASS_AUDIO[minor]) return Vendors.CLASS_AUDIO[minor]
  if (majorId === 7 && Vendors.CLASS_WEARABLE[minor]) return ["watch", Vendors.CLASS_WEARABLE[minor]]
  if (majorId === 5) {
    // Peripherals: bits 2–5 of the minor class say joystick or gamepad, its
    // top two bits keyboard or pointer.
    var shape = minor >> 4, sub = minor & 0x0f
    if (sub === 1 || sub === 2) return ["gamepad", sub === 1 ? "Joystick" : "Gamepad"]
    return ["input", ["", "Keyboard", "Pointing device", "Keyboard and pointer"][shape]]
  }
  return major
}

function kindLabel(kind) {
  return (Vendors.KINDS[kind] || Vendors.KINDS.unknown)[0]
}

function glyph(kind) {
  return (Vendors.KINDS[kind] || Vendors.KINDS.unknown)[1]
}

function durationText(seconds) {
  if (seconds < 60) return Math.max(1, Math.round(seconds)) + " s"
  var minutes = Math.floor(seconds / 60)
  return minutes < 60 ? minutes + " min" : Math.floor(minutes / 60) + " h " + (minutes % 60) + " min"
}

// Everything worth showing about one device, as [label, value] rows.
function details(device, nowMs, guard) {
  if (device.source === "wifi") return networkDetails(device, nowMs)
  var rows = [
    ["Type", kindLabel(device.kind) + (device.detail ? " (" + device.detail + ")" : "")],
    ["Maker", device.vendor || "Unknown"],
    ["Distance", distanceText(device.meters) + " (rough)"],
    ["Signal", Math.round(device.smoothed) + " dBm" + (Math.round(device.smoothed) !== device.rssi ? "  ·  now " + device.rssi : "")]
  ]
  if (device.model) rows.splice(1, 0, ["Model", device.model])
  if (device.battery && Decode.batteryText(device.battery)) rows.push(["Battery", Decode.batteryText(device.battery)])
  if (device.sensor && Decode.sensorText(device.sensor)) rows.push(["Reading", Decode.sensorText(device.sensor)])
  if (device.activity && device.activity !== device.detail) rows.push(["Activity", device.activity])
  if (device.tracker)
    rows.push([device.kind === "tracker" ? "Tracker" : "Find network", device.tracker.network
               + (device.tracker.separated ? "  ·  away from its owner" : "  ·  owner nearby")])
  if (device.glasses)
    rows.push(["Glasses", (device.glasses.level === "high" ? "Likely " : "Possibly ") + device.glasses.maker + " camera glasses"])
  if (isFinite(Number(device.txPower))) rows.push(["Transmit power", device.txPower + " dBm"])
  rows.push(["Radio", device.classic ? "Classic (discoverable)" : "Low Energy"])
  rows.push(["Address", device.addrType === "random" ? "Private, changes over time" : "Fixed (public)"])
  if (device.services && device.services.length) rows.push(["Services", device.services.join(", ")])
  var unnamed = makerIds(device).filter(function(id) { return !Vendors.COMPANIES[id] })
  if (unnamed.length) rows.push(["Company id", unnamed.join(", ")])
  if (device.connected) rows.push(["Connection", "Connected to this laptop"])
  rows.push(["Proximity lock", device.pkey ? "Can be used (fixed identity" + (device.paired ? ", paired)" : ")") : "No — changes its address"])
  if (device.aliases && device.aliases.length)
    rows.push(["Address changes", "Changed " + device.aliases.length + (device.aliases.length > 1 ? " times" : " time") + ", followed"])
  rows.push(["Seen for", durationText((nowMs - device.firstSeen) / 1000)])
  if (guard && guard.count > 1)
    rows.push(["Near you", durationText((guard.last - guard.first) / 1000) + ", seen " + guard.count + " times (Guard)"])
  if (device.trend) rows.push(["Movement", trendText(device.trend) + " (" + Math.abs(device.slope).toFixed(1) + " dB/s)"])
  if (Number(device.age) > LIVE_S) rows.push(["Last heard", durationText(device.age) + " ago"])
  else if (Number(device.n) > 0) rows.push(["Readings", device.n + " in the last second"])
  return rows
}

// Strongest signal first (smoothed when known, so rows don't jitter); ties
// keep a stable order by id.
function sortBySignal(devices) {
  function strength(d) { return isFinite(Number(d.smoothed)) ? Number(d.smoothed) : Number(d.rssi) }
  return devices.slice().sort(function(a, b) {
    return (strength(b) - strength(a)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

function rssiText(device) {
  return Math.round(Number(device.rssi)) + " dBm"
}

// ------------------------------------------------------------- position
//
// Bluetooth gives signal strength, not position. Distance comes from the
// log-distance path-loss model and is rough (±50–100 % indoors). Direction
// is not measurable with one antenna, so each device gets a stable but
// made-up angle derived from its id: it stays put on the radar while only
// its distance from the centre carries meaning.

var PATH_LOSS = 2.5        // 2 = open air, 3+ = walls and bodies
var SMOOTHING = 0.3        // EMA weight, for Wi-Fi's slow 20 s polls
var NEAREST_M = 0.5        // the radar's centre ring

// Exponential moving average so a blip doesn't jump with every reading.
function smoothRssi(previous, rssi) {
  if (!isFinite(Number(previous))) return Number(rssi)
  return previous + SMOOTHING * (Number(rssi) - previous)
}

// Bluetooth gets a Kalman filter instead: it trusts a second with many
// readings more than a lone one, lets the estimate drift while a device is
// silent, and follows someone walking faster than a fixed-weight average.
// Signal in dBm is the state; it is turned into metres only at the end.
var KALMAN_R = 16          // dB² noise of a single reading (±4 dB)
var KALMAN_Q = 1           // dB² per second the true signal may wander
// Hampel test: a second whose median sits further than this many robust
// deviations from the recent ones is a body or a wall in the way, not motion.
// Only a lone jump is dropped: two in a row the same way is someone moving.
var HAMPEL_K = 3
var HAMPEL_FLOOR = 6       // dB; one reading alone jitters about this much
var HISTORY = 8            // window medians kept per device (≈ 8 s)

function median(values) {
  var v = values.slice().sort(function(a, b) { return a - b })
  if (!v.length) return NaN
  var mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// Which way `value` is an outlier against `recent` (needs 4+ of them):
// -1 below, +1 above, 0 not an outlier.
function isOutlier(value, recent) {
  if (recent.length < 4) return 0
  var m = median(recent)
  var mad = median(recent.map(function(x) { return Math.abs(x - m) }))
  if (Math.abs(value - m) <= Math.max(HAMPEL_FLOOR, HAMPEL_K * 1.4826 * mad)) return 0
  return value < m ? -1 : 1
}

// One filter step. `prev` is the previous placed device (or {}), `reading` the
// helper's fields for this second, dt the seconds since the last step.
// Returns { smoothed, variance, history, held } (held: the side of a jump
// just dropped, so a second one the same way is believed).
function track(prev, reading, dt) {
  var history = (prev.history || []).slice()
  var n = Number(reading.n)
  if (!isFinite(n)) n = 1  // older helpers: one reading per snapshot
  var z = Number(reading.rssi)
  if (!isFinite(Number(prev.smoothed)))
    return { smoothed: z, variance: KALMAN_R, history: n > 0 ? [z] : [], held: 0 }
  var x = Number(prev.smoothed)
  var p = Number(prev.variance) + KALMAN_Q * Math.max(0, dt)
  var held = Number(prev.held) || 0
  if (n > 0) {
    var recent = history.slice()
    history.push(z)
    if (history.length > HISTORY) history.shift()
    var side = isOutlier(z, recent)
    held = side !== 0 && side !== held ? side : 0
    if (held === 0) {
      // The median of n readings is ~1.6× steadier than one reading per √n.
      var r = KALMAN_R / Math.max(1, 0.64 * n)
      var gain = p / (p + r)
      x += gain * (z - x)
      p *= 1 - gain
    }
  }
  return { smoothed: x, variance: p, history: history, held: held }
}

// ----------------------------------------------------------------- trend
//
// Getting closer or moving away, from the slope of the real readings (not
// the filtered estimate, which lags) over the last TREND_WINDOW_S. Theil–Sen
// (median of pairwise slopes) shrugs off a single body-blocked reading.
// Walking pace is ~11 dB/s at 1 m and ~1 dB/s at 10 m, so 1 dB/s is about
// the smallest move that stands out from ±4 dB noise; hysteresis keeps the
// arrow from flickering at the edge.
var TREND_WINDOW_S = 12
var TREND_ENTER = 1.0      // dB/s to call a trend
var TREND_EXIT = 0.4       // dB/s below which it is over

function slope(points) {
  var slopes = []
  for (var i = 0; i < points.length; i++)
    for (var j = i + 1; j < points.length; j++) {
      var dt = (points[j][0] - points[i][0]) / 1000
      if (dt > 0) slopes.push((points[j][1] - points[i][1]) / dt)
    }
  return slopes.length ? median(slopes) : 0
}

// Returns { trail, trend, slope }: trend is 1 closer, -1 away, 0 steady.
function trendStep(prev, reading, nowMs) {
  var trail = (prev.trail || []).filter(function(p) { return nowMs - p[0] <= TREND_WINDOW_S * 1000 })
  if (Number(reading.n) > 0 || reading.n === undefined) trail.push([nowMs, Number(reading.rssi)])
  var held = Number(prev.trend) || 0
  var span = trail.length > 1 ? (trail[trail.length - 1][0] - trail[0][0]) / 1000 : 0
  if (trail.length < 3 || span < 4) return { trail: trail, trend: 0, slope: 0 }
  var k = slope(trail)
  var trend = held
  if (held === 0 && Math.abs(k) >= TREND_ENTER) trend = k > 0 ? 1 : -1
  else if (held !== 0 && (Math.abs(k) < TREND_EXIT || (k > 0 ? 1 : -1) !== held)) trend = Math.abs(k) >= TREND_ENTER ? (k > 0 ? 1 : -1) : 0
  return { trail: trail, trend: trend, slope: k }
}

function trendText(trend) {
  return trend > 0 ? "Getting closer" : trend < 0 ? "Moving away" : ""
}

// How present a device is, from seconds since it was last heard: 1 while
// live, dimming briefly before the helper drops it at 12 s. With the scan
// restarts a device that is here is heard every ~3 s (90 % within 7 s).
var LIVE_S = 8
var FADED_S = 12

function presence(age) {
  age = Number(age)
  if (!isFinite(age) || age <= LIVE_S) return 1
  if (age >= FADED_S) return 0.25
  return 1 - 0.75 * (age - LIVE_S) / (FADED_S - LIVE_S)
}

// What this device should read from one metre away, best evidence first:
// your own calibration for its kind, else the TX power it advertises
// (measured at 0 m; ~41 dB is lost by one metre) when that is believable,
// else a guess per kind.
function referenceAt1m(device, calibration) {
  var calibrated = calibration ? Number(calibration[device.kind]) : NaN
  // Saved before the range check existed, a reference like -97 would put
  // every device of its kind "right next to you": ignore what can't be 1 m.
  if (isFinite(calibrated) && calibrated >= CALIBRATION_FLOOR && calibrated <= CALIBRATION_CEILING) return calibrated
  // Advertised TX power is the radio's setting, not what reaches you: Apple
  // says 12 dBm (→ -29 at 1 m) where a phone really reads -55…-65. Only a
  // value that lands in the plausible range is trusted.
  if (device.txPower !== undefined && device.txPower !== null && isFinite(Number(device.txPower))) {
    var fromTx = Number(device.txPower) - 41
    if (fromTx >= CALIBRATION_FLOOR && fromTx <= CALIBRATION_CEILING) return fromTx
  }
  return (Vendors.KINDS[device.kind] || Vendors.KINDS.unknown)[2]
}

function distanceMeters(rssi, atOneMeter, pathLoss) {
  return Math.pow(10, (Number(atOneMeter) - Number(rssi)) / (10 * (pathLoss || PATH_LOSS)))
}

// Calibration says "this device is one metre away right now": its smoothed
// signal becomes the 1 m reference for every device of its kind. Returns a
// new calibration object.
// Weaker than this can't be one metre away: calibrating it would make every
// device of its kind read "right next to you". Returns why not, or "".
var CALIBRATION_FLOOR = -85
// Stronger than this is a device lying on the laptop, not one metre off.
var CALIBRATION_CEILING = -50

function calibrationProblem(device) {
  if (device.smoothed < CALIBRATION_FLOOR)
    return "Too weak to be 1 m away (" + Math.round(device.smoothed) + " dBm) — bring it closer first"
  if (device.smoothed > CALIBRATION_CEILING)
    return "Too strong for 1 m (" + Math.round(device.smoothed) + " dBm) — move it a metre away first"
  return ""
}

// A stored reference the radar actually uses (see referenceAt1m).
function calibrationValid(value) {
  value = Number(value)
  return isFinite(value) && value >= CALIBRATION_FLOOR && value <= CALIBRATION_CEILING
}

// "watches", "TV / display devices": for messages about a whole kind.
function kindPhrase(kind) {
  var label = kindLabel(kind).toLowerCase()
  if (/glasses$/.test(label)) return label
  if (label.indexOf("/") >= 0 || /(audio|fitness|device)$/.test(label)) return label.replace(/ devices?$/, "") + " devices"
  return /(ch|sh|s|x)$/.test(label) ? label + "es" : label + "s"
}

// Drops one kind's calibration, back to the built-in guess.
function clearCalibration(calibration, kind) {
  var next = Object.assign({}, calibration || {})
  delete next[kind]
  return next
}

function calibrate(calibration, device) {
  var next = Object.assign({}, calibration || {})
  next[device.kind] = Math.round(device.smoothed)
  return next
}

// 0 at the centre, 1 at the rim. Log scale, so the room you are in gets
// most of the radar instead of being squashed into the middle.
function radius(meters, maxMeters) {
  var span = Math.log(maxMeters / NEAREST_M)
  return Math.max(0, Math.min(1, Math.log(Math.max(meters, NEAREST_M) / NEAREST_M) / span))
}

// Degrees clockwise from north. The id is already a hash, so its leading
// hex digits are evenly spread.
function angle(id) {
  return parseInt(String(id).slice(0, 6), 16) % 360
}

function distanceText(meters) {
  if (meters < 1) return "< 1 m"
  if (meters < 10) return "~" + Math.round(meters) + " m"
  return "~" + Math.round(meters / 5) * 5 + " m"
}

// Adds smoothed signal and position to a fresh snapshot, carrying the
// smoothing forward from the previous one. Returns new objects; inputs are
// left alone.
// Also stamps when each device was first seen and what it probably is.
// ------------------------------------------------------- address changes
//
// Phones, watches and laptops change their private address every 8–15 min,
// which would make one device look like two. Two ways to tell:
// - a stableKey (an address inside the payload) shared by two entries is
//   certain: one device;
// - one entry going quiet just as a newcomer appears, with the same
//   fingerprint and a similar signal, is likely. Linked only when it is the
//   only candidate on both sides, so two iPhones in a room stay two.
var LINK_QUIET_S = 3       // the old address has gone quiet for this long
var LINK_FRESH_S = 3       // the newcomer was heard within this
var LINK_RSSI_DB = 10      // and reads within this of the old one
var LINK_WINDOW_MS = 5000  // a newcomer can still be linked this long after it appears
var ALIASES_KEPT = 8

function specific(fp) {
  return fp !== "" && fp.indexOf("unknown|") !== 0
}

// items: [{ d, identity }] for one snapshot; byHid: previous placed devices
// by helper id. Sets item.prev (whose history it inherits) and item.aliases
// (helper ids folded into it); returns the items left.
function linkRotations(items, byHid, nowMs) {
  var groups = {}, keep = []
  items.forEach(function(it) {
    var key = it.identity.stableKey
    if (!key) { keep.push(it); return }
    if (!groups[key]) { groups[key] = []; keep.push(groups[key]) }
    groups[key].push(it)
  })
  items = keep.map(function(g) {
    if (!Array.isArray(g)) return g
    g.sort(function(a, b) { return Number(a.d.age) - Number(b.d.age) })
    var keeper = g[0]
    keeper.aliases = g.slice(1).map(function(it) { return it.d.id })
    for (var i = 0; i < g.length && !keeper.prev; i++) keeper.prev = byHid[g[i].d.id]
    return keeper
  })
  var fresh = {}, quiet = {}
  items.forEach(function(it) {
    var fp = fingerprint(Object.assign({ name: it.d.name }, it.identity))
    if (!specific(fp)) return
    var seen = byHid[it.d.id]
    // A newcomer: not placed before, or only just (the old address may take
    // a few seconds to fall quiet), and never linked to anything yet.
    var recent = !seen || (nowMs - seen.firstSeen < LINK_WINDOW_MS && seen.id === seen.hid && !(seen.aliases || []).length)
    if (recent && !it.prev && Number(it.d.age) < LINK_FRESH_S) (fresh[fp] = fresh[fp] || []).push(it)
    else if (seen && Number(it.d.age) >= LINK_QUIET_S) (quiet[fp] = quiet[fp] || []).push(it)
  })
  var gone = {}
  for (var fp in fresh) {
    var q = quiet[fp]
    if (fresh[fp].length !== 1 || !q || q.length !== 1) continue
    var newcomer = fresh[fp][0], old = q[0], before = byHid[old.d.id]
    if (Math.abs(Number(newcomer.d.rssi) - Number(before.smoothed)) > LINK_RSSI_DB) continue
    newcomer.prev = before
    newcomer.aliases = [old.d.id]
    gone[old.d.id] = true
  }
  return items.filter(function(it) { return !gone[it.d.id] })
}

// Adds smoothed signal and position to a fresh snapshot, carrying the
// smoothing forward from the previous one. Returns new objects; inputs are
// left alone.
// Also stamps when each device was first seen and what it probably is.
// `id` stays the same across address changes; `hid` is the helper's id now.
function place(devices, previous, maxMeters, nowMs, calibration) {
  var byHid = {}, folded = {}
  previous.forEach(function(p) {
    byHid[p.hid || p.id] = p
    ;(p.aliases || []).forEach(function(a) { folded[a] = true })
  })
  var items = devices
    .filter(function(d) { return !folded[d.id] || byHid[d.id] })
    .map(function(d) { return { d: d, identity: classify(d) } })
  items = linkRotations(items, byHid, nowMs)
  return items.map(function(it) {
    var d = it.d, identity = it.identity
    var prev = it.prev || byHid[d.id] || {}
    var id = prev.id || d.id
    var dt = prev.updatedMs ? (nowMs - prev.updatedMs) / 1000 : 1
    var signal = track(prev, d, dt)
    var motion = trendStep(prev, d, nowMs)
    var meters = distanceMeters(signal.smoothed, referenceAt1m({ kind: identity.kind, txPower: d.txPower }, calibration))
    var aliases = (prev.aliases || []).concat(it.aliases || []).filter(function(a) { return a !== d.id }).slice(-ALIASES_KEPT)
    return Object.assign({}, d, identity, {
      id: id,
      hid: d.id,
      aliases: aliases,
      smoothed: signal.smoothed,
      variance: signal.variance,
      history: signal.history,
      held: signal.held,
      trail: motion.trail,
      trend: motion.trend,
      slope: motion.slope,
      updatedMs: nowMs,
      presence: presence(d.age),
      meters: meters,
      radius: radius(meters, maxMeters),
      angle: prev.angle !== undefined ? prev.angle : angle(id),
      firstSeen: prev.firstSeen || nowMs,
      source: "bt"
    })
  })
}

// ----------------------------------------------------------------- Wi-Fi
//
// From bin/m-radar-wifi: {"networks": [{id, ssid, channel, band, signal
// (0–100), security, inUse, vendor}]}. Access points shout (~20 dBm) through
// walls, so they get their own 1 m reference and a steeper path loss.

var WIFI_AT_1M = -35
var WIFI_PATH_LOSS = 3.0

function parseWifi(line) {
  var data
  try {
    data = JSON.parse(String(line || ""))
  } catch (e) {
    return null
  }
  if (!data || typeof data !== "object") return null
  if (typeof data.error === "string") return { error: data.error }
  if (!Array.isArray(data.networks)) return null
  return {
    networks: data.networks.filter(function(n) {
      return !!n && typeof n.id === "string" && n.id !== "" && isFinite(Number(n.signal))
    })
  }
}

// NetworkManager's 0–100 strength is a linear map of -100…-40 dBm
// (nm_wifi_utils_level_to_quality); checked against `iw` scan dumps.
function signalToDbm(percent) {
  return Math.round(Math.max(0, Math.min(100, Number(percent))) * 0.6 - 100)
}

// "HUAWEI TECHNOLOGIES CO.,LTD" → "Huawei", "zte corporation" → "ZTE".
// Companies whose name the tidy-up below would get wrong.
var VENDOR_NAMES = { "tp-link": "TP-Link", "zte": "ZTE", "huawei": "Huawei", "d-link": "D-Link" }

function shortVendor(name) {
  var words = String(name || "")
    .replace(/[,.]?\s*(co\.?,?\s*ltd\.?|corporation|corp\.?|inc\.?|ltd\.?|llc|gmbh|systems|technologies|technology|electronics|limited|international)\b.*$/i, "")
    .trim().split(/\s+/)
  if (!words[0]) return ""
  var known = VENDOR_NAMES[words[0].toLowerCase()]
  if (known) return known
  // Mixed case ("TP-Link") is already how the company writes itself; only
  // shouting or all-lowercase registry entries get tidied.
  return words.slice(0, 2).map(function(w) {
    if (w !== w.toUpperCase() && w !== w.toLowerCase()) return w
    return w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  }).join(" ")
}

function classifyNetwork(n) {
  var ssid = String(n.ssid || "")
  if (/^DIRECT-/i.test(ssid)) {
    if (/epson|hp-|canon|brother|print|series/i.test(ssid)) return { kind: "printer", detail: "Wi-Fi Direct" }
    if (/tv|bravia|roku|cast/i.test(ssid)) return { kind: "tv", detail: "Wi-Fi Direct" }
    return { kind: "iot", detail: "Wi-Fi Direct" }
  }
  if (/^proj|projector|\btv\b|bravia|chromecast/i.test(ssid)) return { kind: "tv", detail: "" }
  return { kind: "router", detail: "" }
}

function networkLabel(n) {
  if (String(n.ssid || "") !== "") return n.ssid + (n.sameNameOtherBand ? " · " + n.band : "")
  return n.band ? "Hidden network · " + n.band + (n.channel ? " ch " + n.channel : "") : "Hidden network"
}

// One router often shows up several times: a repeater or mesh node with the
// same name and band, and hidden companion networks (IPTV, mesh backhaul)
// on the same channel at the same strength. Folds those into one entry,
// kept under the smallest member id so it doesn't change as signals shuffle.
var SAME_ROUTER_SIGNAL = 6   // % of NetworkManager strength

function mergeNetworks(networks) {
  var groups = {}, order = []
  networks.forEach(function(n) {
    if (String(n.ssid || "") === "") return
    var key = n.ssid + "\u0000" + n.band
    if (!groups[key]) { groups[key] = []; order.push(key) }
    groups[key].push(n)
  })
  var merged = order.map(function(key) {
    var members = groups[key].slice().sort(function(a, b) { return b.signal - a.signal })
    var ids = members.map(function(m) { return m.id }).sort()
    return Object.assign({}, members[0], {
      id: ids[0], aps: members.length, hiddenSiblings: 0,
      inUse: members.some(function(m) { return m.inUse }),
      radios: members.map(function(m) { return [m.channel, m.signal] })
    })
  })
  // A hidden network belongs to whichever access point it matches, not
  // only the strongest one of a group.
  networks.forEach(function(n) {
    if (String(n.ssid || "") !== "") return
    for (var i = 0; i < merged.length; i++) {
      var m = merged[i]
      if (m.radios && m.radios.some(function(r) { return r[0] === n.channel && Math.abs(r[1] - n.signal) <= SAME_ROUTER_SIGNAL })) {
        m.hiddenSiblings++
        return
      }
    }
    merged.push(Object.assign({}, n, { aps: 1, hiddenSiblings: 0 }))
  })
  // The same name on 2.4 and 5 GHz: say which row is which.
  var bands = {}
  merged.forEach(function(m) { if (m.ssid) bands[m.ssid] = (bands[m.ssid] || 0) + 1 })
  merged.forEach(function(m) { m.sameNameOtherBand = !!m.ssid && bands[m.ssid] > 1; delete m.radios })
  return merged
}

function placeNetworks(networks, previous, maxMeters, nowMs) {
  networks = mergeNetworks(networks)
  var before = {}
  for (var i = 0; i < previous.length; i++) before[previous[i].id] = previous[i]
  return networks.map(function(n) {
    var prev = before[n.id] || {}
    var rssi = signalToDbm(n.signal)
    var smoothed = smoothRssi(prev.smoothed, rssi)
    var meters = distanceMeters(smoothed, WIFI_AT_1M, WIFI_PATH_LOSS)
    var identity = classifyNetwork(n)
    return Object.assign({}, n, identity, {
      source: "wifi",
      name: networkLabel(n),
      vendor: shortVendor(n.vendor),
      rssi: rssi,
      smoothed: smoothed,
      meters: meters,
      radius: radius(meters, maxMeters),
      angle: angle(n.id),
      firstSeen: prev.firstSeen || nowMs
    })
  })
}

function networkDetails(n, nowMs) {
  var rows = [
    ["Type", (n.kind === "router" ? "Wi-Fi network" : kindLabel(n.kind)) + (n.detail ? " (" + n.detail + ")" : "")],
    ["Maker", n.vendor || "Unknown"],
    ["Distance", distanceText(n.meters) + " (rough)"],
    ["Signal", n.signal + " %  ·  " + n.rssi + " dBm"],
    ["Band", n.band + "  ·  channel " + n.channel],
    ["Security", n.security]
  ]
  if (n.aps > 1) rows.push(["Access points", n.aps + " with this name (repeater or mesh)"])
  if (n.hiddenSiblings > 0) rows.push(["Also broadcasts", n.hiddenSiblings + " hidden network" + (n.hiddenSiblings > 1 ? "s" : "")])
  if (n.inUse) rows.push(["Connection", "This laptop is on it"])
  rows.push(["Seen for", durationText((nowMs - n.firstSeen) / 1000)])
  return rows
}

// details() as one flat [label, value, label, value, …] list for a Grid.
function flatDetails(device, nowMs, guard) {
  return details(device, nowMs, guard).reduce(function(all, row) { return all.concat(row) }, [])
}

// ------------------------------------------------------------------ find
//
// Hot/cold for one device you are walking around to find. Signal, not
// metres: the bar should move the moment you take a step, and the 1 m guess
// per kind would only add its own error.

var FIND_COLD = -95        // dBm: barely heard
var FIND_HOT = -45         // dBm: within arm's reach

function findLevel(device) {
  if (!device) return 0
  var dbm = Number(device.smoothed)
  if (!isFinite(dbm)) return 0
  return Math.max(0, Math.min(1, (dbm - FIND_COLD) / (FIND_HOT - FIND_COLD)))
}

function findWord(level, lost) {
  if (lost) return "Signal lost — keep moving slowly"
  if (level > 0.85) return "Very hot — it's within reach"
  if (level > 0.65) return "Hot"
  if (level > 0.45) return "Warm"
  if (level > 0.25) return "Cool"
  return "Cold"
}

// Seconds between Geiger clicks: slow ticks when cold, a buzz when hot.
function clickInterval(level) {
  // At most 5 a second: each click is a short pw-play process.
  return Math.max(200, Math.round(1000 / (0.5 + 9.5 * level * level)))
}

// What identifies a device across an address change: a stable key found in
// its payload if any, else what it is and who made it.
function fingerprint(d) {
  if (!d) return ""
  if (d.stableKey) return d.stableKey
  return [d.kind, d.vendor || "", d.model || "", String(d.name || "")].join("|")
}

// The device being followed vanished (phones and watches change address
// every 8–15 min): the best stand-in heard since, with the same fingerprint.
function reacquire(lost, devices) {
  var want = fingerprint(lost)
  if (!specific(want) || want.split("|").slice(1).join("") === "") return null
  var best = null
  for (var i = 0; i < devices.length; i++) {
    var d = devices[i]
    if (d.id === lost.id || fingerprint(d) !== want) continue
    if (!best || d.smoothed > best.smoothed) best = d
  }
  return best
}

// ----------------------------------------------------------------- guard
//
// Guard mode watches for a tracker that stays with you and for camera
// glasses nearby. Time only (a laptop has no GPS): AirGuard's defaults with
// location switched off — 3+ sightings spread over 30+ minutes — counting
// only trackers that say they are away from their owner. Phones in Samsung
// Find's offline mode are left out: every Galaxy phone can send it.

var GUARD_SIGHTINGS = 3
var GUARD_SPAN_MS = 30 * 60000
var GUARD_SIGHTING_GAP_MS = 60000     // one sighting per minute at most
var GUARD_REALERT_MS = 4 * 3600000
var GUARD_FORGET_MS = 2 * 3600000
var GLASSES_RSSI = -75                // nearer than ~5 m
var GLASSES_REALERT_MS = 10 * 60000

function suspectTracker(d) {
  return !!d.tracker && d.tracker.separated && d.tracker.what !== "Galaxy device offline"
    && (d.kind === "tracker" || d.tracker.what === "AirPods")
}

function suspectGlasses(d) {
  return !!d.glasses && d.glasses.level !== "low" && Number(d.smoothed) >= GLASSES_RSSI
}

// Folds one snapshot into the guard log ({key: entry}). Returns { log,
// alerts }: each alert is { kind: "tracker" | "glasses", title, body, id }.
function guardStep(log, devices, nowMs) {
  var next = {}, alerts = []
  for (var key in log) if (nowMs - log[key].last < GUARD_FORGET_MS) next[key] = Object.assign({}, log[key])
  devices.forEach(function(d) {
    var tracker = suspectTracker(d), glasses = suspectGlasses(d)
    if (!tracker && !glasses) return
    var key = (tracker ? "t:" : "g:") + (d.stableKey || d.id)
    var e = next[key] || { first: nowMs, last: null, count: 0, alerted: null }
    if (e.last === null || nowMs - e.last >= GUARD_SIGHTING_GAP_MS) e.count++
    e.last = nowMs
    e.label = label(d)
    e.id = d.id
    next[key] = e
    if (tracker && e.count >= GUARD_SIGHTINGS && e.last - e.first >= GUARD_SPAN_MS
        && (e.alerted === null || nowMs - e.alerted >= GUARD_REALERT_MS)) {
      e.alerted = nowMs
      alerts.push({ kind: "tracker", id: d.id, title: "A tracker may be following you",
        body: e.label + " (" + d.tracker.network + ", away from its owner) has been near you for "
          + durationText((e.last - e.first) / 1000) + ", seen " + e.count + " times. Now " + distanceText(d.meters) + " away." })
    } else if (glasses && (e.alerted === null || nowMs - e.alerted >= GLASSES_REALERT_MS)) {
      e.alerted = nowMs
      alerts.push({ kind: "glasses", id: d.id, title: "Camera glasses may be nearby",
        body: (d.glasses.level === "high" ? "Likely " : "Possibly ") + d.glasses.maker + " glasses, "
          + distanceText(d.meters) + " away. They mostly advertise when switched on or pairing, so silence proves nothing." })
    }
  })
  return { log: next, alerts: alerts }
}

// The log entry for a device, for its details (how long it has been near).
function guardEntry(log, device) {
  if (!log || !device) return null
  for (var key in log) if (log[key].id === device.id) return log[key]
  return null
}

// ------------------------------------------------------- proximity lock
//
// Locks the screen when the device you carry (phone, watch) leaves. Only
// ever locks, never unlocks: a radio signal can be relayed. Locks only when
// the device has been away for a while AND the laptop is idle, so it never
// fires while you are using it, and warns first so you can cancel.

var PROX_DROP_DB = 12      // weaker than when armed by this much = walked off
var PROX_AWAY_S = 20       // away this long before warning
var PROX_WARN_S = 5        // the warning, then lock

// Can this device be remembered for the lock? Needs a fixed identity.
function lockable(d) {
  return !!d && d.source === "bt" && !!d.pkey
}

function lockProblem(d) {
  if (!d || d.source !== "bt") return "Pick a Bluetooth device you carry"
  if (!d.pkey) return "This device changes its address — pair it with the laptop first"
  if (Number(d.smoothed) < -85) return "Too far to arm — keep it with you at the laptop"
  return ""
}

// One step of the lock's state machine. `st` = { phase, since }, phase one of
// "near" | "away" | "warning" | "locked". Returns the next state plus
// `action` ("", "warn", "cancel", "lock").
function proximityStep(st, target, nowMs, idle, live, baseline) {
  st = st || { phase: "near", since: nowMs }
  if (!live) return { phase: st.phase === "locked" ? "locked" : "near", since: nowMs, action: st.phase === "warning" ? "cancel" : "" }
  var away = !target || Number(target.smoothed) < Number(baseline) - PROX_DROP_DB
  var held = (nowMs - st.since) / 1000
  if (st.phase === "locked") return { phase: away ? "locked" : "near", since: away ? st.since : nowMs, action: "" }
  if (!away) return { phase: "near", since: st.phase === "near" ? st.since : nowMs, action: st.phase === "warning" ? "cancel" : "" }
  if (st.phase === "near") return { phase: "away", since: nowMs, action: "" }
  if (st.phase === "away")
    return held >= PROX_AWAY_S && idle ? { phase: "warning", since: nowMs, action: "warn" } : { phase: "away", since: st.since, action: "" }
  // warning
  if (!idle) return { phase: "away", since: nowMs, action: "cancel" }
  return held >= PROX_WARN_S ? { phase: "locked", since: nowMs, action: "lock" } : { phase: "warning", since: st.since, action: "" }
}

function proximityText(st, label, nowMs) {
  if (!st) return ""
  var s = Math.round((nowMs - st.since) / 1000)
  if (st.phase === "away") return label + " away " + s + " s"
  if (st.phase === "warning") return "Locking in " + Math.max(0, PROX_WARN_S - s) + " s"
  if (st.phase === "locked") return "Locked — waiting for " + label
  return label + " near"
}

// --------------------------------------------------------------- filters
//
// F cycles how far to look (all, 10 m, 3 m); U hides what we can't name.
// The selected device always stays, so a filter never yanks it away.

var RANGE_FILTERS = [0, 10, 3]

function nextRangeFilter(current) {
  var i = RANGE_FILTERS.indexOf(Number(current))
  return RANGE_FILTERS[(i + 1) % RANGE_FILTERS.length]
}

function unidentified(d) {
  return d.kind === "unknown" && !String(d.name || "").trim() && !d.model
}

function filterDevices(devices, rangeMeters, hideUnknown, keepId) {
  return devices.filter(function(d) {
    if (keepId && d.id === keepId) return true
    if (rangeMeters > 0 && d.meters > rangeMeters) return false
    if (hideUnknown && unidentified(d)) return false
    return true
  })
}

function filterText(rangeMeters, hideUnknown) {
  var parts = []
  if (rangeMeters > 0) parts.push("within " + rangeMeters + " m")
  if (hideUnknown) parts.push("named only")
  return parts.join(" · ")
}

// Just showed up: first heard in the last 20 s, once the scan has been going
// long enough that "first heard" means arrived, not "scan started".
var NEW_FOR_MS = 20000

function isNew(device, nowMs, scanStartedMs) {
  return device.source === "bt" && scanStartedMs > 0
    && device.firstSeen - scanStartedMs > NEW_FOR_MS && nowMs - device.firstSeen < NEW_FOR_MS
}

// ------------------------------------------------------------------ list
//
// One flat list for the popout: a header row per section, then its items.
// Every row is the same height, so row index × height is its position.

function buildRows(devices, networks, hidden, hiddenNetworks) {
  var rows = []
  if (devices.length || hidden) rows.push({ header: "NEARBY · " + devices.length + (hidden ? "  (" + hidden + " hidden)" : "") })
  rows = rows.concat(devices)
  if (networks.length || hiddenNetworks) rows.push({ header: "WI-FI · " + networks.length + (hiddenNetworks ? "  (" + hiddenNetworks + " hidden)" : "") })
  return rows.concat(networks)
}

// The next selectable row from `from` in direction `step` (±1), skipping
// headers; stays put at either end. from = -1 means nothing selected yet.
function nextRow(rows, from, step) {
  var i = from < 0 ? (step > 0 ? -1 : rows.length) : from
  for (i += step; i >= 0 && i < rows.length; i += step)
    if (!rows[i].header) return i
  return from
}
