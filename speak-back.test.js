import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'dottie-speak-back-'));
process.env.DOTTIE_TALK_SPEAK_BACK_DIR = dir;
const { hook, isOn, lastReplyFromTranscript, setOn, speakable } = await import('./speak-back.js');

after(() => rmSync(dir, { recursive: true, force: true }));

const line = (o) => JSON.stringify(o);

describe('speakable', () => {
  it('drops code, tables, URLs and markdown marks', () => {
    const md = [
      '**Fixed the bug**',
      '',
      '- Cause: `<` not `<=`',
      '1. Run [tests](https://x.y)',
      '| a | b |',
      '```js',
      'const x = 1;',
      '```',
      'See https://example.com now',
    ].join('\n');
    assert.equal(speakable(md), 'Fixed the bug\nCause: < not <=\nRun tests\nSee now');
  });

  it('keeps snake_case words intact', () => {
    assert.equal(speakable('use last_assistant_message'), 'use last_assistant_message');
  });
});

describe('lastReplyFromTranscript', () => {
  it('returns the final text after the last prompt, skipping tool turns', () => {
    const jsonl = [
      line({ type: 'user', message: { content: 'old prompt' } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'old reply' }] } }),
      line({ type: 'user', message: { content: 'new prompt' } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'new reply' }] } }),
      line({ type: 'attachment' }),
    ].join('\n');
    assert.equal(lastReplyFromTranscript(jsonl), 'new reply');
  });

  it('never speaks thinking or mid-turn narration', () => {
    const jsonl = [
      line({ type: 'user', message: { content: 'prompt' } }),
      line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'plan' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking files.' }, { type: 'tool_use' }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'more plan' }] } }),
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Final answer.' }] } }),
    ].join('\n');
    assert.equal(lastReplyFromTranscript(jsonl), 'Final answer.');
    // Final reply not flushed yet: stay quiet rather than read narration.
    const unflushed = jsonl.split('\n').slice(0, -1).join('\n');
    assert.equal(lastReplyFromTranscript(unflushed), '');
  });

  it('does not reach back past the last prompt', () => {
    const jsonl = [
      line({ type: 'assistant', message: { content: [{ type: 'text', text: 'old reply' }] } }),
      line({ type: 'user', message: { content: 'new prompt' } }),
      line({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
    ].join('\n');
    assert.equal(lastReplyFromTranscript(jsonl), '');
  });
});

describe('hook', () => {
  it('saves the reply but stays quiet when off', async () => {
    setOn(false);
    const r = await hook({ last_assistant_message: '**Done**' });
    assert.equal(r.spoke, false);
    assert.equal(readFileSync(path.join(dir, 'last.txt'), 'utf8'), 'Done');
  });

  it('falls back to the transcript', async () => {
    const t = path.join(dir, 't.jsonl');
    writeFileSync(t, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'From file' }] } }));
    await hook({ transcript_path: t });
    assert.equal(readFileSync(path.join(dir, 'last.txt'), 'utf8'), 'From file');
  });

  it('skip marker keeps the saved reply and stays quiet', async () => {
    setOn(true);
    writeFileSync(path.join(dir, 'skip-next'), '');
    const r = await hook({ last_assistant_message: 'Speaking last reply.' });
    assert.equal(r.spoke, false);
    assert.equal(readFileSync(path.join(dir, 'last.txt'), 'utf8'), 'From file');
    setOn(false);
    assert.equal(isOn(), false);
  });
});
