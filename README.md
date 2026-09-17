# dottie-talk

Standalone local **voice muscles**: parakeet STT (`:1315`) + koko TTS (`:1314`).

No gateway. No Dottie.app required.

Bins ship in `bin/` (`parakeet-server`, `koko`, `espeak-ng-data`). Rebuild with `npm run install:bins`.

Also used as a git submodule by [dottie-desktop](https://github.com/stevederico/dottie-desktop).

| Surface | How |
|---|---|
| MCP stdio | `npm run mcp` — tools `transcribe`, `speak` |
| HTTP | `npm run http` (port `1320`) |
| TTS only | `npm run tts` — koko on `:1314` (used by Talk Keys) |

## Setup

```bash
npm install
npm run install:bins   # only if bin/ missing / FORCE_REBUILD=1
npm run mcp            # or: npm run http
```

Models download on first use into `~/.cache/parakeet.cpp` and `~/.dottie`.

Requires Node ≥22. Apple Silicon for the default build path.
