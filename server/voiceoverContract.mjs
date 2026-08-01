import {
  VOICEOVER_LANGUAGES,
  VOICEOVER_MODEL_MAX_INPUT_TOKENS,
  VOICEOVER_TTS_MODEL,
  VOICEOVER_VOICES,
  getVoiceoverLanguage,
  getVoiceoverVoice,
} from '../src/utils/voiceoverCatalog.mjs';
import {
  GEMINI_INLINE_DATA_BOUNDS,
  GEMINI_INLINE_DATA_DEFAULT_MAX_BYTES,
  getGeminiInlineDataMaxBytes,
} from './geminiInlineData.mjs';

export const VOICEOVER_CHECKPOINT_VERSION = 1;
export const VOICEOVER_ANALYSIS_EVIDENCE_VERSION = 3;
export const VOICEOVER_ALIGNMENT_VERSION = 1;
export const VOICEOVER_MAX_TTS_GROUPS = 100;

export const VOICEOVER_DEFAULTS = Object.freeze({
  enabled: false,
  demucsModel: 'mdx',
  separationConcurrency: 1,
  separationTimeoutMs: 3_600_000,
  readinessModelTimeoutMs: 120_000,
  analysisInlineAudioMaxBytes: GEMINI_INLINE_DATA_DEFAULT_MAX_BYTES,
  minAtempo: 0.75,
  maxAtempo: 1.75,
  ttsMaxInputTokens: 8192,
  groupGapMs: 800,
  overlapToleranceMs: 150,
  maxTargetTextBytesPerSecond: 24,
  fadeMs: 40,
  durationToleranceMs: 100,
  intermediateTtlMs: 259_200_000,
  kieBaseUrl: 'https://api.kie.ai',
  kieModel: 'google/gemini-3-1-flash-tts',
});

export const VOICEOVER_BOUNDS = Object.freeze({
  separationConcurrency: Object.freeze([1, 2]),
  separationTimeoutMs: Object.freeze([300_000, 7_200_000]),
  readinessModelTimeoutMs: Object.freeze([30_000, 180_000]),
  analysisInlineAudioMaxBytes: GEMINI_INLINE_DATA_BOUNDS,
  minAtempo: Object.freeze([0.5, 1]),
  maxAtempo: Object.freeze([1, 2]),
  ttsMaxInputTokens: Object.freeze([1, 8192]),
  groupGapMs: Object.freeze([0, 3000]),
  overlapToleranceMs: Object.freeze([0, 1000]),
  maxTargetTextBytesPerSecond: Object.freeze([16, 512]),
  fadeMs: Object.freeze([0, 200]),
  durationToleranceMs: Object.freeze([20, 500]),
  intermediateTtlMs: Object.freeze([3_600_000, 2_592_000_000]),
});

const STAGES = Object.freeze([
  'input_prepared', 'subtitle_removal', 'audio_extracted', 'voice_separated', 'speech_analysis_submitting',
  'speech_analyzed', 'translated', 'tts_generating', 'audio_aligned', 'result_persisted',
]);
const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage, index]));
const STATUS_INDEX = new Map([['queued', 0], ['submitted', 1], ['succeeded', 2], ['failed', 2]]);
const CHECKPOINT_REQUIRED_FIELDS = Object.freeze([
  ['baseVideoAssetId'],
  ['baseVideoAssetId'],
  ['baseVideoAssetId', 'originalAudioAssetId'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId', 'analysis'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId', 'analysis', 'translation'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId', 'analysis', 'translation', 'ttsGroups'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId', 'analysis', 'translation', 'ttsGroups', 'alignedAudioAssetId'],
  ['baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId', 'analysis', 'translation', 'ttsGroups', 'alignedAudioAssetId', 'finalAssetId'],
]);
const MAX_SEGMENTS = 200;
const MAX_TEXT_BYTES = 20_000;
const MAX_CHECKPOINT_BYTES = 256 * 1024;
const ERROR_CODES = new Set([
  'voiceover_unavailable', 'voiceover_source_has_no_audio', 'voiceover_source_too_large', 'voiceover_no_speech_detected', 'voiceover_multiple_speakers',
  'voiceover_language_unsupported', 'voiceover_analysis_invalid', 'voiceover_analysis_submission_unknown', 'voiceover_separation_unavailable',
  'voiceover_separation_timeout', 'voiceover_tts_input_too_large', 'voiceover_timing_out_of_range', 'provider_submission_unknown',
  'provider_balance_insufficient', 'provider_rate_limited', 'provider_timeout', 'voiceover_mix_failed', 'voiceover_result_persist_failed',
  'voiceover_checkpoint_asset_invalid', 'voiceover_checkpoint_upgrade_required',
]);

export function buildVoiceoverError(code, message, details = {}) {
  const error = new Error(String(message || '口播翻译处理失败'));
  error.code = ERROR_CODES.has(code) || code === 'voiceover_checkpoint_invalid' ? code : 'voiceover_analysis_invalid';
  Object.assign(error, details);
  return error;
}

const parseEnabled = (value) => ['1', 'true', 'on', 'yes'].includes(String(value || '').trim().toLowerCase());
const boundedNumber = (value, fallback, [minimum, maximum], integer = false) => {
  const parsed = Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integer && !Number.isInteger(parsed))) return fallback;
  return parsed;
};

const safeServerUrl = (value, fallback) => {
  const candidate = String(value || '').trim().replace(/\/+$/u, '');
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? candidate : fallback;
  } catch {
    return fallback;
  }
};

export function getVoiceoverConfig(env = {}) {
  return {
    enabled: parseEnabled(env.MEIAO_VOICEOVER_TRANSLATION_ENABLED),
    demucsModel: String(env.MEIAO_VOICEOVER_DEMUCS_MODEL || '').trim() === 'mdx' ? 'mdx' : VOICEOVER_DEFAULTS.demucsModel,
    separationConcurrency: boundedNumber(env.MEIAO_VOICEOVER_SEPARATION_CONCURRENCY, VOICEOVER_DEFAULTS.separationConcurrency, VOICEOVER_BOUNDS.separationConcurrency, true),
    separationTimeoutMs: boundedNumber(env.MEIAO_VOICEOVER_SEPARATION_TIMEOUT_MS, VOICEOVER_DEFAULTS.separationTimeoutMs, VOICEOVER_BOUNDS.separationTimeoutMs, true),
    readinessModelTimeoutMs: boundedNumber(
      env.MEIAO_VOICEOVER_READINESS_MODEL_TIMEOUT_MS,
      VOICEOVER_DEFAULTS.readinessModelTimeoutMs,
      VOICEOVER_BOUNDS.readinessModelTimeoutMs,
      true,
    ),
    analysisInlineAudioMaxBytes: getGeminiInlineDataMaxBytes(env),
    minAtempo: boundedNumber(env.MEIAO_VOICEOVER_MIN_ATEMPO, VOICEOVER_DEFAULTS.minAtempo, VOICEOVER_BOUNDS.minAtempo),
    maxAtempo: boundedNumber(env.MEIAO_VOICEOVER_MAX_ATEMPO, VOICEOVER_DEFAULTS.maxAtempo, VOICEOVER_BOUNDS.maxAtempo),
    ttsMaxInputTokens: boundedNumber(env.MEIAO_VOICEOVER_TTS_MAX_INPUT_TOKENS, VOICEOVER_DEFAULTS.ttsMaxInputTokens, VOICEOVER_BOUNDS.ttsMaxInputTokens, true),
    groupGapMs: boundedNumber(env.MEIAO_VOICEOVER_GROUP_GAP_MS, VOICEOVER_DEFAULTS.groupGapMs, VOICEOVER_BOUNDS.groupGapMs, true),
    overlapToleranceMs: boundedNumber(env.MEIAO_VOICEOVER_TIMESTAMP_OVERLAP_TOLERANCE_MS, VOICEOVER_DEFAULTS.overlapToleranceMs, VOICEOVER_BOUNDS.overlapToleranceMs, true),
    maxTargetTextBytesPerSecond: boundedNumber(
      env.MEIAO_VOICEOVER_MAX_TARGET_TEXT_BYTES_PER_SECOND,
      VOICEOVER_DEFAULTS.maxTargetTextBytesPerSecond,
      VOICEOVER_BOUNDS.maxTargetTextBytesPerSecond,
      true,
    ),
    fadeMs: boundedNumber(env.MEIAO_VOICEOVER_FADE_MS, VOICEOVER_DEFAULTS.fadeMs, VOICEOVER_BOUNDS.fadeMs, true),
    durationToleranceMs: boundedNumber(env.MEIAO_VOICEOVER_DURATION_TOLERANCE_MS, VOICEOVER_DEFAULTS.durationToleranceMs, VOICEOVER_BOUNDS.durationToleranceMs, true),
    intermediateTtlMs: boundedNumber(env.MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS, VOICEOVER_DEFAULTS.intermediateTtlMs, VOICEOVER_BOUNDS.intermediateTtlMs, true),
    kieBaseUrl: safeServerUrl(env.MEIAO_KIE_TTS_BASE_URL, VOICEOVER_DEFAULTS.kieBaseUrl),
    kieModel: String(env.MEIAO_KIE_TTS_MODEL || '').trim() === VOICEOVER_TTS_MODEL ? VOICEOVER_TTS_MODEL : VOICEOVER_DEFAULTS.kieModel,
    separationPython: String(env.MEIAO_VOICEOVER_SEPARATION_PYTHON || '').trim(),
    demucsModelDir: String(env.MEIAO_VOICEOVER_DEMUCS_MODEL_DIR || '').trim(),
  };
}

const PUBLIC_PREVIEW_URL_PATTERN = /^\/voiceover-previews\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;

export function getVoiceoverPublicConfig(env = {}, readiness = {}, previewUrlsByVoice = {}) {
  const config = getVoiceoverConfig(env);
  const publicReadiness = Object.freeze({
    pythonReady: Boolean(readiness.pythonReady),
    modelReady: Boolean(readiness.modelReady),
    ffmpegReady: Boolean(readiness.ffmpegReady),
    separationConcurrency: config.separationConcurrency,
  });
  return Object.freeze({
    enabled: config.enabled,
    ready: config.enabled && publicReadiness.pythonReady && publicReadiness.modelReady && publicReadiness.ffmpegReady,
    model: Object.freeze({ id: VOICEOVER_TTS_MODEL, inputLimit: VOICEOVER_MODEL_MAX_INPUT_TOKENS }),
    languages: VOICEOVER_LANGUAGES,
    voices: Object.freeze(VOICEOVER_VOICES.map((voice) => {
      const previewUrl = String(previewUrlsByVoice?.[voice.name] || '').trim();
      return Object.freeze({
        ...voice,
        ...(PUBLIC_PREVIEW_URL_PATTERN.test(previewUrl) ? { previewUrl } : {}),
      });
    })),
    limits: Object.freeze({
      ttsInputLimit: config.ttsMaxInputTokens,
      groupGapMs: config.groupGapMs,
      minAtempo: config.minAtempo,
      maxAtempo: config.maxAtempo,
      overlapToleranceMs: config.overlapToleranceMs,
      maxTargetTextBytesPerSecond: config.maxTargetTextBytesPerSecond,
      ttsGroupLimit: VOICEOVER_MAX_TTS_GROUPS,
      durationToleranceMs: config.durationToleranceMs,
    }),
    readiness: publicReadiness,
  });
}

const requiredString = (value, field, code = 'voiceover_analysis_invalid') => {
  const result = String(value || '').trim();
  if (!result) throw buildVoiceoverError(code, `${field} 无效`);
  return result;
};
const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const assertKnownKeys = (value, allowed, code = 'voiceover_analysis_invalid') => {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw buildVoiceoverError(code, '口播翻译数据包含不支持的字段');
  }
};
const byteLength = (value) => Buffer.byteLength(String(value || ''), 'utf8');
const isAssetId = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(String(value || ''));

const normalizedValidationOptions = (options = {}) => {
  const minAtempo = boundedNumber(options.minAtempo, VOICEOVER_DEFAULTS.minAtempo, VOICEOVER_BOUNDS.minAtempo);
  const maxAtempo = boundedNumber(options.maxAtempo, VOICEOVER_DEFAULTS.maxAtempo, VOICEOVER_BOUNDS.maxAtempo);
  return Object.freeze({
    durationMs: Number(options.durationMs),
    overlapToleranceMs: boundedNumber(options.overlapToleranceMs, VOICEOVER_DEFAULTS.overlapToleranceMs, VOICEOVER_BOUNDS.overlapToleranceMs, true),
    minAtempo: minAtempo <= maxAtempo ? minAtempo : VOICEOVER_DEFAULTS.minAtempo,
    maxAtempo: minAtempo <= maxAtempo ? maxAtempo : VOICEOVER_DEFAULTS.maxAtempo,
    removeText: options.removeText === true,
  });
};

const requiredCheckpointFields = (stageIndex, options) => Object.freeze([
  ...CHECKPOINT_REQUIRED_FIELDS[stageIndex],
  ...(options.removeText && stageIndex >= STAGE_INDEX.get('subtitle_removal') ? ['subtitleRemoval'] : []),
]);

const normalizeRectangle = (value) => {
  if (!plainObject(value)) throw buildVoiceoverError('voiceover_analysis_invalid', '去文案区域无效');
  assertKnownKeys(value, new Set(['x', 'y', 'width', 'height']));
  const x = Number(value.x); const y = Number(value.y); const width = Number(value.width); const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '去文案区域无效');
  }
  const boundedX = Math.min(1, Math.max(0, x));
  const boundedY = Math.min(1, Math.max(0, y));
  const boundedWidth = Math.min(1 - boundedX, Math.max(0, width));
  const boundedHeight = Math.min(1 - boundedY, Math.max(0, height));
  if (!boundedWidth || !boundedHeight) throw buildVoiceoverError('voiceover_analysis_invalid', '去文案区域无效');
  const normalized = (number) => Number(number.toFixed(6));
  return { x: normalized(boundedX), y: normalized(boundedY), width: normalized(boundedWidth), height: normalized(boundedHeight) };
};

const isManagedSourceUrl = (value) => /^(?:managed|asset):\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value)
  || /^\/api\/(?:assets|media)\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value);

/**
 * Normalizes browser input using the authenticated server actor, never a browser-owned userId.
 * Task 2 must resolve the managed asset for actorUserId before any media use: a managed ID/URL
 * is only an identity syntax check here and is not proof of ownership.
 */
export function normalizeVoiceoverPayload(input = {}, context = {}) {
  const allowed = new Set([
    'taskType', 'taskPurpose', 'userId', 'sourceAssetId', 'sourceUrl', 'sourceProjectId', 'sourceResultId',
    'shellProjectId', 'shellProjectName', 'shellResultId', 'clientSubmissionKey', 'targetLanguage',
    'translationMode', 'voiceMode', 'voiceName', 'removeText', 'subtitleRegionNormalized',
  ]);
  assertKnownKeys(input, allowed);
  if (input.taskType !== 'voiceover_translate_video' || input.taskPurpose !== 'voiceover_translation') {
    throw buildVoiceoverError('voiceover_analysis_invalid', '口播翻译任务类型无效');
  }
  const actorUserId = requiredString(context.actorUserId, '服务器用户');
  const browserUserId = input.userId === undefined ? '' : requiredString(input.userId, '用户');
  if (browserUserId && browserUserId !== actorUserId) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '浏览器用户与认证用户不一致');
  }
  const sourceAssetId = String(input.sourceAssetId || '').trim();
  const sourceUrl = String(input.sourceUrl || '').trim();
  if ((sourceAssetId && !isAssetId(sourceAssetId)) || (sourceUrl && !isManagedSourceUrl(sourceUrl)) || (!sourceAssetId && !isManagedSourceUrl(sourceUrl))) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '请选择当前账号拥有的托管视频');
  }
  const targetLanguage = requiredString(input.targetLanguage, '目标语言');
  if (!getVoiceoverLanguage(targetLanguage)) throw buildVoiceoverError('voiceover_language_unsupported', '目标语言暂不支持');
  const translationMode = String(input.translationMode || '');
  const voiceMode = String(input.voiceMode || '');
  if (!['natural', 'literal'].includes(translationMode) || !['auto', 'preset'].includes(voiceMode)) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '翻译或音色模式无效');
  }
  if (typeof input.removeText !== 'boolean') throw buildVoiceoverError('voiceover_analysis_invalid', '去文案开关无效');
  const removeText = input.removeText;
  const voiceName = String(input.voiceName || '').trim();
  if ((voiceMode === 'preset' && !getVoiceoverVoice(voiceName)) || (voiceMode === 'auto' && voiceName)) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '音色选择无效');
  }
  const normalized = {
    taskType: 'voiceover_translate_video', taskPurpose: 'voiceover_translation',
    userId: actorUserId, ...(sourceAssetId ? { sourceAssetId } : { sourceUrl }),
    ...(input.sourceProjectId ? { sourceProjectId: requiredString(input.sourceProjectId, '来源项目') } : {}),
    ...(input.sourceResultId ? { sourceResultId: requiredString(input.sourceResultId, '来源结果') } : {}),
    shellProjectId: requiredString(input.shellProjectId, '项目'), shellProjectName: requiredString(input.shellProjectName, '项目名称'),
    shellResultId: requiredString(input.shellResultId, '结果'), clientSubmissionKey: requiredString(input.clientSubmissionKey, '提交键'),
    targetLanguage, translationMode, voiceMode, ...(voiceMode === 'preset' ? { voiceName } : {}), removeText,
  };
  if (removeText) normalized.subtitleRegionNormalized = normalizeRectangle(input.subtitleRegionNormalized);
  else if (input.subtitleRegionNormalized !== undefined) normalized.subtitleRegionNormalized = normalizeRectangle(input.subtitleRegionNormalized);
  return Object.freeze(normalized);
}

const normalizeProfile = (value, code = 'voiceover_analysis_invalid') => {
  assertKnownKeys(value, new Set(['pitch', 'brightness', 'energy', 'pace', 'accentDescription']), code);
  const profile = {
    pitch: String(value.pitch || ''), brightness: String(value.brightness || ''), energy: String(value.energy || ''),
    pace: String(value.pace || ''), accentDescription: String(value.accentDescription || '').trim(),
  };
  if (!['low', 'medium', 'high'].includes(profile.pitch) || !['dark', 'balanced', 'bright'].includes(profile.brightness)
    || !['calm', 'balanced', 'energetic'].includes(profile.energy) || !['slow', 'natural', 'fast'].includes(profile.pace)
    || byteLength(profile.accentDescription) > 500) throw buildVoiceoverError(code, '音色分析无效');
  return profile;
};

const normalizeSegments = (segments, { durationMs, overlapToleranceMs = VOICEOVER_DEFAULTS.overlapToleranceMs, code = 'voiceover_analysis_invalid', requireTarget = true } = {}) => {
  if (!Array.isArray(segments) || !segments.length || segments.length > MAX_SEGMENTS) throw buildVoiceoverError(code, '口播分段数量无效');
  let previousEnd = -Infinity;
  const ids = new Set();
  return segments.map((item) => {
    assertKnownKeys(item, new Set(['id', 'startMs', 'endMs', 'sourceText', 'targetText']), code);
    const id = requiredString(item.id, '分段', code);
    const startMs = Number(item.startMs); const endMs = Number(item.endMs);
    const sourceText = String(item.sourceText || '').trim(); const targetText = String(item.targetText || '').trim();
    if (ids.has(id) || !Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs
      || (Number.isFinite(durationMs) && endMs > durationMs) || startMs < previousEnd - overlapToleranceMs
      || !sourceText || (requireTarget && !targetText) || byteLength(sourceText) > MAX_TEXT_BYTES || byteLength(targetText) > MAX_TEXT_BYTES) {
      throw buildVoiceoverError(code, '口播时间轴或文本无效');
    }
    ids.add(id); previousEnd = endMs;
    return { id, startMs, endMs, sourceText, targetText };
  });
};

export function validateVoiceoverAnalysis(value, options = {}) {
  const validationOptions = normalizedValidationOptions(options);
  assertKnownKeys(value, new Set(['sourceLanguage', 'speakerCount', 'voiceProfile', 'segments']));
  const sourceLanguage = requiredString(value.sourceLanguage, '源语言');
  if (!getVoiceoverLanguage(sourceLanguage)) throw buildVoiceoverError('voiceover_language_unsupported', '源语言暂不支持');
  const speakerCount = Number(value.speakerCount);
  if (speakerCount !== 1) throw buildVoiceoverError('voiceover_multiple_speakers', '当前仅支持单人口播');
  return Object.freeze({
    sourceLanguage, speakerCount, voiceProfile: normalizeProfile(value.voiceProfile),
    segments: Object.freeze(normalizeSegments(value.segments, validationOptions)),
  });
}

const normalizeSubtitleRemoval = (value) => {
  assertKnownKeys(value, new Set(['childJobId', 'providerTaskId', 'resultAssetId', 'attempt', 'status']), 'voiceover_checkpoint_invalid');
  const status = String(value.status || 'queued'); const attempt = Number(value.attempt ?? 0);
  if (!['queued', 'submitted', 'succeeded', 'failed'].includes(status) || !Number.isInteger(attempt) || attempt < 0 || attempt > 100
    || !isAssetId(value.childJobId) || (value.providerTaskId && !isAssetId(value.providerTaskId)) || (value.resultAssetId && !isAssetId(value.resultAssetId))) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', '去文案检查点无效');
  }
  return { childJobId: value.childJobId, ...(value.providerTaskId ? { providerTaskId: value.providerTaskId } : {}), ...(value.resultAssetId ? { resultAssetId: value.resultAssetId } : {}), attempt, status };
};

const normalizeTranslation = (value, validationOptions = normalizedValidationOptions()) => {
  assertKnownKeys(value, new Set(['targetLanguage', 'mode', 'segments', 'selectedVoiceName']), 'voiceover_checkpoint_invalid');
  const targetLanguage = requiredString(value.targetLanguage, '目标语言', 'voiceover_checkpoint_invalid');
  const mode = String(value.mode || ''); const selectedVoiceName = String(value.selectedVoiceName || '');
  if (!getVoiceoverLanguage(targetLanguage) || !['natural', 'literal'].includes(mode) || !getVoiceoverVoice(selectedVoiceName)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', '翻译检查点无效');
  }
  return { targetLanguage, mode, selectedVoiceName, segments: normalizeSegments(value.segments, { ...validationOptions, code: 'voiceover_checkpoint_invalid' }) };
};

const normalizeTtsGroups = (groups, validationOptions = normalizedValidationOptions()) => {
  if (!Array.isArray(groups) || !groups.length || groups.length > VOICEOVER_MAX_TTS_GROUPS) throw buildVoiceoverError('voiceover_checkpoint_invalid', 'TTS 分组无效');
  const identities = new Set();
  return groups.map((group) => {
    assertKnownKeys(group, new Set(['index', 'attempt', 'childJobId', 'providerTaskId', 'assetId', 'status', 'startMs', 'endMs', 'actualDurationMs', 'atempo']), 'voiceover_checkpoint_invalid');
    const index = Number(group.index); const attempt = Number(group.attempt ?? 0); const status = String(group.status || '');
    const startMs = Number(group.startMs); const endMs = Number(group.endMs);
    const identity = `${index}:${attempt}`;
    if (!Number.isInteger(index) || index < 0 || identities.has(identity) || !Number.isInteger(attempt) || attempt < 0 || attempt > 100
      || !isAssetId(group.childJobId) || !['queued', 'submitted', 'succeeded', 'failed'].includes(status)
      || !Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs
      || (group.providerTaskId && !isAssetId(group.providerTaskId)) || (group.assetId && !isAssetId(group.assetId))
      || (group.actualDurationMs !== undefined && (!Number.isInteger(Number(group.actualDurationMs)) || Number(group.actualDurationMs) <= 0))
      || (group.atempo !== undefined && (!Number.isFinite(Number(group.atempo)) || Number(group.atempo) < validationOptions.minAtempo || Number(group.atempo) > validationOptions.maxAtempo))) {
      throw buildVoiceoverError('voiceover_checkpoint_invalid', 'TTS 分组无效');
    }
    identities.add(identity);
    return { index, attempt, childJobId: group.childJobId, ...(group.providerTaskId ? { providerTaskId: group.providerTaskId } : {}), ...(group.assetId ? { assetId: group.assetId } : {}), status, startMs, endMs, ...(group.actualDurationMs !== undefined ? { actualDurationMs: Number(group.actualDurationMs) } : {}), ...(group.atempo !== undefined ? { atempo: Number(group.atempo) } : {}) };
  });
};

/**
 * Validates a durable worker checkpoint. `options.removeText` must come from the
 * normalized parent payload, never from browser data persisted in the checkpoint.
 */
export function normalizeVoiceoverCheckpoint(value, options = {}) {
  const validationOptions = normalizedValidationOptions(options);
  const allowed = new Set([
    'version', 'stage', 'baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId',
    'backgroundAssetId', 'subtitleRemoval', 'analysis', 'translation', 'ttsGroups',
    'alignedAudioAssetId', 'finalAssetId', 'analysisAttempt', 'analysisEvidenceVersion',
    'alignmentVersion', 'ttsAttemptBase',
  ]);
  assertKnownKeys(value, allowed, 'voiceover_checkpoint_invalid');
  if (Number(value.version) !== VOICEOVER_CHECKPOINT_VERSION || !STAGE_INDEX.has(value.stage) || !isAssetId(value.baseVideoAssetId)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', '口播翻译检查点无效');
  }
  if (!validationOptions.removeText && (value.stage === 'subtitle_removal' || value.subtitleRemoval !== undefined)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', '未启用去文案时不能写入 Golden 检查点');
  }
  const stageIndex = STAGE_INDEX.get(value.stage); const output = { version: 1, stage: value.stage, baseVideoAssetId: value.baseVideoAssetId };
  const analysisAttempt = Number(value.analysisAttempt ?? 0);
  if (!Number.isInteger(analysisAttempt) || analysisAttempt < 0 || analysisAttempt > 100) throw buildVoiceoverError('voiceover_checkpoint_invalid', '分析尝试次数无效');
  output.analysisAttempt = analysisAttempt;
  const ttsAttemptBase = Number(value.ttsAttemptBase ?? 0);
  if (!Number.isInteger(ttsAttemptBase) || ttsAttemptBase < 0 || ttsAttemptBase > 100) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', 'TTS 起始尝试次数无效');
  }
  if (value.ttsAttemptBase !== undefined || ttsAttemptBase > 0) output.ttsAttemptBase = ttsAttemptBase;
  const allowLegacyProvenance = options.allowLegacyUpgrade === true
    || (options.allowLegacyCompleted === true && value.stage === 'result_persisted');
  const addProvenance = (key, minimumStage, expected, label) => {
    const raw = value[key];
    if (stageIndex < minimumStage) {
      if (raw !== undefined) throw buildVoiceoverError('voiceover_checkpoint_invalid', `${label}阶段无效`);
      return;
    }
    const numericRaw = Number(raw);
    const legacyVersion = Number.isSafeInteger(numericRaw) && numericRaw > 0 && numericRaw < expected;
    if (raw === undefined || legacyVersion) {
      if (!allowLegacyProvenance) {
        throw buildVoiceoverError(
          'voiceover_checkpoint_upgrade_required',
          `旧版${label}需要重新处理`,
          { statusCode: 409 },
        );
      }
      return;
    }
    if (numericRaw !== expected) {
      throw buildVoiceoverError('voiceover_checkpoint_invalid', `${label}版本无效`);
    }
    output[key] = expected;
  };
  addProvenance(
    'analysisEvidenceVersion',
    STAGE_INDEX.get('audio_extracted'),
    VOICEOVER_ANALYSIS_EVIDENCE_VERSION,
    '分析证据',
  );
  addProvenance(
    'alignmentVersion',
    STAGE_INDEX.get('audio_aligned'),
    VOICEOVER_ALIGNMENT_VERSION,
    '音频对齐',
  );
  const addAsset = (key, minimumStage) => {
    if (value[key] !== undefined) {
      if (stageIndex < minimumStage || !isAssetId(value[key])) throw buildVoiceoverError('voiceover_checkpoint_invalid', '检查点素材无效');
      output[key] = value[key];
    }
  };
  if (value.subtitleRemoval !== undefined) {
    if (stageIndex < 1) throw buildVoiceoverError('voiceover_checkpoint_invalid', '去文案阶段无效');
    output.subtitleRemoval = normalizeSubtitleRemoval(value.subtitleRemoval);
  }
  addAsset('originalAudioAssetId', 2); addAsset('vocalAssetId', 3); addAsset('backgroundAssetId', 3); addAsset('alignedAudioAssetId', 8);
  if (value.analysis !== undefined) {
    if (stageIndex < 5) throw buildVoiceoverError('voiceover_checkpoint_invalid', '分析阶段无效');
    try {
      output.analysis = validateVoiceoverAnalysis(value.analysis, validationOptions);
    } catch {
      throw buildVoiceoverError('voiceover_checkpoint_invalid', '分析检查点无效');
    }
  }
  if (value.translation !== undefined) {
    if (stageIndex < 6 || !output.analysis) throw buildVoiceoverError('voiceover_checkpoint_invalid', '翻译阶段无效');
    output.translation = normalizeTranslation(value.translation, validationOptions);
  }
  if (value.ttsGroups !== undefined) {
    if (stageIndex < 7 || !output.translation) throw buildVoiceoverError('voiceover_checkpoint_invalid', 'TTS 阶段无效');
    output.ttsGroups = normalizeTtsGroups(value.ttsGroups, validationOptions);
  }
  if (value.finalAssetId !== undefined) {
    if (stageIndex < 9 || !isAssetId(value.finalAssetId)) throw buildVoiceoverError('voiceover_checkpoint_invalid', '结果阶段无效');
    output.finalAssetId = value.finalAssetId;
  }
  for (const field of requiredCheckpointFields(stageIndex, validationOptions)) {
    if (output[field] === undefined || (Array.isArray(output[field]) && output[field].length === 0)) {
      throw buildVoiceoverError('voiceover_checkpoint_invalid', `阶段缺少 ${field}`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(output), 'utf8') > MAX_CHECKPOINT_BYTES) throw buildVoiceoverError('voiceover_checkpoint_invalid', '检查点过大');
  return Object.freeze(output);
}

const mergeDurableId = (current, next, field) => {
  if (current === undefined) return next;
  if (next === undefined) return current;
  if (current !== next) throw buildVoiceoverError('voiceover_checkpoint_invalid', `${field} 不能被替换`);
  return current;
};

const mergeStatus = (current, next) => {
  if (next === undefined) return current;
  if (STATUS_INDEX.get(next) < STATUS_INDEX.get(current)) return current;
  if (STATUS_INDEX.get(next) === STATUS_INDEX.get(current) && current !== next) return current;
  return next;
};

const mergeChildCheckpoint = (current, patch) => {
  if (patch === undefined) return current;
  const next = normalizeSubtitleRemoval(patch);
  if (current === undefined) return next;
  const attempt = Math.max(current.attempt, next.attempt);
  return {
    childJobId: mergeDurableId(current.childJobId, next.childJobId, 'subtitleRemoval.childJobId'),
    ...(mergeDurableId(current.providerTaskId, next.providerTaskId, 'subtitleRemoval.providerTaskId') ? { providerTaskId: mergeDurableId(current.providerTaskId, next.providerTaskId, 'subtitleRemoval.providerTaskId') } : {}),
    ...(mergeDurableId(current.resultAssetId, next.resultAssetId, 'subtitleRemoval.resultAssetId') ? { resultAssetId: mergeDurableId(current.resultAssetId, next.resultAssetId, 'subtitleRemoval.resultAssetId') } : {}),
    attempt,
    status: mergeStatus(current.status, next.status),
  };
};

const mergeTtsGroup = (current, next) => ({
  index: current.index,
  attempt: current.attempt,
  childJobId: mergeDurableId(current.childJobId, next.childJobId, 'ttsGroups.childJobId'),
  ...(mergeDurableId(current.providerTaskId, next.providerTaskId, 'ttsGroups.providerTaskId') ? { providerTaskId: mergeDurableId(current.providerTaskId, next.providerTaskId, 'ttsGroups.providerTaskId') } : {}),
  ...(mergeDurableId(current.assetId, next.assetId, 'ttsGroups.assetId') ? { assetId: mergeDurableId(current.assetId, next.assetId, 'ttsGroups.assetId') } : {}),
  status: mergeStatus(current.status, next.status),
  startMs: mergeDurableId(current.startMs, next.startMs, 'ttsGroups.startMs'),
  endMs: mergeDurableId(current.endMs, next.endMs, 'ttsGroups.endMs'),
  ...(mergeDurableId(current.actualDurationMs, next.actualDurationMs, 'ttsGroups.actualDurationMs') !== undefined ? { actualDurationMs: mergeDurableId(current.actualDurationMs, next.actualDurationMs, 'ttsGroups.actualDurationMs') } : {}),
  ...(mergeDurableId(current.atempo, next.atempo, 'ttsGroups.atempo') !== undefined ? { atempo: mergeDurableId(current.atempo, next.atempo, 'ttsGroups.atempo') } : {}),
});

const mergeTtsGroups = (current, patch, options) => {
  if (patch === undefined) return current;
  const normalizedPatch = normalizeTtsGroups(patch, options);
  const currentGroups = current || [];
  const merged = new Map(currentGroups.map((group) => [`${group.index}:${group.attempt}`, group]));
  for (const next of normalizedPatch) {
    const identity = `${next.index}:${next.attempt}`;
    const previous = merged.get(identity);
    if (previous) {
      merged.set(identity, mergeTtsGroup(previous, next));
      continue;
    }
    const maximumAttempt = Math.max(-1, ...currentGroups.filter((group) => group.index === next.index).map((group) => group.attempt));
    if (next.attempt < maximumAttempt) throw buildVoiceoverError('voiceover_checkpoint_invalid', 'TTS 分组尝试次数不能回退');
    merged.set(identity, next);
  }
  return [...merged.values()].sort((left, right) => left.index - right.index || left.attempt - right.attempt);
};

const mergeImmutableResult = (current, patch, normalize, field) => {
  if (patch === undefined) return current;
  const normalizedPatch = normalize(patch);
  if (current !== undefined && JSON.stringify(current) !== JSON.stringify(normalizedPatch)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', `${field} 不能被替换`);
  }
  return current === undefined ? normalizedPatch : current;
};

export function mergeVoiceoverCheckpoint(current, patch = {}, options = {}) {
  const validationOptions = normalizedValidationOptions(options);
  const currentCheckpoint = normalizeVoiceoverCheckpoint(current, validationOptions);
  const nextStage = patch.stage === undefined ? currentCheckpoint.stage : patch.stage;
  if (!STAGE_INDEX.has(nextStage) || STAGE_INDEX.get(nextStage) < STAGE_INDEX.get(currentCheckpoint.stage)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', '检查点阶段不能回退');
  }
  const merged = { ...currentCheckpoint, ...patch, version: VOICEOVER_CHECKPOINT_VERSION, stage: nextStage };
  for (const field of [
    'baseVideoAssetId', 'originalAudioAssetId', 'vocalAssetId', 'backgroundAssetId',
    'alignedAudioAssetId', 'finalAssetId', 'analysisEvidenceVersion',
    'alignmentVersion', 'ttsAttemptBase',
  ]) {
    merged[field] = mergeDurableId(currentCheckpoint[field], patch[field], field);
  }
  merged.analysisAttempt = Math.max(currentCheckpoint.analysisAttempt, Number(patch.analysisAttempt ?? currentCheckpoint.analysisAttempt));
  merged.subtitleRemoval = mergeChildCheckpoint(currentCheckpoint.subtitleRemoval, patch.subtitleRemoval);
  merged.analysis = mergeImmutableResult(
    currentCheckpoint.analysis,
    patch.analysis,
    (value) => validateVoiceoverAnalysis(value, validationOptions),
    'analysis',
  );
  merged.translation = mergeImmutableResult(
    currentCheckpoint.translation,
    patch.translation,
    (value) => normalizeTranslation(value, validationOptions),
    'translation',
  );
  merged.ttsGroups = mergeTtsGroups(currentCheckpoint.ttsGroups, patch.ttsGroups, validationOptions);
  return normalizeVoiceoverCheckpoint(merged, validationOptions);
}

/**
 * The only server-side rewind path. Pass the normalized parent payload's
 * `removeText` setting as options so Golden checkpoint requirements remain intact.
 */
export function prepareVoiceoverRetryCheckpoint(checkpoint, retryPlan = {}, options = {}) {
  const current = normalizeVoiceoverCheckpoint(checkpoint, options);
  if (current.stage !== 'speech_analysis_submitting') {
    throw buildVoiceoverError('voiceover_analysis_invalid', '当前阶段不能重新提交语音分析');
  }
  if (retryPlan.userConfirmed !== true) {
    throw buildVoiceoverError(
      'voiceover_analysis_submission_unknown',
      '请先确认可能产生新的分析费用',
      { statusCode: 409 },
    );
  }
  return normalizeVoiceoverCheckpoint({
    version: VOICEOVER_CHECKPOINT_VERSION,
    stage: 'voice_separated',
    baseVideoAssetId: current.baseVideoAssetId,
    ...(current.originalAudioAssetId ? { originalAudioAssetId: current.originalAudioAssetId } : {}),
    ...(current.vocalAssetId ? { vocalAssetId: current.vocalAssetId } : {}),
    ...(current.backgroundAssetId ? { backgroundAssetId: current.backgroundAssetId } : {}),
    ...(current.subtitleRemoval ? { subtitleRemoval: current.subtitleRemoval } : {}),
    ...(current.analysisEvidenceVersion ? { analysisEvidenceVersion: current.analysisEvidenceVersion } : {}),
    ...(current.ttsAttemptBase ? { ttsAttemptBase: current.ttsAttemptBase } : {}),
    analysisAttempt: current.analysisAttempt + 1,
  }, options);
}

export function hasLegacyVoiceoverCheckpointProvenance(value) {
  if (
    !plainObject(value)
    || Number(value.version) !== VOICEOVER_CHECKPOINT_VERSION
    || !STAGE_INDEX.has(value.stage)
  ) {
    return false;
  }
  const stageIndex = STAGE_INDEX.get(value.stage);
  return (
    (
      stageIndex >= STAGE_INDEX.get('audio_extracted')
      && (
        value.analysisEvidenceVersion === undefined
        || (
          Number.isSafeInteger(Number(value.analysisEvidenceVersion))
          && Number(value.analysisEvidenceVersion) > 0
          && Number(value.analysisEvidenceVersion) < VOICEOVER_ANALYSIS_EVIDENCE_VERSION
        )
      )
    )
    || (
      stageIndex >= STAGE_INDEX.get('audio_aligned')
      && value.alignmentVersion === undefined
    )
  );
}

export function prepareVoiceoverEvidenceUpgradeCheckpoint(
  checkpoint,
  retryPlan = {},
  options = {},
) {
  if (!hasLegacyVoiceoverCheckpointProvenance(checkpoint)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', '当前检查点不需要证据升级');
  }
  const current = normalizeVoiceoverCheckpoint(checkpoint, {
    ...options,
    allowLegacyUpgrade: true,
  });
  const stageIndex = STAGE_INDEX.get(current.stage);
  const analysisEvidenceStale = (
    stageIndex >= STAGE_INDEX.get('audio_extracted')
    && current.analysisEvidenceVersion === undefined
  );
  const alignmentStale = (
    stageIndex >= STAGE_INDEX.get('audio_aligned')
    && current.alignmentVersion === undefined
  );

  if (!analysisEvidenceStale && alignmentStale) {
    const reusableTtsGroups = current.ttsGroups.map((group) => {
      const {
        actualDurationMs: _actualDurationMs,
        atempo: _atempo,
        ...durableIdentity
      } = group;
      return durableIdentity;
    });
    return normalizeVoiceoverCheckpoint({
      ...current,
      stage: 'tts_generating',
      ttsGroups: reusableTtsGroups,
      alignedAudioAssetId: undefined,
      finalAssetId: undefined,
      alignmentVersion: undefined,
    }, options);
  }

  const analysisWasSubmitted = stageIndex >= STAGE_INDEX.get('speech_analysis_submitting');
  if (analysisWasSubmitted && retryPlan.userConfirmed !== true) {
    throw buildVoiceoverError(
      'voiceover_checkpoint_upgrade_required',
      '旧版口播分析可能已经产生费用，请确认后重新分析',
      { statusCode: 409 },
    );
  }
  const latestLegacyTtsAttempt = Math.max(
    -1,
    ...(current.ttsGroups || []).map((group) => Number(group.attempt)),
  );
  const ttsAttemptBase = Math.max(
    Number(current.ttsAttemptBase || 0),
    latestLegacyTtsAttempt + 1,
  );
  if (ttsAttemptBase > 100) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', 'TTS 尝试次数已达到上限');
  }
  return normalizeVoiceoverCheckpoint({
    version: VOICEOVER_CHECKPOINT_VERSION,
    stage: current.subtitleRemoval ? 'subtitle_removal' : 'input_prepared',
    baseVideoAssetId: current.baseVideoAssetId,
    ...(current.subtitleRemoval ? { subtitleRemoval: current.subtitleRemoval } : {}),
    ...(ttsAttemptBase > 0 ? { ttsAttemptBase } : {}),
    analysisAttempt: current.analysisAttempt + (analysisWasSubmitted ? 1 : 0),
  }, options);
}
