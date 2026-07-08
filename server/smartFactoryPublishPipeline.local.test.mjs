import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('本地 sync 执行器:已链接分支走更新管道而非跳过', () => {
  const start = source.indexOf('const syncFactoryAgentToLocalAgentCenter');
  // DB 定向链接查找 helper 定义在本地管道之后,以它为界,slice 只含本地管道
  const end = source.indexOf('const findDbLinkedAgentByFactoryId');
  assert.ok(start > 0 && end > start);
  const fn = source.slice(start, end);
  assert.ok(!fn.includes('alreadyLinkedAgentId'), '不许再有"已链接即跳过"');
  assert.ok(fn.includes('createLocalAgentDraft'), '更新分支必须创建新版本');
  assert.ok(fn.includes('updateLocalAgentVersion'), '新版本必须写入工厂最新配置');
  assert.ok(fn.includes('validateLocalAgentVersionRecord'), '发布必须自动验证');
  assert.ok(fn.includes('publishLocalAgentVersionRecord'), '验证通过必须自动上线');
  assert.ok(fn.includes('deleteLocalKnowledgeDocument'), '知识库刷新必须走级联删除(清chunk)');
  assert.ok(fn.includes('findLinkedKnowledgeBase'), '知识库判据必须用单一函数');
  assert.ok(!fn.includes('store.knowledgeDocuments = '), '禁止直接 filter knowledgeDocuments(chunk 孤儿)');
  assert.ok(fn.indexOf('validateLocalAgentVersionRecord(') < fn.indexOf('publishLocalAgentVersionRecord('), '必须先验证再上线');
  assert.ok(fn.includes('validation?.ok'), '上线必须以验证结果为门槛');
  assert.ok(fn.includes('SYNC_ERROR_CODES.KB_REFRESH_FAILED'), '知识库刷新失败必须 fail-fast 回报(错误码走单一来源常量)');
  assert.ok(fn.includes('currentKbName'), 'catch 报错必须带当前知识库名');
  assert.ok(fn.includes('deletedDocCount'), 'catch 报错必须带已删文档计数');
  assert.ok(fn.includes('VALIDATION_PROBE_MESSAGE'), '验证探针文案必须走单一来源常量');
});

test('验证/上线路由复用抽取的辅助函数(单一实现)', () => {
  assert.ok(source.includes('const validateLocalAgentVersionRecord'));
  assert.ok(source.includes('const publishLocalAgentVersionRecord'));
  // 路由1 + 管道1 = 至少2处调用(函数为箭头函数,定义行不含 `(` 紧跟函数名)
  assert.ok(source.split('validateLocalAgentVersionRecord(').length - 1 >= 2, '路由1+管道1');
  assert.ok(source.split('publishLocalAgentVersionRecord(').length - 1 >= 2);
});
