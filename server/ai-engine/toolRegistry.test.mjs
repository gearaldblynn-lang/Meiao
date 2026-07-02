import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSmartFactoryToolRegistry, toRuntimeCliTools } from './toolRegistry.mjs';

test('normalizes safe enabled CLI tools and hides dangerous tools', () => {
  const registry = normalizeSmartFactoryToolRegistry([
    { name: ' feishu_create_sheet ', type: 'cli', enabled: true, riskLevel: 'safe', executorRef: 'feishu.create_sheet' },
    { name: 'rm_all', type: 'cli', enabled: true, riskLevel: 'dangerous', executorRef: 'shell.rm' },
    { name: '', type: 'cli' },
  ]);

  assert.deepEqual(registry.map((item) => item.name), ['feishu_create_sheet']);
  assert.equal(JSON.stringify(registry).includes('rm_all'), false);
});

test('converts registry tools to runtime cli tool declarations', () => {
  const tools = toRuntimeCliTools([
    {
      name: 'feishu_create_sheet',
      type: 'cli',
      description: '创建飞书表格',
      enabled: true,
      riskLevel: 'safe',
      executorRef: 'feishu.create_sheet',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  ]);

  assert.equal(tools[0].name, 'feishu_create_sheet');
  assert.equal(tools[0].authorization_status, 'authorized');
  assert.equal(tools[0].risk_level, 'safe');
  assert.deepEqual(tools[0].invoke_metadata.parameters.required, ['title']);
});
