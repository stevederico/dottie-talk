# dottie-talk

Standalone local **voice muscles**: parakeet STT (`:1315`) + koko TTS (`:1314`).

No gateway. No Dottie.app required (though an installed Dottie can supply bins).

Also used as a git submodule by [dottie-desktop](https://github.com/stevederico/dottie-desktop).

| Surface | How |
|---|---|
| MCP stdio | `npm run mcp` — tools `transcribe`, `speak` |
| HTTP | `npm run http` (listens `:1320`) |

## Setup

```bash
npm run setup          # npm install + ./bin (parakeet + koko + espeak)
npm run mcp            # or: npm run http
npm test
```

`install:bins` / first MCP·HTTP start (unless `DOTTIE_SKIP_BIN_INSTALL=1`):

1. **parakeet-server** — copy from desktop/Dottie.app bin if present, else cmake build (`./scripts/install_parakeet_bundle.sh`)
2. **koko** — copy from `~/Projects/dottie-desktop/bin`, `/Applications/Dottie.app/.../bin`, `DOTTIE_BIN_DIR`, PATH; else `cargo build` [Kokoros](https://github.com/lucasjinreal/Kokoros) (`brew install pkg-config opus`)
3. **espeak-ng-data** — from same places or Homebrew

Models download on first use into `~/.cache/dottie-talk` (reuses `~/.dottie` if models already there). Override with `DOTTIE_TALK_DATA`.

Requires Node ≥22. Apple Silicon for the parakeet build path.
