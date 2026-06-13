import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatMonthDay } from './timeFormat.ts';

test('formatMonthDay 与旧 toDateLabel 同款 MM-DD', () => {
  const ms = new Date('2026-06-13T10:00:00').getTime();
  const expected = new Date(ms).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
  assert.equal(formatMonthDay(ms), expected);
});

test('formatMonthDay 空值给空串', () => {
  assert.equal(formatMonthDay(0), '');
  assert.equal(formatMonthDay(null), '');
  assert.equal(formatMonthDay(undefined), '');
});

test('formatTime 完整日期时间', () => {
  const ms = new Date('2026-06-13T10:00:00').getTime();
  const expected = new Date(ms).toLocaleString('zh-CN', { hour12: false });
  assert.equal(formatTime(ms), expected);
});

test('formatTime 空值给占位', () => {
  assert.equal(formatTime(0), '-');
  assert.equal(formatTime(null), '-');
});
