import QtQuick
import Quickshell
import Quickshell.Io
import qs.Ui
import qs.Commons
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "sd.dottie-talk"

  property bool popupOpen: false
  property bool running: false
  property string status: "off"
  property bool stt: false
  property bool tts: false
  property bool keysEnabled: false
  property bool keysArmed: false
  property string speakChord: ""
  property string dictateChord: ""
  property bool speakingFile: false

  readonly property string talkBin: Quickshell.env("HOME") + "/.local/bin/dottie-talk"
  readonly property string statePath: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/dottie-talk/state"
  readonly property string speakActivePath: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/speak.active"
  readonly property bool speaking: root.status === "speaking" || root.speakingFile
  readonly property var snapshot: ({
    running: root.running,
    status: root.speaking ? "speaking" : root.status,
    stt: root.stt,
    tts: root.tts,
    keysArmed: root.keysArmed
  })
  readonly property string statusLabel: Model.statusLabel(root.snapshot)
  readonly property string statusIcon: Model.statusIcon(root.snapshot)
  readonly property string statusLine: Model.statusLine(root.snapshot)

  implicitWidth: root.running ? button.implicitWidth : 0
  implicitHeight: root.running ? barSize : 0
  visible: root.running
  clip: true

  function applyState(raw) {
    var next = Model.parseState(raw)
    running = next.running
    status = next.status
    stt = next.stt
    tts = next.tts
    keysEnabled = next.keysEnabled
    keysArmed = next.keysArmed
    speakChord = next.speak
    dictateChord = next.dictate
    if (!next.running)
      popupOpen = false
  }

  function runTalk(args) {
    Quickshell.execDetached([root.talkBin].concat(args))
  }

  function handlePress(button) {
    if (button === Qt.MiddleButton) {
      root.runTalk(["stop"])
      return
    }
    root.popupOpen = !root.popupOpen
  }

  function triggerPress(button) { root.handlePress(button) }

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyState(text())
    onLoadFailed: root.applyState("")
  }

  FileView {
    path: root.speakActivePath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.speakingFile = true
    onLoadFailed: root.speakingFile = false
  }

  Timer {
    interval: root.running ? 400 : 2000
    running: true
    repeat: true
    onTriggered: stateFile.reload()
  }

  BarIconButton {
    id: button
    anchors.centerIn: parent
    bar: root.bar
    text: root.statusIcon
    active: root.speaking
    tooltipText: root.running ? (root.statusLine + " · click for menu") : "Talk off"
    onPressed: function(b) { root.handlePress(b) }
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    margin: Style.space(4)
    triggerMode: root.popupOpen ? "click" : "hover"
    open: root.popupOpen
    contentWidth: popup.fittedContentWidth(Style.space(320))
    contentHeight: popup.fittedContentHeight(column.implicitHeight)

    Column {
      id: column
      width: parent.width
      spacing: Style.space(10)

      Row {
        width: parent.width
        spacing: Style.space(10)

        Text {
          text: root.statusIcon
          color: root.bar.foreground
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.display
          anchors.verticalCenter: parent.verticalCenter
        }

        Column {
          spacing: Style.space(2)
          anchors.verticalCenter: parent.verticalCenter
          width: parent.width - Style.space(40)

          Text {
            text: "Talk"
            color: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.subtitle
            font.bold: true
          }

          Text {
            text: root.statusLine
            color: Qt.darker(root.bar.foreground, 1.4)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }

      PanelSeparator { foreground: root.bar.foreground }

      Toggle {
        width: parent.width
        label: "Keys"
        description: [root.speakChord !== "" ? ("Speak " + root.speakChord) : "", root.dictateChord !== "" ? ("Hold " + root.dictateChord + " dictate") : ""].filter(function(s) { return s !== "" }).join(" · ") || "Hotkeys while the server is up"
        checked: root.keysEnabled
        foreground: root.bar.foreground
        fontFamily: root.bar.fontFamily
        onClicked: root.runTalk(["keys", root.keysEnabled ? "off" : "on"])
      }

      Row {
        width: parent.width
        spacing: Style.space(8)

        Button {
          text: "Speak"
          iconText: "󰝚"
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: root.runTalk(["keys", "speak"])
        }

        Button {
          text: "Stop"
          iconText: "󰓛"
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: root.runTalk(["keys", "stop"])
        }

        Button {
          text: "Quit"
          iconText: "󰅖"
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: root.runTalk(["stop"])
        }
      }
    }
  }
}
