import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { scheduleVoiceoverReadinessRetry } from './voiceoverReadinessRetry.mjs';

test('does not schedule a retry when startup readiness already passed', () => {
  let scheduled = 0;
  const timer = scheduleVoiceoverReadinessRetry({
    initialReadiness: { ready: true },
    setTimeoutFn: () => { scheduled += 1; },
  });
  assert.equal(timer, null);
  assert.equal(scheduled, 0);
});

test('rechecks one failed startup snapshot after the configured delay and publishes the result', async () => {
  let scheduledDelay = 0;
  let callback;
  let unrefCalls = 0;
  const updates = [];
  const timer = scheduleVoiceoverReadinessRetry({
    env: { MEIAO_VOICEOVER_READINESS_RETRY_DELAY_MS: '45000' },
    initialReadiness: { ready: false },
    checkReadiness: async ({ env }) => {
      assert.equal(env.MEIAO_VOICEOVER_READINESS_RETRY_DELAY_MS, '45000');
      return { ready: true, pythonReady: true, modelReady: true, ffmpegReady: true };
    },
    onUpdate: (readiness) => updates.push(readiness),
    setTimeoutFn: (run, delay) => {
      callback = run;
      scheduledDelay = delay;
      return { unref: () => { unrefCalls += 1; } };
    },
  });

  assert.ok(timer);
  assert.equal(scheduledDelay, 45_000);
  assert.equal(unrefCalls, 1);
  await callback();
  assert.deepEqual(updates, [{
    ready: true,
    pythonReady: true,
    modelReady: true,
    ffmpegReady: true,
  }]);
});

test('server bootstrap schedules the failed-readiness retry and shutdown clears it', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const bootstrap = source.match(/const bootstrap = async \(\) => \{[\s\S]*?await listenAndNotifyReady/)?.[0] || '';
  const clearTimers = source.match(/const clearRuntimeTimers = \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(bootstrap, /scheduleVoiceoverReadinessRetry\(\{/);
  assert.match(bootstrap, /voiceoverTranslationReadiness = readiness/);
  assert.match(clearTimers, /clearTimeout\(voiceoverReadinessRetryTimer\)/);
});
