import test from 'node:test';
import assert from 'node:assert/strict';

import { searchSmartFactoryKnowledge } from './knowledgeRetrieval.mjs';

test('ranks knowledge chunks by query hits and scopes datasets', () => {
  const results = searchSmartFactoryKnowledge('退货 原包装', [
    { knowledgeBaseId: 'kb-1', documentId: 'doc-1', title: '退货规则', content: '签收后 7 天内可以退货，需要保留原包装。' },
    { knowledgeBaseId: 'kb-2', documentId: 'doc-2', title: '内部说明', content: '退货也可联系人工。' },
    { knowledgeBaseId: 'kb-1', documentId: 'doc-3', title: '退货运费', content: '退货运费按平台规则处理。' },
  ], { datasets: ['kb-1'] });

  assert.equal(results.length, 2);
  assert.equal(results[0].documentId, 'doc-1');
  assert.ok(results[0].score > results[1].score);
  assert.equal(results.every((item) => item.knowledgeBaseId === 'kb-1'), true);
});

test('returns empty results for blank queries', () => {
  assert.deepEqual(searchSmartFactoryKnowledge('', [{ title: '退货', content: '规则' }]), []);
});

test('matches continuous Chinese questions against shorter knowledge titles', () => {
  const results = searchSmartFactoryKnowledge('验收规则是什么', [
    { knowledgeBaseId: 'kb-1', documentId: 'doc-acceptance', title: '验收规则', content: '智能工厂必须支持模型配置、知识库训练、智能体发布和工具调用。' },
  ]);

  assert.equal(results[0].documentId, 'doc-acceptance');
});

test('applies topK similarity threshold and preserves citation metadata', () => {
  const results = searchSmartFactoryKnowledge('退货 原包装', [
    {
      id: 'chunk-return',
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-return',
      title: '退货规则',
      content: '签收后 7 天内可以退货，需要保留原包装。',
      chunkIndex: 0,
      sourceType: 'file',
    },
    {
      id: 'chunk-fee',
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-fee',
      title: '退货运费',
      content: '退货运费按平台规则处理。',
      chunkIndex: 1,
      sourceType: 'text',
    },
    {
      id: 'chunk-exchange',
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-exchange',
      title: '换货规则',
      content: '质量问题可以换货。',
      chunkIndex: 2,
      sourceType: 'text',
    },
  ], {
    topK: 1,
    similarityThreshold: 4,
  });

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    knowledgeBaseId: 'kb-1',
    documentId: 'doc-return',
    chunkId: 'chunk-return',
    chunkIndex: 0,
    title: '退货规则',
    content: '签收后 7 天内可以退货，需要保留原包装。',
    score: results[0].score,
    sourceType: 'file',
  });
  assert.ok(results[0].score >= 4);
});

test('uses vector similarity when query and chunk embeddings are available', () => {
  const results = searchSmartFactoryKnowledge('售后怎么处理', [
    {
      id: 'chunk-return',
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-return',
      title: '退货规则',
      content: '签收后 7 天内可以退货。',
      embedding: [1, 0, 0],
    },
    {
      id: 'chunk-warranty',
      knowledgeBaseId: 'kb-1',
      documentId: 'doc-warranty',
      title: '保修说明',
      content: '电器类商品支持一年保修。',
      embedding: [0, 1, 0],
    },
  ], {
    queryEmbedding: [0.9, 0.1, 0],
    similarityThreshold: 0.1,
  });

  assert.equal(results[0].documentId, 'doc-return');
  assert.equal(results[0].scoreType, 'vector');
  assert.ok(results[0].score > results[1].score);
});

test('D7 回归:空 retrievalPolicy(未显式给阈值)时向量检索不得因默认阈值=1而返回0结果', () => {
  const chunks = [
    { id: 'c1', knowledgeBaseId: 'kb-1', title: '售后', content: '签收后 7 天内可以退货。', embedding: [0.9, 0.1, 0.2] },
    { id: 'c2', knowledgeBaseId: 'kb-1', title: '尺寸', content: '产品尺寸对照表。', embedding: [0.2, 0.9, 0.1] },
  ];
  // 空策略:新建知识库 retrievalPolicy:{} 的真实形态——不带 similarityThreshold
  const results = searchSmartFactoryKnowledge('退货', chunks, {
    queryEmbedding: [0.88, 0.15, 0.22],
  });
  assert.ok(results.length > 0, '高度相似(cosine≈0.998)的 chunk 必须能被检索到');
  assert.equal(results[0].chunkId, 'c1');
});

test('D7 回归:显式 similarityThreshold 仍然生效(高阈值过滤低相似)', () => {
  const chunks = [
    { id: 'c1', knowledgeBaseId: 'kb-1', title: '售后', content: '退货。', embedding: [1, 0, 0] },
    { id: 'c2', knowledgeBaseId: 'kb-1', title: '尺寸', content: '尺寸。', embedding: [0, 1, 0] },
  ];
  const results = searchSmartFactoryKnowledge('退货', chunks, {
    queryEmbedding: [0.9, 0.1, 0],
    similarityThreshold: 0.9,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].chunkId, 'c1');
});
