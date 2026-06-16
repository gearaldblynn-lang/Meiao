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

test('解析生图工具调用进度事件', () => {
  const chunk = [
    'data: {"type":"tool_calling","tool":"generate_image","args":{"prompt":"商品主图"}}',
    'data: {"type":"image_generating","model":"gpt-image-2","phase":"submit"}',
    'data: {"type":"image_ready","imageUrl":"https://img.example/result.png","imagePlan":{"taskType":"new_image"}}',
    '',
  ].join('\n\n');
  const events = parseChatSseChunk(chunk);
  assert.deepEqual(events.map((event) => event.type), ['tool_calling', 'image_generating', 'image_ready']);
  assert.equal(events[0].tool, 'generate_image');
  assert.equal(events[1].model, 'gpt-image-2');
  assert.equal(events[2].imageUrl, 'https://img.example/result.png');
});
