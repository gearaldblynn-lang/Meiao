import test from 'node:test';
import assert from 'node:assert/strict';

import { isFrontendResourceError } from './frontendResourceError.mjs';

// 根因 #5 的护栏:前端资源/chunk 加载失败,绝不能被当成业务任务失败。
// 这个纯函数是分流两类错误的唯一判据。

test('flags a failed dynamic import (stale chunk 404) as a frontend resource error', () => {
  const error = new Error('Failed to fetch dynamically imported module: https://app/assets/shellWorkflow-CYJkx3HQ.js');
  assert.equal(isFrontendResourceError(error), true);
});

test('flags module-script load failures as frontend resource errors', () => {
  assert.equal(isFrontendResourceError(new Error('Importing a module script failed')), true);
  assert.equal(isFrontendResourceError(new Error('error loading dynamically imported module')), true);
});

test('does NOT flag a genuine business failure as a resource error', () => {
  assert.equal(isFrontendResourceError(new Error('策划没有返回可用方案')), false);
});

test('does NOT flag an upstream provider failure as a resource error', () => {
  assert.equal(isFrontendResourceError(new Error('provider_bad_request')), false);
});

test('handles non-Error inputs without throwing', () => {
  assert.equal(isFrontendResourceError('Failed to fetch dynamically imported module: /a.js'), true);
  assert.equal(isFrontendResourceError(null), false);
  assert.equal(isFrontendResourceError(undefined), false);
});
