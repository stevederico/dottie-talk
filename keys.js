/**
 * talk-keys analog: speak selection / stop / dictate.
 * Hotkeys only fire when keys.enabled and the HTTP server is up.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { speak } from './core.js';
import { ensureTtsRunning } from './bin_supervise.js';
import { loadConfig } from './config.js';

const execFileAsync = promisify(execFile);

export function notifyTalk(body) {
  try {
    const child = spawn('notify-send', ['-a', 'Talk', 'Talk', String(body || '')], {
      stdio: 'ignore',
      detached: true,
    });
    child.unref?.();
  } catch { /* no notifier */ }
}

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

export function processingPath() {
  return path.join(runtimeDir(), 'dottie-talk', 'processing');
}

export function markProcessing() {
  mkdirSync(path.dirname(processingPath()), { recursive: true });
  writeFileSync(processingPath(), `${process.pid}\n`);
  bumpBarStatus('processing');
}

export function clearProcessing() {
  try { unlinkSync(processingPath()); } catch { /* ok */ }
  if (!isSpeaking()) bumpBarStatus('idle');
}

export function isProcessing() {
  return existsSync(processingPath());
}

/** Patch bar state immediately — do not wait for the HTTP 400ms ticker. */
export function bumpBarStatus(status) {
  const dest = path.join(runtimeDir(), 'dottie-talk', 'state');
  try {
    const cur = JSON.parse(readFileSync(dest, 'utf8') || '{}');
    if (!cur || cur.running !== true) return;
    if (cur.status === status) return;
    cur.status = status;
    const tmp = `${dest}.${process.pid}.bump.tmp`;
    writeFileSync(tmp, `${JSON.stringify(cur)}\n`);
    renameSync(tmp, dest);
  } catch { /* server will refresh */ }
}

export function isUrlOnly(text) {
  return /^https?:\/\/\S+$/i.test(String(text || '').trim());
}

/**
 * If something is selected (primary), speak that. Otherwise use the clipboard.
 */
export function resolveSpeakText(primary, clipboard) {
  const p = String(primary || '').trim();
  const c = String(clipboard || '').trim();
  if (p && !isUrlOnly(p)) return { text: p, source: 'primary' };
  if (c && !isUrlOnly(c)) return { text: c, source: 'clipboard' };
  return { text: '', source: '' };
}

export function pickText(primary, clipboard) {
  return resolveSpeakText(primary, clipboard).text;
}

export async function clearPrimarySelection({ execFileFn = execFileAsync } = {}) {
  try {
    await execFileFn('wl-copy', ['--primary', '--clear'], { timeout: 1500 });
  } catch { /* ok */ }
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
  return resolveSpeakText(await grab(true), await grab(false));
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
  bumpBarStatus('speaking');
}

export function clearSpeaking() {
  try { unlinkSync(speakActivePath()); } catch { /* ok */ }
  try { unlinkSync(speakPidPath()); } catch { /* ok */ }
  clearProcessing();
  bumpBarStatus('idle');
}

export function isSpeaking() {
  if (!existsSync(speakActivePath())) return false;
  let pid = 0;
  try {
    pid = Number(readFileSync(speakPidPath(), 'utf8').trim()) || 0;
  } catch {
    try { pid = Number(readFileSync(speakActivePath(), 'utf8').trim()) || 0; } catch { /* ok */ }
  }
  if (pid > 1) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      clearSpeaking();
      return false;
    }
  }
  clearSpeaking();
  return false;
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
  spawnFn = spawn,
  whichFn = binOnPath,
  notifyFn = notifyTalk,
  speakFn = speak,
  ensureTtsFn = ensureTtsRunning,
} = {}) {
  const status = keysStatus();
  if (isHotkeyInvoke()) {
    if (!status.enabled) return { skipped: 'disabled' };
    if (!status.armed) return { skipped: 'server-down' };
  }
  // Second tap while playing stops. Key-repeat while TTS runs must not
  // start a parallel speak that overwrites the WAV mid-playback.
  if (isSpeaking()) return { ...stopSpeak(), stopped: true };
  if (isProcessing()) return { skipped: 'busy' };

  const { text, source } = await readSelection({ execFileFn });
  if (!text) {
    notifyFn('Nothing selected');
    return { empty: true };
  }
  notifyFn(text.length > 72 ? `${text.slice(0, 72)}…` : text);

  markProcessing();
  try {
    await ensureTtsFn();
    const result = await speakFn({ text, voice: status.voice || undefined });
    if (result.error) {
      notifyFn(result.error);
      return { error: result.error };
    }

    const dir = path.join(tmpdir(), 'dottie-talk-keys');
    mkdirSync(dir, { recursive: true });
    // Unique path: a second speak must not truncate the file pw-play is reading.
    const wavPath = path.join(dir, `speech-${process.pid}-${Date.now()}.wav`);
    writeFileSync(wavPath, Buffer.from(result.audioBase64, 'base64'));

    const bin = whichPlayer(whichFn);
    if (!bin) {
      const error = 'no audio player (pw-play, paplay, mpv, ffplay)';
      notifyFn(error);
      return { error };
    }
    const args = playerCommands(wavPath).find((c) => c[0] === bin).slice(1);
    const child = spawnFn(bin, args, { stdio: 'ignore', detached: true });
    child.unref?.();
    markSpeaking(child.pid);
    child.on?.('exit', () => clearSpeaking());
    // Drop primary after using it so the next Alt+S falls through to clipboard
    // when nothing is newly selected (Wayland primary otherwise stays stale).
    if (source === 'primary') {
      clearPrimarySelection({ execFileFn }).catch(() => {});
    }
    return { text, source, pid: child.pid };
  } finally {
    clearProcessing();
  }
}

export async function dictate({ execFileFn = execFileAsync, mode = 'toggle', notifyFn = notifyTalk } = {}) {
  const status = keysStatus();
  if (isHotkeyInvoke()) {
    if (!status.enabled) return { skipped: 'disabled' };
    if (!status.armed) return { skipped: 'server-down' };
  }
  const verb = mode === 'start' || mode === 'stop' ? mode : 'toggle';
  try {
    await execFileFn('voxtype', ['record', verb], { timeout: 5000, encoding: 'utf8' });
    notifyFn(verb === 'start' ? 'Dictation on' : verb === 'stop' ? 'Dictation off' : 'Dictation toggle');
    return { ok: true, mode: verb };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    if (/ENOENT|not found/i.test(msg) || err.code === 'ENOENT') {
      const error = 'voxtype not found on PATH — Omarchy: Install > AI > Dictation';
      notifyFn(error);
      return { error };
    }
    const error = `voxtype: ${msg.slice(0, 300)}`;
    notifyFn(error);
    return { error };
  }
}
