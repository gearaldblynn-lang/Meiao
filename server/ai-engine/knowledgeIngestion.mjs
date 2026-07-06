import {
  KNOWLEDGE_CHUNK_STRATEGY_META,
  chunkKnowledgeText,
  normalizeKnowledgeChunkStrategy,
} from '../../src/modules/AgentCenter/agentCenterUtils.mjs';
import { DEFAULT_SIMILARITY_THRESHOLD } from './knowledgeRetrieval.mjs';

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

const normalizeMaxChunkChars = (value, strategy) => {
  const fallback = KNOWLEDGE_CHUNK_STRATEGY_META[normalizeKnowledgeChunkStrategy(strategy)]?.maxChunkChars || 760;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(4000, parsed) : fallback;
};

export const normalizeSmartFactoryRetrievalPolicy = (policy = {}) => {
  const topK = Number.parseInt(String(policy?.topK ?? policy?.limit ?? 3), 10);
  const similarityThreshold = Number(policy?.similarityThreshold ?? policy?.scoreThreshold ?? DEFAULT_SIMILARITY_THRESHOLD);
  const maxContextChars = Number.parseInt(String(policy?.maxContextChars ?? 2400), 10);
  return {
    topK: Number.isFinite(topK) && topK > 0 ? Math.min(20, topK) : 3,
    similarityThreshold: Number.isFinite(similarityThreshold) && similarityThreshold >= 0 ? similarityThreshold : DEFAULT_SIMILARITY_THRESHOLD,
    maxContextChars: Number.isFinite(maxContextChars) && maxContextChars > 0 ? Math.min(20000, maxContextChars) : 2400,
  };
};

const normalizeKnowledgeModelRef = (value = {}) => {
  if (!value || typeof value !== 'object') return undefined;
  const provider = clean(value.provider || value.model_provider, 120);
  const model = clean(value.model || value.name, 160);
  if (!provider || !model) return undefined;
  return { provider, model };
};

const normalizeEmbeddingVector = (value) => {
  if (!Array.isArray(value)) return undefined;
  const embedding = value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  return embedding.length ? embedding : undefined;
};

const buildExistingChunkMap = (chunks = []) => {
  const map = new Map();
  list(chunks).forEach((chunk) => {
    const embedding = normalizeEmbeddingVector(chunk?.embedding);
    if (!embedding) return;
    const model = normalizeKnowledgeModelRef(chunk.embeddingModel || chunk.embedding_model);
    const entry = {
      embedding,
      ...(model ? { embeddingModel: model } : {}),
      ...(Number.isFinite(Number(chunk.embeddedAt || chunk.embedded_at))
        ? { embeddedAt: Number(chunk.embeddedAt || chunk.embedded_at) }
        : {}),
    };
    const id = clean(chunk.id || chunk.chunkId || chunk.chunk_id, 160);
    if (id) map.set(`id:${id}`, entry);
    const index = Number(chunk.chunkIndex ?? chunk.index);
    const content = clean(chunk.content || chunk.text, 100000);
    if (Number.isFinite(index)) map.set(`index:${index}:${content}`, entry);
  });
  return map;
};

export const ingestSmartFactoryDocument = ({ knowledgeBaseId = '', document = {} } = {}) => {
  const id = clean(document.id, 120) || `doc-${Date.now()}`;
  const title = clean(document.title, 200) || '未命名文档';
  const content = clean(document.content, 100000);
  const chunkStrategy = normalizeKnowledgeChunkStrategy(document.chunkStrategy || document.chunk_strategy || 'general');
  const maxChunkChars = normalizeMaxChunkChars(document.maxChunkChars || document.max_chunk_chars, chunkStrategy);
  const sourceType = clean(document.sourceType || document.source_type || (document.fileName ? 'file' : 'text'), 40) || 'text';
  const base = {
    id,
    title,
    fileName: clean(document.fileName || document.file_name, 240),
    sourceType,
    content,
    chunkStrategy,
    maxChunkChars,
    updatedAt: Number(document.updatedAt || Date.now()),
  };
  if (!content) {
    return {
      ...base,
      status: 'failed',
      error: '文档内容为空，无法训练。',
      chunkCount: 0,
      chunks: [],
    };
  }
  const existingChunks = buildExistingChunkMap(document.chunks);
  const chunks = chunkKnowledgeText(content, { strategy: chunkStrategy, maxChunkChars }).map((chunk, index) => {
    const chunkId = `${id}-chunk-${index + 1}`;
    const trained = existingChunks.get(`id:${chunkId}`)
      || existingChunks.get(`index:${index}:${clean(chunk, 100000)}`)
      || {};
    return {
      id: chunkId,
      knowledgeBaseId: clean(knowledgeBaseId, 120),
      documentId: id,
      title,
      sourceType,
      content: chunk,
      chunkIndex: index,
      index,
      ...trained,
    };
  });
  return {
    ...base,
    status: chunks.length ? 'ready' : 'failed',
    ...(chunks.length ? {} : { error: '未生成有效分段，请检查文档内容或分段策略。' }),
    chunkCount: chunks.length,
    chunks,
  };
};

export const normalizeKnowledgeBaseForTraining = (knowledgeBase = {}) => {
  const id = clean(knowledgeBase.id, 120) || `kb-${Date.now()}`;
  const name = clean(knowledgeBase.name, 200) || '未命名知识库';
  const documents = list(knowledgeBase.documents)
    .map((document) => ingestSmartFactoryDocument({ knowledgeBaseId: id, document }));
  const chunkCount = documents.reduce((sum, document) => sum + document.chunkCount, 0);
  const readyDocumentCount = documents.filter((document) => document.status === 'ready').length;
  const failedDocumentCount = documents.filter((document) => document.status === 'failed').length;
  const retrievalPolicy = normalizeSmartFactoryRetrievalPolicy(knowledgeBase.retrievalPolicy || knowledgeBase.retrieval_policy);
  const embeddingModel = normalizeKnowledgeModelRef(knowledgeBase.embeddingModel || knowledgeBase.embedding_model);
  const rerankModel = normalizeKnowledgeModelRef(knowledgeBase.rerankModel || knowledgeBase.rerank_model);
  return {
    id,
    name,
    description: clean(knowledgeBase.description, 600),
    status: failedDocumentCount > 0 && readyDocumentCount > 0
      ? 'partial_failed'
      : failedDocumentCount > 0
        ? 'failed'
        : chunkCount
          ? 'ready'
          : 'empty',
    documentCount: documents.length,
    readyDocumentCount,
    failedDocumentCount,
    chunkCount,
    retrievalPolicy,
    ...(embeddingModel ? { embeddingModel } : {}),
    ...(rerankModel ? { rerankModel } : {}),
    documents,
    updatedAt: Number(knowledgeBase.updatedAt || Date.now()),
  };
};
