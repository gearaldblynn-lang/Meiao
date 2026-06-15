import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChatSseEvent } from './chatStreaming.mjs';

test('SSE 事件格式正确(data 前缀 + 双换行结尾)', () => {
  const line = formatChatSseEvent('streaming', { delta: '你好' });
  assert.match(line, /^data: /);
  assert.match(line, /\n\n$/);
  assert.deepEqual(JSON.parse(line.replace(/^data: /, '').trim()), { type: 'streaming', delta: '你好' });
});

test('compressed 事件携带折叠轮数', () => {
  const line = formatChatSseEvent('compressed', { foldedRounds: 12 });
  assert.deepEqual(JSON.parse(line.replace(/^data: /, '').trim()), { type: 'compressed', foldedRounds: 12 });
});
