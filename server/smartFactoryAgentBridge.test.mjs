import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentCenterSyncPlan,
  buildSmartFactoryLinkMarker,
  findLinkedAgentCenterAgent,
  findLinkedKnowledgeBase,
  isFactoryManagedAgent,
  stripFactoryMarkerLines,
  SYNC_ERROR_CODES,
  VALIDATION_PROBE_MESSAGE,
} from './smartFactoryAgentBridge.mjs';

test('isFactoryManagedAgent:结构化字段或旧 marker 前缀命中(编辑锁正用例)', () => {
  assert.equal(isFactoryManagedAgent({ factoryAgentId: 'fa-1' }), true);
  assert.equal(isFactoryManagedAgent({ description: '[智能工厂同步:fa-1] 由智能工厂同步。' }), true);
});

test('isFactoryManagedAgent:中心自建 agent 不命中(编辑锁反用例)', () => {
  assert.equal(isFactoryManagedAgent({ description: '普通自建智能体', factoryAgentId: '' }), false);
  assert.equal(isFactoryManagedAgent({}), false);
  assert.equal(isFactoryManagedAgent(null), false);
});

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
  assert.ok(!plan.agentPayload.description.includes(buildSmartFactoryLinkMarker('agent-after-sale')));
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

test('findLinkedAgentCenterAgent 优先结构化 factoryAgentId,回退旧 description 标记', () => {
  const byField = { id: 'a1', description: '普通描述', factoryAgentId: 'fa-1' };
  const byMarker = { id: 'a2', description: '旧的 [智能工厂同步:fa-2] 描述' };
  const unrelated = { id: 'a3', description: '无关' };
  assert.equal(findLinkedAgentCenterAgent([unrelated, byField], 'fa-1')?.id, 'a1');
  assert.equal(findLinkedAgentCenterAgent([unrelated, byMarker], 'fa-2')?.id, 'a2');
  assert.equal(findLinkedAgentCenterAgent([unrelated], 'fa-9'), null);
});

test('buildAgentCenterSyncPlan 输出结构化链接,新 description 不再内嵌标记', () => {
  const plan = buildAgentCenterSyncPlan({
    factoryAgent: { id: 'fa-1', name: '客服', prompt: 'p', knowledgeBaseIds: ['kb-1'], model: { model: 'gpt-5.5' } },
    factoryConfig: { knowledgeBases: [{ id: 'kb-1', name: '售后', documents: [{ title: 'd', content: '正文' }] }] },
  });
  assert.equal(plan.agentPayload.factoryAgentId, 'fa-1');
  assert.ok(!plan.agentPayload.description.includes('[智能工厂同步:'));
  assert.equal(plan.knowledgeBases[0].factoryKnowledgeBaseId, 'kb-1');
  assert.equal(plan.knowledgeBases[0].factoryAgentId, 'fa-1');
  assert.ok(!plan.knowledgeBases[0].description.includes('[智能工厂同步:'));
});

test('findLinkedKnowledgeBase 结构化优先,回退旧标记', () => {
  const byField = { id: 'k1', factoryAgentId: 'fa-1', factoryKnowledgeBaseId: 'kb-1' };
  const byMarker = { id: 'k2', description: '[智能工厂同步:fa-1] 由智能工厂知识库「售后」同步。' };
  assert.equal(findLinkedKnowledgeBase([byField], 'fa-1', 'kb-1')?.id, 'k1');
  assert.equal(findLinkedKnowledgeBase([byMarker], 'fa-1', 'kb-x')?.id, 'k2');
  assert.equal(findLinkedKnowledgeBase([], 'fa-1', 'kb-1'), null);
});

test('同步错误码与验证探针文案是单一来源导出', () => {
  assert.equal(SYNC_ERROR_CODES.KB_REFRESH_FAILED, 'kb_refresh_failed');
  assert.equal(SYNC_ERROR_CODES.DRAFT_CREATE_FAILED, 'draft_create_failed');
  assert.equal(SYNC_ERROR_CODES.AGENT_MATERIALIZE_FAILED, 'agent_materialize_failed');
  assert.ok(VALIDATION_PROBE_MESSAGE.length > 0);
});

test('findLinkedKnowledgeBase 空 kbId 直接返回 null(无法构成单一知识库判据)', () => {
  const byMarker = { id: 'k2', description: '[智能工厂同步:fa-1] 由智能工厂知识库「售后」同步。' };
  assert.equal(findLinkedKnowledgeBase([byMarker], 'fa-1', ''), null);
  assert.equal(findLinkedKnowledgeBase([byMarker], 'fa-1', '   '), null);
});

test('结构化字段优先于旧 marker,即使 marker 记录排在数组前面', () => {
  const agentByMarker = { id: 'a-old', description: `x ${buildSmartFactoryLinkMarker('fa-1')} y` };
  const agentByField = { id: 'a-new', description: '无标记', factoryAgentId: 'fa-1' };
  assert.equal(findLinkedAgentCenterAgent([agentByMarker, agentByField], 'fa-1')?.id, 'a-new');

  const kbByMarker = { id: 'k-old', description: `${buildSmartFactoryLinkMarker('fa-1')} 旧同步` };
  const kbByField = { id: 'k-new', factoryAgentId: 'fa-1', factoryKnowledgeBaseId: 'kb-1' };
  assert.equal(findLinkedKnowledgeBase([kbByMarker, kbByField], 'fa-1', 'kb-1')?.id, 'k-new');
});

test('stripFactoryMarkerLines:多行 description 只删含 marker 的行', () => {
  const marker = buildSmartFactoryLinkMarker('fa-1');
  const input = `第一行\n${marker}\n第三行`;
  assert.equal(stripFactoryMarkerLines(input), '第一行\n第三行');
});

test('stripFactoryMarkerLines:无 marker 行时原样返回', () => {
  const input = '普通描述\n第二行';
  assert.equal(stripFactoryMarkerLines(input), input);
});

test('stripFactoryMarkerLines:全 marker 行变空串', () => {
  const marker = buildSmartFactoryLinkMarker('fa-2');
  assert.equal(stripFactoryMarkerLines(marker), '');
});

test('stripFactoryMarkerLines:null/undefined 安全返回空串', () => {
  assert.equal(stripFactoryMarkerLines(null), '');
  assert.equal(stripFactoryMarkerLines(undefined), '');
});
