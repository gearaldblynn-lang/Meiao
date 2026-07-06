import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const getSection = (startMarker, endMarker, { last = false } = {}) => {
  const start = last ? source.lastIndexOf(startMarker) : source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test('smart factory preview API is mounted in mysql and local handlers', () => {
  assert.match(source, /testSmartFactoryModelProviderConnection/);
  assert.match(source, /createSmartFactoryAgent/);
  assert.match(source, /createSmartFactoryKnowledgeBase/);
  assert.match(source, /deleteSmartFactoryKnowledgeDocument/);
  assert.match(source, /publishSmartFactoryAgent/);
  assert.match(source, /retrainSmartFactoryKnowledgeDocument/);
  assert.match(source, /maybeTrainSmartFactoryKnowledgeBaseEmbeddings/);
  assert.match(source, /maybeTrainSmartFactoryKnowledgeDocumentEmbeddings/);
  assert.match(source, /runAllowedCliTool/);
  assert.match(source, /updateSmartFactoryAgent/);
  assert.match(source, /upsertModelProvider/);
  assert.match(source, /upsertSmartFactoryTool/);
  assert.match(source, /import \{ appendSmartFactoryConversationTurn \} from '\.\/ai-engine\/smartFactoryAgentStore\.mjs';/);
  assert.equal((source.match(/\/api\/smart-factory\/preview-turn/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/config/g) || []).length, 4);
  assert.equal((source.match(/\/api\/smart-factory\/chat/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/model-providers'/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/model-providers\/test'/g) || []).length, 2);
  assert.equal((source.match(/testSmartFactoryModelProviderConnection\(body, \{ env: process\.env \}\)/g) || []).length, 4);
  assert.doesNotMatch(source, /模型配置可用。/);
  assert.equal((source.match(/\/api\/smart-factory\/agents'/g) || []).length, 2);
  assert.equal((source.match(/smart-factory\\\/agents\\\/\(\[\^\/\]\+\)\\\/publish/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/knowledge-bases'/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/knowledge-documents'/g) || []).length, 2);
  assert.equal((source.match(/smart-factory\\\/knowledge-documents\\\/\(\[\^\/\]\+\)\\\/retrain/g) || []).length, 2);
  assert.equal((source.match(/maybeTrainSmartFactoryKnowledgeBaseEmbeddings\(/g) || []).length, 2);
  assert.equal((source.match(/maybeTrainSmartFactoryKnowledgeDocumentEmbeddings\(/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/knowledge-search'/g) || []).length, 2);
  assert.equal((source.match(/\/api\/smart-factory\/tools'/g) || []).length, 2);
  assert.equal((source.match(/smart-factory\\\/tools\\\/\(\[\^\/\]\+\)\\\/test/g) || []).length, 2);
  assert.equal((source.match(/runAllowedCliTool\(\{/g) || []).length, 2);
  assert.doesNotMatch(source, /工具测试完成:/);
  assert.match(source, /smartFactory: createDefaultSmartFactoryConfig\(\)/);
  assert.match(source, /smartFactory: normalizeSmartFactoryConfig\(value\?\.smartFactory \|\| \{\}\)/);
  assert.match(source, /const systemSettings = await getDbSystemSettings\(\);[\s\S]*runSmartFactoryPreviewTurn\(\{\s*message: body\.message,\s*smartFactoryConfig: composeSmartFactoryConfigForRuntime\(systemSettings\),\s*\}\)/);
  assert.match(source, /const systemSettings = await getDbSystemSettings\(\);[\s\S]*getSmartFactoryPreviewConfig\(\{\s*smartFactoryConfig: composeSmartFactoryConfigForRuntime\(systemSettings\),\s*\}\)/);
  assert.match(source, /const systemSettings = getLocalSystemSettings\(store\);[\s\S]*runSmartFactoryPreviewTurn\(\{\s*message: body\.message,\s*smartFactoryConfig: composeSmartFactoryConfigForRuntime\(systemSettings\),\s*\}\)/);
  assert.match(source, /const systemSettings = getLocalSystemSettings\(store\);[\s\S]*getSmartFactoryPreviewConfig\(\{\s*smartFactoryConfig: composeSmartFactoryConfigForRuntime\(systemSettings\),\s*\}\)/);
  assert.match(source, /url\.pathname === '\/api\/smart-factory\/config' && req\.method === 'PATCH'[\s\S]*const nextSmartFactory = mergeSmartFactoryConfigUpdate\(currentSettings\.smartFactory, body\?\.smartFactory \?\? body\?\.config \?\? body\)/);
  assert.match(source, /url\.pathname === '\/api\/smart-factory\/config' && req\.method === 'PATCH'[\s\S]*const nextSmartFactory = mergeSmartFactoryConfigUpdate\(currentLocalSettings\.smartFactory, body\?\.smartFactory \?\? body\?\.config \?\? body\)/);
  assert.match(source, /url\.pathname === '\/api\/smart-factory\/chat' && req\.method === 'POST'[\s\S]*appendSmartFactoryConversationTurn/);
  assert.match(source, /url\.pathname === '\/api\/smart-factory\/knowledge-documents' && req\.method === 'POST'[\s\S]*addSmartFactoryKnowledgeDocument/);
  assert.match(source, /url\.pathname === '\/api\/smart-factory\/knowledge-documents' && req\.method === 'POST'[\s\S]*maybeTrainSmartFactoryKnowledgeBaseEmbeddings/);
  assert.match(source, /testSmartFactoryKnowledgeSearch/);
});

test('smart factory APIs require login but are not admin-only', () => {
  const dbSmartFactoryRoutes = getSection(
    "  if (url.pathname === '/api/smart-factory/preview-turn' && req.method === 'POST') {",
    "\n  if (url.pathname === '/api/users' && req.method === 'GET') {",
  );
  const localSmartFactoryRoutes = getSection(
    "  if (url.pathname === '/api/smart-factory/preview-turn' && req.method === 'POST') {",
    "\n  if (url.pathname === '/api/chatwoot/test-connection' && req.method === 'POST') {",
    { last: true },
  );

  // 2026-07-06 U2 新增 agent DELETE 路由(双 handler 各 1),登录守卫 21→22
  assert.equal((dbSmartFactoryRoutes.match(/requireDbUser/g) || []).length, 22);
  assert.equal((localSmartFactoryRoutes.match(/localRequireUser/g) || []).length, 22);
  assert.doesNotMatch(dbSmartFactoryRoutes, /requireDbAdmin/);
  assert.doesNotMatch(localSmartFactoryRoutes, /localRequireAdmin/);
});

test('system model provider registry is the source of truth for smart factory models', () => {
  assert.match(source, /import \{[\s\S]*normalizeModelProviderRegistry[\s\S]*upsertModelProvider[\s\S]*\} from '\.\/modelProviderRegistry\.mjs';/);
  assert.match(source, /modelProviders: createDefaultModelProviderRegistry\(\)/);
  assert.match(source, /modelProviders: normalizeModelProviderRegistry\(/);
  assert.match(source, /const composeSmartFactoryConfigForRuntime = \(systemSettings = \{\}\) =>/);
  assert.match(source, /normalizeSmartFactoryConfig\(\{[\s\S]*modelProviders: normalizeModelProviderRegistry\(systemSettings\?\.modelProviders\)\.providers/);
  assert.ok((source.match(/\/api\/system\/model-providers/g) || []).length >= 4);
  assert.equal((source.match(/\/api\/system\/model-providers\/test/g) || []).length, 2);
  assert.match(source, /getPublicModelProviderRegistry\(systemSettings\.modelProviders\)/);
  assert.match(source, /upsertModelProvider\(currentSettings\.modelProviders, body\)/);
  assert.match(source, /deleteModelProvider\(currentSettings\.modelProviders/);
});
