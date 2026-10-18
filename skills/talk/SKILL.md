---
name: talk
author: stevederico
description: Read Claude's replies aloud with dottie-talk. /talk speaks this session's last reply (one time); /talk on|off toggles talk-back mode (every reply read aloud); /talk stop stops playback; /talk status shows the mode.
argument-hint: "[on|off|toggle|stop|status]"
disable-model-invocation: true
---

# talk

Argument: `$ARGUMENTS` (empty means `last`).

Run exactly one command, then reply with only its one-line output. No other text.

```bash
node ~/Projects/dottie-talk/talk-back.js <argument or last>
```

- No argument → `last` (speak this session's previous reply, one time).
- `/talk-toggle` is a shortcut for `toggle`.
- `on` / `off` / `toggle` → talk-back mode. When on, the Stop hook reads every reply aloud.
- `stop` → stop playback now. Typing any new prompt also stops it (UserPromptSubmit hook).
- `status` → print on/off.

If it prints `koko not running`, tell the user to run `npm start` in `~/Projects/dottie-talk`.
