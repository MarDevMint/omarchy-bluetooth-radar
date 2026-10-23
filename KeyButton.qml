import QtQuick
import qs.Commons
import qs.Ui

// A small labelled button that also shows its keyboard shortcut, like
// "󰑓 Calibrate [C]": click it, or press the key. The panel owns the key
// handling; this only draws the hint and reports clicks.
Rectangle {
  id: root

  property string iconText: ""
  property string text: ""
  property string keyText: ""
  property string tooltipText: ""
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  signal clicked()

  readonly property bool hovered: mouse.containsMouse

  implicitWidth: content.implicitWidth + Style.space(16)
  implicitHeight: content.implicitHeight + Style.space(8)
  radius: Style.cornerRadius
  color: hovered ? Style.selectedFillFor(foreground, accent) : "transparent"
  border.width: 1
  border.color: Qt.rgba(foreground.r, foreground.g, foreground.b, hovered ? 0.45 : 0.25)

  Row {
    id: content
    anchors.centerIn: parent
    spacing: Style.space(6)

    Text {
      visible: root.iconText !== ""
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.iconText
      color: root.hovered ? root.accent : root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.body
    }

    Text {
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.PlainText
      text: root.text
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    // The key, drawn as a little keycap.
    Rectangle {
      visible: root.keyText !== ""
      anchors.verticalCenter: parent.verticalCenter
      width: Math.max(height, key.implicitWidth + Style.space(8))
      height: key.implicitHeight + Style.space(2)
      radius: Math.max(2, Style.cornerRadius / 2)
      color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.08)
      border.width: 1
      border.color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.3)

      Text {
        id: key
        anchors.centerIn: parent
        textFormat: Text.PlainText
        text: root.keyText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }

  PanelToolTip {
    visible: root.hovered && root.tooltipText !== ""
    text: root.tooltipText
    fontFamily: root.fontFamily
  }
}
