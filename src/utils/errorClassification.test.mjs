import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecoverableError } from './errorClassification.mjs';

test('providerStatus=recoverable_pending_result → 可恢复', () => {
  assert.equal(isRecoverableError({ providerStatus: 'recoverable_pending_result' }), true);
});

test('不可恢复错误码 → 不可恢复(即使 message 像网络错)', () => {
  assert.equal(isRecoverableError({ errorCode: 'provider_credit_insufficient', message: 'fetch failed' }), false);
});

test('可恢复错误码 → 可恢复', () => {
  assert.equal(isRecoverableError({ errorCode: 'provider_timeout' }), true);
  assert.equal(isRecoverableError({ errorCode: 'provider_network_error' }), true);
});

test('无错误码时退到 message 正则(过渡期)', () => {
  assert.equal(isRecoverableError({ message: '网络连接失败' }), true);
  assert.equal(isRecoverableError({ message: '余额不足' }), false);
});

test('空输入 → 不可恢复', () => {
  assert.equal(isRecoverableError({}), false);
});
