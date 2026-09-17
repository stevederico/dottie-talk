/**
 * dottie-talk HTTP — owns STT/TTS binaries and proxies audio APIs.
 * Listen: DOTTIE_TALK_HTTP_PORT=1320 node http.js
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { PORTS } from './ports.js';
import { ensureBinsRunning, binsHealth, stopBins } from './bin_supervise.js';
import { transcribe, speak } from './core.js';

const STT = `http://127.0.0.1:${PORTS.STT_PORT}`;
const TTS = `http://127.0.0.1:${PORTS.TTS_PORT}`;

async function proxy(req, res, targetBase) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const target = `${targetBase}${url.pathname}${url.search}`;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = { ...req.headers, host: undefined };
  delete headers.host;
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    duplex: 'half',
  });
  const outHeaders = {};
  upstream.headers.forEach((v, k) => {
    if (k === 'transfer-encoding') return;
    outHeaders[k] = v;
  });
  res.writeHead(upstream.status, outHeaders);
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
}

/**
 * Handle one request. Exported for tests.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleTalkRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      const bins = await binsHealth();
      res.writeHead(bins.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: bins.ok, service: 'dottie-talk', ...bins }));
      return;
    }

    // JSON helpers for MCP / simple clients (buffered)
    if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      const ctype = req.headers['content-type'] || '';
      if (ctype.includes('application/json')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const result = await transcribe({ wavBase64: body.wavBase64 || body.audio });
        const status = result.error ? 502 : 200;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.error ? { error: result.error } : { text: result.text }));
        return;
      }
      // multipart / raw → proxy to parakeet (preserves streaming clients)
      await proxy(req, res, STT);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      // Prefer proxy so PCM streaming + response_format pass through for realtime.
      await proxy(req, res, TTS);
      return;
    }

    // Streaming STT + TTS root health
    if (url.pathname.startsWith('/v1/stream/')) {
      await proxy(req, res, STT);
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/v1/models')) {
      await proxy(req, res, TTS);
      return;
    }

    // Convenience buffered speak for MCP-style JSON without proxy edge cases
    if (req.method === 'POST' && url.pathname === '/v1/talk/speak') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const result = await speak({ text: body.input ?? body.text ?? '', voice: body.voice });
      if (result.error) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      const audio = Buffer.from(result.audioBase64, 'base64');
      res.writeHead(200, {
        'Content-Type': result.contentType || 'audio/wav',
        'Content-Length': audio.length,
      });
      res.end(audio);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
}

export function createTalkServer() {
  return http.createServer((req, res) => {
    handleTalkRequest(req, res);
  });
}

const port = Number(process.env.DOTTIE_TALK_HTTP_PORT || 0);
if (port > 0 && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureBinsRunning()
    .then(() => {
      const server = createTalkServer();
      server.listen(port, '127.0.0.1', () => {
        process.stderr.write(`[dottie-talk] HTTP listening on 127.0.0.1:${port}\n`);
      });
      const shutdown = () => {
        stopBins();
        server.close(() => process.exit(0));
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err) => {
      process.stderr.write(`[dottie-talk] failed to start bins: ${err.message}\n`);
      process.exit(1);
    });
}
