/**
 * dottie-talk HTTP — local STT/TTS only.
 * Optional listen: DOTTIE_TALK_HTTP_PORT=1320 node http.js
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { transcribe, speak } from './core.js';

/**
 * Handle one request. Exported for tests.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleTalkRequest(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  try {
    if (req.method === 'POST' && url.pathname === '/v1/audio/transcriptions') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      const ctype = req.headers['content-type'] || '';
      let result;
      if (ctype.includes('application/json')) {
        const body = JSON.parse(raw.toString('utf8') || '{}');
        result = await transcribe({ wavBase64: body.wavBase64 || body.audio });
      } else {
        // multipart/raw: treat whole body as WAV bytes when not JSON
        result = await transcribe({ wavBuffer: raw });
      }
      const status = result.error ? 502 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.error ? { error: result.error } : { text: result.text }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const result = await speak({
        text: body.input ?? body.text ?? '',
        voice: body.voice,
      });
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

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'dottie-talk' }));
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
  createTalkServer().listen(port, '127.0.0.1', () => {
    process.stderr.write(`[dottie-talk] HTTP listening on 127.0.0.1:${port}\n`);
  });
}
