import { searchKnowledgeChunks } from '../src/modules/AgentCenter/agentCenterUtils.mjs';
import { embedTexts } from './embeddingProvider.mjs';
import { rankChunksByVector } from './vectorSearch.mjs';
import { DEFAULT_SIMILARITY_THRESHOLD } from './ai-engine/knowledgeRetrieval.mjs';

const hasEmbeddingCredential = (env = {}) => Boolean(String(env.DOUBAO_EMBEDDING_API_KEY || '').trim());

export const searchKnowledgeChunksByVector = async (query, chunks, policy = {}, env = {}, fallbackSearch = searchKnowledgeChunks) => {
  if (hasEmbeddingCredential(env)) {
    try {
      const [queryVec] = await embedTexts([query], env);
      const ranked = rankChunksByVector(queryVec, chunks, {
        topK: Number(policy.topK || 3),
        maxChunks: Number(policy.maxChunks || 5),
        maxContextChars: Number(policy.maxContextChars || 2400),
        minSimilarity: Number(env.EMBEDDING_MIN_SIMILARITY || policy.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD),
      });
      if (ranked.length > 0) return ranked;
    } catch (error) {
      console.warn('[rag] 向量检索失败,降级关键词', {
        message: error?.message || String(error || ''),
      });
    }
  }
  if (typeof fallbackSearch === 'function') return fallbackSearch(chunks, query, policy);
  return [];
};

