function parseState(raw) {
  var fallback = {
    running: false,
    pid: 0,
    status: "off",
    stt: false,
    tts: false,
    ok: false,
    backend: "",
    keysEnabled: false,
    keysArmed: false,
    speak: "",
    dictate: ""
  }
  if (!raw) return fallback
  try {
    var parsed = JSON.parse(raw)
    var running = parsed.running === true || (typeof parsed.pid === "number" && parsed.pid > 1)
    return {
      running: running,
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      status: running
        ? (parsed.status === "speaking" || parsed.status === "processing" ? parsed.status : "idle")
        : "off",
      stt: parsed.stt === true,
      tts: parsed.tts === true,
      ok: parsed.ok === true,
      backend: typeof parsed.backend === "string" ? parsed.backend : "",
      keysEnabled: parsed.keysEnabled === true,
      keysArmed: parsed.keysArmed === true,
      speak: typeof parsed.speak === "string" ? parsed.speak : "",
      dictate: typeof parsed.dictate === "string" ? parsed.dictate : ""
    }
  } catch (error) {
    return fallback
  }
}

function statusLabel(state) {
  if (!state.running) return "Off"
  if (state.status === "processing") return "Preparing"
  if (state.status === "speaking") return "Speaking"
  return "Ready"
}

function statusIcon(state) {
  // Monochrome stand-in for 🗣️ (emoji is always blue/color).
  // account-voice = person + speech lines, inherits bar foreground.
  if (!state.running) return "󰻔"             // account-voice-off
  if (state.status === "processing") return "󰝲" // loading (classic spinner)
  return "󰗋"                                  // account-voice
}

function statusLine(state) {
  if (!state.running) return "Off"
  if (state.status === "processing") return "Preparing speech…"
  if (state.status === "speaking") return "Speaking"
  if (!state.stt && !state.tts) return "Bins down"
  if (state.keysEnabled && state.keysArmed) return "Ready"
  if (state.keysEnabled) return "Ready · hotkeys arming"
  return "Ready · hotkeys off"
}

function keysDescription(speak, dictate) {
  var s = speak || "ALT + S"
  var d = dictate || "ALT + D"
  return "Speak " + s + " · Hold " + d + " to dictate"
}
