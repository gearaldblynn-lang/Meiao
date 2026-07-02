import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSmartFactoryConfig,
  toSmartFactoryRuntimeInputs,
} from './smartFactoryConfigStore.mjs';
import {
  maybeTrainSmartFactoryKnowledgeBaseEmbeddings,
  maybeTrainSmartFactoryKnowledgeDocumentEmbeddings,
  trainSmartFactoryKnowledgeBaseEmbeddings,
  trainSmartFactoryKnowledgeDocumentEmbeddings,
} from './smartFactoryKnowledgeTraining.mjs';

const createConfig = (baseUrl = 'http://relay.test/v1') => normalizeSmartFactoryConfig({
  modelProviders: [{
    provider: 'relay',
    displayName: 'Relay',
    baseUrl,
    credentialRef: 'env:RELAY_API_KEY',
    models: [
      { id: 'chat-model', mode: 'chat' },
      { id: 'embedding-model', mode: 'embedding' },
    ],
  }],
  knowledgeBases: [{
    id: 'kb-vector',
    name: '向量知识库',
    embeddingModel: { provider: 'relay', model: 'embedding-model' },
    documents: [{
      id: 'doc-vector',
      title: '退货规则',
      content: '签收后 7 天内可以申请退货。\n\n商品需要保留原包装。',
    }],
  }],
  tools: [],
  agents: [{
    id: 'agent-vector',
    name: '向量智能体',
    model: { provider: 'relay', model: 'chat-model' },
    knowledgeBaseIds: ['kb-vector'],
    enabled: true,
    status: 'published',
  }],
  sessions: [],
});

test('trains knowledge base chunks through configured OpenAI-compatible embeddings provider', async () => {
  const requests = [];
  const trained = await trainSmartFactoryKnowledgeBaseEmbeddings(createConfig(), 'kb-vector', {
    env: { RELAY_API_KEY: 'sk-real' },
    now: () => 1782300000000,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, headers: options.headers, body });
      return new Response(JSON.stringify({
        data: body.input.map((_, index) => ({ index, embedding: [index + 1, index + 2, index + 3] })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const chunks = trained.config.knowledgeBases[0].documents[0].chunks;
  const runtimeInputs = toSmartFactoryRuntimeInputs(trained.config, { agentId: 'agent-vector' });

  assert.equal(trained.trainedChunkCount, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://relay.test/v1/embeddings');
  assert.equal(requests[0].headers.authorization, 'Bearer sk-real');
  assert.equal(requests[0].body.model, 'embedding-model');
  assert.deepEqual(requests[0].body.input, [
    '签收后 7 天内可以申请退货。',
    '商品需要保留原包装。',
  ]);
  assert.deepEqual(chunks[0].embedding, [1, 2, 3]);
  assert.deepEqual(chunks[1].embedding, [2, 3, 4]);
  assert.deepEqual(chunks[0].embeddingModel, { provider: 'relay', model: 'embedding-model' });
  assert.equal(chunks[0].embeddedAt, 1782300000000);
  assert.deepEqual(runtimeInputs.knowledgeChunks.map((chunk) => chunk.embedding), [[1, 2, 3], [2, 3, 4]]);
});

test('fails knowledge embedding training when embedding model is not configured', async () => {
  const config = normalizeSmartFactoryConfig({
    ...createConfig(),
    knowledgeBases: [{
      id: 'kb-vector',
      name: '向量知识库',
      documents: [{ id: 'doc-vector', title: '退货规则', content: '7 天内可退货。' }],
    }],
  });

  await assert.rejects(
    () => trainSmartFactoryKnowledgeBaseEmbeddings(config, 'kb-vector', {
      env: { RELAY_API_KEY: 'sk-real' },
      fetchImpl: async () => {
        throw new Error('should not call provider');
      },
    }),
    /知识库未配置 Embedding 模型/
  );
});

test('maybe training skips without pretending vector training happened', async () => {
  const config = normalizeSmartFactoryConfig({
    ...createConfig(),
    knowledgeBases: [{
      id: 'kb-vector',
      name: '向量知识库',
      documents: [{ id: 'doc-vector', title: '退货规则', content: '7 天内可退货。' }],
    }],
  });

  const result = await maybeTrainSmartFactoryKnowledgeBaseEmbeddings(config, 'kb-vector', {
    fetchImpl: async () => {
      throw new Error('should not call provider');
    },
  });

  assert.equal(result.trainedChunkCount, 0);
  assert.equal(result.skippedReason, 'embedding_model_not_configured');
  assert.equal(result.config.knowledgeBases[0].documents[0].chunks[0].embedding, undefined);
});

test('trains the knowledge base containing a retrained document', async () => {
  const requests = [];
  const result = await trainSmartFactoryKnowledgeDocumentEmbeddings(createConfig(), 'doc-vector', {
    env: { RELAY_API_KEY: 'sk-real' },
    now: () => 1782300000001,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      return new Response(JSON.stringify({
        data: body.input.map((_, index) => ({ index, embedding: [9, 8, index] })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(result.knowledgeBaseId, 'kb-vector');
  assert.equal(result.trainedChunkCount, 2);
  assert.equal(requests.length, 1);
  assert.deepEqual(result.config.knowledgeBases[0].documents[0].chunks[0].embedding, [9, 8, 0]);
});

test('maybe document training skips missing embedding model without calling provider', async () => {
  const config = normalizeSmartFactoryConfig({
    ...createConfig(),
    knowledgeBases: [{
      id: 'kb-vector',
      name: '向量知识库',
      documents: [{ id: 'doc-vector', title: '退货规则', content: '7 天内可退货。' }],
    }],
  });

  const result = await maybeTrainSmartFactoryKnowledgeDocumentEmbeddings(config, 'doc-vector', {
    fetchImpl: async () => {
      throw new Error('should not call provider');
    },
  });

  assert.equal(result.knowledgeBaseId, 'kb-vector');
  assert.equal(result.trainedChunkCount, 0);
  assert.equal(result.skippedReason, 'embedding_model_not_configured');
});
