import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dirHasRequiredBins, isNativeBin, kokoCandidates, kokoEspeakEnv, kokoLinuxName, sttState, ttsState, voxtypeFetchSpec,
  voxtypeHasModel, voxtypeModelDir, voxtypeModelName,
} from './bin_supervise.js';

describe('kokoEspeakEnv', () => {
  it('points koko at the folder that contains espeak-ng-data', () => {
    const env = kokoEspeakEnv('/Applications/Dottie.app/Contents/Resources/espeak-ng-data');
    assert.deepEqual(env, {
      PIPER_ESPEAKNG_DATA_DIRECTORY: '/Applications/Dottie.app/Contents/Resources',
      ESPEAK_DATA_PATH: '/Applications/Dottie.app/Contents/Resources',
      ESPEAKNG_DATA_PATH: '/Applications/Dottie.app/Contents/Resources',
    });
  });

  it('sets nothing when no espeak-ng-data was found', () => {
    assert.deepEqual(kokoEspeakEnv(''), {});
  });
});

describe('isNativeBin', () => {
  it('accepts ELF on Linux', () => {
    if (process.platform !== 'linux') return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-native-'));
    const elf = path.join(dir, 'koko');
    writeFileSync(elf, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00]));
    assert.equal(isNativeBin(elf), true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects Mach-O on Linux', () => {
    if (process.platform !== 'linux') return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-macho-'));
    const macho = path.join(dir, 'koko');
    writeFileSync(macho, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    assert.equal(isNativeBin(macho), false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('dirHasRequiredBins', () => {
  it('ignores Darwin koko on Linux', () => {
    if (process.platform !== 'linux') return;
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-bins-'));
    writeFileSync(path.join(dir, 'koko'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    assert.equal(dirHasRequiredBins(dir), false);
    writeFileSync(path.join(dir, kokoLinuxName()), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    assert.equal(dirHasRequiredBins(dir), true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('voxtypeFetchSpec', () => {
  it('points at the small AVX2 binary on linux x64', () => {
    const spec = voxtypeFetchSpec();
    if (process.platform !== 'linux' || process.arch !== 'x64') {
      assert.equal(spec, null);
      return;
    }
    assert.match(spec.url, /voxtype-1\.0\.1-linux-x86_64-avx2$/);
    assert.equal(spec.bytes, 18245408);
    assert.equal(spec.model, 'base.en');
  });
});

describe('voxtype model', () => {
  it('looks under XDG_DATA_HOME', () => {
    assert.equal(voxtypeModelDir({ XDG_DATA_HOME: '/data' }), '/data/voxtype/models');
  });

  it('has no model in a missing or empty folder', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-vox-'));
    assert.equal(voxtypeHasModel(path.join(dir, 'nope')), false);
    assert.equal(voxtypeHasModel(dir), false);
    writeFileSync(path.join(dir, 'CACHEDIR.TAG'), 'x');
    assert.equal(voxtypeHasModel(dir), false);
    writeFileSync(path.join(dir, 'ggml-base.en.bin'), 'x');
    assert.equal(voxtypeHasModel(dir), true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to base.en and rejects odd names', () => {
    assert.equal(voxtypeModelName({}), 'base.en');
    assert.equal(voxtypeModelName({ DOTTIE_VOXTYPE_MODEL: 'small.en' }), 'small.en');
    assert.equal(voxtypeModelName({ DOTTIE_VOXTYPE_MODEL: 'a b; rm' }), 'base.en');
  });
});

describe('kokoLinuxName', () => {
  it('names the binary the way uname -m spells the CPU', () => {
    assert.equal(kokoLinuxName('x64'), 'koko-linux-x86_64');
    assert.equal(kokoLinuxName('arm64'), 'koko-linux-aarch64');
  });
});

describe('kokoCandidates', () => {
  it('prefers the koko for this CPU on Linux', () => {
    const names = kokoCandidates('/tmp/bin').map((p) => path.basename(p));
    if (process.platform === 'linux') {
      assert.deepEqual(names, [kokoLinuxName(), 'koko']);
    } else {
      assert.deepEqual(names, ['koko']);
    }
  });
});

describe('ttsState', () => {
  const fast = { retryDelayMs: 0 };

  it('is up when koko answers', async () => {
    const r = await ttsState({ ...fast, healthFn: async () => true, portOpenFn: async () => { throw new Error('no probe'); } });
    assert.equal(r, 'up');
  });

  it('is down, not wedged, when nothing listens', async () => {
    const r = await ttsState({ ...fast, healthFn: async () => false, portOpenFn: async () => false });
    assert.equal(r, 'down');
  });

  it('is up when a retry answers after one slow probe', async () => {
    let calls = 0;
    const r = await ttsState({ ...fast, healthFn: async () => ++calls > 1, portOpenFn: async () => true });
    assert.equal(r, 'up');
  });

  it('is wedged only after every retry fails', async () => {
    let calls = 0;
    const r = await ttsState({
      ...fast, retries: 3, healthFn: async () => { calls++; return false; }, portOpenFn: async () => true,
    });
    assert.equal(r, 'wedged');
    assert.equal(calls, 4);
  });
});

describe('sttState', () => {
  const fast = { retryDelayMs: 0 };

  it('probes parakeet /health on the STT port', async () => {
    const urls = [];
    const r = await sttState({ ...fast, healthFn: async (u) => { urls.push(u); return true; } });
    assert.equal(r, 'up');
    assert.match(urls[0], /:1315\/health$/);
  });

  it('is up, not down, when a busy parakeet answers a retry', async () => {
    let calls = 0;
    const r = await sttState({ ...fast, healthFn: async () => ++calls > 2, portOpenFn: async () => true });
    assert.equal(r, 'up');
  });

  it('is down only when nothing listens', async () => {
    const r = await sttState({ ...fast, healthFn: async () => false, portOpenFn: async () => false });
    assert.equal(r, 'down');
  });
});
