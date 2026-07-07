import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentCenterSyncPlan,
  buildSmartFactoryLinkMarker,
  findLinkedAgentCenterAgent,
} from './smartFactoryAgentBridge.mjs';

const factoryConfig = {
  knowledgeBases: [
    {
      id: 'kb-1',
      name: '售后规则',
      documents: [
        { title: '退货规则', content: '签收后7天内可退货。', sourceType: 'text' },
        { title: '空文档', content: '', sourceType: 'text' },
      ],
    },
    {
      id: 'kb-2',
      name: '未绑定库',
      documents: [{ title: '不该出现', content: '内容', sourceType: 'text' }],
    },
  ],
};

const factoryAgent = {
  id: 'agent-after-sale',
  name: '售后智能体',
  description: '处理售后问题',
  prompt: '你是售后智能体,优先使用知识库。',
  model: { provider: 'openai_compatible', model: 'gpt-5.5' },
  knowledgeBaseIds: ['kb-1'],
};

test('buildAgentCenterSyncPlan maps prompt/model/bound knowledge into a materialization plan', () => {
  const plan = buildAgentCenterSyncPlan({ factoryAgent, factoryConfig });

  assert.equal(plan.factoryAgentId, 'agent-after-sale');
  assert.equal(plan.agentPayload.name, '售后智能体');
  assert.equal(plan.agentPayload.systemPrompt, '你是售后智能体,优先使用知识库。');
  assert.equal(plan.agentPayload.defaultChatModel, 'gpt-5.5');
  assert.deepEqual(plan.agentPayload.allowedChatModels, ['gpt-5.5']);
  assert.equal(plan.agentPayload.department, '智能工厂');
  assert.ok(plan.agentPayload.description.includes(buildSmartFactoryLinkMarker('agent-after-sale')));
  // 只带绑定的 kb-1,空文档被过滤,未绑定的 kb-2 不出现
  assert.equal(plan.knowledgeBases.length, 1);
  assert.equal(plan.knowledgeBases[0].factoryKnowledgeBaseId, 'kb-1');
  assert.equal(plan.knowledgeBases[0].documents.length, 1);
  assert.equal(plan.knowledgeBases[0].documents[0].rawText, '签收后7天内可退货。');
});

test('buildAgentCenterSyncPlan skips knowledge bases whose documents are all empty', () => {
  const plan = buildAgentCenterSyncPlan({
    factoryAgent: { ...factoryAgent, knowledgeBaseIds: ['kb-empty'] },
    factoryConfig: {
      knowledgeBases: [{ id: 'kb-empty', name: '空库', documents: [{ title: 'a', content: '' }] }],
    },
  });
  assert.equal(plan.knowledgeBases.length, 0);
});

test('findLinkedAgentCenterAgent locates the bridged agent by marker and is idempotent-safe', () => {
  const marker = buildSmartFactoryLinkMarker('agent-after-sale');
  const agents = [
    { id: 'ac-1', description: '普通智能体' },
    { id: 'ac-2', description: `售后\n${marker} 由智能工厂发布同步` },
  ];
  assert.equal(findLinkedAgentCenterAgent(agents, 'agent-after-sale')?.id, 'ac-2');
  assert.equal(findLinkedAgentCenterAgent(agents, 'agent-other'), null);
  assert.equal(findLinkedAgentCenterAgent(agents, ''), null);
});

test('buildAgentCenterSyncPlan returns null without a factory agent id', () => {
  assert.equal(buildAgentCenterSyncPlan({ factoryAgent: {}, factoryConfig }), null);
});
