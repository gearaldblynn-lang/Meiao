import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFY_TOOL_SOURCE_NOTICE,
  convertToolMessagesToObservation,
  createKnowledgeSearchToolDefinition,
  normalizeToolParameters,
} from './toolContract.mjs';

test('tool contract preserves Dify source metadata', () => {
  assert.equal(DIFY_TOOL_SOURCE_NOTICE.commit, '599d92ef6b59adcaffc82f5231391749fa1ef94c');
  assert.ok(DIFY_TOOL_SOURCE_NOTICE.paths.includes('dify-agent/src/dify_agent/layers/knowledge/layer.py'));
  assert.ok(DIFY_TOOL_SOURCE_NOTICE.paths.includes('dify-agent/src/dify_agent/layers/dify_plugin/tools_layer.py'));
});

test('knowledge search tool exposes only query to the model', () => {
  assert.deepEqual(createKnowledgeSearchToolDefinition(), {
    type: 'function',
    name: 'knowledge_base_search',
    description: 'Search configured knowledge bases for information relevant to the query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for the configured knowledge bases.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  });
});

test('normalizes tool parameters using Dify precedence', () => {
  const result = normalizeToolParameters({
    effectiveParameters: [
      { name: 'query', type: 'string', form: 'llm', required: true },
      { name: 'limit', type: 'number', form: 'llm', required: false, default: 10 },
      { name: 'sheet_id', type: 'string', form: 'form', required: true },
      { name: 'append', type: 'boolean', form: 'llm', required: false, default: false },
    ],
    runtimeParameters: { sheet_id: 'sheet-1', limit: 5 },
    toolArguments: { query: '售后订单', limit: 3, append: true },
  });

  assert.deepEqual(result, {
    query: '售后订单',
    limit: 3,
    sheet_id: 'sheet-1',
    append: true,
  });
});

test('rejects required hidden parameters without runtime values', () => {
  assert.throws(
    () => normalizeToolParameters({
      effectiveParameters: [
        { name: 'token', type: 'secret-input', form: 'form', required: true },
      ],
      runtimeParameters: {},
      toolArguments: {},
      toolName: 'feishu_create_sheet',
    }),
    /requires non-LLM runtime_parameters for: token/
  );
});

test('converts tool messages into model-friendly observation text', () => {
  const observation = convertToolMessagesToObservation([
    { type: 'text', message: { text: '创建成功' } },
    { type: 'json', message: { json_object: { sheetId: 'sheet-1' } } },
    { type: 'link', message: { text: 'https://feishu.example/sheet-1' } },
    { type: 'image_link', message: { text: 'https://image.example/result.png' } },
    { type: 'json', message: { json_object: { hidden: true }, suppress_output: true } },
  ]);

  assert.match(observation, /创建成功/);
  assert.match(observation, /"sheetId": "sheet-1"/);
  assert.match(observation, /result link: https:\/\/feishu\.example\/sheet-1/);
  assert.match(observation, /image has been created and sent to user already/);
  assert.doesNotMatch(observation, /hidden/);
});
