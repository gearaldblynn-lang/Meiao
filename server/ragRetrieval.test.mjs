import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { searchKnowledgeChunksByVector } from './ragRetrieval.mjs';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const chunks = [
  { id: 'a', content: '退换货流程：7天无理由', embedding: [1, 0, 0], chunkIndex: 0, sourceType: 'sop' },
  { id: 'b', content: '产品保修说明', embedding: [0, 1, 0], chunkIndex: 1, sourceType: 'faq' },
];

const policy = { topK: 1, maxChunks: 5, maxContextChars: 9999, similarityThreshold: 0 };

test('向量检索：query 向量最接近的块排第一', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { embedding: [1, 0, 0] } }), { status: 200 });
  const env = {
    EMBEDDING_PROVIDER: 'doubao',
    DOUBAO_EMBEDDING_API_KEY: 'k',
    DOUBAO_EMBEDDING_BASE_URL: 'https://x/api/v3',
    DOUBAO_EMBEDDING_MODEL: 'doubao-embedding-vision-251215',
  };
  const out = await searchKnowledgeChunksByVector('怎么退货', chunks, policy, env);
  assert.equal(out[0].id, 'a');
});

test('embedding 失败 -> 降级关键词检索（不抛错）', async () => {
  globalThis.fetch = async () => new Response('err', { status: 500 });
  const env = {
    EMBEDDING_PROVIDER: 'doubao',
    DOUBAO_EMBEDDING_API_KEY: 'k',
    DOUBAO_EMBEDDING_BASE_URL: 'https://x/api/v3',
    DOUBAO_EMBEDDING_MODEL: 'doubao-embedding-vision-251215',
  };
  const out = await searchKnowledgeChunksByVector('退换货', chunks, policy, env);
  assert.ok(Array.isArray(out));
  assert.ok(out.some((item) => item.id === 'a'));
});

test('未配 embedding key -> 直接走关键词', async () => {
  const out = await searchKnowledgeChunksByVector('退换货', chunks, policy, {});
  assert.ok(out.some((item) => item.id === 'a'));
});

test('有 embedding key 但旧块无向量 -> 降级关键词', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { embedding: [1, 0, 0] } }), { status: 200 });
  const env = {
    EMBEDDING_PROVIDER: 'doubao',
    DOUBAO_EMBEDDING_API_KEY: 'k',
    DOUBAO_EMBEDDING_BASE_URL: 'https://x/api/v3',
    DOUBAO_EMBEDDING_MODEL: 'doubao-embedding-vision-251215',
  };
  const oldChunks = chunks.map(({ embedding, ...item }) => item);
  const out = await searchKnowledgeChunksByVector('退换货', oldChunks, policy, env);
  assert.ok(out.some((item) => item.id === 'a'));
});
