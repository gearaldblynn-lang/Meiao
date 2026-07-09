// 接管管道(中心存量 → 工厂)的 source 断言:双模式同构、守卫齐全、不触发中心重发布。
// 风格沿用 smartFactoryPublishPipeline.*.test.mjs(静态扫描实现结构,不跑运行时)。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSection } from './sourceTestHelper.mjs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('本地接管执行器:守卫 + 计划 + 落库结构齐全', () => {
  const fn = getSection(source, 'const adoptCenterAgentIntoLocalFactory', 'const findDbLinkedAgentByFactoryId');
  assert.ok(fn.includes("user?.role !== 'admin'"), '必须 admin-only');
  assert.ok(fn.includes('isFactoryManagedAgent(centerAgent)'), '已托管判据必须复用 bridge 单一函数');
  assert.ok(fn.includes('409'), '已托管必须 409 而非静默重复接管');
  assert.ok(fn.includes('buildFactoryAdoptionPlan'), '接管计划必须走 bridge 纯函数');
  assert.ok(fn.includes('createSmartFactoryKnowledgeBase'), '知识库导入必须走既有纯函数');
  assert.ok(fn.includes('addSmartFactoryKnowledgeDocument'), '文档导入必须走既有纯函数');
  assert.ok(fn.includes('maybeTrainSmartFactoryKnowledgeBaseEmbeddings'), '导入库必须触发训练(对齐文档新增路由)');
  assert.ok(fn.includes('createSmartFactoryAgent'), '工厂 agent 必须走既有纯函数创建');
  assert.ok(fn.includes('publishAfterCreate'), '中心已发布才置工厂已发布');
  assert.ok(fn.includes('rawAgent.factoryAgentId = plan.centerLinks.factoryAgentId'), '中心 agent 必须写结构化关联');
  assert.ok(fn.includes('rawKb.factoryKnowledgeBaseId'), '中心知识库必须写结构化关联');
  assert.ok(fn.includes('alreadyLinkedFactoryKnowledgeBaseId'), '共用知识库必须复用既有工厂关联');
  assert.ok(fn.includes('writeLocalStore(store)'), '必须持久化');
  // 接管只建关联,不许触发中心重发布/改写中心版本
  assert.ok(!fn.includes('syncFactoryAgentToLocalAgentCenter'), '接管不许触发中心同步发布');
  assert.ok(!fn.includes('createLocalAgentDraft'), '接管不许给中心 agent 建新版本');
  assert.ok(!fn.includes('publishLocalAgentVersionRecord'), '接管不许改中心上线状态');
});

test('DB 接管执行器:与本地同构且文档读取走定向 SQL', () => {
  const fn = getSection(source, 'const adoptCenterAgentIntoDbFactory', 'const buildOpenAICompatibleRuntimeEnv');
  assert.ok(fn.includes("user?.role !== 'admin'"), '必须 admin-only');
  assert.ok(fn.includes('isFactoryManagedAgent(centerAgent)'), '已托管判据必须复用 bridge 单一函数');
  assert.ok(fn.includes('buildFactoryAdoptionPlan'), '接管计划必须走 bridge 纯函数');
  // I1 同款理由:listDbKnowledgeDocuments 对普通 admin 按 owner 过滤,会静默漏文档
  assert.ok(fn.includes('SELECT title, source_type, raw_text FROM knowledge_documents'), '文档必须定向 SQL 全量读');
  assert.ok(!fn.includes('listDbKnowledgeDocuments'), '禁止走 owner 过滤的列表函数');
  assert.ok(fn.includes('UPDATE agents SET factory_agent_id'), '中心 agent 必须写结构化关联');
  assert.ok(fn.includes('UPDATE knowledge_bases SET factory_agent_id = ?, factory_kb_id = ?'), '中心知识库必须写结构化关联');
  assert.ok(fn.includes('saveDbSystemSettings'), '工厂配置必须落 system_settings');
  assert.ok(!fn.includes('syncFactoryAgentToDbAgentCenter'), '接管不许触发中心同步发布');
  assert.ok(!fn.includes('createDbAgentDraft'), '接管不许给中心 agent 建新版本');
});

test('接管路由双模式各注册一次(根因#7:双管道同一次改)', () => {
  const routePattern = '/api\\/smart-factory\\/agents\\/adopt\\/';
  assert.equal(source.split(routePattern).length - 1, 2, '本地 + DB 各一处路由匹配');
  assert.ok(source.includes('adoptCenterAgentIntoLocalFactory(store, user, centerAgentId)'));
  assert.ok(source.includes('adoptCenterAgentIntoDbFactory(user, centerAgentId)'));
});
