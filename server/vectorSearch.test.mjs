import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, rankChunksByVector } from './vectorSearch.mjs';

test('cosineSimilarity 基本正确', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 1]) - 1) < 1e-9);
});

test('cosineSimilarity 处理零向量/长度不等返回 0（不崩）', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
});

test('rankChunksByVector 按相似度降序，截断 topK', () => {
  const q = [1, 0];
  const chunks = [
    { id: 'a', content: 'aaa', embedding: [1, 0] },
    { id: 'b', content: 'bbb', embedding: [0, 1] },
    { id: 'c', content: 'ccc', embedding: [0.7, 0.7] },
  ];
  const out = rankChunksByVector(q, chunks, { topK: 2, maxChunks: 10, maxContextChars: 9999, minSimilarity: 0 });
  assert.deepEqual(out.map((chunk) => chunk.id), ['a', 'c']);
});

test('rankChunksByVector 过滤低于 minSimilarity', () => {
  const q = [1, 0];
  const chunks = [
    { id: 'a', content: 'a', embedding: [1, 0] },
    { id: 'b', content: 'b', embedding: [0, 1] },
  ];
  const out = rankChunksByVector(q, chunks, { topK: 10, maxChunks: 10, maxContextChars: 9999, minSimilarity: 0.5 });
  assert.deepEqual(out.map((chunk) => chunk.id), ['a']);
});

test('rankChunksByVector 跳过没有 embedding 的块', () => {
  const q = [1, 0];
  const chunks = [
    { id: 'a', content: 'a', embedding: [1, 0] },
    { id: 'b', content: 'b', embedding: null },
  ];
  const out = rankChunksByVector(q, chunks, { topK: 10, maxChunks: 10, maxContextChars: 9999, minSimilarity: 0 });
  assert.deepEqual(out.map((chunk) => chunk.id), ['a']);
});

test('rankChunksByVector maxContextChars 截断', () => {
  const q = [1, 0];
  const chunks = [
    { id: 'a', content: 'x'.repeat(100), embedding: [1, 0] },
    { id: 'b', content: 'y'.repeat(100), embedding: [0.9, 0.1] },
  ];
  const out = rankChunksByVector(q, chunks, { topK: 10, maxChunks: 10, maxContextChars: 120, minSimilarity: 0 });
  assert.equal(out.length, 1);
});
