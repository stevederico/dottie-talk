#!/usr/bin/env node
/**
 * dottie-talk MCP stdio — transcribe / speak → local STT (parakeet or voxtype) + koko.
 * No gateway :1317 hop.
 *
 *   node mcp.js
 */

import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { transcribe, speak } from './core.js';
import { ensureBinsRunning } from './bin_supervise.js';

export const TALK_TOOLS = [
  {
    name: 'transcribe',
    description: 'Transcribe WAV audio (base64) via local STT (parakeet or voxtype).',
    inputSchema: {
      type: 'object',
      properties: {
        wavBase64: { type: 'string', description: 'WAV file bytes as base64' },
      },
      required: ['wavBase64'],
    },
  },
  {
    name: 'speak',
    description: 'Synthesize speech via local koko TTS; returns audio base64.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak' },
        voice: { type: 'string', description: 'Optional voice id' },
      },
      required: ['text'],
    },
  },
];

const server = new Server(
  { name: 'dottie-talk', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TALK_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments || {};

  if (name === 'transcribe') {
    const result = await transcribe({ wavBase64: args.wavBase64 });
    if (result.error) {
      return { content: [{ type: 'text', text: result.error }], isError: true };
    }
    return {
      content: [{ type: 'text', text: result.text }],
      structuredContent: { text: result.text },
    };
  }

  if (name === 'speak') {
    const result = await speak({ text: args.text, voice: args.voice });
    if (result.error) {
      return { content: [{ type: 'text', text: result.error }], isError: true };
    }
    return {
      content: [{ type: 'text', text: result.audioBase64 }],
      structuredContent: {
        audioBase64: result.audioBase64,
        contentType: result.contentType,
      },
    };
  }

  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await ensureBinsRunning();
  await server.connect(new StdioServerTransport());
}
