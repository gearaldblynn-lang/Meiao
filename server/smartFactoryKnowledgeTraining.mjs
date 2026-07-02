import { callOpenAICompatibleEmbeddingModel } from './ai-engine/openAICompatibleModelClient.mjs';
import { normalizeSmartFactoryConfig } from './smartFactoryConfigStore.mjs';

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);

const findKnowledgeBase = (config, knowledgeBaseId = '') => {
  const id = clean(knowledgeBaseId, 120);
  const knowledgeBase = config.knowledgeBases.find((item) => item.id === id);
  if (!knowledgeBase) throw new Error(`知识库不存在：${id}`);
  return knowledgeBase;
};

const findModelProvider = (config, providerId = '') => {
  const id = clean(providerId, 120);
  const provider = config.modelProviders.find((item) => item.provider === id);
  if (!provider) throw new Error(`Embedding 模型供应商不存在：${id}`);
  return provider;
};

const findKnowledgeBaseByDocumentId = (config, documentId = '') => {
  const id = clean(documentId, 120);
  const knowledgeBase = config.knowledgeBases.find((item) => (
    item.documents.some((document) => document.id === id)
  ));
  if (!knowledgeBase) throw new Error(`知识文档不存在：${id}`);
  return knowledgeBase;
};

export const trainSmartFactoryKnowledgeBaseEmbeddings = async (
  current = {},
  knowledgeBaseId = '',
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    signal,
    now = Date.now,
  } = {}
) => {
  const config = normalizeSmartFactoryConfig(current);
  const knowledgeBase = findKnowledgeBase(config, knowledgeBaseId);
  const embeddingModel = knowledgeBase.embeddingModel;
  if (!embeddingModel?.provider || !embeddingModel?.model) {
    throw new Error('知识库未配置 Embedding 模型。');
  }
  const provider = findModelProvider(config, embeddingModel.provider);
  const trainableChunks = knowledgeBase.documents.flatMap((document) => (
    (document.chunks || [])
      .filter((chunk) => clean(chunk.content, 20000))
      .map((chunk) => ({ documentId: document.id, chunkId: chunk.id, content: clean(chunk.content, 20000) }))
  ));
  if (!trainableChunks.length) {
    return { config, trainedChunkCount: 0 };
  }
  const embeddings = await callOpenAICompatibleEmbeddingModel({
    provider,
    model: embeddingModel.model,
    input: trainableChunks.map((chunk) => chunk.content),
    env,
    fetchImpl,
    signal,
  });
  const embeddedAt = Number(now());
  const embeddingByChunkId = new Map(trainableChunks.map((chunk, index) => [
    chunk.chunkId,
    {
      embedding: embeddings[index],
      embeddingModel,
      embeddedAt,
    },
  ]));
  const nextConfig = normalizeSmartFactoryConfig({
    ...config,
    knowledgeBases: config.knowledgeBases.map((item) => (
      item.id !== knowledgeBase.id
        ? item
        : {
            ...item,
            documents: item.documents.map((document) => ({
              ...document,
              chunks: (document.chunks || []).map((chunk) => ({
                ...chunk,
                ...(embeddingByChunkId.get(chunk.id) || {}),
              })),
            })),
            updatedAt: embeddedAt,
          }
    )),
  });
  return {
    config: nextConfig,
    trainedChunkCount: embeddings.length,
  };
};

export const maybeTrainSmartFactoryKnowledgeBaseEmbeddings = async (
  current = {},
  knowledgeBaseId = '',
  options = {}
) => {
  const config = normalizeSmartFactoryConfig(current);
  const knowledgeBase = findKnowledgeBase(config, knowledgeBaseId);
  if (!knowledgeBase.embeddingModel?.provider || !knowledgeBase.embeddingModel?.model) {
    return {
      config,
      trainedChunkCount: 0,
      skippedReason: 'embedding_model_not_configured',
    };
  }
  return trainSmartFactoryKnowledgeBaseEmbeddings(config, knowledgeBaseId, options);
};

export const trainSmartFactoryKnowledgeDocumentEmbeddings = async (
  current = {},
  documentId = '',
  options = {}
) => {
  const config = normalizeSmartFactoryConfig(current);
  const knowledgeBase = findKnowledgeBaseByDocumentId(config, documentId);
  const result = await trainSmartFactoryKnowledgeBaseEmbeddings(config, knowledgeBase.id, options);
  return {
    ...result,
    knowledgeBaseId: knowledgeBase.id,
  };
};

export const maybeTrainSmartFactoryKnowledgeDocumentEmbeddings = async (
  current = {},
  documentId = '',
  options = {}
) => {
  const config = normalizeSmartFactoryConfig(current);
  const knowledgeBase = findKnowledgeBaseByDocumentId(config, documentId);
  const result = await maybeTrainSmartFactoryKnowledgeBaseEmbeddings(config, knowledgeBase.id, options);
  return {
    ...result,
    knowledgeBaseId: knowledgeBase.id,
  };
};
