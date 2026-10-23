import QtQuick
import qs.Commons
import "Model.js" as Model

// The radar scope: you in the centre, devices as blips at their estimated
// distance (Bluetooth as the icon of what they are, Wi-Fi networks as small
// diamonds, so a street full of routers doesn't drown the devices). Only the distance means something — the angle is a stable
// stand-in, because one antenna can't tell where a signal comes from.
//
// Cheap to keep around: the grid and the sweep are each painted once (again
// only on resize or theme change); the sweep just rotates, and nothing
// animates unless `active` is set.
Item {
  id: root

  property var devices: []
  property string selectedId: ""
  property real maxMeters: 10
  property bool active: false
  property color foreground: Color.foreground
  property color accent: Color.accent
  property color background: Color.background
  property string fontFamily: Style.font.family

  // Degrees clockwise from north, where the sweep's leading edge points.
  property real sweepAngle: 0
  readonly property real scope: Math.min(width, height) / 2 - Style.space(4)
  readonly property var ringMeters: [1, 3, maxMeters]
  // Icon size, and the closest an icon sits to you: everything under a metre
  // rings the centre instead of piling onto it.
  readonly property real iconSize: Math.round(Style.font.body * 1.3)
  readonly property real innerReach: scope > 0 ? (iconSize * 1.1) / scope : 0

  // A blip was clicked: the widget selects that device.
  signal picked(string deviceId)

  NumberAnimation on sweepAngle {
    from: 0
    to: 360
    duration: 4000
    loops: Animation.Infinite
    running: root.active
  }

  function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }

  // How lit a blip is: bright right after the sweep passes, fading over the
  // following quarter turn, like phosphor.
  function glow(angle) {
    if (!active) return 0.75
    var behind = ((sweepAngle - angle) % 360 + 360) % 360
    return behind < 90 ? 0.35 + 0.65 * (1 - behind / 90) : 0.35
  }

  Canvas {
    id: grid
    anchors.fill: parent
    renderStrategy: Canvas.Cooperative
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    Connections {
      target: root
      function onForegroundChanged() { grid.requestPaint() }
      function onMaxMetersChanged() { grid.requestPaint() }
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var cx = width / 2, cy = height / 2, R = root.scope
      if (R <= 0) return
      ctx.strokeStyle = root.alpha(root.foreground, 0.18)
      ctx.lineWidth = 1
      for (var i = 0; i < root.ringMeters.length; i++) {
        var r = Model.radius(root.ringMeters[i], root.maxMeters) * R
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy)
      ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R)
      ctx.strokeStyle = root.alpha(root.foreground, 0.08)
      ctx.stroke()
    }
  }

  // The beam: a fan of thin slices, brightest at the leading edge, painted
  // once pointing north and then rotated by sweepAngle.
  Canvas {
    id: sweep
    anchors.fill: parent
    visible: root.active
    rotation: root.sweepAngle
    renderStrategy: Canvas.Cooperative
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()

    Connections {
      target: root
      function onAccentChanged() { sweep.requestPaint() }
    }

    onPaint: {
      var ctx = getContext("2d")
      ctx.reset()
      var cx = width / 2, cy = height / 2, R = root.scope
      if (R <= 0) return
      var north = -Math.PI / 2
      var trail = Math.PI / 3
      var slices = 30
      for (var i = 0; i < slices; i++) {
        var from = north - trail * (i + 1) / slices
        var to = north - trail * i / slices
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, R, from, to + 0.01)
        ctx.closePath()
        ctx.fillStyle = root.alpha(root.accent, 0.22 * (1 - i / slices))
        ctx.fill()
      }
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx, cy - R)
      ctx.strokeStyle = root.alpha(root.accent, 0.8)
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }

  // Ring labels, on the right of each ring.
  Repeater {
    model: root.ringMeters

    Text {
      required property var modelData
      x: root.width / 2 + Model.radius(modelData, root.maxMeters) * root.scope - implicitWidth - Style.space(2)
      y: root.height / 2 + Style.space(2)
      textFormat: Text.PlainText
      text: modelData + " m"
      color: root.alpha(root.foreground, 0.45)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }

  // Blips live in a model keyed by device id, updated in place, so each one
  // keeps its delegate and glides to its new distance instead of being
  // rebuilt every second. Roles: bearing (degrees), reach (0 centre – 1 rim),
  // presence (1 heard – 0.25 quiet).
  ListModel { id: blips }

  // Degrees each blip is nudged off its own bearing so icons don't sit on
  // top of each other. Sticky: a nudge stays until its spot is clearly free,
  // so icons don't flick back and forth every second.
  property var nudges: ({})

  function position(reach, bearing) {
    var r = Math.max(innerReach, reach) * scope, a = bearing * Math.PI / 180
    return { x: r * Math.sin(a), y: -r * Math.cos(a), r: r }
  }

  function spread(list) {
    var placed = [], next = {}
    var size = iconSize * 1.05
    // The ring labels ("1 m", "3 m", "10 m") sit right of each ring, just
    // under the axis: keep icons off them too.
    for (var g = 0; g < ringMeters.length; g++) {
      var rr = Model.radius(ringMeters[g], maxMeters) * scope
      placed.push({ x: rr - size * 0.9, y: size * 0.7, size: size })
    }
    // Nearest first: the room close to you is the most crowded. Wi-Fi last,
    // so devices get the good spots and diamonds fit around them.
    list = list.slice().sort(function(a, b) {
      return (a.source === "wifi") - (b.source === "wifi") || a.radius - b.radius || (a.id < b.id ? -1 : 1)
    })
    function sizeOf(d) {
      return d.source === "wifi" ? size * 0.55 : d.id === selectedId ? size * 1.6 : size
    }
    function clear(p, own, margin) {
      for (var k = 0; k < placed.length; k++) {
        var dx = p.x - placed[k].x, dy = p.y - placed[k].y, room = (own + placed[k].size) / 2
        if (dx * dx + dy * dy < room * room * margin) return false
      }
      return true
    }
    for (var i = 0; i < list.length; i++) {
      var d = list[i], base = d.angle, own = sizeOf(d)
      var held = nudges[d.id] || 0
      var offset = held !== 0 && clear(position(d.radius, base), own, 2.2) ? 0 : held
      var p = position(d.radius, base + offset)
      // Step around the ring by about one icon's width, alternating sides.
      var step = Math.max(4, own / Math.max(1, p.r) * 180 / Math.PI)
      // Never further than a third of a turn from its own bearing.
      for (var t = 1; t <= 8 && Math.ceil(t / 2) * step <= 120 && !clear(p, own, 1); t++) {
        offset = (t % 2 ? 1 : -1) * Math.ceil(t / 2) * step
        p = position(d.radius, base + offset)
      }
      next[d.id] = offset
      p.size = own
      placed.push(p)
    }
    nudges = next
  }

  onDevicesChanged: {
    spread(devices)
    var fresh = {}
    for (var i = 0; i < devices.length; i++) fresh[devices[i].id] = devices[i]
    for (var j = blips.count - 1; j >= 0; j--) {
      var id = blips.get(j).deviceId
      if (fresh[id]) {
        blips.setProperty(j, "reach", Math.max(root.innerReach, fresh[id].radius))
        blips.setProperty(j, "bearing", fresh[id].angle + (root.nudges[id] || 0))
        blips.setProperty(j, "kind", fresh[id].kind || "unknown")
        blips.setProperty(j, "presence", fresh[id].presence === undefined ? 1 : fresh[id].presence)
        delete fresh[id]
      } else {
        blips.remove(j)
      }
    }
    for (var key in fresh)
      blips.append({ deviceId: key, bearing: fresh[key].angle + (root.nudges[key] || 0),
                     reach: Math.max(root.innerReach, fresh[key].radius),
                     kind: fresh[key].kind || "unknown", wifi: fresh[key].source === "wifi",
                     presence: fresh[key].presence === undefined ? 1 : fresh[key].presence })
  }

  Repeater {
    model: blips

    Item {
      id: blip
      required property string deviceId
      required property string kind
      required property bool wifi
      required property real bearing
      required property real reach
      // 1 while heard, down to 0.25 as it goes quiet (Model.presence).
      required property real presence
      readonly property bool isSelected: deviceId === root.selectedId
      readonly property real a: bearing * Math.PI / 180
      readonly property real r: reach * root.scope
      // The item is the blip's centre; dot, halo and icon hang off it.
      x: root.width / 2 + r * Math.sin(a)
      y: root.height / 2 - r * Math.cos(a)
      z: isSelected ? 1 : 0

      Behavior on x { NumberAnimation { duration: 600; easing.type: Easing.OutCubic } }
      Behavior on y { NumberAnimation { duration: 600; easing.type: Easing.OutCubic } }

      // Icons never drop below half bright: the sweep adds a flash, it
      // shouldn't make devices hard to read between passes.
      readonly property real lit: blip.isSelected ? 1 : (0.5 + 0.5 * root.glow(blip.bearing)) * blip.presence

      // Wi-Fi networks: small diamonds.
      Rectangle {
        visible: blip.wifi
        width: Style.space(6)
        height: width
        radius: 1
        rotation: 45
        anchors.centerIn: parent
        color: root.foreground
        opacity: blip.lit * 0.8
      }

      // Bluetooth devices: what they are, on a disc of the panel colour so
      // ring lines and the sweep don't run through the icon.
      Rectangle {
        visible: !blip.wifi
        anchors.centerIn: parent
        width: root.iconSize * 1.25
        height: width
        radius: width / 2
        color: root.background
        opacity: 0.85 * blip.presence
      }

      Text {
        visible: !blip.wifi
        anchors.centerIn: parent
        textFormat: Text.PlainText
        text: Model.glyph(blip.kind)
        color: root.accent
        opacity: blip.lit
        font.family: root.fontFamily
        font.pixelSize: blip.isSelected ? root.iconSize * 1.3 : root.iconSize
      }

      MouseArea {
        anchors.centerIn: parent
        width: root.iconSize * 1.4
        height: width
        cursorShape: Qt.PointingHandCursor
        onClicked: root.picked(blip.deviceId)
      }

      // Selected: a halo, so you can find it on the scope.
      Rectangle {
        visible: blip.isSelected
        width: root.iconSize * 2
        height: width
        radius: width / 2
        anchors.centerIn: parent
        color: "transparent"
        border.color: root.accent
        border.width: 1.5
      }

    }
  }

  // You.
  Rectangle {
    width: Style.space(6)
    height: width
    radius: width / 2
    anchors.centerIn: parent
    color: root.foreground
  }
}
