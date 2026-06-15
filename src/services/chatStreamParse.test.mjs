import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChatSseChunk } from './chatStreamParse.ts';

test('解析多条 data 行为事件数组', () => {
  const chunk = 'data: {"type":"streaming","delta":"你"}\n\ndata: {"type":"streaming","delta":"好"}\n\n';
  const events = parseChatSseChunk(chunk);
  assert.equal(events.length, 2);
  assert.equal(events[0].delta, '你');
  assert.equal(events[1].delta, '好');
});

test('忽略不完整的尾块(留待下次拼接)', () => {
  const { events, rest } = parseChatSseChunk('data: {"type":"streaming","delta":"半', { withRest: true });
  assert.equal(events.length, 0);
  assert.ok(rest.length > 0);
});
