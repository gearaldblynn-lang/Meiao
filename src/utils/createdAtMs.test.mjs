import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coerceCreatedAtMs } from './createdAtMs.ts';

const LOWER = new Date('2020-01-01T00:00:00Z').getTime();

test('数字毫秒戳直采,precise', () => {
  const ms = LOWER + 1000;
  assert.deepEqual(coerceCreatedAtMs(ms), { ms, precise: true });
});

test('数字字符串戳直采,precise', () => {
  const ms = LOWER + 5000;
  assert.deepEqual(coerceCreatedAtMs(String(ms)), { ms, precise: true });
});

test('id 含 13 位毫秒戳可抠出,precise', () => {
  const ms = LOWER + 9999;
  const r = coerceCreatedAtMs('06-13', { id: `proj-${ms}` });
  assert.equal(r.ms, ms);
  assert.equal(r.precise, true);
});

test('"06-13" 无 id 戳,解析为当年月日但 precise=false', () => {
  const r = coerceCreatedAtMs('06-13', { id: 'legacy-abc' });
  assert.equal(r.precise, false);
  assert.equal(new Date(r.ms).getMonth(), 5); // 6月=index5
  assert.equal(new Date(r.ms).getDate(), 13);
});

test('"6月13日" 中文同理,precise=false', () => {
  const r = coerceCreatedAtMs('6月13日', { id: 'cn-y' });
  assert.equal(r.precise, false);
  assert.equal(new Date(r.ms).getMonth(), 5);
});

test('啥都没有退 updatedAt,precise=false', () => {
  const up = LOWER + 7777;
  const r = coerceCreatedAtMs(undefined, { id: 'noinfo', updatedAt: up });
  assert.equal(r.precise, false);
  assert.equal(r.ms, new Date(up).setHours(0, 0, 0, 0));
});

test('全垃圾 → ms 0 precise false', () => {
  assert.deepEqual(coerceCreatedAtMs('garbage', { id: 'x' }), { ms: 0, precise: false });
});
