import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_KEYS, loadConfig, saveConfig, setKeysEnabled } from './config.js';

function isolate() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-talk-config-'));
  const prevConfig = process.env.DOTTIE_TALK_CONFIG;
  const prevKeys = process.env.DOTTIE_TALK_KEYS;
  process.env.DOTTIE_TALK_CONFIG = path.join(dir, 'config.json');
  delete process.env.DOTTIE_TALK_KEYS;
  return () => {
    if (prevConfig === undefined) delete process.env.DOTTIE_TALK_CONFIG;
    else process.env.DOTTIE_TALK_CONFIG = prevConfig;
    if (prevKeys === undefined) delete process.env.DOTTIE_TALK_KEYS;
    else process.env.DOTTIE_TALK_KEYS = prevKeys;
    rmSync(dir, { recursive: true, force: true });
  };
}

describe('loadConfig', () => {
  let restore;
  afterEach(() => restore?.());

  it('defaults keys off', () => {
    restore = isolate();
    const cfg = loadConfig();
    assert.equal(cfg.keys.enabled, false);
    assert.equal(cfg.keys.speak, DEFAULT_KEYS.speak);
    assert.equal(cfg.keys.dictate, DEFAULT_KEYS.dictate);
  });

  it('reads enabled from file', () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true, speak: 'SUPER + A' } });
    assert.equal(loadConfig().keys.enabled, true);
    assert.equal(loadConfig().keys.speak, 'SUPER + A');
  });

  it('DOTTIE_TALK_KEYS=on overrides file', () => {
    restore = isolate();
    saveConfig({ keys: { enabled: false } });
    process.env.DOTTIE_TALK_KEYS = 'on';
    assert.equal(loadConfig().keys.enabled, true);
  });

  it('DOTTIE_TALK_KEYS=off overrides file', () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    process.env.DOTTIE_TALK_KEYS = 'off';
    assert.equal(loadConfig().keys.enabled, false);
  });

  it('does not steal Omarchy Display or voxtype', () => {
    restore = isolate();
    assert.equal(DEFAULT_KEYS.speak, 'ALT + S');
    assert.equal(DEFAULT_KEYS.dictate, 'ALT + D');
    assert.notEqual(DEFAULT_KEYS.dictate, 'SUPER + CTRL + D');
    assert.notEqual(DEFAULT_KEYS.dictate, 'SUPER + CTRL + X');
    assert.notEqual(DEFAULT_KEYS.speak, 'SUPER + CTRL + D');
    assert.notEqual(DEFAULT_KEYS.speak, 'SUPER + SHIFT + S');
  });

  it('ignores corrupt JSON', () => {
    restore = isolate();
    writeFileSync(process.env.DOTTIE_TALK_CONFIG, '{nope');
    assert.equal(loadConfig().keys.enabled, false);
  });
});

describe('setKeysEnabled', () => {
  let restore;
  afterEach(() => restore?.());

  it('persists on', () => {
    restore = isolate();
    const cfg = setKeysEnabled(true);
    assert.equal(cfg.keys.enabled, true);
    assert.equal(loadConfig().keys.enabled, true);
  });

  it('fills empty dictate on enable', () => {
    restore = isolate();
    saveConfig({ keys: { enabled: false, dictate: '' } });
    const cfg = setKeysEnabled(true);
    assert.equal(cfg.keys.dictate, DEFAULT_KEYS.dictate);
  });
});
