import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_KNOWLEDGE_TOOL, normalizeSearchKnowledgeArgs } from './knowledgeToolDefinition.mjs';

test('tool 定义符合 chat function 格式（后续由 toResponsesTool 转扁平）', () => {
  assert.equal(SEARCH_KNOWLEDGE_TOOL.type, 'function');
  assert.equal(SEARCH_KNOWLEDGE_TOOL.function.name, 'search_knowledge');
  assert.ok(SEARCH_KNOWLEDGE_TOOL.function.parameters.properties.query);
  assert.deepEqual(SEARCH_KNOWLEDGE_TOOL.function.parameters.required, ['query']);
});

test('规范化: 取 query 字符串', () => {
  assert.equal(normalizeSearchKnowledgeArgs({ query: '  退货流程 ' }).query, '退货流程');
});

test('规范化: 缺 query 抛错', () => {
  assert.throws(() => normalizeSearchKnowledgeArgs({}), /query/);
});

