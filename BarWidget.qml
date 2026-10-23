import QtQuick
import Quickshell.Bluetooth
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar button and popout for the radar. All scan state lives in the shared
// service (Service.qml); this widget only shows it and forwards the toggle,
// so every monitor's bar agrees.
//
// Left click opens the popout, right click toggles the scan — the same split
// the stock Bluetooth button uses for its power.
Panel {
  id: root
  moduleName: "m.radar"

  readonly property var radar: bar && bar.shell ? bar.shell.serviceFor("m.radar") : null
  readonly property bool scanOn: !!radar && radar.wanted
  readonly property var allDevices: radar ? radar.devices : []
  // What F (range) and U (named only) leave; the selected device always stays.
  readonly property var devices: radar ? Model.filterDevices(allDevices, radar.rangeFilter, radar.hideUnknown, selectedId) : []
  readonly property string filterText: radar ? Model.filterText(radar.rangeFilter, radar.hideUnknown) : ""
  readonly property bool showWifi: !!radar && radar.showWifi
  readonly property bool classic: !!radar && radar.classic
  readonly property var networks: radar && showWifi ? Model.filterDevices(radar.networks, radar.rangeFilter, false, selectedId) : []
  // The list: section headers plus every device and network.
  readonly property var allNetworks: radar && showWifi ? radar.networks : []
  readonly property var rows: Model.buildRows(devices, networks, allDevices.length - devices.length, allNetworks.length - networks.length)
  // Not 󰐷: weather-radar already uses that glyph in the same bar.
  readonly property string icon: "󰓾"

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.4)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // Ticks while the popout is open so countdowns stay honest.
  property double nowMs: Date.now()

  readonly property string statusText: {
    if (!radar) return "Unavailable"
    if (radar.error !== "") return "Error"
    if (!scanOn) {
      var off = radar.guard ? (radar.bursting ? "Guard · checking" : "Off · guard on") : "Off"
      return radar.proximityArmed ? off + " · " + radar.proximityText : off
    }
    if (!radar.scanning) return "Starting…"
    // Filtered: say "3 of 5", so the count agrees with the list below.
    var shown = devices.length, total = allDevices.length
    var count = (shown !== total ? shown + " of " + total : String(total)) + (total === 1 ? " device nearby" : " devices nearby")
    if (allNetworks.length)
      count += " · " + (networks.length !== allNetworks.length ? networks.length + " of " + allNetworks.length : allNetworks.length) + " Wi-Fi"
    if (filterText) count += " · " + filterText
    if (radar.proximityArmed) count += " · " + radar.proximityText
    if (radar.stopsAtMs <= 0) return count
    var minutes = Math.max(1, Math.min(radar.autoStopMinutes, Math.ceil((radar.stopsAtMs - nowMs) / 60000)))
    return count + " · off in " + minutes + " min"
  }

  // Scanning shares the radio with Bluetooth audio and can make it stutter
  // (the stock Bluetooth panel notes the same), so say so when it applies.
  readonly property bool audioConnected: {
    var list = Bluetooth.devices ? Bluetooth.devices.values : []
    for (var i = 0; i < list.length; i++)
      if (list[i].connected && String(list[i].icon).indexOf("audio") === 0) return true
    return false
  }

  // A short line under the hero after an action, e.g. calibration.
  property string notice: ""

  function calibrateSelected() {
    // Access points need no calibration: they all shout about the same.
    if (!radar || !selected || selected.source !== "bt") return
    var problem = Model.calibrationProblem(selected)
    if (problem) {
      notice = problem
      noticeTimer.restart()
      return
    }
    radar.calibrate(selected)
    notice = "Calibrated: " + Model.kindPhrase(selected.kind) + " at "
      + Math.round(selected.smoothed) + " dBm now read 1 m"
    noticeTimer.restart()
  }

  // Only calibrations the radar actually uses: old out-of-range ones are
  // ignored (Model.referenceAt1m), so offering to reset them would mislead.
  readonly property bool selectedCalibrated: !!radar && !!selected && selected.source === "bt"
    && Model.calibrationValid(radar.calibration[selected.kind])

  function clearSelectedCalibration() {
    if (!selectedCalibrated) return
    radar.clearCalibration(selected.kind)
    notice = "Calibration cleared for " + Model.kindPhrase(selected.kind)
    noticeTimer.restart()
  }

  // The shell injects settings into widgets but not services.
  function syncService() {
    if (radar) radar.settings = root.settings
  }
  onSettingsChanged: syncService()
  onRadarChanged: syncService()
  onOpenedChanged: if (opened) nowMs = Date.now()

  Connections {
    target: root.radar
    function onShowRequested() { root.toggle() }
    // Find mode may follow the device to a new address: keep it selected.
    function onFindIdChanged() { if (root.radar.finding) root.selectedId = root.radar.findId }
  }
  onScanOnChanged: nowMs = Date.now()

  Timer {
    interval: 15000
    running: root.opened && root.scanOn
    repeat: true
    onTriggered: root.nowMs = Date.now()
  }

  Timer {
    id: noticeTimer
    interval: 5000
    onTriggered: root.notice = ""
  }

  function toggleScan() {
    if (radar) radar.toggle()
  }

  function toggleWifi() {
    if (radar) radar.toggleWifi()
  }

  function toggleClassic() {
    if (radar) radar.toggleClassic()
  }

  // L: find the selected device (or stop finding); M: Geiger clicks.
  function toggleFind() {
    if (!radar) return
    if (radar.finding) radar.stopFind()
    else if (selected && selected.source === "bt") radar.startFind(selected)
  }

  function toggleFindSound() {
    if (radar && radar.finding) radar.toggleFindSound()
  }

  function cycleRangeFilter() {
    if (radar) radar.cycleRangeFilter()
  }

  function toggleHideUnknown() {
    if (radar) radar.toggleHideUnknown()
  }

  // K: lock the screen when the picked device (the one you carry) leaves.
  function toggleProximity() {
    if (!radar) return
    if (radar.proximityArmed) {
      radar.disarmProximity()
      notice = "Proximity lock off"
    } else {
      var problem = radar.armProximity(selected)
      notice = problem !== "" ? problem
        : "Proximity lock on: the screen locks when " + Model.label(selected) + " has been away 20 s and the laptop is idle."
    }
    noticeTimer.restart()
  }

  function toggleGuard() {
    if (!radar) return
    radar.toggleGuard()
    notice = radar.guard
      ? "Guard on: checks for trackers following you and camera glasses nearby, a short scan every 2 min."
      : "Guard off"
    noticeTimer.restart()
  }

  // ---------------------------------------------------------- selection
  //
  // Arrow keys walk the list, skipping section headers. The selection
  // follows the device, not the row, because rows re-sort every second.

  property string selectedId: ""
  readonly property int selectedIndex: {
    for (var i = 0; i < rows.length; i++) if (!rows[i].header && rows[i].id === selectedId) return i
    return -1
  }
  readonly property var selected: selectedIndex >= 0 ? rows[selectedIndex] : null
  readonly property int rowHeight: Style.space(26)

  function select(index) {
    if (index < 0 || index >= rows.length || rows[index].header) return
    selectedId = rows[index].id
    revealSelected()
  }

  // Keep the chosen row in view. Also runs when the details panel opens and
  // shrinks the list, which would otherwise hide the row just picked.
  function revealSelected() {
    if (selectedIndex < 0) return
    var top = selectedIndex * rowHeight
    if (top < listFlick.contentY) listFlick.contentY = top
    else if (top + rowHeight > listFlick.contentY + listFlick.height)
      listFlick.contentY = top + rowHeight - listFlick.height
  }

  // Rows re-sort every second; keep the picked one in view as it moves.
  onSelectedIndexChanged: Qt.callLater(revealSelected)

  function moveSelection(step) {
    select(Model.nextRow(rows, selectedIndex, step))
  }

  // Escape steps back out: first the selection, then the popout.
  function back() {
    if (radar && radar.finding) radar.stopFind()
    else if (selected) selectedId = ""
    else close()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.icon
    active: root.scanOn
    // Scanning is a state, not an alarm: accent, not the bar's urgent red.
    activeColor: Color.accent
    tooltipText: "Radar · " + root.statusText
    onPressed: function(b) {
      if (b === Qt.RightButton) root.toggleScan()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(660))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.back()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onMoveRequested: function(dx, dy) { if (dy !== 0) root.moveSelection(dy) }
      onActivateRequested: root.toggleScan()
      // Keys that change something lasting (calibration, the screen lock,
      // Guard) need Shift: a stray lowercase letter typed while the popout
      // had focus — YouTube's k and c, say — must not arm a lock.
      onTextKey: function(t) {
        if (t === "s" || t === "S") root.toggleScan()
        else if (t === "C") root.calibrateSelected()
        else if (t === "w" || t === "W") root.toggleWifi()
        else if (t === "b" || t === "B") root.toggleClassic()
        else if (t === "R") root.clearSelectedCalibration()
        else if (t === "f" || t === "F") root.cycleRangeFilter()
        else if (t === "u" || t === "U") root.toggleHideUnknown()
        else if (t === "l" || t === "L") root.toggleFind()
        else if (t === "G") root.toggleGuard()
        else if (t === "K") root.toggleProximity()
        else if (t === "m" || t === "M") root.toggleFindSound()
      }

      Column {
        id: column
        anchors.fill: parent
        spacing: Style.space(14)

        // ---------- Hero: radar icon · status · switch ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight, scanSwitch.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: root.icon
            color: root.scanOn ? Color.accent : root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.display
            opacity: root.scanOn ? 1.0 : 0.5
          }

          ToggleSwitch {
            id: scanSwitch
            checked: root.scanOn
            busy: root.scanOn && !!root.radar && !root.radar.scanning
            foreground: root.foreground
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            onToggled: root.toggleScan()

            PanelToolTip {
              visible: scanSwitch.containsMouse
              text: (root.scanOn ? "Stop scanning (S)" : "Scan for nearby devices (S)") + "\n↑ ↓ pick · L find · ⇧C calibrate · F range · U named only · ⇧G guard · ⇧K lock when away · W Wi-Fi · B classic Bluetooth · Esc back"
              fontFamily: root.fontFamily
            }
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.rightMargin: scanSwitch.width + Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "Radar"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
              elide: Text.ElideRight
              width: parent.width
            }

            Text {
              textFormat: Text.PlainText
              text: root.statusText.toUpperCase()
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }
        }

        // ---------- Notices: audio warning, last action ----------
        Text {
          visible: text !== ""
          width: parent.width
          textFormat: Text.PlainText
          wrapMode: Text.WordWrap
          color: root.notice !== "" ? Color.accent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          text: root.notice !== "" ? root.notice
            : (root.scanOn && root.audioConnected
              ? (root.classic ? "Bluetooth audio is connected — classic scanning (B) can make it stutter." : "Bluetooth audio is connected — scanning can make it stutter.")
              : "")
        }

        PanelSeparator {
          foreground: root.foreground
        }

        // ---------- Scope · nearby · details ----------
        Row {
          width: parent.width
          spacing: Style.space(18)

          Radar {
            id: scope
            width: Style.space(300)
            height: width
            devices: root.devices.concat(root.networks)
            selectedId: root.selectedId
            maxMeters: root.radar ? root.radar.maxMeters : 10
            // The sweep only turns while you are looking at it.
            active: root.opened && !!root.radar && root.radar.scanning
            opacity: root.scanOn ? 1.0 : 0.4
            foreground: root.foreground
            fontFamily: root.fontFamily
            onPicked: function(deviceId) {
              root.selectedId = root.selectedId === deviceId ? "" : deviceId
              Qt.callLater(root.revealSelected)
            }
          }

          Column {
            id: side
            width: parent.width - scope.width - parent.spacing
            height: scope.height
            spacing: Style.space(8)

            // Empty and error states take the whole side.
            Text {
              visible: root.rows.length === 0
              width: parent.width
              textFormat: Text.PlainText
              wrapMode: Text.WordWrap
              color: root.radar && root.radar.error !== "" ? Color.urgent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              text: {
                if (!root.radar) return "Radar service is not running."
                if (root.radar.error !== "") return root.radar.error
                if (!root.scanOn) return "Turn on to listen for Bluetooth devices around you.\n\nOnly the distance from the centre is real: one antenna can't tell direction, so each device keeps a fixed spot.\n\nBluetooth is switched back off when you stop, if it was off."
                return "Listening…"
              }
            }

            Flickable {
              id: listFlick
              visible: root.rows.length > 0
              width: parent.width
              height: side.height - y - (details.visible ? details.height + side.spacing : 0)
              contentHeight: list.height
              clip: true
              boundsBehavior: Flickable.StopAtBounds
              interactive: contentHeight > height
              onHeightChanged: Qt.callLater(root.revealSelected)

              Column {
                id: list
                width: parent.width

                Repeater {
                  model: root.rows

                  Rectangle {
                    required property var modelData
                    required property int index
                    readonly property bool isHeader: !!modelData.header
                    readonly property bool isSelected: !isHeader && modelData.id === root.selectedId
                    // Gone quiet: dims over a few seconds before it drops out.
                    readonly property real fade: isHeader || modelData.presence === undefined ? 1 : modelData.presence
                    width: list.width
                    height: root.rowHeight
                    radius: Style.cornerRadius
                    color: isSelected ? Style.selectedFillFor(root.foreground, Color.accent) : "transparent"

                    // Section header row ("NEARBY · 10", "WI-FI · 13").
                    PanelSectionHeader {
                      visible: isHeader
                      anchors.left: parent.left
                      anchors.bottom: parent.bottom
                      anchors.bottomMargin: Style.space(4)
                      text: isHeader ? modelData.header : ""
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                    }

                    Text {
                      id: rowIcon
                      visible: !isHeader
                      anchors.left: parent.left
                      anchors.leftMargin: Style.space(6)
                      anchors.verticalCenter: parent.verticalCenter
                      width: Style.space(20)
                      textFormat: Text.PlainText
                      text: Model.glyph(modelData.kind)
                      opacity: fade
                      color: isSelected ? Color.accent : root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }

                    Text {
                      visible: !isHeader
                      anchors.left: rowIcon.right
                      anchors.right: rowNew.visible ? rowNew.left : rowTrend.visible ? rowTrend.left : rowDistance.left
                      anchors.rightMargin: Style.space(8)
                      anchors.verticalCenter: parent.verticalCenter
                      textFormat: Text.PlainText
                      text: Model.label(modelData)
                      opacity: fade
                      color: modelData.kind !== "unknown" || modelData.name ? root.foreground : root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      elide: Text.ElideRight
                    }

                    // Just arrived (Model.isNew): a small accent tag.
                    Text {
                      id: rowNew
                      visible: !isHeader && Model.isNew(modelData, Date.now(), root.radar ? root.radar.startedMs : 0)
                      anchors.right: rowTrend.visible ? rowTrend.left : rowDistance.left
                      anchors.rightMargin: Style.space(6)
                      anchors.verticalCenter: parent.verticalCenter
                      textFormat: Text.PlainText
                      text: "NEW"
                      color: Color.accent
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      font.bold: true
                    }

                    // The distance's direction (Model.trendStep): ↓ getting closer, ↑ moving away.
                    Text {
                      id: rowTrend
                      visible: !isHeader && !!modelData.trend
                      anchors.right: rowDistance.left
                      anchors.rightMargin: Style.space(4)
                      anchors.verticalCenter: parent.verticalCenter
                      textFormat: Text.PlainText
                      text: modelData.trend > 0 ? "↓" : "↑"
                      color: modelData.trend > 0 ? Color.accent : root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                    }

                    Text {
                      id: rowDistance
                      visible: !isHeader
                      anchors.right: parent.right
                      anchors.rightMargin: Style.space(6)
                      anchors.verticalCenter: parent.verticalCenter
                      textFormat: Text.PlainText
                      text: Model.distanceText(modelData.meters)
                      opacity: fade
                      color: root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }

                    MouseArea {
                      anchors.fill: parent
                      enabled: !isHeader
                      onClicked: root.selectedId = isSelected ? "" : modelData.id
                    }
                  }
                }
              }
            }

            // ---------- Details of the selected device ----------
            Column {
              id: details
              visible: !!root.selected || (!!root.radar && root.radar.finding)
              width: parent.width
              spacing: Style.space(6)

              PanelSeparator {
                foreground: root.foreground
              }

              FindMeter {
                visible: !!root.radar && root.radar.finding
                width: parent.width
                // The service's copy: it stays while the device is out of
                // the list (lost), so the meter can say "signal lost".
                device: root.radar ? root.radar.findTarget : null
                level: root.radar ? root.radar.findLevel : 0
                best: root.radar ? root.radar.findBest : 0
                lost: !!root.radar && root.radar.findLost
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Grid {
                visible: !root.radar || !root.radar.finding
                width: parent.width
                columns: 2
                columnSpacing: Style.space(10)
                rowSpacing: Style.space(3)

                Repeater {
                  model: root.selected ? Model.flatDetails(root.selected, Date.now(), root.radar ? Model.guardEntry(root.radar.guardLog, root.selected) : null) : []

                  Text {
                    required property var modelData
                    required property int index
                    readonly property bool isLabel: index % 2 === 0
                    width: isLabel ? Style.space(92) : details.width - Style.space(102)
                    textFormat: Text.PlainText
                    text: modelData
                    color: isLabel ? root.dim : root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: isLabel ? Text.NoWrap : Text.WordWrap
                  }
                }
              }

              Flow {
                width: parent.width
                spacing: Style.space(6)

              KeyButton {
                visible: !!root.selected && root.selected.source === "bt"
                iconText: root.radar && root.radar.finding ? "󰓛" : "󰍉"
                text: root.radar && root.radar.finding ? "Stop finding" : "Find"
                keyText: "L"
                tooltipText: root.radar && root.radar.finding ? "Back to the normal scan." : "Walk around with a hot/cold meter to locate this device.\nScans faster meanwhile; the auto-stop waits."
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.toggleFind()
              }

              KeyButton {
                readonly property bool armedHere: !!root.radar && root.radar.proximityArmed && !!root.selected && root.selected.pkey === root.radar.proximity.key
                visible: !!root.selected && root.selected.source === "bt" && !(root.radar && root.radar.finding)
                         && (armedHere || !(root.radar && root.radar.proximityArmed))
                iconText: armedHere ? "󰌾" : "󰍁"
                text: armedHere ? "Lock armed" : "Lock when away"
                keyText: "⇧K"
                tooltipText: armedHere ? "Press to switch proximity lock off."
                  : "Lock the screen when this device (the one you carry) has been away 20 s and the laptop is idle.\nNever unlocks. Needs a device with a fixed address: a watch, or a phone paired with this laptop."
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.toggleProximity()
              }

              KeyButton {
                visible: !!root.radar && root.radar.finding
                iconText: root.radar && root.radar.findSound ? "󰕾" : "󰖁"
                text: root.radar && root.radar.findSound ? "Sound on" : "Sound off"
                keyText: "M"
                tooltipText: "Geiger clicks that speed up as you get closer."
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.toggleFindSound()
              }

              KeyButton {
                visible: !!root.selected && root.selected.source === "bt" && !(root.radar && root.radar.finding)
                iconText: "󰑓"
                text: "Calibrate"
                keyText: "⇧C"
                tooltipText: "Hold this device 1 m from the laptop, then calibrate.\nEvery " + (root.selected ? Model.kindLabel(root.selected.kind).toLowerCase() : "device") + " will use it as its 1 m reference."
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.calibrateSelected()
              }

              KeyButton {
                visible: root.selectedCalibrated && !(root.radar && root.radar.finding)
                iconText: "󰜺"
                text: "Reset calibration"
                keyText: "⇧R"
                tooltipText: "Go back to the built-in 1 m guess for this kind of device."
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.clearSelectedCalibration()
              }
              }
            }
          }
        }
      }
    }
  }
}
