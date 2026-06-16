import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getModelCapability, MODEL_CAPABILITIES } from './modelCapabilities.mjs';

test('已登记模型返回其官方上下文能力', () => {
  const cap = getModelCapability('claude-sonnet-4-6');
  assert.equal(cap.contextWindowTokens, 1000000);
  assert.equal(cap.maxOutputTokens, 64000);
  assert.equal(cap.supportsStreaming, true);
});

test('gpt-5-4 上下文为官方 1M / 输出 128K', () => {
  const cap = getModelCapability('gpt-5-4-openai-resp');
  assert.equal(cap.contextWindowTokens, 1000000);
  assert.equal(cap.maxOutputTokens, 128000);
});

test('未登记模型返回保守默认(小窗口,不假设流式)', () => {
  const cap = getModelCapability('some-unknown-model');
  assert.ok(cap.contextWindowTokens <= 128000, '默认窗口应保守');
  assert.equal(cap.supportsStreaming, false, '未知模型不假设支持流式');
  assert.equal(cap.isFallbackDefault, true);
});

test('能力表至少登记本期五个对话模型', () => {
  assert.deepEqual(Object.keys(MODEL_CAPABILITIES).sort(), [
    'claude-sonnet-4-6',
    'gemini-3-5-flash',
    'gemini-3-flash-openai',
    'gemini-3.1-pro-openai',
    'gpt-5-4-openai-resp',
    'gpt-5.4',
    'gpt-5.5',
  ]);
});

test('gpt-5.4 登记为支持 tool use 的百万上下文模型', () => {
  const cap = getModelCapability('gpt-5.4');
  assert.equal(cap.supportsToolUse, true);
  assert.equal(cap.isFallbackDefault, false);
  assert.ok(cap.contextWindowTokens >= 200000);
});

test('gpt-5.5 同样支持 tool use', () => {
  const cap = getModelCapability('gpt-5.5');
  assert.equal(cap.supportsToolUse, true);
  assert.equal(cap.isFallbackDefault, false);
});
