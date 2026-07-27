import {
  VOICEOVER_MODEL_MAX_INPUT_TOKENS,
  getVoiceoverLanguage,
  getVoiceoverVoice,
} from '../src/utils/voiceoverCatalog.mjs';
import {
  VOICEOVER_BOUNDS,
  buildVoiceoverError,
  validateVoiceoverAnalysis,
} from './voiceoverContract.mjs';

const MAX_ANALYSIS_CONTENT_BYTES = 256 * 1024;
const SPEAKER = 'Speaker 1';
const GROUP_SCENE = 'Translated product voiceover with natural, controlled pacing.';
const GROUP_SAMPLE_CONTEXT = 'Use one consistent narrator and preserve punctuation and pauses.';
const JSON_FENCE = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/iu;
const ANALYSIS_KEYS = new Set(['sourceLanguage', 'speakerCount', 'voiceProfile', 'segments']);
const PROFILE_KEYS = new Set(['pitch', 'brightness', 'energy', 'pace', 'accentDescription']);
const SEGMENT_KEYS = new Set(['id', 'startMs', 'endMs', 'sourceText', 'targetText']);

const invalidAnalysis = (message) => buildVoiceoverError('voiceover_analysis_invalid', message);

const validateDurationMs = (value) => {
  const durationMs = Number(value);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw invalidAnalysis('视频时长无效');
  }
  return durationMs;
};

const validateTargetLanguage = (value) => {
  const code = String(value || '').trim();
  const language = getVoiceoverLanguage(code);
  if (!language) {
    throw buildVoiceoverError('voiceover_language_unsupported', '目标语言暂不支持');
  }
  return language;
};

const validateTranslationMode = (value) => {
  const mode = String(value || '').trim();
  if (!['natural', 'literal'].includes(mode)) {
    throw invalidAnalysis('翻译模式无效');
  }
  return mode;
};

const validateOverlapToleranceMs = (value) => {
  const tolerance = Number(value);
  const [minimum, maximum] = VOICEOVER_BOUNDS.overlapToleranceMs;
  if (!Number.isSafeInteger(tolerance) || tolerance < minimum || tolerance > maximum) {
    throw invalidAnalysis('时间轴重叠容差无效');
  }
  return tolerance;
};

const validateManagedVideoUrl = (value) => {
  const candidate = String(value || '').trim();
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('invalid');
    }
  } catch {
    throw invalidAnalysis('受控人声视频地址无效');
  }
  return candidate;
};

const freezeSegment = (segment) => Object.freeze({
  id: segment.id,
  startMs: segment.startMs,
  endMs: segment.endMs,
  sourceText: segment.sourceText,
  targetText: segment.targetText,
});

const assertMonotonicSegments = (segments) => {
  let previousStart = -1;
  let previousEnd = -1;
  for (const segment of segments) {
    const startMs = Number(segment?.startMs);
    const endMs = Number(segment?.endMs);
    if (startMs < previousStart || endMs < previousEnd) {
      throw invalidAnalysis('口播分段顺序无效');
    }
    previousStart = startMs;
    previousEnd = endMs;
  }
};

const assertNoUnknownFields = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidAnalysis('语音分析包含不支持的字段');
  }
};

export function buildVoiceoverAnalysisMessages({
  vocalOnlyVideoUrl,
  targetLanguage,
  translationMode,
  durationMs,
} = {}) {
  const fileUrl = validateManagedVideoUrl(vocalOnlyVideoUrl);
  const language = validateTargetLanguage(targetLanguage);
  const mode = validateTranslationMode(translationMode);
  const safeDurationMs = validateDurationMs(durationMs);
  const modeConstraint = mode === 'natural'
    ? 'Write idiomatic spoken translation. You may restructure wording to fit the original time budget naturally.'
    : 'Prioritize the original meaning and sentence structure, while still fitting safe timing for each original speech window.';

  const prompt = [
    'R Role',
    'You are a precise single-speaker speech analyst and spoken-language translator for video localization.',
    '',
    'T Task',
    `Analyze the attached vocal-only video, transcribe each spoken segment, and translate it into ${language.englishName} (${language.code}).`,
    'Return timestamps in integer milliseconds and describe only non-sensitive voice characteristics needed to choose a preset synthetic voice.',
    '',
    'C Context / Constraint',
    `1. The attached file is the only analysis input and its exact duration is ${safeDurationMs} ms.`,
    '2. Detect only audible speech. Do not invent speech, merge different speakers, or infer personal identity or sensitive attributes.',
    '3. voiceProfile is limited to pitch, brightness, energy, pace, and a short non-sensitive accentDescription.',
    `4. ${modeConstraint}`,
    '5. Every targetText must be non-empty and written in the requested target language.',
    '6. Segments must be ordered, have unique ids, remain within the video duration, and use endMs greater than startMs.',
    '',
    'F Format',
    'Output one strict JSON object only. Output no prose, commentary, Markdown, or additional JSON objects.',
    'Use exactly these root fields: sourceLanguage, speakerCount, voiceProfile, segments.',
    'sourceLanguage must be a supported language code. speakerCount must be an integer.',
    'voiceProfile must contain exactly: pitch, brightness, energy, pace, accentDescription.',
    'pitch: low | medium | high; brightness: dark | balanced | bright; energy: calm | balanced | energetic; pace: slow | natural | fast.',
    'Each segment must contain exactly: id, startMs, endMs, sourceText, targetText.',
    '',
    'E Example',
    '{"sourceLanguage":"cmn","speakerCount":1,"voiceProfile":{"pitch":"medium","brightness":"balanced","energy":"balanced","pace":"natural","accentDescription":"clear neutral delivery"},"segments":[{"id":"s1","startMs":120,"endMs":980,"sourceText":"示例原文","targetText":"Example translation."}]}',
  ].join('\n');

  return Object.freeze([
    Object.freeze({
      role: 'user',
      content: Object.freeze([
        Object.freeze({ type: 'input_file', file_url: fileUrl }),
        Object.freeze({ type: 'text', text: prompt }),
      ]),
    }),
  ]);
}

const parseStrictJsonObject = (content) => {
  if (typeof content !== 'string' || !content.trim()) {
    throw invalidAnalysis('语音分析结果为空');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_ANALYSIS_CONTENT_BYTES) {
    throw invalidAnalysis('语音分析结果过大');
  }
  const trimmed = content.trim();
  const fenced = trimmed.match(JSON_FENCE);
  const json = fenced ? fenced[1].trim() : trimmed;
  if (!json.startsWith('{') || !json.endsWith('}')) {
    throw invalidAnalysis('语音分析必须是单个 JSON 对象');
  }
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalidAnalysis('语音分析 JSON 无效');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidAnalysis('语音分析必须是单个 JSON 对象');
  }
  return parsed;
};

export function parseVoiceoverAnalysis(content, {
  durationMs,
  targetLanguage,
  translationMode,
  overlapToleranceMs,
} = {}) {
  const safeDurationMs = validateDurationMs(durationMs);
  validateTargetLanguage(targetLanguage);
  validateTranslationMode(translationMode);
  const safeOverlapToleranceMs = validateOverlapToleranceMs(overlapToleranceMs);
  const parsed = parseStrictJsonObject(content);

  assertNoUnknownFields(parsed, ANALYSIS_KEYS);
  assertNoUnknownFields(parsed.voiceProfile, PROFILE_KEYS);
  if (Array.isArray(parsed.segments)) {
    for (const segment of parsed.segments) assertNoUnknownFields(segment, SEGMENT_KEYS);
  }
  if (!Number.isInteger(parsed.speakerCount) || parsed.speakerCount < 0) {
    throw invalidAnalysis('说话人数无效');
  }
  if (parsed.speakerCount > 1) {
    throw buildVoiceoverError('voiceover_multiple_speakers', '当前仅支持单人口播');
  }
  if (parsed.speakerCount === 0 && Array.isArray(parsed.segments) && parsed.segments.length > 0) {
    throw invalidAnalysis('说话人数与口播分段冲突');
  }
  if (parsed.speakerCount === 0 || (Array.isArray(parsed.segments) && parsed.segments.length === 0)) {
    throw buildVoiceoverError('voiceover_no_speech_detected', '没有检测到可翻译口播');
  }
  if (typeof parsed.sourceLanguage !== 'string' || !parsed.sourceLanguage.trim()) {
    throw invalidAnalysis('源语言无效');
  }
  if (!getVoiceoverLanguage(parsed.sourceLanguage)) {
    throw buildVoiceoverError('voiceover_language_unsupported', '源语言暂不支持');
  }
  if (Array.isArray(parsed.segments)) assertMonotonicSegments(parsed.segments);

  const validated = validateVoiceoverAnalysis(parsed, {
    durationMs: safeDurationMs,
    overlapToleranceMs: safeOverlapToleranceMs,
  });
  return Object.freeze({
    sourceLanguage: validated.sourceLanguage,
    speakerCount: validated.speakerCount,
    voiceProfile: Object.freeze({ ...validated.voiceProfile }),
    segments: Object.freeze(validated.segments.map(freezeSegment)),
  });
}

const validateEstimatorInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalidAnalysis('TTS 输入无效');
  }
  const voiceName = String(input.voiceName || '').trim();
  if (!getVoiceoverVoice(voiceName) || !Array.isArray(input.dialogueTurns) || !input.dialogueTurns.length) {
    throw invalidAnalysis('TTS 输入无效');
  }
  const dialogueTurns = input.dialogueTurns.map((turn) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)
      || turn.speaker !== SPEAKER || typeof turn.text !== 'string' || !turn.text.trim()) {
      throw invalidAnalysis('TTS 对话无效');
    }
    return { speaker: SPEAKER, text: turn.text };
  });
  if (typeof input.scene !== 'string' || !input.scene.trim()
    || typeof input.sampleContext !== 'string' || !input.sampleContext.trim()) {
    throw invalidAnalysis('TTS 场景或上下文无效');
  }
  const scene = input.scene;
  const sampleContext = input.sampleContext;
  return { voiceName, dialogueTurns, scene, sampleContext };
};

/**
 * Returns a conservative upper-bound estimate based on the UTF-8 byte length of
 * the complete serialized provider input. It is intentionally not an exact
 * Gemini tokenizer or exact token count.
 */
export function estimateVoiceoverTtsInputTokens(input) {
  const normalized = validateEstimatorInput(input);
  const serialized = JSON.stringify({
    speakers: [{ speaker: SPEAKER, voiceName: normalized.voiceName }],
    dialogue_turns: normalized.dialogueTurns,
    scene: normalized.scene,
    sample_context: normalized.sampleContext,
  });
  return Buffer.byteLength(serialized, 'utf8');
}

const validateGroupingBound = (value, [minimum, maximum], field) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw invalidAnalysis(`${field} 无效`);
  }
  return result;
};

const buildGroupData = (segments, voiceName) => {
  const dialogueTurns = segments.map((segment) => Object.freeze({
    speaker: SPEAKER,
    text: segment.targetText,
  }));
  const estimatedInputTokens = estimateVoiceoverTtsInputTokens({
    voiceName,
    dialogueTurns,
    scene: GROUP_SCENE,
    sampleContext: GROUP_SAMPLE_CONTEXT,
  });
  return {
    dialogueTurns: Object.freeze(dialogueTurns),
    estimatedInputTokens,
  };
};

export function buildVoiceoverTtsGroups({
  segments,
  selectedVoiceName,
  maxInputTokens,
  groupGapMs,
} = {}) {
  const voiceName = String(selectedVoiceName || '').trim();
  if (!getVoiceoverVoice(voiceName)) throw invalidAnalysis('音色选择无效');
  const inputLimit = validateGroupingBound(
    maxInputTokens,
    [VOICEOVER_BOUNDS.ttsMaxInputTokens[0], VOICEOVER_MODEL_MAX_INPUT_TOKENS],
    'TTS 输入预算',
  );
  const maximumGapMs = validateGroupingBound(groupGapMs, VOICEOVER_BOUNDS.groupGapMs, 'TTS 分组间隔');
  const normalized = validateVoiceoverAnalysis({
    sourceLanguage: 'en',
    speakerCount: 1,
    voiceProfile: {
      pitch: 'medium',
      brightness: 'balanced',
      energy: 'balanced',
      pace: 'natural',
      accentDescription: '',
    },
    segments,
  }, {
    durationMs: Number.MAX_SAFE_INTEGER,
    overlapToleranceMs: VOICEOVER_BOUNDS.overlapToleranceMs[1],
  }).segments;
  assertMonotonicSegments(normalized);
  const immutableSegments = normalized.map(freezeSegment);
  const plannedGroups = [];
  let current = [];

  const assertFits = (candidate) => {
    const data = buildGroupData(candidate, voiceName);
    if (data.estimatedInputTokens > inputLimit) {
      throw buildVoiceoverError(
        'voiceover_tts_input_too_large',
        '单个口播片段超过当前语音模型输入上限',
      );
    }
    return data;
  };

  const publish = (groupSegments, data) => {
    const frozenSegments = Object.freeze(groupSegments.slice());
    plannedGroups.push(Object.freeze({
      groupIndex: plannedGroups.length,
      segmentIds: Object.freeze(frozenSegments.map((segment) => segment.id)),
      segments: frozenSegments,
      startMs: frozenSegments[0].startMs,
      endMs: frozenSegments.at(-1).endMs,
      voiceName,
      dialogueTurns: data.dialogueTurns,
      scene: GROUP_SCENE,
      sampleContext: GROUP_SAMPLE_CONTEXT,
      estimatedInputTokens: data.estimatedInputTokens,
    }));
  };

  for (const segment of immutableSegments) {
    const singleData = assertFits([segment]);
    if (!current.length) {
      current = [segment];
      continue;
    }
    const gapMs = segment.startMs - current.at(-1).endMs;
    const candidate = [...current, segment];
    const candidateData = buildGroupData(candidate, voiceName);
    if (gapMs <= maximumGapMs && candidateData.estimatedInputTokens <= inputLimit) {
      current = candidate;
      continue;
    }
    publish(current, buildGroupData(current, voiceName));
    current = [segment];
    if (singleData.estimatedInputTokens > inputLimit) {
      throw buildVoiceoverError('voiceover_tts_input_too_large', '单个口播片段超过当前语音模型输入上限');
    }
  }
  if (current.length) publish(current, buildGroupData(current, voiceName));
  return Object.freeze(plannedGroups);
}
