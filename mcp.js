#!/usr/bin/env node
/**
 * dottie-talk MCP stdio — transcribe / speak → local STT (parakeet or voxtype) + koko.
 * No gateway :1317 hop.
 *
 * Audio stays on disk or goes to the speakers. Base64 only on request, so an
 * agent's context never fills with audio bytes.
 *
 *   node mcp.js
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { transcribe, speak, speakStream } from './core.js';
import { ensureBinsRunning } from './bin_supervise.js';
import { clearProcessing, markProcessing, playPcmStream, playWav } from './keys.js';

export const TALK_TOOLS = [
  {
    name: 'transcribe',
    description: 'Transcribe an audio file via local STT (parakeet or voxtype). Pass `path`; returns the text.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to a WAV file' },
        wavBase64: { type: 'string', description: 'WAV bytes as base64. For apps; agents should pass `path`.' },
      },
    },
  },
  {
    name: 'speak',
    description: 'Say text out loud via local koko TTS. Streams to the speakers by default, so audio starts right away. '
      + 'Set `out` to save a file instead. Returns a short status line, not audio.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        voice: { type: 'string', description: 'Optional voice id' },
        out: { type: 'string', description: 'Save the audio to this path' },
        play: { type: 'boolean', description: 'Play out loud. Default true, false when `out` or `returnAudio` is set.' },
        returnAudio: { type: 'boolean', description: 'Also return audio as base64. For apps; large.' },
      },
      required: ['text'],
    },
  },
];

const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
const ok = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });

/**
 * Tool handler, split out from the server so tests can inject fakes.
 */
export async function callTool(name, args = {}, {
  transcribeFn = transcribe,
  speakFn = speak,
  speakStreamFn = speakStream,
  playWavFn = playWav,
  playPcmStreamFn = playPcmStream,
  readFileFn = readFileSync,
  writeFileFn = writeFileSync,
} = {}) {
  if (name === 'transcribe') {
    if (!args.path && !args.wavBase64) return fail('path required');
    let wavBuffer;
    if (args.path) {
      try {
        wavBuffer = readFileFn(args.path);
      } catch (err) {
        return fail(`cannot read ${args.path}: ${err.message}`);
      }
    }
    const result = await transcribeFn({ wavBuffer, wavBase64: args.wavBase64 });
    if (result.error) return fail(result.error);
    return ok(result.text, { text: result.text });
  }

  if (name === 'speak') {
    const { text, voice, out, returnAudio } = args;
    const play = args.play ?? !(out || returnAudio);

    // Plain "say this": stream PCM straight to the player.
    if (play && !out && !returnAudio) {
      markProcessing();
      let result;
      try {
        result = await speakStreamFn({ text, voice });
      } finally {
        clearProcessing();
      }
      if (result.error) return fail(result.error);
      const played = playPcmStreamFn(result.body);
      if (played.error) return fail(played.error);
      return ok(`playing (pid ${played.pid})`, { playing: true, pid: played.pid });
    }

    markProcessing();
    let result;
    try {
      result = await speakFn({ text, voice });
    } finally {
      clearProcessing();
    }
    if (result.error) return fail(result.error);

    const audio = Buffer.from(result.audioBase64, 'base64');
    const lines = [];
    const structured = { contentType: result.contentType, bytes: audio.length };
    if (out) {
      const dest = path.resolve(out);
      try {
        writeFileFn(dest, audio);
      } catch (err) {
        return fail(`cannot write ${dest}: ${err.message}`);
      }
      lines.push(`saved ${dest} (${result.contentType}, ${audio.length} bytes)`);
      structured.path = dest;
    }
    if (play) {
      const played = playWavFn(audio);
      if (played.error) return fail(played.error);
      lines.push(`playing (pid ${played.pid})`);
      structured.pid = played.pid;
    }
    if (returnAudio) {
      structured.audioBase64 = result.audioBase64;
      return {
        content: [...lines.map((t) => ({ type: 'text', text: t })), { type: 'text', text: result.audioBase64 }],
        structuredContent: structured,
      };
    }
    return ok(lines.join('\n') || 'done', structured);
  }

  return fail(`Unknown tool: ${name}`);
}

const server = new Server(
  { name: 'dottie-talk', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TALK_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) =>
  callTool(req.params.name, req.params.arguments || {}));

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await ensureBinsRunning();
  await server.connect(new StdioServerTransport());
}
