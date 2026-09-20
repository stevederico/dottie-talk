import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildTalkState,
  clearTalkState,
  parseTalkState,
  readTalkPid,
  stopTalkServer,
  writeTalkPid,
  writeTalkState,
} from './state.js';
import { saveConfig } from './config.js';

function isolate() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-talk-state-'));
  const prev = {
    runtime: process.env.XDG_RUNTIME_DIR,
    config: process.env.DOTTIE_TALK_CONFIG,
    keys: process.env.DOTTIE_TALK_KEYS,
  };
  process.env.XDG_RUNTIME_DIR = dir;
  process.env.DOTTIE_TALK_CONFIG = path.join(dir, 'config.json');
  delete process.env.DOTTIE_TALK_KEYS;
  return () => {
    clearTalkState();
    if (prev.runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = prev.runtime;
    if (prev.config === undefined) delete process.env.DOTTIE_TALK_CONFIG;
    else process.env.DOTTIE_TALK_CONFIG = prev.config;
    if (prev.keys === undefined) delete process.env.DOTTIE_TALK_KEYS;
    else process.env.DOTTIE_TALK_KEYS = prev.keys;
    rmSync(dir, { recursive: true, force: true });
  };
}

describe('parseTalkState', () => {
  it('falls back when empty', () => {
    const s = parseTalkState('');
    assert.equal(s.running, false);
    assert.equal(s.status, 'off');
  });

  it('reads a live snapshot', () => {
    const s = parseTalkState(JSON.stringify({
      running: true,
      pid: 9,
      status: 'speaking',
      stt: true,
      tts: true,
      ok: true,
      keysEnabled: true,
      keysArmed: true,
      speak: 'ALT + S',
    }));
    assert.equal(s.running, true);
    assert.equal(s.status, 'speaking');
    assert.equal(s.keysArmed, true);
    assert.equal(s.speak, 'ALT + S');
  });

  it('keeps processing status', () => {
    const s = parseTalkState(JSON.stringify({ running: true, pid: 2, status: 'processing' }));
    assert.equal(s.status, 'processing');
  });
});

describe('writeTalkState', () => {
  let restore;
  afterEach(() => restore?.());

  it('writes pid and state', () => {
    restore = isolate();
    saveConfig({ keys: { enabled: false } });
    writeTalkPid(4242);
    writeTalkState(buildTalkState({ stt: true, tts: true, ok: true }));
    assert.equal(readTalkPid(), 4242);
    const raw = readFileSync(path.join(process.env.XDG_RUNTIME_DIR, 'dottie-talk', 'state'), 'utf8');
    const s = parseTalkState(raw);
    assert.equal(s.running, true);
    assert.equal(s.stt, true);
    assert.equal(s.keysEnabled, false);
  });
});

describe('stopTalkServer', () => {
  let restore;
  afterEach(() => restore?.());

  it('returns not running without a pid file', () => {
    restore = isolate();
    const r = stopTalkServer();
    assert.equal(r.stopped, false);
  });

  it('signals the recorded pid', () => {
    restore = isolate();
    writeTalkPid(77);
    let got = 0;
    const r = stopTalkServer({
      killFn: (pid, sig) => {
        got = pid;
        assert.equal(sig, 'SIGTERM');
      },
    });
    assert.equal(r.stopped, true);
    assert.equal(got, 77);
  });
});
