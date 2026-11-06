import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  transcribe, transcribeWords, parseWav, chunkWav, wordsToCues, cuesToSrt, speak, TALK_PORTS,
} from './core.js';
import { sttBackend } from './bin_supervise.js';

describe('TALK_PORTS', () => {
  it('exposes STT TTS HTTP', () => {
    assert.equal(TALK_PORTS.STT, 1315);
    assert.equal(TALK_PORTS.TTS, 1314);
    assert.equal(TALK_PORTS.HTTP, 1320);
  });
});

describe('sttBackend', () => {
  const prev = process.env.DOTTIE_STT;
  after(() => {
    if (prev === undefined) delete process.env.DOTTIE_STT;
    else process.env.DOTTIE_STT = prev;
  });

  it('honors DOTTIE_STT=voxtype', () => {
    process.env.DOTTIE_STT = 'voxtype';
    assert.equal(sttBackend(), 'voxtype');
  });

  it('honors DOTTIE_STT=parakeet', () => {
    process.env.DOTTIE_STT = 'parakeet';
    assert.equal(sttBackend(), 'parakeet');
  });
});

describe('transcribe', () => {
  it('requires audio', async () => {
    const r = await transcribe({});
    assert.match(r.error, /wavBase64|wavBuffer/);
  });

  it('parses STT JSON via parakeet', async () => {
    const prev = process.env.DOTTIE_STT;
    process.env.DOTTIE_STT = 'parakeet';
    try {
      const fetchFn = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: 'hello' }),
      });
      const r = await transcribe({
        wavBuffer: Buffer.from('RIFF'),
        fetchFn,
      });
      assert.equal(r.text, 'hello');
    } finally {
      if (prev === undefined) delete process.env.DOTTIE_STT;
      else process.env.DOTTIE_STT = prev;
    }
  });

  it('uses voxtype CLI when backend=voxtype', async () => {
    const prev = process.env.DOTTIE_STT;
    process.env.DOTTIE_STT = 'voxtype';
    try {
      const execFileFn = async (cmd, args) => {
        assert.equal(cmd, 'voxtype');
        assert.equal(args[0], 'transcribe');
        assert.match(args[1], /\.wav$/);
        return { stdout: 'hello from voxtype\n', stderr: '' };
      };
      const r = await transcribe({
        wavBuffer: Buffer.from('RIFF'),
        execFileFn,
      });
      assert.equal(r.text, 'hello from voxtype');
    } finally {
      if (prev === undefined) delete process.env.DOTTIE_STT;
      else process.env.DOTTIE_STT = prev;
    }
  });
});

/** PCM16 mono WAV: `loudSec` of a square wave with a silent gap at `silentAt`. */
function testWav(sec, sampleRate = 1000, silentAt = -1) {
  const data = Buffer.alloc(sec * sampleRate * 2);
  for (let i = 0; i < sec * sampleRate; i++) {
    const t = i / sampleRate;
    const quiet = silentAt >= 0 && t >= silentAt && t < silentAt + 0.5;
    data.writeInt16LE(quiet ? 0 : (i % 2 ? 8000 : -8000), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe('parseWav / chunkWav', () => {
  it('reads the fmt and data chunks', () => {
    const w = parseWav(testWav(2));
    assert.deepEqual(w, { channels: 1, sampleRate: 1000, bits: 16, dataOffset: 44, dataLength: 4000 });
    assert.equal(parseWav(Buffer.from('nope')), null);
  });

  it('keeps short audio whole', () => {
    const buf = testWav(5);
    const chunks = chunkWav(buf, 10);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].wav, buf);
  });

  it('cuts long audio at the quiet spot before the boundary', () => {
    const chunks = chunkWav(testWav(25, 1000, 7), 10);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].offsetSec, 0);
    assert.ok(chunks[1].offsetSec >= 7 && chunks[1].offsetSec < 7.5, `cut at ${chunks[1].offsetSec}`);
    const total = chunks.reduce((n, c) => n + parseWav(c.wav).dataLength, 0);
    assert.equal(total, 25 * 1000 * 2);
  });
});

describe('transcribeWords', () => {
  it('requests word timestamps and offsets each chunk', async () => {
    const prev = process.env.DOTTIE_STT;
    process.env.DOTTIE_STT = 'parakeet';
    try {
      const forms = [];
      const fetchFn = async (_url, { body }) => {
        forms.push(body);
        const n = forms.length;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            text: `part ${n}`, language: 'en', duration: 1,
            words: [{ word: `w${n}`, start: 0.5, end: 0.9, conf: 1 }],
          }),
        };
      };
      // 700 s at 1 kHz → three chunks (300 s default, cuts just before 300 and 600)
      const r = await transcribeWords({ wavBuffer: testWav(700), fetchFn });
      assert.equal(forms.length, 3);
      assert.equal(forms[0].get('response_format'), 'verbose_json');
      assert.equal(forms[0].get('timestamp_granularities[]'), 'word');
      assert.equal(r.text, 'part 1 part 2 part 3');
      assert.equal(r.words[0].start, 0.5);
      assert.ok(r.words[1].start > 290, `second chunk offset ${r.words[1].start}`);
    } finally {
      if (prev === undefined) delete process.env.DOTTIE_STT;
      else process.env.DOTTIE_STT = prev;
    }
  });

  it('refuses voxtype, which has no timestamps', async () => {
    const prev = process.env.DOTTIE_STT;
    process.env.DOTTIE_STT = 'voxtype';
    try {
      const r = await transcribeWords({ wavBuffer: testWav(1) });
      assert.match(r.error, /parakeet/);
    } finally {
      if (prev === undefined) delete process.env.DOTTIE_STT;
      else process.env.DOTTIE_STT = prev;
    }
  });
});

describe('wordsToCues / cuesToSrt', () => {
  const words = [
    { word: 'Hello', start: 0, end: 0.4 },
    { word: 'Steve.', start: 0.4, end: 0.88 },
    { word: 'This', start: 1.04, end: 1.2 },
    { word: 'is', start: 1.2, end: 1.28 },
    { word: 'later', start: 5, end: 5.5 },
  ];

  it('breaks after sentences and long pauses', () => {
    assert.deepEqual(wordsToCues(words).map((c) => c.text), ['Hello Steve.', 'This is', 'later']);
  });

  it('breaks before passing maxChars', () => {
    const cues = wordsToCues([{ word: 'aaaa', start: 0, end: 1 }, { word: 'bbbb', start: 1, end: 2 }], { maxChars: 6 });
    assert.equal(cues.length, 2);
  });

  it('renders SRT', () => {
    assert.equal(
      cuesToSrt([{ start: 0, end: 0.88, text: 'Hello Steve.' }, { start: 3661.5, end: 3662, text: 'Bye' }]),
      '1\n00:00:00,000 --> 00:00:00,880\nHello Steve.\n\n2\n01:01:01,500 --> 01:01:02,000\nBye\n',
    );
  });
});

describe('speak', () => {
  it('requires text', async () => {
    const r = await speak({ text: '  ' });
    assert.match(r.error, /text/);
  });

  it('returns audioBase64', async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('wav-bytes'),
      headers: { get: () => 'audio/wav' },
    });
    const r = await speak({ text: 'hi', fetchFn });
    assert.equal(r.contentType, 'audio/wav');
    assert.equal(Buffer.from(r.audioBase64, 'base64').toString(), 'wav-bytes');
  });
});
