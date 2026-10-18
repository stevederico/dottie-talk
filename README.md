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
| Omarchy / Linux | `voxtype` (PATH, else fetched AVX2 binary + `base.en`) | `koko` `:1314` (ELF fetched on first start as `bin/koko-linux-x86_64`) |

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
speak "hello" -o hello.wav   # after dottie-talk bar on (~/.local/bin/speak)
npx transcribe hello.wav
```

Node ≥22. Override STT with `DOTTIE_STT=voxtype` or `DOTTIE_STT=parakeet`.

Linux: if `voxtype` is already on PATH, talk uses it. If not, first start downloads the x86_64 AVX2 binary into `~/.cache/dottie-talk/bin` and `base.en` (no sudo, no pacman). `npm start` skips the Darwin `bin/koko` and downloads the linux-bins ELF the same way. Streaming/multipart STT needs parakeet — buffered JSON `/v1/audio/transcriptions` works on both.

## MCP

`npm run mcp` (stdio). Audio stays on disk or goes to the speakers, so agent context never fills with base64.

| Tool | Args | Returns |
|---|---|---|
| `transcribe` | `path` (or `wavBase64` for apps) | text |
| `speak` | `text`, `voice?` | streams PCM to the speakers; starts in ~20 ms, not after the whole clip |
| `speak` | `out` | saves the file; `play: true` also plays it |
| `speak` | `returnAudio: true` | base64 too (old behavior, for apps) |

Streaming needs a player that reads stdin: `pw-cat`, `pacat`, `aplay`, or `ffplay`. The first one on PATH wins (`pw-cat` runs with `--raw`).

Add to Claude Code:

```bash
claude mcp add dottie-talk -s user -- node ~/Projects/dottie-talk/mcp.js
```

## Talk-back (Claude Code)

Read Claude's replies aloud through koko. `talk-back.js` runs as two Claude Code hooks, and `skills/` has the `/speak` and `/speak-toggle` skills.

| Command | What |
|---|---|
| `/speak` | speak this session's last reply, one time |
| `/speak on` / `off` / `toggle` | talk-back mode: read every reply aloud |
| `/speak-toggle` | same as `/speak toggle` |
| `/speak stop` | stop playback |
| `/speak status` | on or off |

Stop it: type anything (the next prompt cuts playback off), `/speak stop`, or `/speak off`. On Linux with `dottie-talk keys on`, Escape stops it too.

What is read: only the final reply. Never thinking, tool calls, or notes written between tool calls. Code blocks, tables, URLs, and markdown marks are dropped.

State: `~/.config/dottie-talk/talk-back/`. The saved last reply is per session (`last-<session>.txt`), so two windows never read each other's reply. The on/off mode is global.

### Setup

1. Start dottie-talk (`npm start`), so koko answers on `:1314`
2. Link the skills:

   ```bash
   ln -s ~/Projects/dottie-talk/skills/speak ~/.claude/skills/speak
   ln -s ~/Projects/dottie-talk/skills/speak-toggle ~/.claude/skills/speak-toggle
   ```

3. Add the hooks to `~/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "Stop": [{ "hooks": [{ "type": "command", "command": "node ~/Projects/dottie-talk/talk-back.js hook", "timeout": 5 }] }],
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node ~/Projects/dottie-talk/talk-back.js interrupt", "timeout": 5 }] }]
     }
   }
   ```

4. Restart Claude Code, then `/speak on`

The Stop hook saves every reply and speaks it only when the mode is on. It returns at once; playback runs in a detached child. The `interrupt` hook prints nothing, because `UserPromptSubmit` output goes into the model's context.

## Keys (Linux)

Talk-keys analog. **Off by default.** Enable, then keep `npm start` running so binds arm:

```bash
dottie-talk keys on
npm start
```

| Chord | Action | Omarchy |
|---|---|---|
| Alt+S | Speak selection if present, else clipboard. Second tap stops. | Steals app Alt+S menu accelerators **while armed** |
| Alt+D | Hold to dictate (voxtype push-to-talk) | Steals browser Alt+D address bar **while armed**; leaves Super+Ctrl+X / F9 alone |
| Escape | Stop speak | Only consumed while playback is active |

Config: `~/.config/dottie-talk/config.json`

```json
{
  "keys": {
    "enabled": false,
    "speak": "ALT + S",
    "stop": "ESCAPE",
    "dictate": "ALT + D",
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
