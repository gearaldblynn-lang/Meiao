import test from 'node:test';
import assert from 'node:assert/strict';

const modelReplacePreflight = await import('./modelReplacePreflight.mjs');
const {
  MODEL_REPLACE_ERROR_CODES,
  assertModelReplaceMaterialCounts,
  formatModelReplacePreflightError,
  parseModelReplacePreflightContent,
} = modelReplacePreflight;

test('exposes only the supported public preflight contract', () => {
  assert.deepEqual(Object.keys(modelReplacePreflight).sort(), [
    'MODEL_REPLACE_ERROR_CODES',
    'assertModelReplaceMaterialCounts',
    'formatModelReplacePreflightError',
    'parseModelReplacePreflightContent',
  ]);
});

test('accepts material counts within the supported ranges', () => {
  assert.doesNotThrow(() => assertModelReplaceMaterialCounts(1, 1));
  assert.doesNotThrow(() => assertModelReplaceMaterialCounts(4, 40));
});

test('rejects invalid identity counts with the identity count error code', () => {
  for (const identityCount of [0, 5, 1.5]) {
    assert.throws(
      () => assertModelReplaceMaterialCounts(identityCount, 1),
      (error) =>
        error.code === 'IDENTITY_COUNT_INVALID' &&
        error.message === '请上传 1–4 张同一人物的身份图。',
    );
  }
});

test('rejects invalid reference counts with the reference material label', () => {
  for (const referenceCount of [0, 41, 1.5]) {
    assert.throws(
      () => assertModelReplaceMaterialCounts(1, referenceCount),
      (error) => error.message === '请上传 1–40 张待替换参考图。',
    );
  }
});

test('exposes the exact supported preflight error codes', () => {
  assert.deepEqual(MODEL_REPLACE_ERROR_CODES, [
    'IDENTITY_COUNT_INVALID',
    'PERSON_COUNT_INVALID',
    'IDENTITY_MISMATCH',
    'FACE_NOT_USABLE',
    'REFERENCE_PERSON_TOO_SMALL',
    'FULL_REPLACE_SOURCE_INCOMPLETE',
  ]);
});

test('parses a valid JSON preflight result', () => {
  assert.deepEqual(
    parseModelReplacePreflightContent(JSON.stringify({
      passed: true,
      issues: [{ role: 'identity', index: 1, code: 'FACE_NOT_USABLE' }],
    })),
    {
      passed: false,
      issues: [{ role: 'identity', index: 1, code: 'FACE_NOT_USABLE' }],
    },
  );
});

test('parses a whole-response fenced JSON preflight result', () => {
  assert.deepEqual(
    parseModelReplacePreflightContent('```json\n{"passed":true,"issues":[]}\n```'),
    { passed: true, issues: [] },
  );
});

test('preserves lightweight reference classifications while normalizing malformed angles to unknown', () => {
  assert.deepEqual(
    parseModelReplacePreflightContent(JSON.stringify({
      passed: true,
      issues: [],
      referenceAnalysis: [
        { index: 1, framing: 'half_body', faceDirection: 'front', headPitch: 'level', occlusion: 'low', exposedSkinRegions: ['face', 'neck', 'hands'] },
        { index: 2, framing: 'too_close', faceDirection: null, headPitch: 'tilted', occlusion: 'none', exposedSkinRegions: ['face'] },
      ],
    })),
    {
      passed: true,
      issues: [],
      referenceAnalysis: [
        { index: 1, framing: 'half_body', faceDirection: 'front', headPitch: 'level', occlusion: 'low', exposedSkinRegions: ['face', 'neck', 'hands'] },
        { index: 2, framing: 'unknown', faceDirection: 'unknown', headPitch: 'unknown', occlusion: 'unknown', exposedSkinRegions: ['face'] },
      ],
    },
  );
});

test('ignores malformed optional reference analysis without failing the existing preflight contract', () => {
  assert.deepEqual(
    parseModelReplacePreflightContent(JSON.stringify({ passed: true, issues: [], referenceAnalysis: 'not-an-array' })),
    { passed: true, issues: [], referenceAnalysis: [] },
  );
});

test('strictly parses complete lightweight per-reference facts and strips obsolete detailed analysis', () => {
  const referenceAnalysis = {
    index: 1,
    framing: 'full_body',
    faceDirection: 'right',
    headPitch: 'level',
    occlusion: 'medium',
    exposedSkinRegions: ['face', 'ears', 'neck', 'arms', 'hands', 'legs'],
    bodyDirection: 'three_quarter',
    gazeDirection: 'right',
    protectedContent: {
      clothing: ['蓝色连衣裙', '蓝色花卉刺绣'],
      accessories: ['项链', '双肩包'],
      bodyPose: ['身体四分之三侧向', '双手交叠'],
      headAndGaze: ['头部朝右', '视线朝右'],
      composition: ['全身构图', '人物位于画面中央'],
      scene: ['户外树林', '草地'],
      lighting: ['右上方自然阳光', '地面保留原阴影'],
      visibleCopy: [{ text: 'SUMMER', layout: '画面顶部居中，白色大字' }],
      otherProtectedContent: ['人物与背包带的遮挡关系'],
    },
  };

  assert.deepEqual(
    parseModelReplacePreflightContent(JSON.stringify({
      passed: true,
      issues: [],
      referenceAnalysis: [referenceAnalysis],
    }), { requireCompleteReferenceAnalysis: true }),
    { passed: true, issues: [], referenceAnalysis: [{
      index: 1,
      framing: 'full_body',
      faceDirection: 'right',
      headPitch: 'level',
      occlusion: 'medium',
      exposedSkinRegions: ['face', 'ears', 'neck', 'arms', 'hands', 'legs'],
    }] },
  );
});

test('strict reference analysis rejects missing exposed skin regions', () => {
  const incomplete = {
    index: 1,
    framing: 'half_body',
    faceDirection: 'front',
    headPitch: 'level',
    occlusion: 'low',
  };

  assert.throws(
    () => parseModelReplacePreflightContent(JSON.stringify({
      passed: true,
      issues: [],
      referenceAnalysis: [incomplete],
    }), { requireCompleteReferenceAnalysis: true }),
    /轻量分析结构无效/,
  );
});

test('strict reference analysis rejects unknown or duplicate exposed skin regions', () => {
  for (const exposedSkinRegions of [['face', 'hair'], ['face', 'face']]) {
    assert.throws(
      () => parseModelReplacePreflightContent(JSON.stringify({
        passed: true,
        issues: [],
        referenceAnalysis: [{
          index: 1,
          framing: 'portrait',
          faceDirection: 'front',
          headPitch: 'level',
          occlusion: 'low',
          exposedSkinRegions,
        }],
      }), { requireCompleteReferenceAnalysis: true }),
      /裸露皮肤区域无效/,
    );
  }
});

test('strict reference analysis rejects duplicate reference indexes', () => {
  const complete = {
    index: 1,
    framing: 'portrait',
    faceDirection: 'front',
    headPitch: 'level',
    occlusion: 'low',
    exposedSkinRegions: ['face', 'ears', 'neck'],
  };

  assert.throws(
    () => parseModelReplacePreflightContent(JSON.stringify({
      passed: true,
      issues: [],
      referenceAnalysis: [complete, structuredClone(complete)],
    }), { requireCompleteReferenceAnalysis: true }),
    /参考图索引重复/,
  );
});

test('parses the first complete JSON object when the model adds trailing text', () => {
  assert.deepEqual(
    parseModelReplacePreflightContent([
      '{"passed":true,"issues":[]}',
      '说明：以上为检查结果。',
      '{"passed":false,"issues":[{"role":"reference","index":1,"code":"FACE_NOT_USABLE"}]}',
    ].join('\n')),
    { passed: true, issues: [] },
  );
});

test('parses fenced JSON even when the model adds text after the fence', () => {
  assert.deepEqual(
    parseModelReplacePreflightContent('```json\n{"passed":true,"issues":[]}\n```\n已完成检查。'),
    { passed: true, issues: [] },
  );
});

test('wraps JSON parse failures in a user-facing Chinese error', () => {
  assert.throws(
    () => parseModelReplacePreflightContent('模型检查通过'),
    (error) =>
      error instanceof SyntaxError &&
      error.message === '人物素材检查返回格式异常，请重试。',
  );
});

test('normalizes passed to false whenever issues are present', () => {
  assert.equal(
    parseModelReplacePreflightContent(JSON.stringify({
      passed: true,
      issues: [{ role: 'reference', index: 40, code: 'PERSON_COUNT_INVALID' }],
    })).passed,
    false,
  );
});

test('rejects malformed preflight content', () => {
  const invalidContents = [
    '模型检查通过',
    JSON.stringify([]),
    JSON.stringify(null),
    JSON.stringify({ passed: true }),
    JSON.stringify({ passed: true, issues: [], extra: true }),
    JSON.stringify({ issues: [] }),
    JSON.stringify({ passed: 'true', issues: [] }),
    JSON.stringify({ passed: true, issues: {} }),
    JSON.stringify({ passed: true, issues: [null] }),
    JSON.stringify({ passed: true, issues: ['issue'] }),
    JSON.stringify({ passed: true, issues: [{}] }),
    JSON.stringify({ passed: true, issues: [{ index: 1, code: 'FACE_NOT_USABLE' }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'identity', code: 'FACE_NOT_USABLE' }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'identity', index: 1 }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'identity', index: 1, code: 'FACE_NOT_USABLE', extra: true }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'other', index: 1, code: 'FACE_NOT_USABLE' }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'identity', index: 0, code: 'FACE_NOT_USABLE' }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'identity', index: 1.5, code: 'FACE_NOT_USABLE' }] }),
    JSON.stringify({ passed: true, issues: [{ role: 'identity', index: 1, code: 'UNKNOWN_CODE' }] }),
  ];

  for (const content of invalidContents) {
    assert.throws(() => parseModelReplacePreflightContent(content));
  }
});

test('formats every preflight error with each role label and one-based index', () => {
  const messages = {
    IDENTITY_COUNT_INVALID: '身份图数量必须为 1–4 张',
    PERSON_COUNT_INVALID: '必须恰好出现一名人物',
    IDENTITY_MISMATCH: '与主身份图疑似不是同一人物',
    FACE_NOT_USABLE: '面部过小、严重遮挡或清晰度不足',
    REFERENCE_PERSON_TOO_SMALL: '人物主体过小，无法可靠替换',
    FULL_REPLACE_SOURCE_INCOMPLETE: '未清楚展示全部替换所需的身材、姿势、服装和配饰',
  };
  const roles = {
    identity: '人物身份图',
    reference: '待替换参考图',
  };

  for (const [role, roleLabel] of Object.entries(roles)) {
    for (const [code, errorMessage] of Object.entries(messages)) {
      assert.equal(
        formatModelReplacePreflightError({ role, index: 2, code }),
        `${roleLabel}第 2 张：${errorMessage}`,
      );
    }
  }
});
