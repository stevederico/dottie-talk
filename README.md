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
| Omarchy / Linux | system `voxtype` CLI | `koko` `:1314` (build via `npm run install:bins`) |

| Command | What |
|---|---|
| `npm start` | HTTP `:1320` (starts STT+TTS) |
| `npm run mcp` | MCP stdio |
| `npm run tts` | TTS only (`:1314`) |
| `dottie-talk speak "hi"` | TTS → `speech.wav` (or `-o` / stdout) |
| `dottie-talk transcribe a.wav` | STT → text on stdout |
| `dottie-talk start` | same as `npm start` |
| `dottie-talk health` | STT/TTS readiness JSON |

```bash
npx dottie-talk speak "hello" -o hello.wav
npx dottie-talk transcribe hello.wav
```

Node ≥22. Override STT with `DOTTIE_STT=voxtype` or `DOTTIE_STT=parakeet`.

Linux: install Voxtype first (Omarchy: Install → AI → Dictation, or `voxtype-bin`). Streaming/multipart STT needs parakeet — buffered JSON `/v1/audio/transcriptions` works on both.

## Related

- [talk-keys](https://github.com/stevederico/talk-keys) — macOS hotkeys for speak / dictate
- [dottie-desktop](https://github.com/stevederico/dottie-desktop) — desktop app
- [local-ai-cli](https://github.com/stevederico/local-ai-cli) — local AI CLI
