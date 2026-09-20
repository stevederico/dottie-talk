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
  property bool clickLock: false
  property bool running: false
  property string status: "off"
  property bool stt: false
  property bool tts: false
  property bool keysEnabled: false
  property bool keysArmed: false
  property string speakChord: "ALT + S"
  property string dictateChord: "ALT + D"
  property bool speakingFile: false
  property bool processingFile: false

  readonly property string talkBin: Quickshell.env("HOME") + "/.local/bin/dottie-talk"
  readonly property string statePath: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/dottie-talk/state"
  readonly property string speakActivePath: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/speak.active"
  readonly property string processingPath: (Quickshell.env("XDG_RUNTIME_DIR") || "/tmp") + "/dottie-talk/processing"
  readonly property bool speaking: root.status === "speaking" || root.speakingFile
  readonly property bool busy: root.status === "processing" || root.processingFile
  readonly property var snapshot: ({
    running: root.running,
    status: root.busy ? "processing" : (root.speaking ? "speaking" : root.status),
    stt: root.stt,
    tts: root.tts,
    keysArmed: root.keysArmed,
    keysEnabled: root.keysEnabled
  })
  readonly property string statusLabel: Model.statusLabel(root.snapshot)
  readonly property string statusIcon: Model.statusIcon(root.snapshot)
  readonly property string statusLine: Model.statusLine(root.snapshot)

  implicitWidth: root.running ? Math.max(button.implicitWidth, barSize) : 0
  implicitHeight: root.running ? barSize : 0
  visible: root.running
  clip: true

  function close() { root.popupOpen = false }
  function open() { root.popupOpen = true }

  function applyState(raw) {
    var next = Model.parseState(raw)
    running = next.running
    status = next.status
    stt = next.stt
    tts = next.tts
    keysEnabled = next.keysEnabled
    keysArmed = next.keysArmed
    if (next.speak) speakChord = next.speak
    if (next.dictate) dictateChord = next.dictate
    if (!next.running) root.close()
  }

  function runTalk(args) {
    Quickshell.execDetached([root.talkBin].concat(args))
  }

  function handlePress(button) {
    if (button === Qt.MiddleButton) {
      root.runTalk(["stop"])
      root.close()
      return
    }
    if (root.clickLock) return
    root.clickLock = true
    clickLockTimer.restart()
    root.popupOpen = !root.popupOpen
  }

  function triggerPress(button) { root.handlePress(button) }

  Timer {
    id: clickLockTimer
    interval: 160
    onTriggered: root.clickLock = false
  }

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

  FileView {
    path: root.processingPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.processingFile = true
    onLoadFailed: root.processingFile = false
  }

  Timer {
    interval: root.busy || root.speaking ? 200 : (root.running ? 500 : 2000)
    running: true
    repeat: true
    onTriggered: stateFile.reload()
  }

  BarIconButton {
    id: button
    anchors.centerIn: parent
    bar: root.bar
    opacity: root.busy ? 0 : 1
    text: root.statusIcon
    // Do not use active/urgent (red) — that color means alerts, not speech.
    active: false
    useActiveColor: false
    tooltipText: root.running ? (root.statusLine + " · click") : "Talk off"
    onPressed: function(b) { root.handlePress(b) }
  }

  Text {
    visible: root.busy
    anchors.centerIn: parent
    text: "󰝲"
    color: root.bar ? root.bar.barForeground : "#ddd"
    font.family: root.bar ? root.bar.fontFamily : ""
    font.pixelSize: Style.font.icon
    transformOrigin: Item.Center
    RotationAnimation on rotation {
      running: root.busy
      loops: Animation.Infinite
      from: 0
      to: 360
      duration: 800
    }
  }

  MouseArea {
    visible: root.busy
    anchors.fill: parent
    acceptedButtons: Qt.LeftButton | Qt.RightButton | Qt.MiddleButton
    onPressed: function(mouse) { root.handlePress(mouse.button) }
  }

  PopupCard {
    id: popup
    anchorItem: root
    bar: root.bar
    owner: root
    margin: Style.space(4)
    triggerMode: "click"
    open: root.popupOpen
    contentWidth: popup.fittedContentWidth(Style.space(300))
    contentHeight: popup.fittedContentHeight(column.implicitHeight)

    Column {
      id: column
      width: parent.width
      spacing: Style.space(12)

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
        label: "Hotkeys"
        description: Model.keysDescription(root.speakChord, root.dictateChord)
        checked: root.keysEnabled
        foreground: root.bar.foreground
        fontFamily: root.bar.fontFamily
        onClicked: root.runTalk(["keys", root.keysEnabled ? "off" : "on"])
      }

      PanelSeparator { foreground: root.bar.foreground }

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

        Item { width: Style.space(8); height: 1 }

        Button {
          text: "Quit"
          iconText: "󰅖"
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          onClicked: {
            root.close()
            root.runTalk(["stop"])
          }
        }
      }
    }
  }
}
