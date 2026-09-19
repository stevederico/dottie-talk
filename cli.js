#!/usr/bin/env node
/**
 * dottie-talk CLI — speak / transcribe / start / health
 *
 *   dottie-talk speak "hello" [-o out.wav] [--voice af_bella]
 *   dottie-talk transcribe audio.wav
 *   dottie-talk start          # HTTP :1320 (same as npm start)
 *   dottie-talk health
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { speak, transcribe } from './core.js';
import { ensureBinsRunning, binsHealth } from './bin_supervise.js';
import { PORTS } from './ports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage(code = 0) {
  const text = `dottie-talk — local STT + TTS

Usage:
  dottie-talk speak <text> [-o out.wav] [--voice <id>]
  dottie-talk transcribe <audio.wav>
  speak <text> [-o out.wav] [--voice <id>]
  transcribe <audio.wav>
  dottie-talk start
  dottie-talk health
  dottie-talk keys [on|off|status|speak|stop|dictate]
  dottie-talk bar [on|off|status]
  dottie-talk stop
  dottie-talk help

speak writes WAV to -o, or stdout when piped, else ./speech.wav.
transcribe prints text to stdout.
start runs the HTTP façade on :${PORTS.TALK_HTTP_PORT}.
keys is off by default. on installs Hyprland binds; they arm while start is running.
stop ends the HTTP server. bar on puts the Omarchy menubar icon (visible while start is running).
`;
  process.stderr.write(text);
  process.exit(code);
}

/**
 * @param {string[]} argv
 * @returns {{ cmd: string, text: string, file: string, out: string, voice: string, keysAction: string, barAction: string }}
 */
export function parseArgs(argv) {
  const bin = path.basename(argv[1] || '').replace(/\.js$/, '');
  let rest = argv.slice(2);
  let cmd;
  if (bin === 'transcribe' || bin === 'speak') {
    cmd = bin;
  } else {
    cmd = rest[0] || 'help';
    rest = rest.slice(1);
  }
  let out = '';
  let voice = '';
  const positionals = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-o' || a === '--out') {
      out = rest[++i] || '';
      continue;
    }
    if (a === '--voice') {
      voice = rest[++i] || '';
      continue;
    }
    if (a.startsWith('-')) continue;
    positionals.push(a);
  }
  return {
    cmd,
    text: cmd === 'speak' ? positionals.join(' ') : '',
    file: cmd === 'transcribe' ? (positionals[0] || '') : '',
    keysAction: cmd === 'keys' ? (positionals[0] || 'status') : '',
    barAction: cmd === 'bar' ? (positionals[0] || 'status') : '',
    out,
    voice,
  };
}

async function cmdSpeak({ text, out, voice }) {
  if (!text.trim()) {
    process.stderr.write('usage: speak <text> [-o out.wav]\n');
    process.exit(1);
  }
  await ensureBinsRunning();
  const result = await speak({ text, voice: voice || undefined });
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
    process.exit(1);
  }
  const wav = Buffer.from(result.audioBase64, 'base64');
  if (out) {
    writeFileSync(out, wav);
    process.stderr.write(`wrote ${out}\n`);
    return;
  }
  if (process.stdout.isTTY) {
    const dest = path.resolve('speech.wav');
    writeFileSync(dest, wav);
    process.stderr.write(`wrote ${dest}\n`);
    return;
  }
  process.stdout.write(wav);
}

async function cmdTranscribe({ file }) {
  if (!file) {
    process.stderr.write('usage: transcribe <audio.wav>\n');
    process.exit(1);
  }
  await ensureBinsRunning();
  const wavBuffer = readFileSync(file);
  const result = await transcribe({ wavBuffer });
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write(`${result.text}\n`);
}

async function cmdHealth() {
  const { keysStatus } = await import('./keys.js');
  const h = await binsHealth();
  process.stdout.write(`${JSON.stringify({ service: 'dottie-talk', ...h, keys: keysStatus() }, null, 2)}\n`);
  process.exit(h.ok ? 0 : 1);
}

async function cmdKeys(action) {
  const { runKeysCommand } = await import('./keys_hypr.js');
  const result = await runKeysCommand(action);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result && result.error) process.exit(1);
}

async function cmdStop() {
  const { stopTalkServer } = await import('./state.js');
  const result = stopTalkServer();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.stopped) process.exit(1);
}

async function cmdBar(action) {
  const { installBar, uninstallBar, barHasWidget, shellConfigPath } = await import('./bar.js');
  const { readFileSync, existsSync } = await import('node:fs');
  if (action === 'on' || action === 'enable') {
    const result = await installBar();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (action === 'off' || action === 'disable') {
    const result = await uninstallBar();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  let onBar = false;
  const file = shellConfigPath();
  if (existsSync(file)) {
    try { onBar = barHasWidget(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* ok */ }
  }
  process.stdout.write(`${JSON.stringify({ id: 'sd.dottie-talk', onBar }, null, 2)}\n`);
}

function cmdStart() {
  const httpJs = path.join(__dirname, 'http.js');
  const child = spawn(process.execPath, [httpJs], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  switch (opts.cmd) {
    case 'speak':
      await cmdSpeak(opts);
      break;
    case 'transcribe':
      await cmdTranscribe(opts);
      break;
    case 'start':
    case 'serve':
    case 'http':
      cmdStart();
      break;
    case 'health':
      await cmdHealth();
      break;
    case 'keys':
      await cmdKeys(opts.keysAction);
      break;
    case 'stop':
      await cmdStop();
      break;
    case 'bar':
      await cmdBar(opts.barAction);
      break;
    case 'help':
    case '-h':
    case '--help':
      usage(0);
      break;
    default:
      process.stderr.write(`unknown command: ${opts.cmd}\n`);
      usage(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err.message || err}\n`);
    process.exit(1);
  });
}
