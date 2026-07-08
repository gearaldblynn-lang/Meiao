import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSection } from './sourceTestHelper.mjs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const extractDbSync = () => getSection(source, 'const syncFactoryAgentToDbAgentCenter', 'const buildOpenAICompatibleRuntimeEnv');

test('DB sync 执行器:已链接分支走更新管道而非跳过', () => {
  const fn = extractDbSync();
  assert.ok(!fn.includes('alreadyLinkedAgentId'), '不许再有"已链接即跳过"');
  assert.ok(fn.includes('createDbAgentDraft'), '更新分支必须创建新版本');
  assert.ok(fn.includes('updateDbAgentVersion'), '新版本必须写入工厂最新配置');
  assert.ok(fn.includes('validateDbAgentVersion'), '发布必须自动验证');
  assert.ok(fn.includes('publishDbAgentVersion'), '验证通过必须自动上线');
  assert.ok(fn.includes('deleteDbKnowledgeDocument'), '知识库刷新必须走级联删除(清chunk)');
  assert.ok(fn.includes('SYNC_ERROR_CODES.KB_REFRESH_FAILED'), '刷新失败必须fail-fast回报(错误码走单一来源常量)');
  assert.ok(fn.indexOf('validateDbAgentVersion(') < fn.indexOf('publishDbAgentVersion('), '先验证后上线');
});

test('DB sync 链接查找:定向 SQL 全局判据,不走 owner 过滤的 listDb*', () => {
  const fn = extractDbSync();
  assert.ok(fn.includes('findDbLinkedAgentByFactoryId'), 'agent 链接判据必须用定向查找(普通 admin 的 listDbAgents 有 owner 过滤)');
  assert.ok(fn.includes('findDbLinkedKnowledgeBaseByFactoryId'), 'KB 链接判据必须用定向查找');
  assert.ok(!fn.includes('listDbAgents('), '禁止用 owner 过滤的 listDbAgents 做链接查找');
  assert.ok(!fn.includes('listDbKnowledgeBases('), '禁止用 owner 过滤的 listDbKnowledgeBases 做链接查找');
  const finders = getSection(source, 'const findDbLinkedAgentByFactoryId', 'const syncFactoryAgentToDbAgentCenter');
  assert.ok(finders.includes('factory_agent_id = ?'), '定向查找必须结构化字段优先');
  assert.ok(finders.includes('description LIKE ?'), '无命中必须回退旧 description marker');
  assert.ok(finders.includes('buildSmartFactoryLinkMarker'), 'marker 判据必须复用 bridge 单一实现');
});

test('DB sync 半刷新报错带上下文,惰性迁移补 updated_at', () => {
  const fn = extractDbSync();
  assert.ok(fn.includes('currentKbName'), 'catch 报错必须带当前知识库名');
  assert.ok(fn.includes('deletedDocCount'), 'catch 报错必须带已删文档计数');
  assert.ok(fn.includes('publish_failed:'), '上线门禁失败要用 publish_failed 回报,不冒充 validationFailed');
  const migrations = fn.match(/UPDATE (knowledge_bases|agents) SET [^']*updated_at = \?/g) || [];
  assert.equal(migrations.length, 2, '两处惰性迁移 UPDATE 都必须补 updated_at');
});

test('schema 与透传:factory_agent_id 结构化列', () => {
  assert.ok(source.includes("ensureMysqlColumn(pool, 'agents', 'factory_agent_id'"));
  assert.ok(source.includes("ensureMysqlColumn(pool, 'knowledge_bases', 'factory_agent_id'"));
  assert.ok(source.includes("ensureMysqlColumn(pool, 'knowledge_bases', 'factory_kb_id'"));
  const getAgent = getSection(source, 'const getDbAgentById', 'const listDbAgents');
  assert.ok(getAgent.includes("factoryAgentId: rows[0].factory_agent_id || ''"), 'getDbAgentById 行映射必须透出 factoryAgentId');
  const getKb = getSection(source, 'const getDbKnowledgeBaseById', 'const createDbKnowledgeBase');
  assert.ok(getKb.includes("factoryAgentId: rows[0].factory_agent_id || ''"), 'getDbKnowledgeBaseById 行映射必须透出 factoryAgentId');
  assert.ok(getKb.includes("factoryKnowledgeBaseId: rows[0].factory_kb_id || ''"), 'getDbKnowledgeBaseById 行映射必须透出 factoryKnowledgeBaseId');
});
