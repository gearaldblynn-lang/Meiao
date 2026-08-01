import {
  VOICEOVER_LANGUAGES,
  VOICEOVER_MODEL_MAX_INPUT_TOKENS,
  getVoiceoverLanguage,
  getVoiceoverVoice,
} from '../src/utils/voiceoverCatalog.mjs';
import {
  VOICEOVER_BOUNDS,
  VOICEOVER_DEFAULTS,
  VOICEOVER_MAX_TTS_GROUPS,
  buildVoiceoverError,
  validateVoiceoverAnalysis,
} from './voiceoverContract.mjs';

const MAX_ANALYSIS_CONTENT_BYTES = 256 * 1024;
const MAX_JSON_NESTING_DEPTH = 32;
const SPEAKER = 'Speaker 1';
const GROUP_SCENE = 'Translated product voiceover with natural, controlled pacing.';
const GROUP_SAMPLE_CONTEXT = 'Use one consistent narrator and preserve punctuation and pauses.';
const ALLOWED_SOURCE_LANGUAGE_CODES = VOICEOVER_LANGUAGES.map(({ code }) => code).join(', ');
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

const validateTargetTextBytesPerSecond = (value) => {
  if (value === undefined) return VOICEOVER_DEFAULTS.maxTargetTextBytesPerSecond;
  const rate = Number(value);
  const [minimum, maximum] = VOICEOVER_BOUNDS.maxTargetTextBytesPerSecond;
  if (!Number.isSafeInteger(rate) || rate < minimum || rate > maximum) {
    throw invalidAnalysis('译文异常密度门限无效');
  }
  return rate;
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

const validateInlineAudio = (data, mimeType) => {
  const normalizedData = String(data || '').trim();
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  if (
    !normalizedData
    || normalizedData.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalizedData)
    || normalizedMimeType !== 'audio/mp4'
  ) {
    throw invalidAnalysis('受控人声音频证据无效');
  }
  return {
    data: normalizedData,
    mimeType: normalizedMimeType,
  };
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
  vocalAudioData,
  vocalAudioMimeType,
  vocalOnlyVideoUrl,
  targetLanguage,
  translationMode,
  durationMs,
  maxTargetTextBytesPerSecond,
} = {}) {
  const vocalAudio = validateInlineAudio(vocalAudioData, vocalAudioMimeType);
  const fileUrl = validateManagedVideoUrl(vocalOnlyVideoUrl);
  const language = validateTargetLanguage(targetLanguage);
  const mode = validateTranslationMode(translationMode);
  const safeDurationMs = validateDurationMs(durationMs);
  const targetTextRate = validateTargetTextBytesPerSecond(maxTargetTextBytesPerSecond);
  const modeConstraint = mode === 'natural'
    ? 'Write idiomatic spoken translation. You may restructure wording to fit the original time budget naturally.'
    : 'Prioritize the original meaning and sentence structure, while still fitting safe timing for each original speech window.';

  const prompt = [
    'R Role',
    'You are a precise single-speaker speech analyst and spoken-language translator for video localization.',
    '',
    'T Task',
    `Analyze the attached inline vocal audio, transcribe each spoken segment, and translate it into ${language.englishName} (${language.code}).`,
    'Return timestamps in integer milliseconds and describe only non-sensitive voice characteristics needed to choose a preset synthetic voice.',
    '',
    'C Context / Constraint',
    `1. The attached inline audio and supporting video are the only analysis inputs and their exact duration is ${safeDurationMs} ms.`,
    '2. The inline audio is the primary evidence for speech. Use visible subtitles in the supporting video only to cross-check noisy or ambiguous separated audio.',
    '3. Never invent generic content or substitute a plausible topic when evidence is unclear. Mark only genuinely audible speech as segments.',
    '4. Do not merge different speakers or infer personal identity or sensitive attributes. voiceProfile is limited to pitch, brightness, energy, pace, and a short non-sensitive accentDescription.',
    `5. ${modeConstraint}`,
    '6. Every targetText must be non-empty and written in the requested target language.',
    '7. Preserve every instruction, quantity, negation, and product claim. Make wording concise by removing only disfluencies or exact repetition, never semantic content.',
    `8. For each segment, targetText must not exceed ${targetTextRate} UTF-8 bytes per second of its own startMs-to-endMs window; use concise faithful equivalents while preserving all meaning.`,
    '9. For languages written with spaces, use at most 3 spoken words per second in each segment. Timing fit is mandatory.',
    '10. Semantic fidelity takes priority over timing fit. If both cannot be satisfied, fail validation rather than omit or alter any meaning.',
    '11. Each targetText must be one concise spoken line that maps to the same source segment and visual action.',
    '12. Segments must be ordered, have unique ids, remain within the video duration, and use endMs greater than startMs.',
    `13. Allowed sourceLanguage codes: ${ALLOWED_SOURCE_LANGUAGE_CODES}.`,
    '14. Mandarin Chinese must use sourceLanguage "cmn". Do not use "zh" or "zh-CN".',
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
    'No language-content example; follow F Format only.',
  ].join('\n');

  return Object.freeze([
    Object.freeze({
      role: 'user',
      content: Object.freeze([
        Object.freeze({
          type: 'input_file',
          file_data: vocalAudio.data,
          mime_type: vocalAudio.mimeType,
          filename: 'vocal-evidence.m4a',
        }),
        Object.freeze({
          type: 'input_file',
          file_url: fileUrl,
          filename: 'supporting-video.mp4',
          mime_type: 'video/mp4',
        }),
        Object.freeze({ type: 'text', text: prompt }),
      ]),
    }),
  ]);
}

const scanStrictJsonStructure = (json) => {
  let index = 0;
  const fail = () => {
    throw new Error('invalid JSON structure');
  };
  const skipWhitespace = () => {
    while (index < json.length && /[\t\n\r ]/u.test(json[index])) index += 1;
  };
  const scanString = () => {
    if (json[index] !== '"') fail();
    const start = index;
    index += 1;
    while (index < json.length) {
      const code = json.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return JSON.parse(json.slice(start, index));
      }
      if (code < 0x20) fail();
      if (code === 0x5c) {
        index += 1;
        if (index >= json.length) fail();
        const escape = json[index];
        if ('"\\/bfnrt'.includes(escape)) {
          index += 1;
          continue;
        }
        if (escape !== 'u' || !/^[0-9a-fA-F]{4}$/u.test(json.slice(index + 1, index + 5))) fail();
        index += 5;
        continue;
      }
      index += 1;
    }
    fail();
  };
  const scanValue = (depth) => {
    if (depth > MAX_JSON_NESTING_DEPTH) fail();
    skipWhitespace();
    const character = json[index];
    if (character === '"') {
      scanString();
      return;
    }
    if (character === '{') {
      scanObject(depth + 1);
      return;
    }
    if (character === '[') {
      scanArray(depth + 1);
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (json.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    const number = json.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (!number) fail();
    index += number.length;
  };
  const scanObject = (depth) => {
    if (depth > MAX_JSON_NESTING_DEPTH || json[index] !== '{') fail();
    index += 1;
    skipWhitespace();
    if (json[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set();
    while (index < json.length) {
      skipWhitespace();
      const key = scanString();
      if (keys.has(key)) fail();
      keys.add(key);
      skipWhitespace();
      if (json[index] !== ':') fail();
      index += 1;
      scanValue(depth);
      skipWhitespace();
      if (json[index] === '}') {
        index += 1;
        return;
      }
      if (json[index] !== ',') fail();
      index += 1;
    }
    fail();
  };
  const scanArray = (depth) => {
    if (depth > MAX_JSON_NESTING_DEPTH || json[index] !== '[') fail();
    index += 1;
    skipWhitespace();
    if (json[index] === ']') {
      index += 1;
      return;
    }
    while (index < json.length) {
      scanValue(depth);
      skipWhitespace();
      if (json[index] === ']') {
        index += 1;
        return;
      }
      if (json[index] !== ',') fail();
      index += 1;
    }
    fail();
  };

  scanValue(0);
  skipWhitespace();
  if (index !== json.length) fail();
};

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
    scanStrictJsonStructure(json);
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
  maxTargetTextBytesPerSecond,
} = {}) {
  const safeDurationMs = validateDurationMs(durationMs);
  const safeTargetLanguage = validateTargetLanguage(targetLanguage);
  validateTranslationMode(translationMode);
  const safeOverlapToleranceMs = validateOverlapToleranceMs(overlapToleranceMs);
  const safeTargetTextBytesPerSecond = validateTargetTextBytesPerSecond(maxTargetTextBytesPerSecond);
  const parsed = parseStrictJsonObject(content);

  assertNoUnknownFields(parsed, ANALYSIS_KEYS);
  assertNoUnknownFields(parsed.voiceProfile, PROFILE_KEYS);
  if (!Array.isArray(parsed.segments)) throw invalidAnalysis('口播分段结构无效');
  for (const segment of parsed.segments) assertNoUnknownFields(segment, SEGMENT_KEYS);
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
  if (validated.sourceLanguage === safeTargetLanguage.code) {
    throw invalidAnalysis('源语言与目标语言不能相同');
  }
  for (const segment of validated.segments) {
    const speechWindowSeconds = Math.max(1, (segment.endMs - segment.startMs) / 1000);
    const maximumTargetTextBytes = Math.ceil(safeTargetTextBytesPerSecond * speechWindowSeconds);
    if (Buffer.byteLength(segment.targetText, 'utf8') > maximumTargetTextBytes) {
      throw invalidAnalysis('译文长度超过当前口播时间段的异常密度安全门');
    }
  }
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
  const temperature = input.temperature === undefined ? 1 : Number(input.temperature);
  if (!Number.isFinite(temperature)
    || temperature < 0
    || temperature > 2
    || Math.abs(temperature * 100 - Math.round(temperature * 100)) > Number.EPSILON * 100) {
    throw invalidAnalysis('TTS 温度无效');
  }
  return { voiceName, dialogueTurns, temperature, scene, sampleContext };
};

export function buildVoiceoverTtsProviderInput(input) {
  const normalized = validateEstimatorInput(input);
  return {
    speakers: [{
      speaker_id: SPEAKER,
      voice_name: normalized.voiceName,
      audio_profile: '',
      style: 'Deadpan',
      pace: 'Natural',
      accent: 'Neutral',
    }],
    dialogue_turns: normalized.dialogueTurns.map((turn) => ({
      speaker_id: SPEAKER,
      text: turn.text,
    })),
    temperature: normalized.temperature,
    scene: normalized.scene,
    sample_context: normalized.sampleContext,
  };
}

/**
 * Returns a conservative upper-bound estimate based on the UTF-8 byte length of
 * the complete serialized provider input. It is intentionally not an exact
 * Gemini tokenizer or exact token count.
 */
export function estimateVoiceoverTtsInputTokens(input) {
  const serialized = JSON.stringify(buildVoiceoverTtsProviderInput(input));
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
    if (plannedGroups.length >= VOICEOVER_MAX_TTS_GROUPS) {
      throw buildVoiceoverError('voiceover_tts_input_too_large', '口播分组数量超过当前安全上限');
    }
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

  // A provider result has no per-dialogue-turn timestamps. Combining adjacent
  // analysis segments therefore destroys the only durable audio/video sync
  // anchors and concentrates any residual silence at the end of one long clip.
  // Keep one provider output per detected speech window so FFmpeg can place and
  // speed each line independently on its original timeline.
  void maximumGapMs;
  for (const segment of immutableSegments) {
    publish([segment], assertFits([segment]));
  }
  return Object.freeze(plannedGroups);
}
