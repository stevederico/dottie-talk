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
      keysEnabled: true,
      keysArmed: true,
    }));
    assert.equal(ctx.statusLabel(on), 'Ready');
    assert.equal(ctx.statusLine(on), 'Ready');
  });

  it('labels processing', () => {
    const busy = ctx.parseState(JSON.stringify({
      running: true,
      pid: 3,
      status: 'processing',
    }));
    assert.equal(ctx.statusLabel(busy), 'Preparing');
  });

  it('lists speak and dictate', () => {
    const text = ctx.keysDescription('ALT + S', 'ALT + D');
    assert.match(text, /Speak ALT \+ S/);
    assert.match(text, /Hold ALT \+ D to dictate/);
  });
});
