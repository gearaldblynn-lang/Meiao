import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceoverAnalysisMessages,
  buildVoiceoverTtsGroups,
  estimateVoiceoverTtsInputTokens,
  parseVoiceoverAnalysis,
} from './voiceoverAnalysis.mjs';
import { VOICEOVER_LANGUAGES } from '../src/utils/voiceoverCatalog.mjs';
import { VOICEOVER_MAX_TTS_GROUPS } from './voiceoverContract.mjs';

const validProfile = (patch = {}) => ({
  pitch: 'medium',
  brightness: 'balanced',
  energy: 'balanced',
  pace: 'natural',
  accentDescription: 'Clear neutral delivery',
  ...patch,
});

const validSegment = (patch = {}) => ({
  id: 's1',
  startMs: 100,
  endMs: 900,
  sourceText: '原文',
  targetText: 'Translated line.',
  ...patch,
});

const validAnalysis = (patch = {}) => ({
  sourceLanguage: 'cmn',
  speakerCount: 1,
  voiceProfile: validProfile(),
  segments: [validSegment()],
  ...patch,
});

const parserOptions = (patch = {}) => ({
  durationMs: 2_000,
  targetLanguage: 'en',
  translationMode: 'natural',
  overlapToleranceMs: 150,
  ...patch,
});

const parse = (value, options) => parseVoiceoverAnalysis(
  typeof value === 'string' ? value : JSON.stringify(value),
  options || parserOptions(),
);

test('analysis prompt is one RTCFE user message with one managed input_file before one text item', () => {
  const vocalOnlyVideoUrl = 'https://managed.example/vocal-only.mp4?signature=redacted';
  const messages = buildVoiceoverAnalysisMessages({
    vocalOnlyVideoUrl,
    targetLanguage: 'en',
    translationMode: 'natural',
    durationMs: 12_000,
    maxTargetTextBytesPerSecond: 24,
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.deepEqual(messages[0].content[0], { type: 'input_file', file_url: vocalOnlyVideoUrl });
  assert.equal(messages[0].content[1].type, 'text');
  assert.equal(messages[0].content.length, 2);
  const prompt = messages[0].content[1].text;
  for (const heading of [
    'R Role',
    'T Task',
    'C Context / Constraint',
    'F Format',
    'E Example',
  ]) {
    assert.match(prompt, new RegExp(heading.replace('/', '\\/')));
  }
  for (const field of [
    'sourceLanguage',
    'speakerCount',
    'voiceProfile',
    'pitch',
    'brightness',
    'energy',
    'pace',
    'accentDescription',
    'segments',
    'id',
    'startMs',
    'endMs',
    'sourceText',
    'targetText',
  ]) {
    assert.match(prompt, new RegExp(`\\b${field}\\b`));
  }
  assert.match(prompt, /one strict JSON object/i);
  assert.match(prompt, /no prose/i);
  assert.match(prompt, /English/);
  assert.match(prompt, /12000/);
  assert.match(prompt, /24 UTF-8 bytes per second/i);
  assert.match(prompt, /shorten.*nonessential/i);
  assert.match(prompt, /3 spoken words per second/i);
  assert.match(prompt, /timing fit is mandatory/i);
  assert.match(prompt, /omit secondary modifiers/i);
  assert.doesNotMatch(prompt, /\b(?:gender|ethnicity|age|race)\b/i);
});

test('natural and literal prompts preserve distinct translation priorities and safe timing', () => {
  const base = {
    vocalOnlyVideoUrl: 'https://managed.example/vocal-only.mp4',
    targetLanguage: 'en',
    durationMs: 12_000,
  };
  const natural = buildVoiceoverAnalysisMessages({ ...base, translationMode: 'natural' })[0].content[1].text;
  const literal = buildVoiceoverAnalysisMessages({ ...base, translationMode: 'literal' })[0].content[1].text;

  assert.notEqual(natural, literal);
  assert.match(natural, /idiomatic/i);
  assert.match(natural, /original time budget/i);
  assert.match(literal, /meaning and sentence structure/i);
  assert.match(literal, /safe timing/i);
  assert.match(natural, /targetText.*requested target language/is);
  assert.match(literal, /targetText.*requested target language/is);
});

test('analysis prompt lists every supported source code, pins Mandarin to cmn, and uses no language-content example', () => {
  const allowedCodes = VOICEOVER_LANGUAGES.map(({ code }) => code).join(', ');
  for (const targetLanguage of ['ja', 'ko', 'cmn']) {
    const prompt = buildVoiceoverAnalysisMessages({
      vocalOnlyVideoUrl: 'https://managed.example/vocal-only.mp4',
      targetLanguage,
      translationMode: 'natural',
      durationMs: 12_000,
    })[0].content[1].text;

    assert.match(prompt, new RegExp(`Allowed sourceLanguage codes: ${allowedCodes.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`));
    assert.match(prompt, /Mandarin Chinese must use sourceLanguage "cmn"/);
    assert.match(prompt, /Do not use "zh" or "zh-CN"/);
    assert.match(prompt, /E Example\s+No language-content example; follow F Format only\./s);
    assert.doesNotMatch(prompt, /Example translation|示例原文/);
  }
});

test('analysis prompt rejects invalid input instead of constructing an ambiguous provider request', () => {
  assert.throws(
    () => buildVoiceoverAnalysisMessages({
      vocalOnlyVideoUrl: '',
      targetLanguage: 'en',
      translationMode: 'natural',
      durationMs: 12_000,
    }),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
  assert.throws(
    () => buildVoiceoverAnalysisMessages({
      vocalOnlyVideoUrl: 'https://managed.example/vocal-only.mp4',
      targetLanguage: 'zz',
      translationMode: 'natural',
      durationMs: 12_000,
    }),
    (error) => error.code === 'voiceover_language_unsupported',
  );
  assert.throws(
    () => buildVoiceoverAnalysisMessages({
      vocalOnlyVideoUrl: 'https://managed.example/vocal-only.mp4',
      targetLanguage: 'en',
      translationMode: 'natural',
      durationMs: 12_000,
      maxTargetTextBytesPerSecond: 513,
    }),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
});

test('parser accepts one complete JSON object or one whole JSON fence and returns deeply immutable data', () => {
  const raw = JSON.stringify(validAnalysis());
  const plain = parse(raw);
  const fenced = parse(`\`\`\`json\n${raw}\n\`\`\``);

  assert.deepEqual(fenced, plain);
  assert.equal(Object.isFrozen(plain), true);
  assert.equal(Object.isFrozen(plain.voiceProfile), true);
  assert.equal(Object.isFrozen(plain.segments), true);
  assert.equal(Object.isFrozen(plain.segments[0]), true);
  assert.throws(() => {
    plain.voiceProfile.pitch = 'high';
  }, TypeError);
  assert.throws(() => {
    plain.segments[0].targetText = 'mutated';
  }, TypeError);
});

test('parser rejects prose, multiple objects, arrays, malformed JSON, unknown fields, and oversized content', () => {
  const raw = JSON.stringify(validAnalysis());
  const invalidValues = [
    `analysis:\n${raw}`,
    `${raw}\nfinished`,
    `${raw}\n${raw}`,
    `[${raw}]`,
    '{"sourceLanguage":',
    JSON.stringify({ ...validAnalysis(), extra: true }),
    JSON.stringify({ ...validAnalysis(), voiceProfile: validProfile({ privateTrait: 'x' }) }),
    JSON.stringify({ ...validAnalysis(), segments: [validSegment({ privateField: 'x' })] }),
    JSON.stringify({ ...validAnalysis(), extra: 'x'.repeat(300_000) }),
    `\`\`\`json\n${raw}\n\`\`\`\ntrailing`,
  ];

  for (const content of invalidValues) {
    assert.throws(
      () => parseVoiceoverAnalysis(content, parserOptions()),
      (error) => error.code === 'voiceover_analysis_invalid',
      content.slice(0, 80),
    );
  }
});

test('strict JSON scanner rejects canonical duplicate keys without misreading string contents', () => {
  const profile = JSON.stringify(validProfile());
  const segment = JSON.stringify(validSegment());
  const duplicateRoot = String.raw`{"sourceLanguage":"cmn","source\u004canguage":"en","speakerCount":1,"voiceProfile":${profile},"segments":[${segment}]}`;
  const duplicateProfile = String.raw`{"sourceLanguage":"cmn","speakerCount":1,"voiceProfile":{"pitch":"medium","p\u0069tch":"high","brightness":"balanced","energy":"balanced","pace":"natural","accentDescription":"clear"},"segments":[${segment}]}`;
  const duplicateSegment = String.raw`{"sourceLanguage":"cmn","speakerCount":1,"voiceProfile":${profile},"segments":[{"id":"s1","\u0069d":"s2","startMs":100,"endMs":900,"sourceText":"原文","targetText":"Translated line."}]}`;
  const excessiveDepth = `{"sourceLanguage":"cmn","speakerCount":1,"voiceProfile":${profile},"segments":[${segment}],"extra":${'['.repeat(40)}null${']'.repeat(40)}}`;

  for (const content of [duplicateRoot, duplicateProfile, duplicateSegment, excessiveDepth]) {
    assert.throws(
      () => parse(content),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }

  assert.equal(parse(validAnalysis({
    segments: [validSegment({
      startMs: 0,
      endMs: 2_000,
      targetText: 'Say "sourceLanguage" and "id" literally.',
    })],
  })).segments[0].targetText, 'Say "sourceLanguage" and "id" literally.');
});

test('unknown fields fail as invalid analysis before semantic no-speech or speaker errors', () => {
  assert.throws(
    () => parse(validAnalysis({ speakerCount: 2, extra: true })),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
  assert.throws(
    () => parse(validAnalysis({
      speakerCount: 0,
      voiceProfile: validProfile({ privateTrait: 'x' }),
      segments: [],
    })),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
});

test('parser maps no speech, multiple speakers, and unsupported languages to their specific errors', () => {
  for (const value of [
    validAnalysis({ speakerCount: 0, segments: [] }),
    validAnalysis({ speakerCount: 1, segments: [] }),
  ]) {
    assert.throws(() => parse(value), (error) => error.code === 'voiceover_no_speech_detected');
  }
  assert.throws(
    () => parse(validAnalysis({ speakerCount: 2 })),
    (error) => error.code === 'voiceover_multiple_speakers',
  );
  assert.throws(
    () => parse(validAnalysis({ speakerCount: 2, segments: [] })),
    (error) => error.code === 'voiceover_multiple_speakers',
  );
  assert.throws(
    () => parse(validAnalysis({ speakerCount: 0 })),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
  assert.throws(
    () => parse(validAnalysis({ sourceLanguage: 'zz' })),
    (error) => error.code === 'voiceover_language_unsupported',
  );
  assert.throws(
    () => parse(validAnalysis(), parserOptions({ targetLanguage: 'zz' })),
    (error) => error.code === 'voiceover_language_unsupported',
  );
});

test('speakerCount zero is no-speech only when segments is a structurally valid empty array', () => {
  for (const segments of [undefined, null, 'not-an-array']) {
    assert.throws(
      () => parse(validAnalysis({ speakerCount: 0, segments })),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }
  assert.throws(
    () => parse(validAnalysis({ speakerCount: 0, segments: [] })),
    (error) => error.code === 'voiceover_no_speech_detected',
  );
});

test('parser rejects same source and target language before TTS', () => {
  assert.throws(
    () => parse(validAnalysis({ sourceLanguage: 'en' }), parserOptions({ targetLanguage: 'en' })),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
  assert.throws(
    () => parse(validAnalysis({ sourceLanguage: 'cmn' }), parserOptions({ targetLanguage: 'cmn' })),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
  assert.equal(parse(validAnalysis({ sourceLanguage: 'cmn' }), parserOptions({ targetLanguage: 'en' })).sourceLanguage, 'cmn');
});

test('parser rejects abnormal target-text byte density in natural and literal modes', () => {
  for (const translationMode of ['natural', 'literal']) {
    assert.throws(
      () => parse(validAnalysis({
        segments: [validSegment({
          startMs: 0,
          endMs: 100,
          targetText: 'a'.repeat(5_000),
        })],
      }), parserOptions({ translationMode })),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }

  assert.equal(parse(validAnalysis({
    sourceLanguage: 'en',
    segments: [validSegment({ startMs: 0, endMs: 500, sourceText: 'Hello', targetText: '你好。' })],
  }), parserOptions({ targetLanguage: 'cmn' })).segments[0].targetText, '你好。');
  assert.equal(parse(validAnalysis({
    segments: [validSegment({ startMs: 0, endMs: 1_000, targetText: 'Concise line.' })],
  })).segments[0].targetText, 'Concise line.');
});

test('parser fails closed for invalid options, speech text, profile, duplicate ids, and speaker counts', () => {
  const invalidOptions = [
    parserOptions({ durationMs: 0 }),
    parserOptions({ durationMs: 1.5 }),
    parserOptions({ translationMode: 'freeform' }),
    parserOptions({ overlapToleranceMs: -1 }),
    parserOptions({ overlapToleranceMs: 1001 }),
    parserOptions({ maxTargetTextBytesPerSecond: 15 }),
    parserOptions({ maxTargetTextBytesPerSecond: 513 }),
  ];
  for (const options of invalidOptions) {
    assert.throws(
      () => parse(validAnalysis(), options),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }

  const invalidValues = [
    validAnalysis({ speakerCount: -1 }),
    validAnalysis({ speakerCount: 1.5 }),
    validAnalysis({ segments: [validSegment({ sourceText: '' })] }),
    validAnalysis({ segments: [validSegment({ targetText: '' })] }),
    validAnalysis({ voiceProfile: validProfile({ accentDescription: '口'.repeat(501) }) }),
    validAnalysis({
      segments: [
        validSegment(),
        validSegment({ id: 's1', startMs: 1_000, endMs: 1_500 }),
      ],
    }),
  ];
  for (const value of invalidValues) {
    assert.throws(
      () => parse(value),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }
});

test('parser rejects invalid, out-of-bounds, non-monotonic, and excessive-overlap timestamps', () => {
  const invalidSegments = [
    [validSegment({ startMs: -1 })],
    [validSegment({ startMs: 900, endMs: 900 })],
    [validSegment({ endMs: 2_001 })],
    [validSegment({ startMs: 100.5 })],
    [
      validSegment({ id: 's1', startMs: 500, endMs: 600 }),
      validSegment({ id: 's2', startMs: 490, endMs: 800 }),
    ],
    [
      validSegment({ id: 's1', startMs: 100, endMs: 900 }),
      validSegment({ id: 's2', startMs: 700, endMs: 1_200 }),
    ],
  ];

  for (const segments of invalidSegments) {
    assert.throws(
      () => parse(validAnalysis({ segments })),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }

  const tolerated = parse(validAnalysis({
    segments: [
      validSegment({ id: 's1', startMs: 100, endMs: 900 }),
      validSegment({ id: 's2', startMs: 750, endMs: 1_200 }),
    ],
  }));
  assert.deepEqual(tolerated.segments.map(({ id }) => id), ['s1', 's2']);
});

test('UTF-8 estimator is the conservative serialized provider-input byte upper bound', () => {
  const input = {
    voiceName: 'Kore',
    dialogueTurns: [{ speaker: 'Speaker 1', text: '你好, world.' }],
    scene: 'Translated product voiceover.',
    sampleContext: 'One consistent narrator.',
  };
  const expected = Buffer.byteLength(JSON.stringify({
    speakers: [{
      speaker_id: 'Speaker 1',
      voice_name: 'Kore',
      audio_profile: '',
      style: 'Deadpan',
      pace: 'Natural',
      accent: 'Neutral',
    }],
    dialogue_turns: [{ speaker_id: 'Speaker 1', text: '你好, world.' }],
    temperature: 1,
    scene: input.scene,
    sample_context: input.sampleContext,
  }), 'utf8');

  assert.equal(estimateVoiceoverTtsInputTokens(input), expected);
  assert.ok(
    estimateVoiceoverTtsInputTokens({ ...input, voiceName: 'Zubenelgenubi' }) > expected,
    'speaker serialization must be included',
  );
  assert.ok(
    estimateVoiceoverTtsInputTokens({ ...input, sampleContext: `${input.sampleContext} extra` }) > expected,
    'sample_context serialization must be included',
  );

  const padded = {
    ...input,
    dialogueTurns: [{ speaker: 'Speaker 1', text: '  keep provider spacing  ' }],
    scene: '  keep scene spacing  ',
    sampleContext: '  keep context spacing  ',
  };
  assert.equal(
    estimateVoiceoverTtsInputTokens(padded),
    Buffer.byteLength(JSON.stringify({
      speakers: [{
        speaker_id: 'Speaker 1',
        voice_name: 'Kore',
        audio_profile: '',
        style: 'Deadpan',
        pace: 'Natural',
        accent: 'Neutral',
      }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text: '  keep provider spacing  ' }],
      temperature: 1,
      scene: padded.scene,
      sample_context: padded.sampleContext,
    }), 'utf8'),
  );
});

test('grouping preserves every detected timing window instead of merging adjacent speech', () => {
  const segments = [
    validSegment({ id: 's1', startMs: 100, endMs: 500, targetText: 'First.' }),
    validSegment({ id: 's2', startMs: 900, endMs: 1_300, targetText: 'Second.' }),
    validSegment({ id: 's3', startMs: 2_500, endMs: 2_900, targetText: 'Third.' }),
  ];
  const snapshot = structuredClone(segments);
  const options = {
    segments,
    selectedVoiceName: 'Kore',
    maxInputTokens: 8_192,
    groupGapMs: 800,
  };
  const groups = buildVoiceoverTtsGroups(options);

  assert.deepEqual(groups.map((group) => group.segmentIds), [['s1'], ['s2'], ['s3']]);
  assert.deepEqual(buildVoiceoverTtsGroups(options), groups);
  assert.deepEqual(segments, snapshot);
  assert.deepEqual(groups[0], {
    groupIndex: 0,
    segmentIds: ['s1'],
    segments: snapshot.slice(0, 1),
    startMs: 100,
    endMs: 500,
    voiceName: 'Kore',
    dialogueTurns: [
      { speaker: 'Speaker 1', text: 'First.' },
    ],
    scene: groups[0].scene,
    sampleContext: groups[0].sampleContext,
    estimatedInputTokens: groups[0].estimatedInputTokens,
  });
  assert.equal(typeof groups[0].scene, 'string');
  assert.equal(typeof groups[0].sampleContext, 'string');
  assert.ok(groups.every((group) => group.estimatedInputTokens <= 8_192));
  assert.equal(Object.isFrozen(groups), true);
  assert.equal(Object.isFrozen(groups[0]), true);
  assert.equal(Object.isFrozen(groups[0].segments), true);
  assert.equal(Object.isFrozen(groups[0].segments[0]), true);
  assert.equal(Object.isFrozen(groups[0].dialogueTurns[0]), true);
  assert.doesNotMatch(JSON.stringify(groups), /(?:https?:\/\/|\/tmp\/|file:)/);
});

test('each timing-window group independently respects the serialized provider budget', () => {
  const segments = [
    validSegment({ id: 's1', startMs: 0, endMs: 400, targetText: 'One.' }),
    validSegment({ id: 's2', startMs: 600, endMs: 1_000, targetText: 'Two.' }),
    validSegment({ id: 's3', startMs: 1_200, endMs: 1_600, targetText: 'Three.' }),
  ];
  const singleSegmentBudget = estimateVoiceoverTtsInputTokens({
    voiceName: 'Kore',
    dialogueTurns: [{ speaker: 'Speaker 1', text: 'Three.' }],
    scene: 'Translated product voiceover with natural, controlled pacing.',
    sampleContext: 'Use one consistent narrator and preserve punctuation and pauses.',
  });
  const groups = buildVoiceoverTtsGroups({
    segments,
    selectedVoiceName: 'Kore',
    maxInputTokens: singleSegmentBudget,
    groupGapMs: 800,
  });

  assert.deepEqual(groups.map((group) => group.segmentIds), [['s1'], ['s2'], ['s3']]);
  assert.ok(groups.every((group) => group.estimatedInputTokens <= singleSegmentBudget));
});

test('the reported four-window canary produces four exact TTS placement groups', () => {
  const segments = [
    validSegment({ id: 'seg_1', startMs: 0, endMs: 3_000, targetText: 'First line.' }),
    validSegment({ id: 'seg_2', startMs: 3_000, endMs: 6_000, targetText: 'Second line.' }),
    validSegment({ id: 'seg_3', startMs: 6_000, endMs: 10_000, targetText: 'Third line.' }),
    validSegment({ id: 'seg_4', startMs: 10_000, endMs: 15_070, targetText: 'Fourth line.' }),
  ];

  const groups = buildVoiceoverTtsGroups({
    segments,
    selectedVoiceName: 'Charon',
    maxInputTokens: 8_192,
    groupGapMs: 800,
  });

  assert.deepEqual(
    groups.map(({ segmentIds, startMs, endMs }) => ({ segmentIds, startMs, endMs })),
    [
      { segmentIds: ['seg_1'], startMs: 0, endMs: 3_000 },
      { segmentIds: ['seg_2'], startMs: 3_000, endMs: 6_000 },
      { segmentIds: ['seg_3'], startMs: 6_000, endMs: 10_000 },
      { segmentIds: ['seg_4'], startMs: 10_000, endMs: 15_070 },
    ],
  );
});

test('one oversized segment and invalid grouping configuration fail before provider submission', () => {
  assert.throws(
    () => buildVoiceoverTtsGroups({
      segments: [validSegment({ targetText: '字'.repeat(200) })],
      selectedVoiceName: 'Kore',
      maxInputTokens: 100,
      groupGapMs: 800,
    }),
    (error) => error.code === 'voiceover_tts_input_too_large',
  );

  const invalidInputs = [
    { selectedVoiceName: 'Unknown' },
    { maxInputTokens: 0 },
    { maxInputTokens: 8_193 },
    { groupGapMs: -1 },
    { groupGapMs: 3_001 },
  ];
  for (const patch of invalidInputs) {
    assert.throws(
      () => buildVoiceoverTtsGroups({
        segments: [validSegment()],
        selectedVoiceName: 'Kore',
        maxInputTokens: 8_192,
        groupGapMs: 800,
        ...patch,
      }),
      (error) => error.code === 'voiceover_analysis_invalid',
    );
  }
});

test('TTS grouping shares the checkpoint group limit and fails before a 101st provider group', () => {
  const separatedSegments = (count) => Array.from({ length: count }, (_, index) => validSegment({
    id: `s${index}`,
    startMs: index * 2_000,
    endMs: index * 2_000 + 500,
    sourceText: `source ${index}`,
    targetText: `target ${index}`,
  }));
  const groups = buildVoiceoverTtsGroups({
    segments: separatedSegments(VOICEOVER_MAX_TTS_GROUPS),
    selectedVoiceName: 'Kore',
    maxInputTokens: 8_192,
    groupGapMs: 0,
  });
  assert.equal(groups.length, VOICEOVER_MAX_TTS_GROUPS);
  assert.throws(
    () => buildVoiceoverTtsGroups({
      segments: separatedSegments(VOICEOVER_MAX_TTS_GROUPS + 1),
      selectedVoiceName: 'Kore',
      maxInputTokens: 8_192,
      groupGapMs: 0,
    }),
    (error) => error.code === 'voiceover_tts_input_too_large',
  );
});
