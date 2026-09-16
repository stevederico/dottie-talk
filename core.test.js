/**
 * dottie-talk core — never hits gateway :1317.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribe, speak, TALK_PORTS } from './core.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dottie-talk core', () => {
  it('transcribe POSTs to :1315, never :1317', async () => {
    const urls = [];
    const fetchFn = vi.fn(async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ text: 'hello' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const out = await transcribe({ wavBase64: Buffer.from('RIFF').toString('base64'), fetchFn });
    expect(out.text).toBe('hello');
    expect(urls[0]).toBe(`http://127.0.0.1:${TALK_PORTS.STT}/v1/audio/transcriptions`);
    expect(urls.every((u) => !u.includes(`:${TALK_PORTS.GATEWAY}`))).toBe(true);
  });

  it('speak POSTs to :1314, never :1317', async () => {
    const urls = [];
    const fetchFn = vi.fn(async (url) => {
      urls.push(String(url));
      return new Response(Buffer.from('audio'), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      });
    });
    const out = await speak({ text: 'hi', fetchFn });
    expect(out.audioBase64).toBe(Buffer.from('audio').toString('base64'));
    expect(urls[0]).toBe(`http://127.0.0.1:${TALK_PORTS.TTS}/v1/audio/speech`);
    expect(urls.every((u) => !u.includes(`:${TALK_PORTS.GATEWAY}`))).toBe(true);
  });

  it('rejects empty speak text without fetch', async () => {
    const fetchFn = vi.fn();
    const out = await speak({ text: '  ', fetchFn });
    expect(out.error).toMatch(/text/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
