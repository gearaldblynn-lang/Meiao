import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponsesOutput, runResponsesJob, toResponsesTool } from './openaiResponsesProvider.mjs';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = {
  OPENAI_COMPATIBLE_API_KEY: 'sk-t',
  OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test',
  OPENAI_COMPATIBLE_MODELS: 'gpt-5.4',
};

test('toResponsesTool: chat 嵌套 function -> responses 扁平 function', () => {
  const chatTool = { type: 'function', function: { name: 'generate_image', description: 'd', parameters: { type: 'object' } } };
  const tool = toResponsesTool(chatTool);
  assert.equal(tool.type, 'function');
  assert.equal(tool.name, 'generate_image');
  assert.equal(tool.description, 'd');
  assert.deepEqual(tool.parameters, { type: 'object' });
});

test('toResponsesTool: web_search 原样透传', () => {
  assert.deepEqual(toResponsesTool({ type: 'web_search' }), { type: 'web_search' });
});

test('parseResponsesOutput 提取 message 文本', () => {
  const out = parseResponsesOutput({
    output: [{ type: 'message', content: [{ type: 'output_text', text: '你好' }] }],
    usage: { input_tokens: 5, output_tokens: 2 },
  });
  assert.equal(out.content, '你好');
  assert.deepEqual(out.toolCalls, []);
  assert.equal(out.finishReason, 'stop');
  assert.deepEqual(out.usage, { input_tokens: 5, output_tokens: 2 });
});

test('parseResponsesOutput 提取 function_call', () => {
  const out = parseResponsesOutput({
    output: [
      { type: 'function_call', id: 'fc_1', name: 'generate_image', arguments: '{"prompt":"猫","task_type":"new_image"}', call_id: 'c1', status: 'completed' },
    ],
  });
  assert.equal(out.toolCalls.length, 1);
  assert.equal(out.toolCalls[0].name, 'generate_image');
  assert.deepEqual(out.toolCalls[0].args, { prompt: '猫', task_type: 'new_image' });
  assert.equal(out.toolCalls[0].id, 'c1');
  assert.deepEqual(out.toolCalls[0].responseItem, {
    type: 'function_call',
    id: 'fc_1',
    name: 'generate_image',
    arguments: '{"prompt":"猫","task_type":"new_image"}',
    call_id: 'c1',
    status: 'completed',
  });
  assert.equal(out.finishReason, 'tool_calls');
});

test('parseResponsesOutput 坏 JSON 跳过该 call', () => {
  const out = parseResponsesOutput({
    output: [{ type: 'function_call', name: 'x', arguments: '{坏', call_id: 'c1' }],
  });
  assert.equal(out.toolCalls.length, 0);
});

test('非流式请求体走 responses 格式（input 数组 + 扁平 tools）', async () => {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
  };
  await runResponsesJob({
    payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'web_search' }] },
    env,
  });
  assert.match(captured.url, /\/v1\/responses$/);
  assert.ok(Array.isArray(captured.body.input));
  assert.equal(captured.body.input[0].role, 'user');
  assert.deepEqual(captured.body.tools[0], { type: 'web_search' });
});

test('非流式请求体把 chat 多模态图片 content 转成 responses input_image', async () => {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    void url;
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
  };
  await runResponsesJob({
    payload: {
      model: 'gpt-5.4',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } },
        ],
      }],
    },
    env,
  });
  assert.equal(captured.input[0].content[0].type, 'input_text');
  assert.equal(captured.input[0].content[0].text, '看这张图');
  assert.equal(captured.input[0].content[1].type, 'input_image');
  assert.equal(captured.input[0].content[1].image_url, 'https://example.com/a.jpg');
  assert.doesNotMatch(JSON.stringify(captured.input), /"type":"image_url"/);
});

test('非流式请求体透传 reasoning effort', async () => {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    void url;
    captured = JSON.parse(init.body);
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
  };
  await runResponsesJob({
    payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }], reasoningLevel: 'high' },
    env,
  });
  assert.deepEqual(captured.reasoning, { effort: 'high' });
});

test('未配 key 抛错', async () => {
  await assert.rejects(runResponsesJob({ payload: { model: 'gpt-5.4', messages: [] }, env: {} }), /API.?KEY|未配置/i);
});
