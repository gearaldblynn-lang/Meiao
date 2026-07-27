import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (url) => existsSync(url) ? readFileSync(url, 'utf8') : '';
const playerSource = read(new URL('./VoiceoverResultPlayer.tsx', import.meta.url));
const cardSource = read(new URL('./ProjectCard.tsx', import.meta.url));
const experienceSource = read(new URL('./voiceoverResultExperience.ts', import.meta.url));
const experience = await import('./voiceoverResultExperience.ts').catch(() => ({}));

test('voiceover result player pauses the current node before switching managed videos', () => {
  assert.equal(typeof experience.switchVoiceoverPlaybackMode, 'function');
  const calls = [];
  const currentVideo = { pause: () => calls.push('pause') };
  experience.switchVoiceoverPlaybackMode({
    currentMode: 'original',
    nextMode: 'final',
    currentVideo,
    setMode: (mode) => calls.push(`set:${mode}`),
  });
  assert.deepEqual(calls, ['pause', 'set:final']);

  calls.length = 0;
  experience.switchVoiceoverPlaybackMode({
    currentMode: 'final',
    nextMode: 'final',
    currentVideo,
    setMode: (mode) => calls.push(`set:${mode}`),
  });
  assert.deepEqual(calls, []);
  assert.match(playerSource, /originalVideoRef/);
  assert.match(playerSource, /finalVideoRef/);
  assert.match(playerSource, /switchVoiceoverPlaybackMode/);
  assert.match(playerSource, /src=\{activeUrl\}/);
  assert.match(playerSource, /preload="metadata"/);
  assert.doesNotMatch(playerSource, /key=\{`\$\{mode\}:\$\{activeUrl\}`\}/);
  assert.doesNotMatch(playerSource, /URL\.createObjectURL|new Blob|fetch\(/);
});

test('every eligible result gets an unambiguous voiceover entry action', () => {
  assert.equal(typeof experience.buildVoiceoverTranslationEntryActions, 'function');
  const actions = experience.buildVoiceoverTranslationEntryActions({
    enabled: true,
    projectSubFeature: 'subtitle_removal',
    results: [
      { id: 'unsafe-first', status: 'completed', videoUrl: 'https://evil.example/video.mp4' },
      { id: 'later-a', status: 'completed', videoUrl: '/api/assets/file/asset-a/result.mp4' },
      { id: 'later-b', status: 'completed', videoUrl: '/api/assets/file/asset-b/result.mp4' },
    ],
  });
  assert.deepEqual(actions.map(({ resultId, label }) => ({ resultId, label })), [
    { resultId: 'later-a', label: '口播翻译 · 结果 2' },
    { resultId: 'later-b', label: '口播翻译 · 结果 3' },
  ]);
  assert.match(cardSource, /voiceoverTranslationEntryActions\.map/);
  assert.match(cardSource, /action\.resultId/);
});

test('voiceover retry confirmation derives paid checkpoint attempts and catches server 409 once', async () => {
  assert.equal(typeof experience.requiresVoiceoverRetryConfirmation, 'function');
  assert.equal(typeof experience.runVoiceoverRetryRequest, 'function');

  const goldenFailure = {
    errorCode: 'provider_job_failed',
    voiceoverCheckpoint: {
      subtitleRemoval: { attempt: 0, status: 'failed', childJobId: 'golden-0' },
      ttsGroups: [],
    },
  };
  const ttsFailure = {
    errorCode: 'provider_job_failed',
    voiceoverCheckpoint: {
      ttsGroups: [{
        index: 0,
        attempt: 0,
        status: 'failed',
        childJobId: 'tts-0',
        startMs: 0,
        endMs: 1_000,
      }],
    },
  };
  assert.equal(experience.requiresVoiceoverRetryConfirmation(goldenFailure), true);
  assert.equal(experience.requiresVoiceoverRetryConfirmation(ttsFailure), true);

  let submitCalls = 0;
  let confirmationCalls = 0;
  await experience.runVoiceoverRetryRequest({
    result: goldenFailure,
    submit: async () => { submitCalls += 1; },
    requestConfirmation: () => { confirmationCalls += 1; },
  });
  assert.equal(submitCalls, 0);
  assert.equal(confirmationCalls, 1);

  submitCalls = 0;
  confirmationCalls = 0;
  await experience.runVoiceoverRetryRequest({
    result: { errorCode: 'provider_job_failed', voiceoverCheckpoint: { ttsGroups: [] } },
    submit: async (options) => {
      submitCalls += 1;
      assert.equal(options.confirmNewProviderAttempt, false);
      throw Object.assign(new Error('confirm first'), {
        code: 'voiceover_retry_confirmation_required',
        status: 409,
      });
    },
    requestConfirmation: () => { confirmationCalls += 1; },
  });
  assert.equal(submitCalls, 1);
  assert.equal(confirmationCalls, 1);
});

test('voiceover player canonicalizes both media urls and never downloads a raw persisted url', () => {
  assert.equal(typeof experience.resolveSafeVoiceoverResultMedia, 'function');
  const safe = experience.resolveSafeVoiceoverResultMedia({
    sourceAssetId: 'asset-source-safe',
    finalAssetId: 'asset-final-safe',
  });
  assert.equal(safe.originalUrl, '/api/assets/file/asset-source-safe');
  assert.equal(safe.finalUrl, '/api/assets/file/asset-final-safe');

  for (const value of [
    'https://evil.example/video.mp4',
    '//evil.example/video.mp4',
    'https://user:password@meiao.example/api/assets/file/stolen/video.mp4',
    '/api/assets/file/%2e%2e/video.mp4',
  ]) {
    const rejected = experience.resolveSafeVoiceoverResultMedia({
      sourceUrl: value,
      videoUrl: value,
    });
    assert.equal(rejected.originalUrl, undefined, value);
    assert.equal(rejected.finalUrl, undefined, value);
  }
  assert.match(playerSource, /resolveSafeVoiceoverResultMedia/);
  assert.match(playerSource, /onDownloadFinal\(finalUrl\)/);
  assert.doesNotMatch(playerSource, /onDownloadFinal\(result\.videoUrl/);
  assert.match(cardSource, /onDownloadFinal=\{\(safeUrl\)/);
});

test('voiceover result details are collapsed React text with language and actual voice metadata', () => {
  assert.match(playerSource, /<details/);
  assert.doesNotMatch(playerSource, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(playerSource, /\{result\.sourceTranscript(?:\s*\|\|[^}]*)?\}/);
  assert.match(playerSource, /\{result\.translatedTranscript(?:\s*\|\|[^}]*)?\}/);
  assert.match(playerSource, /result\.sourceLanguage/);
  assert.match(playerSource, /result\.targetLanguage/);
  assert.match(playerSource, /result\.voiceName/);
  assert.doesNotMatch(playerSource, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(playerSource, /声音克隆|音色克隆|voice cloning|唇形同步|lip sync/i);
});

test('voiceover final download delegates the managed URL to the shared card download path', () => {
  assert.match(playerSource, /onDownloadFinal/);
  assert.match(playerSource, /onDownloadFinal\(finalUrl\)/);
  assert.match(cardSource, /<VoiceoverResultPlayer/);
  assert.match(cardSource, /onDownloadFinal=/);
});

test('voiceover retry and cancellation use explicit safe in-app boundaries', () => {
  assert.match(experienceSource, /provider_submission_unknown/);
  assert.match(experienceSource, /voiceover_analysis_submission_unknown/);
  assert.match(cardSource, /<ConfirmDialog/);
  assert.match(cardSource, /confirmNewProviderAttempt:\s*true/);
  assert.doesNotMatch(cardSource, /window\.confirm/);
  assert.match(playerSource, /canCancel/);
  assert.match(playerSource, /不能保证上游任务立即取消/);
  assert.match(cardSource, /Boolean\(result\.backendJobId \|\| project\.backendJobId\)/);
});

test('voiceover manual retry is hidden while an automatic retry is waiting', () => {
  assert.match(playerSource, /onRetry && result\.status === 'error'/);
  assert.doesNotMatch(playerSource, /\['error', 'retry_waiting'\]\.includes\(result\.status\)/);
});

test('voiceover project cards use the approved Chinese subfeature label', () => {
  assert.match(cardSource, /voiceover_translation:\s*'口播翻译'/);
  assert.match(cardSource, /subFeatureNames\[project\.subFeature\]/);
});
