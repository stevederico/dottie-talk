# dottie-talk

Standalone local **voice muscles**: parakeet STT (`:1315`) + koko TTS (`:1314`).

No gateway. No Dottie.app required.

Also used as a git submodule by [dottie-desktop](https://github.com/stevederico/dottie-desktop) at `backend/gateway/dottie-talk`.

| Surface | How |
|---|---|
| MCP stdio | `node mcp.js` / `npm run mcp` — tools `transcribe`, `speak` (spawns bins) |
| HTTP | `DOTTIE_TALK_HTTP_PORT=1320 node http.js` (spawns bins, proxies audio) |

## Setup

```bash
npm install
# binaries: package-local bin/ (preferred), or DOTTIE_BIN_DIR, or PATH
./scripts/install_parakeet_bundle.sh   # builds parakeet-server → ./bin
# place koko (+ espeak-ng-data) next to it
npm run mcp
```

### Rebuild `parakeet-server`

Streaming `/v1/stream/*` lives in `patches/parakeet/`:

```bash
./scripts/install_parakeet_bundle.sh              # → ./bin (or desktop bin/ if submodule)
./scripts/install_parakeet_bundle.sh /path/to/bin # explicit
```

## Runtime

- Owns STT/TTS process lifecycle (`bin_supervise.js`)
- Optional HTTP on `DOTTIE_TALK_HTTP_PORT` (default `1320`)
- Ports: `ports.js`

Requires Node ≥22.
