---
name: speak
author: stevederico
description: Read Claude's replies aloud with dottie-talk. /speak speaks this session's last reply (one time); /speak on|off toggles talk-back mode (every reply read aloud); /speak stop stops playback; /speak status shows the mode.
argument-hint: "[on|off|toggle|stop|status]"
disable-model-invocation: true
---

# speak

Argument: `$ARGUMENTS` (empty means `last`).

Run exactly one command, then reply with only its one-line output. No other text.

```bash
node ~/Projects/dottie-talk/talk-back.js <argument or last>
```

- No argument → `last` (speak this session's previous reply, one time).
- `/speak-toggle` is a shortcut for `toggle`.
- `on` / `off` / `toggle` → talk-back mode. When on, the Stop hook reads every reply aloud.
- `stop` → stop playback now. Typing any new prompt also stops it (UserPromptSubmit hook).
- `status` → print on/off.

If it prints `koko not running`, tell the user to run `npm start` in `~/Projects/dottie-talk`.
