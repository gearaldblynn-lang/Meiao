import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireVoiceoverHeavyProcessPermit,
} from './voiceoverHeavyProcessLimiter.mjs';

test('Demucs and Whisper share one FIFO heavy-process permit', async () => {
  const events = [];
  const releaseDemucs = await acquireVoiceoverHeavyProcessPermit(undefined, 1);
  events.push('demucs-started');
  let whisperStarted = false;
  const whisperPermit = acquireVoiceoverHeavyProcessPermit(undefined, 1).then((release) => {
    whisperStarted = true;
    events.push('whisper-started');
    return release;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(whisperStarted, false);
  releaseDemucs();
  const releaseWhisper = await whisperPermit;
  assert.deepEqual(events, ['demucs-started', 'whisper-started']);
  releaseWhisper();
});

test('an aborted queued heavy process never consumes the next permit', async () => {
  const releaseFirst = await acquireVoiceoverHeavyProcessPermit(undefined, 1);
  const controller = new AbortController();
  const aborted = acquireVoiceoverHeavyProcessPermit(controller.signal, 1);
  controller.abort();
  await assert.rejects(
    aborted,
    (error) => error?.name === 'AbortError' && error?.code === 'request_cancelled',
  );

  let thirdStarted = false;
  const third = acquireVoiceoverHeavyProcessPermit(undefined, 1).then((release) => {
    thirdStarted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(thirdStarted, false);
  releaseFirst();
  const releaseThird = await third;
  assert.equal(thirdStarted, true);
  releaseThird();
});

test('heavy-process permits reject invalid limits and release idempotently', async () => {
  await assert.rejects(
    acquireVoiceoverHeavyProcessPermit(undefined, 0),
    /limit/i,
  );
  const release = await acquireVoiceoverHeavyProcessPermit(undefined, 1);
  release();
  release();
  const releaseNext = await acquireVoiceoverHeavyProcessPermit(undefined, 1);
  releaseNext();
});
