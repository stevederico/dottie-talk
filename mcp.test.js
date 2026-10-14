import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callTool, TALK_TOOLS } from './mcp.js';

let dir;
let prevRuntime;
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-talk-mcp-'));
  prevRuntime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
after(() => {
  if (prevRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = prevRuntime;
  rmSync(dir, { recursive: true, force: true });
});

const AUDIO = Buffer.from('fake-audio');
const fakeSpeak = async () => ({ audioBase64: AUDIO.toString('base64'), contentType: 'audio/mpeg' });
const noStream = async () => { throw new Error('should not stream'); };
const noPlay = () => { throw new Error('should not play'); };

describe('TALK_TOOLS', () => {
  it('transcribe takes a path', () => {
    const t = TALK_TOOLS.find((x) => x.name === 'transcribe');
    assert.ok(t.inputSchema.properties.path);
  });
});

describe('callTool transcribe', () => {
  it('reads the file at path and returns only text', async () => {
    let got;
    const r = await callTool('transcribe', { path: '/x.wav' }, {
      readFileFn: (p) => { assert.equal(p, '/x.wav'); return AUDIO; },
      transcribeFn: async (opts) => { got = opts; return { text: 'hello' }; },
    });
    assert.deepEqual(got.wavBuffer, AUDIO);
    assert.equal(r.content[0].text, 'hello');
    assert.equal(r.isError, undefined);
  });

  it('still accepts wavBase64', async () => {
    let got;
    await callTool('transcribe', { wavBase64: 'QUJD' }, {
      transcribeFn: async (opts) => { got = opts; return { text: 'ok' }; },
    });
    assert.equal(got.wavBase64, 'QUJD');
  });

  it('errors without path or wavBase64', async () => {
    const r = await callTool('transcribe', {});
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /path required/);
  });

  it('errors on unreadable path', async () => {
    const r = await callTool('transcribe', { path: path.join(dir, 'missing.wav') });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /cannot read/);
  });
});

describe('callTool speak', () => {
  it('streams to the player by default and returns no audio', async () => {
    const body = new ReadableStream();
    let streamed;
    const r = await callTool('speak', { text: 'hi' }, {
      speakFn: async () => { throw new Error('should not fetch full clip'); },
      speakStreamFn: async ({ text }) => { assert.equal(text, 'hi'); return { body }; },
      playPcmStreamFn: (b) => { streamed = b; return { pid: 42 }; },
    });
    assert.equal(streamed, body);
    assert.equal(r.content.length, 1);
    assert.equal(r.content[0].text, 'playing (pid 42)');
    assert.equal(r.structuredContent.audioBase64, undefined);
  });

  it('saves to out without playing', async () => {
    const out = path.join(dir, 'speech.mp3');
    const r = await callTool('speak', { text: 'hi', out }, {
      speakFn: fakeSpeak,
      speakStreamFn: noStream,
      playWavFn: noPlay,
    });
    assert.deepEqual(readFileSync(out), AUDIO);
    assert.match(r.content[0].text, /^saved /);
    assert.equal(r.structuredContent.path, out);
    assert.equal(r.structuredContent.audioBase64, undefined);
  });

  it('saves and plays when play: true with out', async () => {
    const out = path.join(dir, 'both.mp3');
    let played;
    const r = await callTool('speak', { text: 'hi', out, play: true }, {
      speakFn: fakeSpeak,
      speakStreamFn: noStream,
      playWavFn: (buf) => { played = buf; return { pid: 7 }; },
    });
    assert.ok(existsSync(out));
    assert.deepEqual(played, AUDIO);
    assert.match(r.content[0].text, /playing \(pid 7\)/);
  });

  it('returns base64 only when returnAudio is set', async () => {
    const r = await callTool('speak', { text: 'hi', returnAudio: true }, {
      speakFn: fakeSpeak,
      speakStreamFn: noStream,
      playWavFn: noPlay,
    });
    assert.equal(r.structuredContent.audioBase64, AUDIO.toString('base64'));
    assert.equal(r.content.at(-1).text, AUDIO.toString('base64'));
  });

  it('surfaces TTS and player errors', async () => {
    const tts = await callTool('speak', { text: 'hi' }, {
      speakStreamFn: async () => ({ error: 'koko not running' }),
    });
    assert.equal(tts.isError, true);
    const player = await callTool('speak', { text: 'hi' }, {
      speakStreamFn: async () => ({ body: new ReadableStream() }),
      playPcmStreamFn: () => ({ error: 'no streaming audio player' }),
    });
    assert.equal(player.isError, true);
  });
});
