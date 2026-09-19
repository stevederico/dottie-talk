# dottie-talk

Local voice: STT + koko TTS (`:1314`) + HTTP façade (`:1320`).

Standalone. No gateway. No Dottie.app.

```bash
npm install
npm start
```

Bins ship in `bin/` (macOS). Models download on first boot (`~/.cache/parakeet.cpp`, `~/.cache/dottie-talk` or `~/.dottie`).

| Platform | STT | TTS |
|---|---|---|
| Apple Silicon (darwin) | `parakeet-server` `:1315` (bundled) | `koko` `:1314` |
| Omarchy / Linux | system `voxtype` CLI | `koko` `:1314` (ELF fetched on first start as `bin/koko-linux-x86_64`) |

| Command | What |
|---|---|
| `npm start` | HTTP `:1320` (starts STT+TTS) |
| `npm run mcp` | MCP stdio |
| `npm run tts` | TTS only (`:1314`) |
| `dottie-talk speak "hi"` / `speak "hi"` | TTS → `speech.wav` (or `-o` / stdout) |
| `dottie-talk transcribe a.wav` / `transcribe a.wav` | STT → text on stdout |
| `dottie-talk start` | same as `npm start` |
| `dottie-talk health` | STT/TTS readiness JSON |
| `dottie-talk keys on` | enable talk-keys-style hotkeys (off by default) |
| `dottie-talk keys off` | disable hotkeys |
| `dottie-talk keys status` | enabled / armed / chords |
| `dottie-talk bar on` | Omarchy menubar icon (hidden until `start`) |
| `dottie-talk stop` | stop the HTTP server |

```bash
npx speak "hello" -o hello.wav
npx transcribe hello.wav
```

Node ≥22. Override STT with `DOTTIE_STT=voxtype` or `DOTTIE_STT=parakeet`.

Linux: install Voxtype first (Omarchy: Install → AI → Dictation, or `voxtype-bin`). `npm start` skips the Darwin `bin/koko` and downloads the linux-bins ELF (no sudo). Streaming/multipart STT needs parakeet — buffered JSON `/v1/audio/transcriptions` works on both.

## Keys (Linux)

Talk-keys analog. **Off by default.** Enable, then keep `npm start` running so binds arm:

```bash
dottie-talk keys on
npm start
```

| Chord | Action | Omarchy |
|---|---|---|
| Super+Shift+S | Speak primary selection (else clipboard). Second tap stops. | Replaces Google Maps **while armed** |
| Super+Shift+V | Hold to dictate (voxtype). Release stops. | Leaves Super+Ctrl+X / F9 alone |
| Escape | Stop speak | Only consumed while playback is active |

Config: `~/.config/dottie-talk/config.json`

```json
{
  "keys": {
    "enabled": false,
    "speak": "SUPER + SHIFT + S",
    "stop": "ESCAPE",
    "dictate": "SUPER + SHIFT + V",
    "voice": ""
  }
}
```

`DOTTIE_TALK_KEYS=on` / `off` overrides `enabled`. Hotkeys no-op when the HTTP server is down. macOS: use [talk-keys](https://github.com/stevederico/talk-keys).

## Bar (Omarchy)

Menubar icon **only while `npm start` is running**. Click: keys toggle, speak selection, stop, quit. Middle-click quits.

```bash
dottie-talk bar on
dottie-talk start
```

`start` on Linux also installs the plugin (`sd.dottie-talk`) next to Dottie if the bar does not already have it.

## Related

- [talk-keys](https://github.com/stevederico/talk-keys) — macOS hotkeys for speak / dictate
- [dottie-desktop](https://github.com/stevederico/dottie-desktop) — desktop app
- [local-ai-cli](https://github.com/stevederico/local-ai-cli) — local AI CLI
