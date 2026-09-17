import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, speak, TALK_PORTS } from './core.js';
import { sttBackend } from './bin_supervise.js';

describe('TALK_PORTS', () => {
  it('exposes STT TTS HTTP', () => {
    assert.equal(TALK_PORTS.STT, 1315);
    assert.equal(TALK_PORTS.TTS, 1314);
    assert.equal(TALK_PORTS.HTTP, 1320);
  });
});

describe('sttBackend', () => {
  const prev = process.env.DOTTIE_STT;
  after(() => {
    if (prev === undefined) delete process.env.DOTTIE_STT;
    else process.env.DOTTIE_STT = prev;
  });

  it('honors DOTTIE_STT=voxtype', () => {
    process.env.DOTTIE_STT = 'voxtype';
    assert.equal(sttBackend(), 'voxtype');
  });

  it('honors DOTTIE_STT=parakeet', () => {
    process.env.DOTTIE_STT = 'parakeet';
    assert.equal(sttBackend(), 'parakeet');
  });
});

describe('transcribe', () => {
  it('requires audio', async () => {
    const r = await transcribe({});
    assert.match(r.error, /wavBase64|wavBuffer/);
  });

  it('parses STT JSON via parakeet', async () => {
    const prev = process.env.DOTTIE_STT;
    process.env.DOTTIE_STT = 'parakeet';
    try {
      const fetchFn = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: 'hello' }),
      });
      const r = await transcribe({
        wavBuffer: Buffer.from('RIFF'),
        fetchFn,
      });
      assert.equal(r.text, 'hello');
    } finally {
      if (prev === undefined) delete process.env.DOTTIE_STT;
      else process.env.DOTTIE_STT = prev;
    }
  });

  it('uses voxtype CLI when backend=voxtype', async () => {
    const prev = process.env.DOTTIE_STT;
    process.env.DOTTIE_STT = 'voxtype';
    try {
      const execFileFn = async (cmd, args) => {
        assert.equal(cmd, 'voxtype');
        assert.equal(args[0], 'transcribe');
        assert.match(args[1], /\.wav$/);
        return { stdout: 'hello from voxtype\n', stderr: '' };
      };
      const r = await transcribe({
        wavBuffer: Buffer.from('RIFF'),
        execFileFn,
      });
      assert.equal(r.text, 'hello from voxtype');
    } finally {
      if (prev === undefined) delete process.env.DOTTIE_STT;
      else process.env.DOTTIE_STT = prev;
    }
  });
});

describe('speak', () => {
  it('requires text', async () => {
    const r = await speak({ text: '  ' });
    assert.match(r.error, /text/);
  });

  it('returns audioBase64', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('wav-bytes'),
      headers: { get: () => 'audio/wav' },
    });
    const r = await speak({ text: 'hi', fetchFn });
    assert.equal(r.contentType, 'audio/wav');
    assert.equal(Buffer.from(r.audioBase64, 'base64').toString(), 'wav-bytes');
  });
});
