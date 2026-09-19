import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearSpeaking,
  dictate,
  isUrlOnly,
  keysStatus,
  markSpeaking,
  pickText,
  readSelection,
  speakSelection,
  stopSpeak,
  writeKeysFlag,
} from './keys.js';
import { saveConfig } from './config.js';

function isolate() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-talk-keys-'));
  const prev = {
    config: process.env.DOTTIE_TALK_CONFIG,
    keys: process.env.DOTTIE_TALK_KEYS,
    runtime: process.env.XDG_RUNTIME_DIR,
    hotkey: process.env.DOTTIE_TALK_KEYS_HOTKEY,
  };
  process.env.DOTTIE_TALK_CONFIG = path.join(dir, 'config.json');
  process.env.XDG_RUNTIME_DIR = dir;
  delete process.env.DOTTIE_TALK_KEYS;
  delete process.env.DOTTIE_TALK_KEYS_HOTKEY;
  return () => {
    clearSpeaking();
    for (const [name, value] of Object.entries({
      DOTTIE_TALK_CONFIG: prev.config,
      DOTTIE_TALK_KEYS: prev.keys,
      XDG_RUNTIME_DIR: prev.runtime,
      DOTTIE_TALK_KEYS_HOTKEY: prev.hotkey,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  };
}

describe('pickText', () => {
  it('prefers primary', () => {
    assert.equal(pickText(' highlighted ', 'clip'), 'highlighted');
  });

  it('skips URL-only primary', () => {
    assert.equal(pickText('https://x.com/foo', 'hello'), 'hello');
  });

  it('returns empty when both URL or blank', () => {
    assert.equal(pickText('https://x.com', '  '), '');
  });
});

describe('isUrlOnly', () => {
  it('matches a bare URL', () => {
    assert.equal(isUrlOnly('https://example.com/a'), true);
  });

  it('rejects prose with a URL', () => {
    assert.equal(isUrlOnly('see https://example.com'), false);
  });
});

describe('keysStatus', () => {
  let restore;
  afterEach(() => restore?.());

  it('is disarmed by default', () => {
    restore = isolate();
    const s = keysStatus();
    assert.equal(s.enabled, false);
    assert.equal(s.armed, false);
  });

  it('arms when enabled and flag exists', () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    writeKeysFlag();
    const s = keysStatus();
    assert.equal(s.enabled, true);
    assert.equal(s.armed, true);
  });
});

describe('readSelection', () => {
  it('uses primary then clipboard', async () => {
    const calls = [];
    const execFileFn = async (cmd, args) => {
      calls.push([cmd, args.slice()]);
      if (args.includes('--primary')) return { stdout: '  sel  ' };
      return { stdout: 'clip' };
    };
    assert.equal(await readSelection({ execFileFn }), 'sel');
    assert.equal(calls[0][0], 'wl-paste');
    assert.ok(calls[0][1].includes('--primary'));
  });
});

describe('speakSelection', () => {
  let restore;
  afterEach(() => restore?.());

  it('hotkey no-ops when disabled', async () => {
    restore = isolate();
    process.env.DOTTIE_TALK_KEYS_HOTKEY = '1';
    const r = await speakSelection({
      execFileFn: async () => ({ stdout: 'hi' }),
      speakFn: async () => { throw new Error('should not speak'); },
    });
    assert.equal(r.skipped, 'disabled');
  });

  it('hotkey no-ops when server is down', async () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    process.env.DOTTIE_TALK_KEYS_HOTKEY = '1';
    const r = await speakSelection({
      execFileFn: async () => ({ stdout: 'hi' }),
      speakFn: async () => { throw new Error('should not speak'); },
    });
    assert.equal(r.skipped, 'server-down');
  });

  it('second tap stops playback', async () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    writeKeysFlag();
    markSpeaking(1234);
    let killed = 0;
    const r = stopSpeak({ killFn: (pid) => { killed = pid; } });
    assert.equal(r.stopped, true);
    assert.equal(killed, 1234);
  });

  it('speaks selected text', async () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    writeFileSync(process.env.XDG_RUNTIME_DIR + '/dummy', '');
    const r = await speakSelection({
      execFileFn: async (cmd, args) => {
        if (cmd === 'wl-paste') {
          return { stdout: args.includes('--primary') ? 'hello there' : '' };
        }
        return { stdout: '' };
      },
      whichFn: (bin) => bin === 'pw-play',
      spawnFn: () => ({ pid: 9, unref() {}, on() {} }),
      speakFn: async ({ text }) => {
        assert.equal(text, 'hello there');
        return { audioBase64: Buffer.from('wav').toString('base64'), contentType: 'audio/wav' };
      },
      ensureTtsFn: async () => true,
    });
    assert.equal(r.text, 'hello there');
    assert.equal(r.pid, 9);
    clearSpeaking();
  });
});

describe('dictate', () => {
  let restore;
  afterEach(() => restore?.());

  it('toggles voxtype when enabled', async () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    const r = await dictate({
      execFileFn: async (cmd, args) => {
        assert.equal(cmd, 'voxtype');
        assert.deepEqual(args, ['record', 'toggle']);
        return { stdout: '' };
      },
    });
    assert.equal(r.ok, true);
  });

  it('starts and stops voxtype for push-to-talk', async () => {
    restore = isolate();
    saveConfig({ keys: { enabled: true } });
    const start = await dictate({
      mode: 'start',
      execFileFn: async (cmd, args) => {
        assert.equal(cmd, 'voxtype');
        assert.deepEqual(args, ['record', 'start']);
        return { stdout: '' };
      },
    });
    assert.equal(start.mode, 'start');
    const stop = await dictate({
      mode: 'stop',
      execFileFn: async (cmd, args) => {
        assert.deepEqual(args, ['record', 'stop']);
        return { stdout: '' };
      },
    });
    assert.equal(stop.mode, 'stop');
  });
});
