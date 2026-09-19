import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { barHasWidget, barPutArgs, installBar, talkBinScript } from './bar.js';

describe('barHasWidget', () => {
  it('finds the talk widget', () => {
    const shell = { bar: { layout: { right: [{ id: 'omarchy.audio' }, { id: 'sd.dottie-talk' }] } } };
    assert.equal(barHasWidget(shell), true);
  });

  it('is false when missing', () => {
    assert.equal(barHasWidget({ bar: { layout: { right: [{ id: 'omarchy.clock' }] } } }), false);
  });
});

describe('barPutArgs', () => {
  it('sits before Dottie when that widget is on the bar', () => {
    const args = barPutArgs({ bar: { layout: { right: [{ id: 'sd.dottie-omarchy' }] } } });
    assert.deepEqual(args, ['sd.dottie-talk', '--before', 'sd.dottie-omarchy']);
  });

  it('sits after audio otherwise', () => {
    const args = barPutArgs({ bar: { layout: { right: [{ id: 'omarchy.audio' }] } } });
    assert.deepEqual(args, ['sd.dottie-talk', '--after', 'omarchy.audio']);
  });
});

describe('talkBinScript', () => {
  it('execs this cli', () => {
    const sh = talkBinScript();
    assert.match(sh, /^#!\/bin\/sh/);
    assert.match(sh, /dottie-talk/);
    assert.match(sh, /cli\.js/);
  });
});

describe('installBar', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    delete process.env.DOTTIE_TALK_PLUGIN_DIR;
    delete process.env.DOTTIE_TALK_BIN;
    delete process.env.DOTTIE_TALK_SHELL_JSON;
  });

  it('writes bin, links plugin, puts the widget', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-talk-bar-'));
    process.env.DOTTIE_TALK_PLUGIN_DIR = path.join(dir, 'plugins', 'sd.dottie-talk');
    process.env.DOTTIE_TALK_BIN = path.join(dir, 'bin', 'dottie-talk');
    process.env.DOTTIE_TALK_SHELL_JSON = path.join(dir, 'shell.json');
    mkdirSync(path.join(dir, 'bin'), { recursive: true });
    writeFileSync(process.env.DOTTIE_TALK_SHELL_JSON, JSON.stringify({
      bar: { layout: { right: [{ id: 'omarchy.audio' }, { id: 'sd.dottie-omarchy' }] } },
    }));
    const calls = [];
    const result = await installBar({
      execFileFn: async (cmd, args) => {
        calls.push([cmd, args.slice()]);
        return { stdout: '' };
      },
    });
    assert.equal(result.id, 'sd.dottie-talk');
    assert.match(readFileSync(result.bin, 'utf8'), /cli\.js/);
    const put = calls.find((c) => c[0] === 'omarchy-bar');
    assert.deepEqual(put[1], ['put', 'sd.dottie-talk', '--before', 'sd.dottie-omarchy']);
  });
});
