import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  injectHyprland,
  removeHyprland,
  renderKeysLua,
  wrapperScript,
} from './keys_hypr.js';

describe('injectHyprland', () => {
  it('appends a require block once', () => {
    const once = injectHyprland('-- Load Omarchy defaults.\n');
    assert.match(once, /dottie-talk-keys: begin/);
    assert.match(once, /hypr\.dottie-talk-keys/);
    const twice = injectHyprland(once);
    assert.equal(twice, once);
  });

  it('removes the require block', () => {
    const src = injectHyprland('require("hypr.bindings")\n');
    const gone = removeHyprland(src);
    assert.equal(gone.includes('dottie-talk-keys'), false);
    assert.match(gone, /hypr\.bindings/);
  });
});

describe('renderKeysLua', () => {
  it('no-ops without the runtime flag', () => {
    const lua = renderKeysLua({
      speak: 'SUPER + SHIFT + S',
      stop: 'ESCAPE',
      dictate: 'SUPER + SHIFT + V',
      speakBin: '/tmp/speak-selection',
      stopBin: '/tmp/speak-stop',
      dictateStartBin: '/tmp/dottie-talk-dictate-start',
      dictateStopBin: '/tmp/dottie-talk-dictate-stop',
    });
    assert.match(lua, /dottie-talk-keys\.on/);
    assert.match(lua, /if not f then/);
    assert.match(lua, /Speak selection/);
    assert.match(lua, /Start dictation/);
    assert.match(lua, /Stop dictation/);
    assert.match(lua, /release = true/);
    assert.match(lua, /setsid -f /);
    assert.equal(lua.includes('wl-paste'), false);
    assert.equal(lua.includes('hyprctl'), false);
  });

  it('skips empty chords', () => {
    const lua = renderKeysLua({
      speak: '',
      dictate: 'SUPER + SHIFT + V',
      dictateStartBin: '/bin/start',
      dictateStopBin: '/bin/stop',
    });
    assert.equal(lua.includes('Speak selection'), false);
    assert.match(lua, /Start dictation/);
  });
});

describe('wrapperScript', () => {
  it('marks hotkey invokes', () => {
    const sh = wrapperScript('speak');
    assert.match(sh, /^#!\/bin\/sh/);
    assert.match(sh, /dottie-talk-keys/);
    assert.match(sh, /DOTTIE_TALK_KEYS_HOTKEY=1/);
    assert.match(sh, / keys speak /);
  });
});

describe('enableKeys install', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.DOTTIE_TALK_CONFIG;
    delete process.env.DOTTIE_TALK_HYPR_DIR;
    delete process.env.DOTTIE_TALK_USER_BIN;
    delete process.env.DOTTIE_TALK_KEYS;
    delete process.env.XDG_RUNTIME_DIR;
  });

  it('writes lua wrappers and hypr snippet', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-talk-hypr-'));
    process.env.DOTTIE_TALK_CONFIG = path.join(dir, 'config.json');
    process.env.DOTTIE_TALK_HYPR_DIR = path.join(dir, 'hypr');
    process.env.DOTTIE_TALK_USER_BIN = path.join(dir, 'bin');
    process.env.XDG_RUNTIME_DIR = dir;
    delete process.env.DOTTIE_TALK_KEYS;
    mkdirSync(path.join(dir, 'hypr'), { recursive: true });
    writeFileSync(path.join(dir, 'hypr', 'hyprland.lua'), '-- root\n');
    const { enableKeys, keysLuaPath, wrapperPaths } = await import('./keys_hypr.js');
    const status = await enableKeys({ execFileFn: async () => ({ stdout: '' }) });
    assert.equal(status.enabled, true);
    const lua = readFileSync(keysLuaPath(), 'utf8');
    assert.match(lua, /Speak selection/);
    const hypr = readFileSync(path.join(dir, 'hypr', 'hyprland.lua'), 'utf8');
    assert.match(hypr, /dottie-talk-keys: begin/);
    const bins = wrapperPaths();
    assert.match(readFileSync(bins.speak, 'utf8'), /keys speak/);
  });
});
