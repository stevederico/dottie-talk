import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(fileURLToPath(new URL('./Model.js', import.meta.url)), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

describe('Model.js', () => {
  it('hides off state', () => {
    const off = ctx.parseState('');
    assert.equal(off.running, false);
    assert.equal(ctx.statusLabel(off), 'Off');
  });

  it('labels a live server', () => {
    const on = ctx.parseState(JSON.stringify({
      running: true,
      pid: 3,
      status: 'idle',
      stt: true,
      tts: true,
      keysArmed: true,
    }));
    assert.equal(ctx.statusLabel(on), 'On');
    assert.match(ctx.statusLine(on), /keys/);
  });

  it('lists speak and dictate', () => {
    const text = ctx.keysDescription('SUPER + SHIFT + S', 'SUPER + SHIFT + V');
    assert.match(text, /Speak SUPER \+ SHIFT \+ S/);
    assert.match(text, /Hold SUPER \+ SHIFT \+ V/);
  });
});
