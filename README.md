# dottie-talk

Local **voice muscles**: parakeet STT (`:1315`) + koko TTS (`:1314`).

Consumed by [dottie-desktop](https://github.com/stevederico/dottie-desktop) as a **git submodule** at `backend/gateway/dottie-talk`.

| Surface | How |
|---|---|
| MCP stdio | `node mcp.js` / `npm run mcp` — tools `transcribe`, `speak` |
| HTTP | `DOTTIE_TALK_HTTP_PORT=1320 node http.js` |

Hits muscles **direct** — never `POST :1317`. Face duplex still uses gateway WS.

## Setup

```bash
npm install
npm test
npm run mcp
```

## Runtime contract

- parakeet on `:1315`, koko on `:1314` (usually supervised by Dottie.app / gateway)
- Optional HTTP: `DOTTIE_TALK_HTTP_PORT`
- Ports: see `ports.js` (keep in sync with desktop `gateway/ports.js` + Swift `AppPorts`)

Requires Node ≥22.
