/**
 * Runtime state for the Omarchy bar widget.
 * $XDG_RUNTIME_DIR/dottie-talk/state — FileView, never poll via spawn.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isSpeaking, keysStatus } from './keys.js';
import { PORTS } from './ports.js';

export function talkDir() {
  return path.join(process.env.XDG_RUNTIME_DIR || tmpdir(), 'dottie-talk');
}

export function talkStatePath() {
  return path.join(talkDir(), 'state');
}

export function talkPidPath() {
  return path.join(talkDir(), 'http.pid');
}

export function buildTalkState(bins = {}, extra = {}) {
  const keys = keysStatus();
  const speaking = isSpeaking();
  return {
    running: true,
    pid: process.pid,
    port: PORTS.TALK_HTTP_PORT,
    status: speaking ? 'speaking' : 'idle',
    stt: Boolean(bins.stt),
    tts: Boolean(bins.tts),
    ok: Boolean(bins.ok),
    backend: bins.backend || '',
    keysEnabled: Boolean(keys.enabled),
    keysArmed: Boolean(keys.armed),
    speak: keys.speak || '',
    dictate: keys.dictate || '',
    ...extra,
  };
}

export function parseTalkState(raw) {
  const fallback = {
    running: false,
    pid: 0,
    status: 'off',
    stt: false,
    tts: false,
    ok: false,
    backend: '',
    keysEnabled: false,
    keysArmed: false,
    speak: '',
    dictate: '',
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    const running = parsed.running === true || (typeof parsed.pid === 'number' && parsed.pid > 1);
    return {
      running,
      pid: Number(parsed.pid) || 0,
      status: running ? (parsed.status === 'speaking' ? 'speaking' : 'idle') : 'off',
      stt: parsed.stt === true,
      tts: parsed.tts === true,
      ok: parsed.ok === true,
      backend: typeof parsed.backend === 'string' ? parsed.backend : '',
      keysEnabled: parsed.keysEnabled === true,
      keysArmed: parsed.keysArmed === true,
      speak: typeof parsed.speak === 'string' ? parsed.speak : '',
      dictate: typeof parsed.dictate === 'string' ? parsed.dictate : '',
    };
  } catch {
    return fallback;
  }
}

let lastJson = '';

export function writeTalkState(state) {
  const dir = talkDir();
  mkdirSync(dir, { recursive: true });
  const json = `${JSON.stringify(state)}\n`;
  if (json === lastJson) return false;
  lastJson = json;
  const dest = talkStatePath();
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, dest);
  return true;
}

export function clearTalkState() {
  lastJson = '';
  try { unlinkSync(talkStatePath()); } catch { /* ok */ }
  try { unlinkSync(talkPidPath()); } catch { /* ok */ }
}

export function writeTalkPid(pid = process.pid) {
  mkdirSync(talkDir(), { recursive: true });
  writeFileSync(talkPidPath(), `${pid}\n`);
}

export function readTalkPid() {
  try {
    const n = Number(readFileSync(talkPidPath(), 'utf8').trim());
    return n > 1 ? n : 0;
  } catch {
    return 0;
  }
}

export function stopTalkServer({ killFn = process.kill } = {}) {
  const pid = readTalkPid();
  if (!pid) return { stopped: false, error: 'not running' };
  try {
    killFn(pid, 'SIGTERM');
  } catch (err) {
    return { stopped: false, error: err.message || String(err), pid };
  }
  return { stopped: true, pid };
}


