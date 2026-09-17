import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, speak, TALK_PORTS } from './core.js';

describe('TALK_PORTS', () => {
  it('exposes STT TTS HTTP', () => {
    assert.equal(TALK_PORTS.STT, 1315);
    assert.equal(TALK_PORTS.TTS, 1314);
    assert.equal(TALK_PORTS.HTTP, 1320);
  });
});

describe('transcribe', () => {
  it('requires audio', async () => {
    const r = await transcribe({});
    assert.match(r.error, /wavBase64|wavBuffer/);
  });

  it('parses STT JSON', async () => {
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
