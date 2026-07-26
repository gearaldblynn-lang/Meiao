import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICEOVER_CHECKPOINT_VERSION,
  buildVoiceoverError,
  getVoiceoverConfig,
  getVoiceoverPublicConfig,
  mergeVoiceoverCheckpoint,
  normalizeVoiceoverCheckpoint,
  normalizeVoiceoverPayload,
  prepareVoiceoverRetryCheckpoint,
  validateVoiceoverAnalysis,
} from './voiceoverContract.mjs';

const enabledEnv = (overrides = {}) => ({
  MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
  ...overrides,
});

const validPayload = (overrides = {}) => ({
  taskType: 'voiceover_translate_video',
  taskPurpose: 'voiceover_translation',
  userId: 'user-1',
  sourceAssetId: 'asset-source',
  shellProjectId: 'project-1',
  shellProjectName: 'Voiceover project',
  shellResultId: 'result-1',
  clientSubmissionKey: 'submission-1',
  targetLanguage: 'en',
  translationMode: 'natural',
  voiceMode: 'auto',
  removeText: false,
  ...overrides,
});

const normalizePayload = (input, context = { actorUserId: 'user-1' }) => normalizeVoiceoverPayload(input, context);

const validCheckpoint = (overrides = {}) => ({
  version: VOICEOVER_CHECKPOINT_VERSION,
  stage: 'voice_separated',
  baseVideoAssetId: 'asset-base',
  originalAudioAssetId: 'asset-audio',
  vocalAssetId: 'asset-vocals',
  backgroundAssetId: 'asset-background',
  subtitleRemoval: { childJobId: 'subtitle-child-1', attempt: 0, status: 'queued' },
  analysisAttempt: 0,
  ...overrides,
});

test('invalid capacity values fall back to conservative defaults', () => {
  const config = getVoiceoverConfig({
    MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
    MEIAO_VOICEOVER_SEPARATION_CONCURRENCY: '99',
    MEIAO_VOICEOVER_MIN_ATEMPO: 'oops',
    MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS: '9000',
  });
  assert.equal(config.separationConcurrency, 1);
  assert.equal(config.minAtempo, 0.75);
  assert.equal(config.ttsMaxInputTokens, 8192);
});

test('payload only accepts catalog members and a managed source identity', () => {
  assert.equal(normalizePayload(validPayload()).targetLanguage, 'en');
  assert.equal(normalizePayload(validPayload({ voiceMode: 'preset', voiceName: 'Kore' })).voiceName, 'Kore');
  assert.throws(() => normalizePayload(validPayload({ targetLanguage: 'zz' })), (error) => error.code === 'voiceover_language_unsupported');
  assert.throws(() => normalizePayload(validPayload({ voiceMode: 'preset', voiceName: 'Unknown' })), (error) => error.code === 'voiceover_analysis_invalid');
  assert.throws(() => normalizePayload(validPayload({ sourceAssetId: '', sourceUrl: 'https://untrusted.example/video.mp4' })), (error) => error.code === 'voiceover_analysis_invalid');
  assert.throws(() => normalizePayload(validPayload({ sourceUrl: 'https://untrusted.example/video.mp4' })), (error) => error.code === 'voiceover_analysis_invalid');
  assert.equal(normalizePayload(validPayload({ sourceAssetId: '', sourceUrl: 'managed://asset-source' })).sourceUrl, 'managed://asset-source');
});

test('payload derives its actor from trusted server context and never from the browser', () => {
  const actor = { actorUserId: 'actor-1' };
  assert.equal(normalizeVoiceoverPayload(validPayload({ userId: 'actor-1' }), actor).userId, 'actor-1');
  assert.equal(normalizeVoiceoverPayload(validPayload({ userId: undefined }), actor).userId, 'actor-1');
  assert.throws(() => normalizeVoiceoverPayload(validPayload({ userId: 'another-browser-user' }), actor), (error) => error.code === 'voiceover_analysis_invalid');
  assert.throws(() => normalizeVoiceoverPayload(validPayload(), {}), (error) => error.code === 'voiceover_analysis_invalid');
});

test('remove text requires a bounded normalized subtitle rectangle', () => {
  assert.deepEqual(
    normalizePayload(validPayload({
      removeText: true,
      subtitleRegionNormalized: { x: -1, y: 0.8, width: 4, height: 0.9 },
    })).subtitleRegionNormalized,
    { x: 0, y: 0.8, width: 1, height: 0.2 },
  );
  assert.throws(() => normalizePayload(validPayload({ removeText: true })), (error) => error.code === 'voiceover_analysis_invalid');
  assert.throws(() => normalizePayload(validPayload({ removeText: 'false' })), (error) => error.code === 'voiceover_analysis_invalid');
});

test('checkpoint rejects local paths, signed urls, unknown fields, and oversized text', () => {
  assert.throws(
    () => normalizeVoiceoverCheckpoint({ ...validCheckpoint(), localPath: '/tmp/secret.wav' }),
    (error) => error.code === 'voiceover_checkpoint_invalid',
  );
  assert.throws(
    () => normalizeVoiceoverCheckpoint({ ...validCheckpoint(), finalAssetUrl: 'https://private.example/result?signature=secret' }),
    (error) => error.code === 'voiceover_checkpoint_invalid',
  );
  assert.throws(
    () => normalizeVoiceoverCheckpoint(validCheckpoint({
      stage: 'speech_analyzed',
      analysis: { sourceLanguage: 'cmn', speakerCount: 1, voiceProfile: validProfile(), segments: [validSegment({ sourceText: '中'.repeat(6_667) })] },
    })),
    (error) => error.code === 'voiceover_checkpoint_invalid',
  );
});

test('checkpoint stages are monotonic and carry only fields available at each stage', () => {
  const current = normalizeVoiceoverCheckpoint(validCheckpoint());
  assert.equal(mergeVoiceoverCheckpoint(current, { stage: 'speech_analyzed', analysis: validAnalysis() }).stage, 'speech_analyzed');
  assert.throws(() => mergeVoiceoverCheckpoint(current, { stage: 'audio_extracted' }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint(validCheckpoint({ stage: 'input_prepared', vocalAssetId: 'asset-vocals' })), (error) => error.code === 'voiceover_checkpoint_invalid');
});

test('each progressed stage requires its durable prerequisite checkpoint data', () => {
  const goldenOptions = { removeText: true };
  assert.throws(() => normalizeVoiceoverCheckpoint({ version: 1, stage: 'subtitle_removal', baseVideoAssetId: 'asset-base', analysisAttempt: 0 }, goldenOptions), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint(noGoldenCheckpointAt('audio_extracted'), goldenOptions), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...validCheckpoint(), stage: 'audio_extracted', originalAudioAssetId: undefined, vocalAssetId: undefined, backgroundAssetId: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...validCheckpoint(), stage: 'voice_separated', vocalAssetId: undefined, backgroundAssetId: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...validCheckpoint(), stage: 'speech_analysis_submitting', vocalAssetId: undefined, backgroundAssetId: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...checkpointAt('speech_analyzed'), analysis: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...checkpointAt('translated'), translation: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...checkpointAt('tts_generating'), ttsGroups: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...checkpointAt('audio_aligned'), alignedAudioAssetId: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint({ ...checkpointAt('result_persisted'), finalAssetId: undefined }), (error) => error.code === 'voiceover_checkpoint_invalid');
});

test('no-Golden checkpoint progression omits subtitle removal while Golden requires it', () => {
  const options = { removeText: false };
  let checkpoint = normalizeVoiceoverCheckpoint(noGoldenCheckpointAt('input_prepared'), options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'audio_extracted', originalAudioAssetId: 'asset-audio' }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'voice_separated', vocalAssetId: 'asset-vocals', backgroundAssetId: 'asset-background' }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'speech_analysis_submitting' }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'speech_analyzed', analysis: validAnalysis() }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'translated', translation: validTranslation() }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'tts_generating', ttsGroups: [validTtsGroup(0)] }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'audio_aligned', alignedAudioAssetId: 'asset-aligned-audio' }, options);
  checkpoint = mergeVoiceoverCheckpoint(checkpoint, { stage: 'result_persisted', finalAssetId: 'asset-final' }, options);
  assert.equal(checkpoint.stage, 'result_persisted');
  assert.equal(checkpoint.subtitleRemoval, undefined);
  assert.throws(() => normalizeVoiceoverCheckpoint(noGoldenCheckpointAt('result_persisted'), { removeText: true }), (error) => error.code === 'voiceover_checkpoint_invalid');
});

test('checkpoint merging is deep and monotonic for TTS group state and durable anchors', () => {
  const current = normalizeVoiceoverCheckpoint(checkpointAt('tts_generating', {
    ttsGroups: [validTtsGroup(0, { status: 'succeeded', providerTaskId: 'provider-1', assetId: 'asset-tts-1' })],
  }));
  const merged = mergeVoiceoverCheckpoint(current, {
    ttsGroups: [validTtsGroup(0, { status: 'queued', providerTaskId: undefined, assetId: undefined })],
  });
  assert.equal(merged.ttsGroups[0].status, 'succeeded');
  assert.equal(merged.ttsGroups[0].providerTaskId, 'provider-1');
  assert.equal(merged.ttsGroups[0].assetId, 'asset-tts-1');
  assert.equal(mergeVoiceoverCheckpoint(current, { ttsGroups: [validTtsGroup(1)] }).ttsGroups.length, 2);
  assert.throws(() => mergeVoiceoverCheckpoint(current, {
    ttsGroups: [validTtsGroup(0, { status: 'succeeded', providerTaskId: 'provider-other', assetId: 'asset-tts-1' })],
  }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => mergeVoiceoverCheckpoint(
    normalizeVoiceoverCheckpoint(checkpointAt('tts_generating', { ttsGroups: [validTtsGroup(0, { attempt: 1 })] })),
    { ttsGroups: [validTtsGroup(0)] },
  ), (error) => error.code === 'voiceover_checkpoint_invalid');
});

test('checkpoint merge preserves normalized analysis and translation as immutable results', () => {
  const current = normalizeVoiceoverCheckpoint(checkpointAt('translated'));
  const replay = mergeVoiceoverCheckpoint(current, { analysis: validAnalysis(), translation: validTranslation() });
  assert.deepEqual(replay.analysis, current.analysis);
  assert.deepEqual(replay.translation, current.translation);
  assert.throws(() => mergeVoiceoverCheckpoint(current, { analysis: validAnalysis({ sourceLanguage: 'en' }) }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => mergeVoiceoverCheckpoint(current, { analysis: validAnalysis({ voiceProfile: { ...validProfile(), pace: 'fast' } }) }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => mergeVoiceoverCheckpoint(current, { analysis: validAnalysis({ segments: [validSegment({ sourceText: 'changed source' })] }) }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => mergeVoiceoverCheckpoint(current, { translation: validTranslation({ targetLanguage: 'ja' }) }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => mergeVoiceoverCheckpoint(current, { translation: validTranslation({ selectedVoiceName: 'Zephyr' }) }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => mergeVoiceoverCheckpoint(current, { translation: validTranslation({ segments: [validSegment({ targetText: 'changed target' })] }) }), (error) => error.code === 'voiceover_checkpoint_invalid');
});

test('confirmed chargeable analysis retry is the only checkpoint rewind path', () => {
  const submitting = normalizeVoiceoverCheckpoint(validCheckpoint({ stage: 'speech_analysis_submitting' }));
  const retried = prepareVoiceoverRetryCheckpoint(submitting, { userConfirmed: true });
  assert.equal(retried.stage, 'voice_separated');
  assert.equal(retried.analysisAttempt, 1);
  assert.equal(retried.vocalAssetId, 'asset-vocals');
  assert.throws(() => prepareVoiceoverRetryCheckpoint(submitting, { userConfirmed: false }), (error) => error.code === 'voiceover_analysis_submission_unknown');
  assert.throws(() => prepareVoiceoverRetryCheckpoint(validCheckpoint(), { userConfirmed: true }), (error) => error.code === 'voiceover_analysis_invalid');
});

test('checkpoint bounds segments, TTS groups, and serialized size', () => {
  const analysis = validAnalysis({ segments: Array.from({ length: 201 }, (_, index) => validSegment({ id: `s-${index}`, startMs: index * 10, endMs: index * 10 + 9 })) });
  assert.throws(() => normalizeVoiceoverCheckpoint(validCheckpoint({ stage: 'speech_analyzed', analysis })), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint(validCheckpoint({
    stage: 'tts_generating',
    analysis: validAnalysis(),
    translation: validTranslation(),
    ttsGroups: Array.from({ length: 101 }, (_, index) => validTtsGroup(index)),
  })), (error) => error.code === 'voiceover_checkpoint_invalid');
  const oversizedAnalysis = validAnalysis({
    segments: Array.from({ length: 200 }, (_, index) => validSegment({
      id: `large-${index}`,
      startMs: index * 10,
      endMs: index * 10 + 9,
      sourceText: 's'.repeat(700),
      targetText: 't'.repeat(700),
    })),
  });
  assert.throws(() => normalizeVoiceoverCheckpoint(validCheckpoint({ stage: 'speech_analyzed', analysis: oversizedAnalysis })), (error) => error.code === 'voiceover_checkpoint_invalid');
});

test('analysis validates speaker, language, timeline, and transcript limits before TTS', () => {
  assert.deepEqual(validateVoiceoverAnalysis(validAnalysis(), { durationMs: 2_000 }).segments.map((segment) => segment.id), ['s1']);
  assert.throws(() => validateVoiceoverAnalysis(validAnalysis({ speakerCount: 2 }), { durationMs: 2_000 }), (error) => error.code === 'voiceover_multiple_speakers');
  assert.throws(() => validateVoiceoverAnalysis(validAnalysis({ sourceLanguage: 'zz' }), { durationMs: 2_000 }), (error) => error.code === 'voiceover_language_unsupported');
  assert.throws(() => validateVoiceoverAnalysis(validAnalysis({ segments: [validSegment({ startMs: 900, endMs: 500 })] }), { durationMs: 2_000 }), (error) => error.code === 'voiceover_analysis_invalid');
});

test('analysis overlap and TTS atempo use validated runtime configuration', () => {
  const overlapping = validAnalysis({ segments: [validSegment({ id: 's1', startMs: 0, endMs: 800 }), validSegment({ id: 's2', startMs: 700, endMs: 1_200 })] });
  assert.throws(() => validateVoiceoverAnalysis(overlapping, { overlapToleranceMs: 0 }), (error) => error.code === 'voiceover_analysis_invalid');
  assert.equal(validateVoiceoverAnalysis(overlapping, { overlapToleranceMs: 1_000 }).segments.length, 2);
  const translated = checkpointAt('translated', { translation: validTranslation({ segments: overlapping.segments }) });
  assert.throws(() => normalizeVoiceoverCheckpoint(translated, { overlapToleranceMs: 0 }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.equal(normalizeVoiceoverCheckpoint(translated, { overlapToleranceMs: 1_000 }).translation.segments.length, 2);
  assert.throws(() => normalizeVoiceoverCheckpoint(checkpointAt('tts_generating', { ttsGroups: [validTtsGroup(0, { atempo: 0.7 })] }), { minAtempo: 0.75, maxAtempo: 1.35 }), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.throws(() => normalizeVoiceoverCheckpoint(checkpointAt('tts_generating', { ttsGroups: [validTtsGroup(0, { atempo: 1.36 })] })), (error) => error.code === 'voiceover_checkpoint_invalid');
  assert.equal(normalizeVoiceoverCheckpoint(checkpointAt('tts_generating', { ttsGroups: [validTtsGroup(0, { atempo: 0.7 })] }), { minAtempo: 0.5, maxAtempo: 1.35 }).ttsGroups[0].atempo, 0.7);
  assert.deepEqual(
    normalizeVoiceoverCheckpoint(checkpointAt('tts_generating', { ttsGroups: [validTtsGroup(0, { atempo: 0.5 }), validTtsGroup(1, { atempo: 2 })] }), { minAtempo: 0.5, maxAtempo: 2 }).ttsGroups.map((group) => group.atempo),
    [0.5, 2],
  );
});

test('public config cannot leak local paths or credentials', () => {
  const config = getVoiceoverPublicConfig(enabledEnv({ MEIAO_VOICEOVER_SEPARATION_PYTHON: '/Users/private/env/bin/python', KIE_API_KEY: 'secret-token' }), {
    pythonReady: true,
    modelReady: true,
    ffmpegReady: true,
  });
  const serialized = JSON.stringify(config);
  assert.deepEqual(Object.keys(config).sort(), ['enabled', 'languages', 'limits', 'model', 'readiness', 'ready', 'voices']);
  assert.doesNotMatch(serialized, /SEPARATION_PYTHON|MODEL_DIR|apiKey|token|\/Users\//);
  assert.deepEqual(config.readiness, { pythonReady: true, modelReady: true, ffmpegReady: true, separationConcurrency: 1 });
});

test('all documented voiceover error codes are structured errors', () => {
  for (const code of [
    'voiceover_unavailable', 'voiceover_source_has_no_audio', 'voiceover_no_speech_detected', 'voiceover_multiple_speakers',
    'voiceover_language_unsupported', 'voiceover_analysis_invalid', 'voiceover_analysis_submission_unknown', 'voiceover_separation_unavailable',
    'voiceover_separation_timeout', 'voiceover_tts_input_too_large', 'voiceover_timing_out_of_range', 'provider_submission_unknown',
    'provider_balance_insufficient', 'provider_rate_limited', 'provider_timeout', 'voiceover_mix_failed', 'voiceover_result_persist_failed',
  ]) {
    const error = buildVoiceoverError(code, 'expected', { stage: 'test' });
    assert.equal(error.code, code);
    assert.equal(error.stage, 'test');
  }
});

function validProfile() {
  return { pitch: 'medium', brightness: 'balanced', energy: 'balanced', pace: 'natural', accentDescription: 'clear' };
}

function validSegment(overrides = {}) {
  return { id: 's1', startMs: 0, endMs: 800, sourceText: '源文', targetText: 'Translation', ...overrides };
}

function validAnalysis(overrides = {}) {
  return { sourceLanguage: 'cmn', speakerCount: 1, voiceProfile: validProfile(), segments: [validSegment()], ...overrides };
}

function validTranslation(overrides = {}) {
  return { targetLanguage: 'en', mode: 'natural', selectedVoiceName: 'Kore', segments: [validSegment()], ...overrides };
}

const STAGE_WITH_ANALYSIS = new Set(['speech_analyzed', 'translated', 'tts_generating', 'audio_aligned', 'result_persisted']);
const STAGE_WITH_TRANSLATION = new Set(['translated', 'tts_generating', 'audio_aligned', 'result_persisted']);
const STAGE_WITH_TTS_GROUPS = new Set(['tts_generating', 'audio_aligned', 'result_persisted']);
const STAGE_WITH_ALIGNED_AUDIO = new Set(['audio_aligned', 'result_persisted']);

function checkpointAt(stage, overrides = {}) {
  return {
    version: VOICEOVER_CHECKPOINT_VERSION,
    stage,
    baseVideoAssetId: 'asset-base',
    subtitleRemoval: { childJobId: 'subtitle-child-1', attempt: 0, status: 'queued' },
    originalAudioAssetId: 'asset-audio',
    vocalAssetId: 'asset-vocals',
    backgroundAssetId: 'asset-background',
    analysisAttempt: 0,
    ...(STAGE_WITH_ANALYSIS.has(stage) ? { analysis: validAnalysis() } : {}),
    ...(STAGE_WITH_TRANSLATION.has(stage) ? { translation: validTranslation() } : {}),
    ...(STAGE_WITH_TTS_GROUPS.has(stage) ? { ttsGroups: [validTtsGroup(0)] } : {}),
    ...(STAGE_WITH_ALIGNED_AUDIO.has(stage) ? { alignedAudioAssetId: 'asset-aligned-audio' } : {}),
    ...(stage === 'result_persisted' ? { finalAssetId: 'asset-final' } : {}),
    ...overrides,
  };
}

function noGoldenCheckpointAt(stage, overrides = {}) {
  return {
    version: VOICEOVER_CHECKPOINT_VERSION,
    stage,
    baseVideoAssetId: 'asset-base',
    originalAudioAssetId: stage === 'input_prepared' ? undefined : 'asset-audio',
    vocalAssetId: ['voice_separated', 'speech_analysis_submitting', 'speech_analyzed', 'translated', 'tts_generating', 'audio_aligned', 'result_persisted'].includes(stage) ? 'asset-vocals' : undefined,
    backgroundAssetId: ['voice_separated', 'speech_analysis_submitting', 'speech_analyzed', 'translated', 'tts_generating', 'audio_aligned', 'result_persisted'].includes(stage) ? 'asset-background' : undefined,
    analysisAttempt: 0,
    ...(STAGE_WITH_ANALYSIS.has(stage) ? { analysis: validAnalysis() } : {}),
    ...(STAGE_WITH_TRANSLATION.has(stage) ? { translation: validTranslation() } : {}),
    ...(STAGE_WITH_TTS_GROUPS.has(stage) ? { ttsGroups: [validTtsGroup(0)] } : {}),
    ...(STAGE_WITH_ALIGNED_AUDIO.has(stage) ? { alignedAudioAssetId: 'asset-aligned-audio' } : {}),
    ...(stage === 'result_persisted' ? { finalAssetId: 'asset-final' } : {}),
    ...overrides,
  };
}

function validTtsGroup(index, overrides = {}) {
  return { index, attempt: 0, childJobId: `child-${index}`, status: 'queued', startMs: index * 100, endMs: index * 100 + 99, ...overrides };
}
