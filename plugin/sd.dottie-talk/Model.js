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
  if (state.status === "processing") return "Working"
  if (state.status === "speaking") return "Speaking"
  return "On"
}

function statusIcon(state) {
  if (!state.running) return "󰝛"
  if (state.status === "processing") return "󰔟"
  if (state.status === "speaking") return "󰝚"
  return "󰔊"
}

function statusLine(state) {
  if (!state.running) return "Talk off"
  var bits = [statusLabel(state)]
  bits.push(state.stt && state.tts ? "STT+TTS" : (state.tts ? "TTS" : (state.stt ? "STT" : "bins down")))
  if (state.keysArmed) bits.push("keys")
  return bits.join(" · ")
}

function keysDescription(speak, dictate) {
  var s = speak || "SUPER + SHIFT + S"
  var d = dictate || "SUPER + SHIFT + V"
  return "Speak " + s + "\nDictate " + d
}
