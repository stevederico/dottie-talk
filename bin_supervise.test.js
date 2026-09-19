import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirHasRequiredBins, isNativeBin, kokoCandidates } from './bin_supervise.js';

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
    writeFileSync(path.join(dir, 'koko-linux-x86_64'), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    assert.equal(dirHasRequiredBins(dir), true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('kokoCandidates', () => {
  it('prefers koko-linux-x86_64 on Linux', () => {
    const names = kokoCandidates('/tmp/bin').map((p) => path.basename(p));
    if (process.platform === 'linux') {
      assert.deepEqual(names, ['koko-linux-x86_64', 'koko']);
    } else {
      assert.deepEqual(names, ['koko']);
    }
  });
});
