#!/usr/bin/env node
/**
 * Claude Code talk-back: read assistant replies aloud through koko.
 *
 *   node talk-back.js hook     Stop hook. Saves the reply; speaks it when on.
 *   node talk-back.js last     Speak the last saved reply.
 *   node talk-back.js on|off   Toggle talk-back.
 *   node talk-back.js stop     Stop playback.
 *   node talk-back.js interrupt  UserPromptSubmit hook. Typing cuts playback off.
 *   node talk-back.js status   Print on/off.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STATE_DIR = process.env.DOTTIE_TALK_TALK_BACK_DIR
  || path.join(os.homedir(), '.config', 'dottie-talk', 'talk-back');
const flagPath = () => path.join(STATE_DIR, 'on');
// Per session: two Claude Code windows must not read each other's replies.
// The hook gets session_id on stdin; /speak's Bash gets CLAUDE_CODE_SESSION_ID.
const sid = (id) => String(id || process.env.CLAUDE_CODE_SESSION_ID || 'default').replace(/[^\w-]/g, '');
const lastPath = (id) => path.join(STATE_DIR, `last-${sid(id)}.txt`);
// Set by `last` / `stop`. The next Stop is that command's own reply: the hook
// must not save it over the real reply or talk over playback.
const skipPath = (id) => path.join(STATE_DIR, `skip-${sid(id)}`);

export function isOn() {
  return existsSync(flagPath());
}

export function setOn(on) {
  mkdirSync(STATE_DIR, { recursive: true });
  if (on) writeFileSync(flagPath(), '');
  else try { unlinkSync(flagPath()); } catch { /* ok */ }
}

function consumeSkip(id) {
  if (!existsSync(skipPath(id))) return false;
  try { unlinkSync(skipPath(id)); } catch { /* ok */ }
  return true;
}

function markSkip(id) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(skipPath(id), '');
}

/** Markdown reply → plain sentences worth hearing. */
export function speakable(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*\|/.test(line))
    .map((line) => line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
    .join('\n')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Asterisks only: underscores live inside snake_case names.
    .replace(/(\*\*|\*|~~)(\S(?:.*?\S)?)\1/g, '$2')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function isPrompt(entry) {
  if (entry.type !== 'user' || entry.isMeta) return false;
  const c = entry.message?.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.some((b) => b.type === 'text');
}

const hasBlock = (entry, type) => Array.isArray(entry.message?.content)
  && entry.message.content.some((b) => b.type === type);

/**
 * The final reply only, from a transcript JSONL. Thinking is never text.
 * Text before a tool call is mid-turn narration, so hitting a tool call
 * before any text means the final reply is not written yet: return ''.
 */
export function lastReplyFromTranscript(jsonl) {
  const lines = String(jsonl).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (isPrompt(entry)) return '';
    if (hasBlock(entry, 'tool_result') || hasBlock(entry, 'tool_use')) return '';
    if (entry.type !== 'assistant') continue;
    const text = entry.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

/** Speak in a detached child so the hook returns at once. */
function speakDetached(text) {
  const self = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [self, 'say'], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.end(text);
  child.unref();
}

async function say(text) {
  const { speakStream } = await import('./core.js');
  const { playPcmStream, stopSpeak } = await import('./keys.js');
  stopSpeak();
  const result = await speakStream({ text });
  if (result.error) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  const played = playPcmStream(result.body);
  if (played.error) {
    process.stderr.write(`${played.error}\n`);
    return 1;
  }
  await played.done;
  return 0;
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

export async function hook(input) {
  let reply = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '';
  if (!reply && input.transcript_path) {
    try { reply = lastReplyFromTranscript(readFileSync(input.transcript_path, 'utf8')); } catch { /* ok */ }
  }
  // The /speak turn's own reply: keep the saved reply, stay quiet.
  if (consumeSkip(input.session_id)) return { spoke: false };
  const text = speakable(reply);
  if (!text) return { spoke: false };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(lastPath(input.session_id), text);
  if (!isOn()) return { spoke: false };
  speakDetached(text);
  return { spoke: true };
}

async function main(cmd) {
  switch (cmd) {
    case 'hook': {
      let input = {};
      try { input = JSON.parse(await readStdin() || '{}'); } catch { /* ok */ }
      await hook(input);
      return 0;
    }
    case 'say':
      return say(await readStdin());
    case 'last': {
      let text = '';
      try { text = readFileSync(lastPath(), 'utf8'); } catch { /* ok */ }
      if (!text.trim()) {
        console.log('no saved reply yet');
        return 1;
      }
      markSkip();
      speakDetached(text);
      console.log('speaking last reply');
      return 0;
    }
    case 'on':
      setOn(true);
      console.log('talk-back on');
      return 0;
    case 'off': {
      setOn(false);
      const { stopSpeak } = await import('./keys.js');
      stopSpeak();
      console.log('talk-back off');
      return 0;
    }
    case 'stop': {
      const { stopSpeak } = await import('./keys.js');
      markSkip();
      console.log(stopSpeak().stopped ? 'stopped' : 'nothing playing');
      return 0;
    }
    case 'interrupt': {
      // Silent: UserPromptSubmit stdout lands in the model's context.
      const { isSpeaking, stopSpeak } = await import('./keys.js');
      if (isSpeaking()) stopSpeak();
      return 0;
    }
    case 'toggle':
      return main(isOn() ? 'off' : 'on');
    case 'status':
      console.log(`talk-back ${isOn() ? 'on' : 'off'}`);
      return 0;
    default:
      console.log('usage: talk-back.js hook|last|on|off|toggle|stop|status');
      return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await main(process.argv[2]);
