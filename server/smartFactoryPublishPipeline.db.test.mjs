import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const extractDbSync = () => {
  const start = source.indexOf('const syncFactoryAgentToDbAgentCenter');
  const end = source.indexOf('const buildOpenAICompatibleRuntimeEnv');
  assert.ok(start > 0 && end > start, '函数边界定位失败');
  return source.slice(start, end);
};

test('DB sync 执行器:已链接分支走更新管道而非跳过', () => {
  const fn = extractDbSync();
  assert.ok(!fn.includes('alreadyLinkedAgentId'), '不许再有"已链接即跳过"');
  assert.ok(fn.includes('createDbAgentDraft'), '更新分支必须创建新版本');
  assert.ok(fn.includes('updateDbAgentVersion'), '新版本必须写入工厂最新配置');
  assert.ok(fn.includes('validateDbAgentVersion'), '发布必须自动验证');
  assert.ok(fn.includes('publishDbAgentVersion'), '验证通过必须自动上线');
  assert.ok(fn.includes('deleteDbKnowledgeDocument'), '知识库刷新必须走级联删除(清chunk)');
  assert.ok(fn.includes('findLinkedKnowledgeBase'), '知识库判据必须用单一函数');
  assert.ok(fn.includes('kb_refresh_failed'), '刷新失败必须fail-fast回报');
  assert.ok(fn.indexOf('validateDbAgentVersion(') < fn.indexOf('publishDbAgentVersion('), '先验证后上线');
});

test('schema 与透传:factory_agent_id 结构化列', () => {
  assert.ok(source.includes("ensureMysqlColumn(pool, 'agents', 'factory_agent_id'"));
  assert.ok(source.includes("ensureMysqlColumn(pool, 'knowledge_bases', 'factory_agent_id'"));
  assert.ok(source.includes("ensureMysqlColumn(pool, 'knowledge_bases', 'factory_kb_id'"));
  assert.ok(source.includes('factory_agent_id || '), 'getDbAgentById 行映射必须透出 factoryAgentId');
});
