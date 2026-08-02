import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractTranslationPlanningMappings,
  normalizeTranslationPlanningContent,
  reconcileTranslationPlanningBatchConsistency,
  runTranslationPlanningWithLanguageGuard,
  validateTranslationPlanningTargetLanguage,
} from './translationPlanningLanguage.mjs';

test('extractTranslationPlanningMappings reads localized-copy rows only', () => {
  const mappings = extractTranslationPlanningMappings(`
- “一枚で、食卓の印象を整える。”本地化为“1枚で、食卓を上品に演出。”
- "Water resistant"本地化为"Water-repellent finish"
- “产品主体/包装实物表面的原文案”保持不变
`);

  assert.deepEqual(mappings, [
    { source: '一枚で、食卓の印象を整える。', target: '1枚で、食卓を上品に演出。' },
    { source: 'Water resistant', target: 'Water-repellent finish' },
  ]);
});

test('normalizeTranslationPlanningContent removes process text and keeps structured rows only', () => {
  const normalized = normalizeTranslationPlanningContent(`
先识别原文角色，再输出目标市场文案。
commentary
- [主标题] “自然な垂れ感で、すっきり。”本地化为“美しいドレープで、食卓をすっきり演出。”
- [副标题] “切り替えと波型の縁取りが、食卓のアクセントに。”本地化为“切り替えデザインと波型の縁取りが、食卓にさりげないアクセントを添えます。”
- “ABC-1200”保持不变
final_answer
`);

  assert.equal(normalized, [
    '- “自然な垂れ感で、すっきり。”本地化为“美しいドレープで、食卓をすっきり演出。”',
    '- “切り替えと波型の縁取りが、食卓のアクセントに。”本地化为“切り替えデザインと波型の縁取りが、食卓にさりげないアクセントを添えます。”',
    '- “ABC-1200”保持不变',
  ].join('\n'));
  assert.doesNotMatch(normalized, /commentary|final_answer|先识别/);
});

test('batch reconciliation reuses the first accepted target for identical source copy', () => {
  const registry = new Map();
  const first = reconcileTranslationPlanningBatchConsistency({
    content: '- “撥水加工”本地化为“水をはじく撥水仕様”',
    registry,
  });
  const second = reconcileTranslationPlanningBatchConsistency({
    content: '- “撥水加工”本地化为“水滴をはじく加工”\n- “上質な質感”本地化为“上品な風合い”\n- “ABC-1200”保持不变',
    registry,
  });

  assert.equal(first, '- “撥水加工”本地化为“水をはじく撥水仕様”');
  assert.equal(second, [
    '- “撥水加工”本地化为“水をはじく撥水仕様”',
    '- “上質な質感”本地化为“上品な風合い”',
    '- “ABC-1200”保持不变',
  ].join('\n'));
});

test('batch reconciliation normalizes harmless source whitespace but does not merge similar copy', () => {
  const registry = new Map();
  reconcileTranslationPlanningBatchConsistency({
    content: '- “撥水  加工”本地化为“水をはじく撥水仕様”',
    registry,
  });

  assert.equal(
    reconcileTranslationPlanningBatchConsistency({
      content: '- “撥水 加工”本地化为“別の表現”\n- “水滴をはじく撥水加工”本地化为“水滴をはじきやすい撥水仕様”',
      registry,
    }),
    [
      '- “撥水 加工”本地化为“水をはじく撥水仕様”',
      '- “水滴をはじく撥水加工”本地化为“水滴をはじきやすい撥水仕様”',
    ].join('\n'),
  );
});

test('target-language validation accepts localized copy using the expected writing system', () => {
  const cases = [
    ['Japanese', '- “食卓を整える”本地化为“食卓を上品に演出します”'],
    ['Korean', '- “주방 정리”本地化为“주방을 깔끔하게 정리해요”'],
    ['Russian', '- “Удобный дизайн”本地化为“Практичный дизайн для дома”'],
    ['Thai', '- “ใช้งานง่าย”本地化为“ใช้งานง่าย เหมาะกับทุกวัน”'],
    ['German', '- “Wasserfest”本地化为“Wasserabweisend und alltagstauglich”'],
  ];

  for (const [targetLanguage, content] of cases) {
    assert.deepEqual(
      validateTranslationPlanningTargetLanguage({ content, targetLanguage }),
      { valid: true, reason: '', mappingCount: 1 },
      targetLanguage,
    );
  }
});

test('target-language validation rejects a clear conflicting writing system', () => {
  const cases = [
    ['Japanese', '- “食卓を整える”本地化为“只需一张，餐桌氛围更有格调”'],
    ['Korean', '- “주방 정리”本地化为“厨房收纳更整洁”'],
    ['Russian', '- “Удобный дизайн”本地化为“Convenient design for home”'],
    ['Thai', '- “ใช้งานง่าย”本地化为“Easy to use every day”'],
    ['English', '- “Water resistant”本地化为“防泼水，更适合日常使用”'],
  ];

  for (const [targetLanguage, content] of cases) {
    const result = validateTranslationPlanningTargetLanguage({ content, targetLanguage });
    assert.equal(result.valid, false, targetLanguage);
    assert.equal(result.mappingCount, 1, targetLanguage);
    assert.match(result.reason, /目标语言|文字体系/);
  }
});

test('same-language copy still passes when it is naturally localized', () => {
  const result = validateTranslationPlanningTargetLanguage({
    targetLanguage: 'Japanese',
    content: '- “落ち着いた色合いと、表情のあるデザイン。”本地化为“落ち着きのある色合いと、表情豊かなデザイン。”',
  });

  assert.deepEqual(result, { valid: true, reason: '', mappingCount: 1 });
});

test('validation conservatively accepts ambiguous short shared copy and custom languages', () => {
  const cases = [
    ['Japanese', '- “品質”本地化为“高級感”'],
    ['Japanese', '- “画像品質”本地化为“高画質”\n- “価格”本地化为“一万円”'],
    ['English', '- “Model”本地化为“X200”'],
    ['CUSTOM', '- “Original”本地化为“Localized copy”'],
    ['Italian', '- “Logo”本地化为“MEIAO”'],
  ];

  for (const [targetLanguage, content] of cases) {
    assert.equal(
      validateTranslationPlanningTargetLanguage({ content, targetLanguage }).valid,
      true,
      targetLanguage,
    );
  }
});

test('validation preserves existing behavior when planning has no replacement mappings', () => {
  assert.deepEqual(
    validateTranslationPlanningTargetLanguage({
      targetLanguage: 'Japanese',
      content: '- “产品主体/包装实物表面的原文案”保持不变',
    }),
    { valid: true, reason: '', mappingCount: 0 },
  );
});

test('planning guard retries one language mismatch and accumulates planning credits', async () => {
  const calls = [];
  const responses = [
    {
      content: '- “주방 정리”本地化为“厨房收纳更整洁”',
      creditsConsumed: 2,
      taskId: 'planning-wrong',
    },
    {
      content: '- “주방 정리”本地化为“주방을 깔끔하게 정리해요”',
      creditsConsumed: 3,
      taskId: 'planning-corrected',
    },
  ];

  const result = await runTranslationPlanningWithLanguageGuard({
    targetLanguage: 'Korean',
    request: async ({ attempt, correction }) => {
      calls.push({ attempt, correction });
      return responses[attempt];
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { attempt: 0, correction: '' });
  assert.equal(calls[1].attempt, 1);
  assert.match(calls[1].correction, /目标语言|重新/);
  assert.equal(result.content, responses[1].content);
  assert.equal(result.creditsConsumed, 5);
  assert.equal(result.taskId, 'planning-corrected');
  assert.deepEqual(result.taskIds, ['planning-wrong', 'planning-corrected']);
});

test('planning guard throws after two clear language mismatches', async () => {
  let calls = 0;

  await assert.rejects(
    () => runTranslationPlanningWithLanguageGuard({
      targetLanguage: 'Russian',
      request: async () => {
        calls += 1;
        return {
          content: '- “Удобный дизайн”本地化为“Convenient design for home”',
          creditsConsumed: 1,
          taskId: `planning-${calls}`,
        };
      },
    }),
    (error) => {
      assert.equal(error.code, 'translation_target_language_mismatch');
      assert.equal(error.creditsConsumed, 2);
      assert.deepEqual(error.taskIds, ['planning-1', 'planning-2']);
      assert.match(error.message, /目标语言/);
      return true;
    },
  );

  assert.equal(calls, 2);
});

test('planning guard does not retry valid planning content', async () => {
  let calls = 0;
  const result = await runTranslationPlanningWithLanguageGuard({
    targetLanguage: 'Thai',
    request: async () => {
      calls += 1;
      return {
        content: 'commentary\n- “ใช้งานง่าย”本地化为“ใช้งานง่าย เหมาะกับทุกวัน”\nfinal_answer',
        creditsConsumed: 4,
        taskId: 'planning-valid',
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.content, '- “ใช้งานง่าย”本地化为“ใช้งานง่าย เหมาะกับทุกวัน”');
  assert.equal(result.creditsConsumed, 4);
  assert.deepEqual(result.taskIds, ['planning-valid']);
});
