import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('parses speak with -o and --voice', () => {
    const r = parseArgs(['node', 'cli.js', 'speak', 'hello world', '-o', 'out.wav', '--voice', 'af_bella']);
    assert.equal(r.cmd, 'speak');
    assert.equal(r.text, 'hello world');
    assert.equal(r.out, 'out.wav');
    assert.equal(r.voice, 'af_bella');
  });

  it('parses transcribe file', () => {
    const r = parseArgs(['node', 'cli.js', 'transcribe', 'clip.wav']);
    assert.equal(r.cmd, 'transcribe');
    assert.equal(r.file, 'clip.wav');
  });

  it('defaults to help', () => {
    assert.equal(parseArgs(['node', 'cli.js']).cmd, 'help');
  });
});
