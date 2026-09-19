/**
 * talk-keys analog: speak selection / stop / dictate.
 * Hotkeys only fire when keys.enabled and the HTTP server is up.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { speak } from './core.js';
import { ensureTtsRunning } from './bin_supervise.js';
import { loadConfig } from './config.js';

const execFileAsync = promisify(execFile);

export function runtimeDir() {
  return process.env.XDG_RUNTIME_DIR || tmpdir();
}

export function keysFlagPath() {
  return path.join(runtimeDir(), 'dottie-talk-keys.on');
}

export function speakActivePath() {
  return path.join(runtimeDir(), 'speak.active');
}

export function speakPidPath() {
  const dir = path.join(runtimeDir(), 'speak');
  return path.join(dir, 'speak.pid');
}

export function isUrlOnly(text) {
  return /^https?:\/\/\S+$/i.test(String(text || '').trim());
}

export function pickText(primary, clipboard) {
  const first = String(primary || '').trim();
  const second = String(clipboard || '').trim();
  if (first && !isUrlOnly(first)) return first;
  if (second && !isUrlOnly(second)) return second;
  return '';
}

export function isHotkeyInvoke() {
  const raw = (process.env.DOTTIE_TALK_KEYS_HOTKEY || '').trim();
  return raw === '1' || raw === 'true';
}

export function keysStatus() {
  const { keys } = loadConfig();
  const armed = Boolean(keys.enabled && existsSync(keysFlagPath()));
  return {
    enabled: Boolean(keys.enabled),
    armed,
    speak: keys.speak,
    stop: keys.stop,
    dictate: keys.dictate,
    voice: keys.voice,
    platform: process.platform,
  };
}

export function writeKeysFlag() {
  writeFileSync(keysFlagPath(), `${process.pid}\n`);
}

export function removeKeysFlag() {
  try { unlinkSync(keysFlagPath()); } catch { /* ok */ }
}

function pasteArgs(primary) {
  return primary ? ['--primary', '-n'] : ['-n'];
}

export async function readSelection({ execFileFn = execFileAsync } = {}) {
  const grab = async (primary) => {
    try {
      const { stdout } = await execFileFn('wl-paste', pasteArgs(primary), {
        timeout: 1500,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      });
      return String(stdout || '');
    } catch {
      return '';
    }
  };
  return pickText(await grab(true), await grab(false));
}

function playerCommands(wavPath) {
  return [
    ['pw-play', wavPath],
    ['paplay', wavPath],
    ['afplay', wavPath],
    ['mpv', '--no-terminal', '--really-quiet', '--audio-display=no', wavPath],
    ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', wavPath],
  ];
}

function whichPlayer(whichFn) {
  for (const cmd of playerCommands('x')) {
    if (whichFn(cmd[0])) return cmd[0];
  }
  return '';
}

export function markSpeaking(pid) {
  writeFileSync(speakActivePath(), `${pid}\n`);
  mkdirSync(path.dirname(speakPidPath()), { recursive: true });
  writeFileSync(speakPidPath(), `${pid}\n`);
}

export function clearSpeaking() {
  try { unlinkSync(speakActivePath()); } catch { /* ok */ }
  try { unlinkSync(speakPidPath()); } catch { /* ok */ }
}

export function isSpeaking() {
  return existsSync(speakActivePath());
}

export function stopSpeak({ killFn = process.kill } = {}) {
  let pid = 0;
  try {
    pid = Number(readFileSync(speakPidPath(), 'utf8').trim()) || 0;
  } catch { /* ok */ }
  if (pid > 1) {
    try { killFn(pid, 'SIGTERM'); } catch { /* ok */ }
  }
  clearSpeaking();
  return { stopped: pid > 1 };
}

function binOnPath(bin) {
  const dirs = (process.env.PATH || '/usr/bin:/bin').split(path.delimiter);
  return dirs.some((d) => existsSync(path.join(d || '.', bin)));
}

export async function speakSelection({
  execFileFn = execFileAsync,
  spawnFn,
  whichFn = binOnPath,
  speakFn = speak,
  ensureTtsFn = ensureTtsRunning,
} = {}) {
  const status = keysStatus();
  if (!status.enabled) return { skipped: 'disabled' };
  if (isHotkeyInvoke() && !status.armed) return { skipped: 'server-down' };
  if (isSpeaking()) return { ...stopSpeak(), stopped: true };

  const text = await readSelection({ execFileFn });
  if (!text) return { empty: true };

  await ensureTtsFn();
  const result = await speakFn({ text, voice: status.voice || undefined });
  if (result.error) return { error: result.error };

  const dir = path.join(tmpdir(), 'dottie-talk-keys');
  mkdirSync(dir, { recursive: true });
  const wavPath = path.join(dir, 'speech.wav');
  writeFileSync(wavPath, Buffer.from(result.audioBase64, 'base64'));

  const bin = whichPlayer(whichFn);
  if (!bin) return { error: 'no audio player (pw-play, paplay, mpv, ffplay)' };
  const args = playerCommands(wavPath).find((c) => c[0] === bin).slice(1);
  if (spawnFn) {
    const child = spawnFn(bin, args, { stdio: 'ignore', detached: true });
    child.unref?.();
    markSpeaking(child.pid);
    child.on?.('exit', () => clearSpeaking());
    return { text, pid: child.pid };
  }
  markSpeaking(process.pid);
  try {
    await execFileFn(bin, args, { timeout: 120_000 });
  } finally {
    clearSpeaking();
    try { rmSync(wavPath, { force: true }); } catch { /* ok */ }
  }
  return { text };
}

export async function dictate({ execFileFn = execFileAsync } = {}) {
  const status = keysStatus();
  if (!status.enabled) return { skipped: 'disabled' };
  if (isHotkeyInvoke() && !status.armed) return { skipped: 'server-down' };
  try {
    await execFileFn('voxtype', ['record', 'toggle'], { timeout: 5000, encoding: 'utf8' });
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    if (/ENOENT|not found/i.test(msg) || err.code === 'ENOENT') {
      return { error: 'voxtype not found on PATH — Omarchy: Install > AI > Dictation' };
    }
    return { error: `voxtype: ${msg.slice(0, 300)}` };
  }
}
