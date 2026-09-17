# dottie-talk

Local voice: parakeet STT (`:1315`) + koko TTS (`:1314`) + HTTP façade (`:1320`).

Standalone. No gateway. No Dottie.app.

```bash
npm install
npm start
```

Bins ship in `bin/`. Models download on first boot (`~/.cache/parakeet.cpp`, `~/.cache/dottie-talk` or `~/.dottie`).

| Command | What |
|---|---|
| `npm start` | HTTP `:1320` (starts STT+TTS) |
| `npm run mcp` | MCP stdio |
| `npm run tts` | TTS only (`:1314`) |

Apple Silicon + Node ≥22.
