import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOpenAIToolCallingJob,
  parseToolCallsFromChoice,
  runOpenAIToolCallingStream,
  accumulateToolCallDeltas,
} from './openaiToolCalling.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const mockEnv = {
  OPENAI_COMPATIBLE_API_KEY: 'sk-test',
  OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test',
  OPENAI_COMPATIBLE_MODELS: 'gpt-5.4,gpt-5.5',
};

test('parseToolCallsFromChoice 提取 tool_calls', () => {
  const choice = {
    finish_reason: 'tool_calls',
    message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"猫","task_type":"new_image"}' } }] },
  };
  const calls = parseToolCallsFromChoice(choice);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'generate_image');
  assert.deepEqual(calls[0].args, { prompt: '猫', task_type: 'new_image' });
});

test('parseToolCallsFromChoice 容忍坏 JSON（跳过该 call）', () => {
  const choice = { message: { tool_calls: [{ id: 'c1', function: { name: 'generate_image', arguments: '{坏的' } }] } };
  const calls = parseToolCallsFromChoice(choice);
  assert.equal(calls.length, 0);
});

test('非流式：返回文本（finish_reason=stop）', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '你好' } }],
  }), { status: 200 });
  const out = await runOpenAIToolCallingJob({
    payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] },
    env: mockEnv,
  });
  assert.equal(out.content, '你好');
  assert.deepEqual(out.toolCalls, []);
  assert.equal(out.finishReason, 'stop');
});

test('非流式：返回 tool_calls（finish_reason=tool_calls）', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'c1', function: { name: 'generate_image', arguments: '{"prompt":"猫","task_type":"new_image"}' } }] } }],
  }), { status: 200 });
  const out = await runOpenAIToolCallingJob({
    payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: '画猫' }], tools: [{ type: 'function', function: { name: 'generate_image' } }] },
    env: mockEnv,
  });
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.finishReason, 'tool_calls');
});

test('未配 API key 抛错', async () => {
  await assert.rejects(
    runOpenAIToolCallingJob({ payload: { model: 'gpt-5.4', messages: [] }, env: {} }),
    /API.?KEY|未配置/i
  );
});

test('模型不在白名单抛错', async () => {
  await assert.rejects(
    runOpenAIToolCallingJob({ payload: { model: 'gpt-9', messages: [] }, env: mockEnv }),
    /不支持|白名单|allowed/i
  );
});

test('请求体含 tools 参数', async () => {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }), { status: 200 });
  };
  await runOpenAIToolCallingJob({
    payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function', function: { name: 'generate_image' } }], toolChoice: 'auto' },
    env: mockEnv,
  });
  assert.ok(Array.isArray(captured.tools));
  assert.equal(captured.tool_choice, 'auto');
});

const sseResponse = (chunks) => new Response(
  new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
);

test('accumulateToolCallDeltas 按 index 拼装分片 arguments', () => {
  const acc = new Map();
  accumulateToolCallDeltas(acc, [{ index: 0, id: 'c1', function: { name: 'generate_image', arguments: '{"prom' } }]);
  accumulateToolCallDeltas(acc, [{ index: 0, function: { arguments: 'pt":"猫"}' } }]);
  const result = Array.from(acc.values());
  assert.equal(result[0].function.name, 'generate_image');
  assert.equal(result[0].function.arguments, '{"prompt":"猫"}');
});

test('流式：文本 delta 逐个回调 onDelta，最终拼成完整内容', async () => {
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const deltas = [];
  const out = await runOpenAIToolCallingStream({
    payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] },
    env: mockEnv,
    onDelta: (delta) => deltas.push(delta),
  });
  assert.deepEqual(deltas, ['你', '好']);
  assert.equal(out.content, '你好');
  assert.equal(out.finishReason, 'stop');
});

test('流式：tool_calls 分片累积，finishReason=tool_calls', async () => {
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"generate_image","arguments":"{\\"prompt"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\":\\"猫\\",\\"task_type\\":\\"new_image\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const out = await runOpenAIToolCallingStream({
    payload: { model: 'gpt-5.4', messages: [], tools: [{ type: 'function', function: { name: 'generate_image' } }] },
    env: mockEnv,
    onDelta: () => {},
  });
  assert.equal(out.finishReason, 'tool_calls');
  assert.equal(out.toolCalls.length, 1);
  assert.deepEqual(out.toolCalls[0].args, { prompt: '猫', task_type: 'new_image' });
});
