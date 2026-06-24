import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_SSE_HEARTBEAT_INTERVAL_MS,
  formatChatSseEvent,
  formatChatSseHeartbeat,
  getChatSseHeartbeatIntervalMs,
} from './chatStreaming.mjs';

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

test('SSE 心跳使用注释帧，客户端解析器会忽略但代理不会判定空闲', () => {
  assert.equal(formatChatSseHeartbeat(), ': keep-alive\n\n');
});

test('SSE 心跳间隔支持 env 配置并有保守默认', () => {
  assert.equal(getChatSseHeartbeatIntervalMs({}), DEFAULT_CHAT_SSE_HEARTBEAT_INTERVAL_MS);
  assert.equal(getChatSseHeartbeatIntervalMs({ MEIAO_CHAT_SSE_HEARTBEAT_MS: '5000' }), 5000);
  assert.equal(getChatSseHeartbeatIntervalMs({ MEIAO_CHAT_SSE_HEARTBEAT_MS: '100' }), DEFAULT_CHAT_SSE_HEARTBEAT_INTERVAL_MS);
  assert.equal(getChatSseHeartbeatIntervalMs({ MEIAO_CHAT_SSE_HEARTBEAT_MS: 'bad' }), DEFAULT_CHAT_SSE_HEARTBEAT_INTERVAL_MS);
});
