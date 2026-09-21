/**
 * dottie-talk core — local STT/TTS muscles only (:1315 / :1314).
 * No gateway :1317 hop. Linux/Omarchy STT uses system voxtype CLI.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PORTS } from './ports.js';
import { sttBackend } from './bin_supervise.js';

const execFileAsync = promisify(execFile);

const STT = `http://127.0.0.1:${PORTS.STT_PORT}`;
const TTS = `http://127.0.0.1:${PORTS.TTS_PORT}`;

/**
 * @param {object} opts
 * @param {string} [opts.wavBase64]
 * @param {Buffer|Uint8Array} [opts.wavBuffer]
 * @param {typeof fetch} [opts.fetchFn]
 * @param {(file: string, args: string[], opts?: object) => Promise<{ stdout: string, stderr: string }>} [opts.execFileFn]
 * @returns {Promise<{ text: string }|{ error: string }>}
 */
export async function transcribe({
  wavBase64,
  wavBuffer,
  fetchFn = globalThis.fetch,
  execFileFn = execFileAsync,
} = {}) {
  let buf = wavBuffer;
  if (!buf && typeof wavBase64 === 'string') {
    buf = Buffer.from(wavBase64, 'base64');
  }
  if (!buf || !buf.length) {
    return { error: 'wavBase64 or wavBuffer required' };
  }

  if (sttBackend() === 'voxtype') {
    return transcribeVoxtype(buf, execFileFn);
  }
  return transcribeParakeet(buf, fetchFn);
}

/**
 * @param {Buffer|Uint8Array} buf
 * @param {(file: string, args: string[], opts?: object) => Promise<{ stdout: string, stderr: string }>} execFileFn
 */
async function transcribeVoxtype(buf, execFileFn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'dottie-talk-'));
  const wavPath = path.join(dir, 'audio.wav');
  try {
    writeFileSync(wavPath, buf);
    const { stdout, stderr } = await execFileFn('voxtype', ['transcribe', wavPath], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    });
    const text = String(stdout || '').trim();
    if (!text && stderr) {
      return { error: `voxtype: ${String(stderr).slice(0, 300)}` };
    }
    return { text };
  } catch (err) {
    const msg = err.stderr ? String(err.stderr).trim() : err.message;
    if (/ENOENT|not found/i.test(msg) || err.code === 'ENOENT') {
      return {
        error: 'voxtype missing — restart talk so it can download the binary',
      };
    }
    return { error: `voxtype: ${String(msg).slice(0, 300)}` };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

/**
 * @param {Buffer|Uint8Array} buf
 * @param {typeof fetch} fetchFn
 */
async function transcribeParakeet(buf, fetchFn) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');

  try {
    const res = await fetchFn(`${STT}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const textBody = await res.text();
    let json;
    try {
      json = JSON.parse(textBody);
    } catch {
      return { error: `STT ${res.status}: ${textBody.slice(0, 300)}` };
    }
    if (!res.ok) {
      return { error: `STT ${res.status}: ${json.error || textBody.slice(0, 300)}` };
    }
    return { text: typeof json.text === 'string' ? json.text : '' };
  } catch (err) {
    const gone = err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message);
    return {
      error: gone
        ? `parakeet not running on :${PORTS.STT_PORT} — run: npm start`
        : err.message,
    };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} [opts.voice]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ audioBase64: string, contentType: string }|{ error: string }>}
 */
export async function speak({ text, voice, fetchFn = globalThis.fetch } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'text (string) required' };
  }
  const body = { input: text.trim(), model: 'kokoro' };
  if (voice) body.voice = voice;

  try {
    const res = await fetchFn(`${TTS}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return { error: `TTS ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const ab = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'audio/wav';
    return {
      audioBase64: Buffer.from(ab).toString('base64'),
      contentType,
    };
  } catch (err) {
    const gone = err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message);
    return {
      error: gone
        ? `koko not running on :${PORTS.TTS_PORT} — run: npm start`
        : err.message,
    };
  }
}

export const TALK_PORTS = { STT: PORTS.STT_PORT, TTS: PORTS.TTS_PORT, HTTP: PORTS.TALK_HTTP_PORT };
