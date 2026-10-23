import QtQuick
import qs.Commons
import "Model.js" as Model

// Find mode's hot/cold meter: one big bar that fills as you get closer, a
// tick at the hottest point so far, and what to do next. It reads signal
// strength, not metres, so it reacts to every step.
Column {
  id: root

  property var device: null
  property real level: 0
  property real best: 0
  property bool lost: false
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  readonly property color dim: Qt.darker(foreground, 1.4)

  spacing: Style.space(6)

  Row {
    width: parent.width
    spacing: Style.space(8)

    Text {
      id: findGlyph
      textFormat: Text.PlainText
      text: root.device ? Model.glyph(root.device.kind) : ""
      color: root.accent
      font.family: root.fontFamily
      font.pixelSize: Style.font.display
      anchors.verticalCenter: parent.verticalCenter
    }

    Column {
      width: parent.width - findGlyph.width - parent.spacing
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(1)

      Text {
        width: parent.width
        elide: Text.ElideRight
        textFormat: Text.PlainText
        text: "FINDING " + (root.device ? Model.label(root.device) : "").toUpperCase()
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: true
        font.letterSpacing: 1.2
      }

      Text {
        textFormat: Text.PlainText
        text: Model.findWord(root.level, root.lost)
        color: root.lost ? root.dim : root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.title
        font.bold: true
      }
    }
  }

  // The bar, with the best-so-far tick.
  Item {
    width: parent.width
    height: Style.space(14)

    Rectangle {
      anchors.fill: parent
      radius: height / 2
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.12)
    }

    Rectangle {
      width: Math.max(height, parent.width * root.level)
      height: parent.height
      radius: height / 2
      color: root.accent
      opacity: root.lost ? 0.25 : 0.35 + 0.65 * root.level
      Behavior on width { NumberAnimation { duration: 250; easing.type: Easing.OutCubic } }
    }

    Rectangle {
      visible: root.best > 0
      x: parent.width * root.best - width / 2
      width: 2
      height: parent.height + Style.space(6)
      anchors.verticalCenter: parent.verticalCenter
      color: root.foreground
      opacity: 0.6
    }
  }

  Text {
    width: parent.width
    textFormat: Text.PlainText
    text: {
      if (!root.device) return ""
      var parts = [Math.round(root.device.smoothed) + " dBm", Model.distanceText(root.device.meters)]
      if (root.device.trend) parts.push(Model.trendText(root.device.trend).toLowerCase())
      if (root.best > root.level + 0.1) parts.push("it was hotter a moment ago")
      return parts.join("  ·  ")
    }
    color: root.foreground
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  Text {
    width: parent.width
    textFormat: Text.PlainText
    wrapMode: Text.WordWrap
    text: {
      var tip = "Turn slowly in a full circle, pausing every 45°: your body blocks the signal, so it's strongest facing the device. Then walk that way."
      if (root.device && root.device.kind === "watch")
        tip += " A watch connected to its phone barely advertises — switch the phone's Bluetooth off."
      return tip
    }
    color: root.dim
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }
}
