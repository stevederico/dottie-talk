# dottie-talk

Standalone local **voice muscles**: parakeet STT (`:1315`) + koko TTS (`:1314`).

No gateway. No Dottie.app required.

Also used as a git submodule by [dottie-desktop](https://github.com/stevederico/dottie-desktop).

| Surface | How |
|---|---|
| MCP stdio | `npm run mcp` — tools `transcribe`, `speak` |
| HTTP | `npm run http` (port `1320`) |

## Setup

```bash
npm install
npm run install:bins   # → ./bin (parakeet-server + koko + espeak data)
npm run mcp            # or: npm run http
```

`install:bins` builds parakeet from source (cmake), and for koko: copies a nearby binary if present, else `cargo build` of [Kokoros](https://github.com/lucasjinreal/Kokoros) (`brew install pkg-config opus` first).

First MCP/HTTP start also auto-runs `install:bins` if `./bin` is empty (`DOTTIE_SKIP_BIN_INSTALL=1` to disable).

Models download on first use into `~/.cache/parakeet.cpp` and `~/.dottie`.

Requires Node ≥22. Apple Silicon for the bundled build path.
