import test from 'node:test';
import assert from 'node:assert/strict';

import { humanizeProviderError } from './providerErrorHumanize.mjs';

test('provider_network_error 映射为网络不稳人话，detail 保留技术原文', () => {
  const { message, detail } = humanizeProviderError({
    code: 'provider_network_error',
    message: 'fetch failed',
    providerStage: 'create_task',
  });
  assert.equal(message, '服务器到生成服务的网络暂时不稳，已自动重试仍未成功，请稍后重试');
  assert.equal(detail, 'fetch failed');
});

test('provider_timeout 映射为超时人话', () => {
  const { message, detail } = humanizeProviderError({
    code: 'provider_timeout',
    message: 'Kie 请求超时',
  });
  assert.equal(message, '生成服务响应超时，请稍后重试');
  assert.equal(detail, 'Kie 请求超时');
});

test('provider_internal_error 映射为服务异常人话', () => {
  const { message } = humanizeProviderError({
    code: 'provider_internal_error',
    message: 'Gemini chat (OpenAI format) responseCode error: 504',
  });
  assert.equal(message, '生成服务暂时异常，请稍后重试');
});

test('provider_internal_error 带 cpu overloaded 原文时映射为上游过载人话', () => {
  const { message, detail } = humanizeProviderError({
    code: 'provider_internal_error',
    message: 'cpu overloaded, please try again later',
  });
  assert.equal(message, '生成服务当前繁忙（上游过载），请稍后重试');
  assert.equal(detail, 'cpu overloaded, please try again later');
});

test('provider_internal_error 带 Concurrency limit 原文时映射为上游过载人话', () => {
  const { message } = humanizeProviderError({
    code: 'provider_internal_error',
    message: 'Concurrency limit exceeded (503)',
  });
  assert.equal(message, '生成服务当前繁忙（上游过载），请稍后重试');
});

test('provider_credit_insufficient 映射为余额不足人话', () => {
  const { message } = humanizeProviderError({
    code: 'provider_credit_insufficient',
    message: 'credits insufficient',
  });
  assert.equal(message, '生成服务余额不足，请联系管理员充值');
});

test('asset_upload 阶段的传输类错误统一映射为素材上传人话', () => {
  for (const code of ['provider_network_error', 'provider_timeout', 'provider_internal_error']) {
    const { message, detail } = humanizeProviderError({
      code,
      message: 'fetch failed',
      providerStage: 'asset_upload',
    });
    assert.equal(message, '素材上传到生成服务失败，请稍后重试或压缩素材');
    assert.equal(detail, 'fetch failed');
  }
});

test('asset_download 阶段的传输类错误统一映射为素材下载人话', () => {
  const { message } = humanizeProviderError({
    code: 'provider_network_error',
    message: 'fetch failed',
    providerStage: 'asset_download',
  });
  assert.equal(message, '从生成服务下载素材失败，请稍后重试');
});

test('provider_bad_request 中文原文直接透传（已是人话）', () => {
  const raw = 'Seedance API 带参考视频时，参考视频合计时长不能超过 15 秒。请先裁短参考视频后重试。';
  const { message, detail } = humanizeProviderError({
    code: 'provider_bad_request',
    message: raw,
  });
  assert.equal(message, raw);
  assert.equal(detail, raw);
});

test('provider_bad_request 英文原文包成人话并附技术原因', () => {
  const { message, detail } = humanizeProviderError({
    code: 'provider_bad_request',
    message: 'invalid image format',
  });
  assert.match(message, /生成服务无法处理本次请求/);
  assert.match(message, /invalid image format/);
  assert.equal(detail, 'invalid image format');
});

test('provider_refusal 英文原文映射为拒绝人话', () => {
  const { message } = humanizeProviderError({
    code: 'provider_refusal',
    message: 'I cannot help with that request.',
  });
  assert.match(message, /生成服务拒绝了本次生成请求/);
});

test('request_cancelled 保留原文不改写', () => {
  const { message } = humanizeProviderError({
    code: 'request_cancelled',
    message: '任务已取消',
  });
  assert.equal(message, '任务已取消');
});

test('未知 code 落兜底人话并附原文，不丢技术信息', () => {
  const { message, detail } = humanizeProviderError({
    code: 'some_future_code',
    message: 'weird upstream explosion',
  });
  assert.match(message, /任务执行失败，请稍后重试/);
  assert.match(message, /weird upstream explosion/);
  assert.equal(detail, 'weird upstream explosion');
});

test('空错误对象也能给出非空人话', () => {
  const { message, detail } = humanizeProviderError(null);
  assert.ok(message.length > 0);
  assert.equal(detail, '');
});

test('超长原文附注被截断但 detail 完整保留', () => {
  const raw = `boom ${'x'.repeat(500)}`;
  const { message, detail } = humanizeProviderError({ code: 'provider_bad_request', message: raw });
  assert.ok(message.length < 300);
  assert.equal(detail, raw);
});
