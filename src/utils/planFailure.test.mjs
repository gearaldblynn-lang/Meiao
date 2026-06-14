import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlanFailed, getPlanContent } from './planFailure.mjs';

test('结构化标志优先:planningFailed=true 即失败', () => {
  assert.equal(isPlanFailed({ planningFailed: true, schemeContent: '一切正常' }), true);
});

test('结构化:status=error 即失败', () => {
  assert.equal(isPlanFailed({ status: 'error' }), true);
});

test('结构化:有 errorCode 即失败', () => {
  assert.equal(isPlanFailed({ errorCode: 'planning_failed' }), true);
});

test('干净成功方案:不失败', () => {
  assert.equal(isPlanFailed({ schemeContent: '黑色丝绒礼盒,突出质感' }), false);
});

test('过渡期兜底:仅文本含"策划失败"也判失败', () => {
  assert.equal(isPlanFailed({ schemeContent: 'SKU方案策划失败' }), true);
});

test('过渡期兜底:fetch failed 文本', () => {
  assert.equal(isPlanFailed({ error: 'fetch failed' }), true);
});

test('getPlanContent 取首个非空内容字段并 trim', () => {
  assert.equal(getPlanContent({ schemeContent: '  abc  ' }), 'abc');
  assert.equal(getPlanContent({ title: 'fallback' }), 'fallback');
  assert.equal(getPlanContent({}), '');
});
