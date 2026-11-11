/**
 * dottie-talk core — local STT/TTS muscles only (:1315 / :1314).
 * No gateway :1317 hop. Linux/Omarchy STT uses system voxtype CLI.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

  const norm = await toPcm16Wav(Buffer.from(buf), { execFileFn });
  if (norm.error) return { error: norm.error };
  buf = norm.wav;

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
      return { error: `STT ${res.status}: ${errorText(json.error) || textBody.slice(0, 300)}` };
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
 * Turn a server error field (string, or OpenAI-style { message }) into text.
 * @param {unknown} err
 * @returns {string}
 */
export function errorText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && typeof err.message === 'string') return err.message;
  return JSON.stringify(err);
}

/**
 * STT servers only read WAV, and chunking needs PCM16. Pass PCM16 WAV through;
 * convert anything else (mp3, m4a, float WAV, video) with ffmpeg to 16 kHz mono
 * PCM16. Without ffmpeg, a WAV of another sample format is sent as is.
 * @param {Buffer} buf
 * @param {object} [opts]
 * @param {(file: string, args: string[], opts?: object) => Promise<{ stdout: string, stderr: string }>} [opts.execFileFn]
 * @returns {Promise<{ wav: Buffer }|{ error: string }>}
 */
export async function toPcm16Wav(buf, { execFileFn = execFileAsync } = {}) {
  const w = parseWav(buf);
  if (w && w.bits === 16) return { wav: buf };

  const dir = mkdtempSync(path.join(tmpdir(), 'dottie-talk-'));
  const inPath = path.join(dir, 'input');
  const outPath = path.join(dir, 'audio.wav');
  try {
    writeFileSync(inPath, buf);
    await execFileFn('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath,
    ], { timeout: 600_000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' });
    return { wav: readFileSync(outPath) };
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (w) return { wav: buf };
      return { error: 'audio is not WAV and ffmpeg is not installed to convert it' };
    }
    const msg = err.stderr ? String(err.stderr).trim() : err.message;
    return { error: `cannot decode audio: ${String(msg).slice(0, 300)}` };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

// The patched parakeet-server caps request bodies at ~20 MB (about 10 minutes
// of 16 kHz mono PCM16), so long audio is sent in chunks cut at quiet spots.
const CHUNK_SEC = 300;
const CUT_SEARCH_SEC = 10;

/**
 * Locate the fmt and data chunks of a WAV file.
 * @param {Buffer} buf
 * @returns {{ sampleRate: number, channels: number, bits: number, dataOffset: number, dataLength: number }|null}
 */
export function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data' && fmt) {
      return { ...fmt, dataOffset: off + 8, dataLength: Math.min(size, buf.length - off - 8) };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Build a PCM16 WAV file around raw sample bytes.
 * @param {Buffer} data
 * @param {number} sampleRate
 * @param {number} channels
 */
function makeWav(data, sampleRate, channels) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/**
 * Split a PCM16 WAV into chunks of about CHUNK_SEC, cutting at the quietest
 * 20 ms frame in the CUT_SEARCH_SEC before each boundary so words stay whole.
 * @param {Buffer} buf
 * @param {number} [chunkSec]
 * @returns {{ wav: Buffer, offsetSec: number }[]}
 */
export function chunkWav(buf, chunkSec = CHUNK_SEC) {
  const w = parseWav(buf);
  if (!w || w.bits !== 16) return [{ wav: buf, offsetSec: 0 }];
  const frameBytes = w.channels * 2;
  const total = Math.floor(w.dataLength / frameBytes);
  const perChunk = chunkSec * w.sampleRate;
  if (total <= perChunk) return [{ wav: buf, offsetSec: 0 }];

  const win = Math.round(w.sampleRate * 0.02);
  const energy = (start) => {
    let sum = 0;
    for (let i = start; i < start + win; i++) {
      const s = buf.readInt16LE(w.dataOffset + i * frameBytes);
      sum += s * s;
    }
    return sum;
  };

  const chunks = [];
  let start = 0;
  while (total - start > perChunk) {
    const target = start + perChunk;
    let cut = target;
    let best = Infinity;
    // Search only the back half of the chunk so a cut always makes progress;
    // on ties the later frame wins, so uniform audio cuts near the boundary.
    const from = Math.max(start + Math.floor(perChunk / 2), target - CUT_SEARCH_SEC * w.sampleRate);
    for (let f = from; f + win <= target; f += win) {
      const e = energy(f);
      if (e <= best) { best = e; cut = f + Math.floor(win / 2); }
    }
    chunks.push([start, cut]);
    start = cut;
  }
  chunks.push([start, total]);

  return chunks.map(([a, b]) => ({
    wav: makeWav(buf.subarray(w.dataOffset + a * frameBytes, w.dataOffset + b * frameBytes), w.sampleRate, w.channels),
    offsetSec: a / w.sampleRate,
  }));
}

/**
 * Transcribe with per-word timestamps (parakeet only). Long audio is chunked
 * and each chunk's word times are shifted by its start offset.
 * @param {object} opts
 * @param {Buffer} opts.wavBuffer Audio; non-WAV is converted with ffmpeg
 * @param {typeof fetch} [opts.fetchFn]
 * @param {(file: string, args: string[], opts?: object) => Promise<{ stdout: string, stderr: string }>} [opts.execFileFn]
 * @returns {Promise<{ text: string, language: string, duration: number, words: { word: string, start: number, end: number, conf?: number }[] }|{ error: string }>}
 */
export async function transcribeWords({ wavBuffer, fetchFn = globalThis.fetch, execFileFn = execFileAsync } = {}) {
  if (!wavBuffer || !wavBuffer.length) return { error: 'wavBuffer required' };
  if (sttBackend() === 'voxtype') return { error: 'timestamps need parakeet; voxtype returns text only' };
  const norm = await toPcm16Wav(Buffer.from(wavBuffer), { execFileFn });
  if (norm.error) return { error: norm.error };

  const words = [];
  const texts = [];
  let language = '';
  let duration = 0;
  for (const { wav, offsetSec } of chunkWav(norm.wav)) {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    let json;
    try {
      const res = await fetchFn(`${STT}/v1/audio/transcriptions`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(600_000),
      });
      const body = await res.text();
      try { json = JSON.parse(body); } catch { return { error: `STT ${res.status}: ${body.slice(0, 300)}` }; }
      if (!res.ok) return { error: `STT ${res.status}: ${errorText(json.error) || body.slice(0, 300)}` };
    } catch (err) {
      const gone = err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message);
      return { error: gone ? `parakeet not running on :${PORTS.STT_PORT} — run: npm start` : err.message };
    }
    if (json.text) texts.push(json.text.trim());
    if (!language && json.language) language = json.language;
    duration = offsetSec + (json.duration || 0);
    for (const w of json.words || []) {
      words.push({ ...w, start: round3(w.start + offsetSec), end: round3(w.end + offsetSec) });
    }
  }
  return { text: texts.filter(Boolean).join(' '), language, duration: round3(duration), words };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Group timed words into caption cues: break before a cue would pass
 * maxChars, after sentence-ending punctuation, or at a pause over maxGap.
 * @param {{ word: string, start: number, end: number }[]} words
 * @returns {{ start: number, end: number, text: string }[]}
 */
export function wordsToCues(words, { maxChars = 60, maxGap = 1.0 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    const word = String(w.word).trim();
    if (!word) continue;
    const breakHere = cur && (
      cur.text.length + 1 + word.length > maxChars
      || w.start - cur.end > maxGap
      || /[.?!]$/.test(cur.text)
    );
    if (!cur || breakHere) {
      if (cur) cues.push(cur);
      cur = { start: w.start, end: w.end, text: word };
    } else {
      cur.text += ` ${word}`;
      cur.end = w.end;
    }
  }
  if (cur) cues.push(cur);
  return cues;
}

/**
 * Render cues as SRT.
 * @param {{ start: number, end: number, text: string }[]} cues
 */
export function cuesToSrt(cues) {
  const ts = (sec) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}

/**
 * Audio format for a save path: `.mp3` stays MP3, anything else is WAV.
 * @param {string} [file]
 * @returns {'mp3'|'wav'}
 */
export function formatForPath(file) {
  return /\.mp3$/i.test(String(file || '')) ? 'mp3' : 'wav';
}

/**
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} [opts.voice]
 * @param {'wav'|'mp3'|'pcm'} [opts.format] koko response_format; koko's default is MP3
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ audioBase64: string, contentType: string }|{ error: string }>}
 */
export async function speak({ text, voice, format, fetchFn = globalThis.fetch } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'text (string) required' };
  }
  const body = { input: text.trim(), model: 'kokoro' };
  if (voice) body.voice = voice;
  if (format) body.response_format = format;

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

/** koko `stream: true` sends raw PCM: s16le, 24 kHz, mono. */
export const PCM_FORMAT = { sampleRate: 24000, channels: 1, encoding: 's16le' };

/**
 * Start TTS and return the PCM body as it arrives, so playback starts on the
 * first chunk instead of after the whole clip.
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} [opts.voice]
 * @param {typeof fetch} [opts.fetchFn]
 * @returns {Promise<{ body: ReadableStream<Uint8Array> }|{ error: string }>}
 */
export async function speakStream({ text, voice, fetchFn = globalThis.fetch } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'text (string) required' };
  }
  const body = { input: text.trim(), model: 'kokoro', stream: true };
  if (voice) body.voice = voice;

  try {
    const res = await fetchFn(`${TTS}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { error: `TTS ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    return { body: res.body };
  } catch (err) {
    const gone = err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message);
    return {
      error: gone
        ? `koko not running on :${PORTS.TTS_PORT} — run: npm start`
        : err.message,
    };
  }
}

export const TALK_PORTS ={ STT: PORTS.STT_PORT, TTS: PORTS.TTS_PORT, HTTP: PORTS.TALK_HTTP_PORT };
