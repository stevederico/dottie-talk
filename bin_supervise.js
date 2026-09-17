/**
 * Own STT (parakeet :1315) + TTS (koko :1314). Spawned when talk HTTP boots.
 * Gateway no longer supervises these binaries directly.
 */

import { spawn, execSync } from 'node:child_process';
import {
  createWriteStream, existsSync, statSync, statfsSync, mkdirSync,
  symlinkSync, lstatSync, unlinkSync, rmSync, readdirSync, renameSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PORTS } from './ports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
/** Prefer standalone cache; reuse ~/.dottie if models already there. */
const DATA_DIR = process.env.DOTTIE_TALK_DATA
  || (existsSync(path.join(HOME, '.dottie', 'checkpoints', 'kokoro-v1.0.onnx'))
    ? path.join(HOME, '.dottie')
    : path.join(HOME, '.cache', 'dottie-talk'));
const DOTTIE_DIR = DATA_DIR;

/** Prefer DOTTIE_BIN_DIR when it actually has bins (app-signed Resources/bin);
 *  else package-local bin/ so standalone clones ignore a stale env. */
function resolveBinDir() {
  const local = path.join(__dirname, 'bin');
  const env = process.env.DOTTIE_BIN_DIR;
  const has = (dir) => existsSync(path.join(dir, 'parakeet-server')) && existsSync(path.join(dir, 'koko'));
  if (env && has(env)) return env;
  if (has(local)) return local;
  return env || local;
}

function binDir() {
  return resolveBinDir();
}

function ensurePackageBinsInstalled() {
  const dir = binDir();
  const need = !existsSync(path.join(dir, 'parakeet-server')) || !existsSync(path.join(dir, 'koko'));
  if (!need) return dir;
  if (process.env.DOTTIE_SKIP_BIN_INSTALL === '1') {
    throw new Error(`bins missing in ${dir} — run: npm run install:bins (or unset DOTTIE_SKIP_BIN_INSTALL)`);
  }
  const script = path.join(__dirname, 'scripts', 'install_bins.sh');
  if (!existsSync(script)) {
    throw new Error(`bins missing in ${dir} and install_bins.sh not found`);
  }
  log(`bins missing — running ${script} → ${path.join(__dirname, 'bin')}`);
  execSync(`bash "${script}" "${path.join(__dirname, 'bin')}"`, {
    stdio: 'inherit',
    env: process.env,
  });
  const local = path.join(__dirname, 'bin');
  if (!existsSync(path.join(local, 'parakeet-server')) || !existsSync(path.join(local, 'koko'))) {
    throw new Error(`install_bins.sh finished but bins still missing under ${local}`);
  }
  return local;
}

const STT_GGUF = 'tdt-0.6b-v3-q8_0.gguf';
const STT_GGUF_BYTES = 940663680;
const STT_STREAM_GGUF = 'realtime_eou_120m-v1-f16.gguf';
const STT_STREAM_GGUF_BYTES = 266517952;
const STT_MODEL_URL_BASE = process.env.STT_MODEL_URL_BASE
  || 'https://huggingface.co/mudler/parakeet-cpp-gguf/resolve/main';
const STT_MODEL_DIR = path.join(HOME, '.cache', 'parakeet.cpp', 'models');

const KOKO_MODEL_URL_BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
const KOKO_FILES = [
  { rel: path.join('checkpoints', 'kokoro-v1.0.onnx'), bytes: 325532387 },
  { rel: path.join('data', 'voices-v1.0.bin'), bytes: 28214398 },
];

const children = { stt: null, tts: null };
let startPromise = null;
let healthTimer = null;

function log(msg) {
  process.stderr.write(`[dottie-talk] ${msg}\n`);
}

async function ensureDownloadedFile({ url, dest, expectedBytes, label }) {
  const filename = path.basename(dest);
  const dir = path.dirname(dest);
  if (existsSync(dest)) {
    const size = statSync(dest).size;
    if (size === expectedBytes) return dest;
    log(`${filename} size mismatch — re-downloading`);
    rmSync(dest, { force: true });
  }
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (f.startsWith(`${filename}.download-`)) rmSync(path.join(dir, f), { force: true });
  }
  try {
    const st = statfsSync(dir);
    const free = st.bavail * st.bsize;
    const needed = expectedBytes + 1024 ** 3;
    if (free < needed) throw new Error(`not enough disk (${Math.ceil((needed - free) / 1e9)} GB short)`);
  } catch (err) {
    if (/disk/.test(err.message)) throw err;
  }
  const tmp = `${dest}.download-${process.pid}`;
  log(`downloading ${label} ${filename} (${Math.round(expectedBytes / 1e6)} MB)`);
  const controller = new AbortController();
  let stallTimer = null;
  const arm = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(new Error('stalled')), 60_000);
  };
  arm();
  try {
    const resp = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const gate = new Transform({
      transform(chunk, _e, cb) { arm(); cb(null, chunk); },
    });
    await pipeline(Readable.fromWeb(resp.body), gate, createWriteStream(tmp));
    const got = statSync(tmp).size;
    if (got !== expectedBytes) throw new Error(`size mismatch (${got} != ${expectedBytes})`);
    renameSync(tmp, dest);
    return dest;
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* ok */ }
    throw new Error(`${filename}: ${err.message}`);
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}

function cachedModelPath(filename, expectedBytes) {
  const dest = path.join(STT_MODEL_DIR, filename);
  try {
    if (existsSync(dest) && statSync(dest).size === expectedBytes) return dest;
  } catch { /* miss */ }
  return null;
}

function hasValidKokoModels(dir) {
  return KOKO_FILES.every((f) => {
    try { return statSync(path.join(dir, f.rel)).size === f.bytes; } catch { return false; }
  });
}

async function ensureKokoModels() {
  const bundled = binDir();
  const candidates = [
    path.resolve(bundled, '..'),
    DOTTIE_DIR,
  ];
  const ready = candidates.find(hasValidKokoModels);
  if (ready) return ready;
  for (const f of KOKO_FILES) {
    await ensureDownloadedFile({
      url: `${KOKO_MODEL_URL_BASE}/${path.basename(f.rel)}`,
      dest: path.join(DOTTIE_DIR, f.rel),
      expectedBytes: f.bytes,
      label: 'TTS model',
    });
  }
  return DOTTIE_DIR;
}

function findEspeakData() {
  const bundled = binDir();
  for (const d of [
    path.join(bundled, 'espeak-ng-data'),
    path.join(bundled, '..', 'espeak-ng-data'),
    '/opt/homebrew/share/espeak-ng-data',
    '/usr/local/share/espeak-ng-data',
  ]) {
    if (existsSync(path.join(d, 'phontab'))) return d;
  }
  return '';
}

let kokoHardcodedEspeakPaths = null;
function ensureKokoEspeakSymlinks(kokoBin, espeakDataDir) {
  if (!kokoBin || !espeakDataDir || !existsSync(path.join(espeakDataDir, 'phontab'))) return;
  if (!kokoHardcodedEspeakPaths) {
    try {
      const out = execSync(`strings "${kokoBin}"`, { encoding: 'utf-8', timeout: 5000, maxBuffer: 64 * 1024 * 1024 });
      const re = /\/[^\s\0]*?espeak-rs-sys-[0-9a-f]+\/out\/share\/espeak-ng-data/g;
      kokoHardcodedEspeakPaths = Array.from(new Set(out.match(re) || []));
    } catch {
      return;
    }
  }
  for (const expected of kokoHardcodedEspeakPaths) {
    try {
      if (existsSync(path.join(expected, 'phontab'))) continue;
      try {
        const st = lstatSync(expected);
        if (st.isSymbolicLink() || st.isDirectory()) unlinkSync(expected);
      } catch { /* ok */ }
      mkdirSync(path.dirname(expected), { recursive: true });
      symlinkSync(espeakDataDir, expected);
    } catch { /* non-fatal */ }
  }
}

async function healthOk(url, timeoutMs = 800) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

function track(name, proc) {
  children[name] = proc;
  proc.on('exit', () => {
    if (children[name] === proc) children[name] = null;
    log(`${name} exited`);
  });
}

async function spawnStt() {
  if (await healthOk(`http://127.0.0.1:${PORTS.STT_PORT}/health`)) return true;
  const dir = ensurePackageBinsInstalled();
  const bin = [path.join(dir, 'parakeet-server'), '/usr/local/bin/parakeet-server']
    .find((p) => existsSync(p));
  if (!bin) throw new Error(`parakeet-server not found in ${dir} — run: npm run install:bins`);
  const legacyOnnx = path.join(DOTTIE_DIR, 'models', 'parakeet-tdt-0.6b-v3-int8');
  if (existsSync(legacyOnnx)) {
    try { rmSync(legacyOnnx, { recursive: true, force: true }); } catch { /* ok */ }
  }
  const modelPath = await ensureDownloadedFile({
    url: `${STT_MODEL_URL_BASE}/${STT_GGUF}`,
    dest: path.join(STT_MODEL_DIR, STT_GGUF),
    expectedBytes: STT_GGUF_BYTES,
    label: 'STT model',
  });
  const args = ['--model', modelPath, '--host', '127.0.0.1', '--port', String(PORTS.STT_PORT)];
  const streamPath = cachedModelPath(STT_STREAM_GGUF, STT_STREAM_GGUF_BYTES);
  if (streamPath) args.push('--stream-model', streamPath);
  else {
    // Background EOU download — non-blocking
    ensureDownloadedFile({
      url: `${STT_MODEL_URL_BASE}/${STT_STREAM_GGUF}`,
      dest: path.join(STT_MODEL_DIR, STT_STREAM_GGUF),
      expectedBytes: STT_STREAM_GGUF_BYTES,
      label: 'STT stream model',
    }).then(() => log('EOU model ready — restart talk to enable streaming'))
      .catch((e) => log(`EOU download failed: ${e.message}`));
  }
  log(`spawning STT ${bin}`);
  const proc = spawn(bin, args, {
    cwd: DOTTIE_DIR,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  track('stt', proc);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await healthOk(`http://127.0.0.1:${PORTS.STT_PORT}/health`, 500)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('STT failed to become healthy');
}

function resolveKokoBin() {
  const dir = binDir();
  if (existsSync(path.join(dir, 'koko'))) return path.join(dir, 'koko');
  for (const p of ['/usr/local/bin/koko', '/opt/homebrew/bin/koko']) {
    if (existsSync(p)) return p;
  }
  // Last resort: install script (may also fetch parakeet).
  try {
    const installed = ensurePackageBinsInstalled();
    const bin = path.join(installed, 'koko');
    if (existsSync(bin)) return bin;
  } catch { /* fall through */ }
  return null;
}

async function spawnTts() {
  if (await healthOk(`http://127.0.0.1:${PORTS.TTS_PORT}/`)) return true;
  const bin = resolveKokoBin();
  if (!bin) throw new Error(`koko not found — run: npm run install:bins`);
  const kokoDataDir = await ensureKokoModels();
  const espeakDataDir = findEspeakData();
  ensureKokoEspeakSymlinks(bin, espeakDataDir);
  log(`spawning TTS ${bin}`);
  const proc = spawn(bin, ['openai', '--port', String(PORTS.TTS_PORT), '--ip', '127.0.0.1'], {
    cwd: kokoDataDir,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
      PIPER_ESPEAKNG_DATA_DIRECTORY: espeakDataDir,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  track('tts', proc);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await healthOk(`http://127.0.0.1:${PORTS.TTS_PORT}/`, 500)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('TTS failed to become healthy');
}

/** Start koko TTS only (:1314). Idempotent. Does not require parakeet. */
export async function ensureTtsRunning() {
  return spawnTts();
}

/** Start STT+TTS if down. Idempotent. */
export async function ensureBinsRunning() {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    try {
      await spawnStt();
      await spawnTts();
      if (!healthTimer) {
        healthTimer = setInterval(() => {
          ensureBinsRunning().catch((e) => log(`health respawn: ${e.message}`));
        }, 15_000);
        healthTimer.unref?.();
      }
      return true;
    } finally {
      startPromise = null;
    }
  })();
  return startPromise;
}

/** Aggregate readiness for talk /health. */
export async function binsHealth() {
  const stt = await healthOk(`http://127.0.0.1:${PORTS.STT_PORT}/health`);
  const tts = await healthOk(`http://127.0.0.1:${PORTS.TTS_PORT}/`);
  return { stt, tts, ok: stt && tts };
}

export function stopBins() {
  for (const name of ['stt', 'tts']) {
    const p = children[name];
    if (p && !p.killed) {
      try { p.kill('SIGTERM'); } catch { /* ok */ }
    }
    children[name] = null;
  }
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}
