import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextLimits } from './contextPlan.mjs';

test('用户显式配置优先于自适应', () => {
  const r = resolveContextLimits({
    modelId: 'claude-sonnet-4-6',
    contextPolicy: { maxHistoryRounds: 3, summaryTriggerThreshold: 4, maxSummaryChars: 500 },
  });
  assert.equal(r.maxHistoryRounds, 3);
  assert.equal(r.summaryTriggerThreshold, 4);
  assert.equal(r.maxSummaryChars, 500);
});

test('用户没配时,1M 上下文模型给出比旧写死值(6/10)更大的历史保留', () => {
  const r = resolveContextLimits({ modelId: 'claude-sonnet-4-6', contextPolicy: {} });
  assert.ok(r.maxHistoryRounds > 6, '长上下文模型应保留远多于 6 轮');
  assert.ok(r.summaryTriggerThreshold > 10);
  assert.equal(r.maxOutputTokens, 64000, 'maxOutputTokens 应来自能力表,不再写死 4096');
});

test('未登记模型走保守默认(不超过旧写死值太多)', () => {
  const r = resolveContextLimits({ modelId: 'unknown', contextPolicy: {} });
  assert.ok(r.maxHistoryRounds >= 6, '至少不低于旧默认');
  assert.ok(r.maxOutputTokens <= 4096);
});

test('部分配置:只配了 maxHistoryRounds,其余仍自适应', () => {
  const r = resolveContextLimits({
    modelId: 'gpt-5-4-openai-resp',
    contextPolicy: { maxHistoryRounds: 5 },
  });
  assert.equal(r.maxHistoryRounds, 5);
  assert.equal(r.maxOutputTokens, 128000);
});
