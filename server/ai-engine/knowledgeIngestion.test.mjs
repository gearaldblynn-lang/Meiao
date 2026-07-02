import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ingestSmartFactoryDocument,
  normalizeKnowledgeBaseForTraining,
} from './knowledgeIngestion.mjs';

test('ingests text document into ready chunks with stable metadata', () => {
  const document = ingestSmartFactoryDocument({
    knowledgeBaseId: 'kb-1',
    document: {
      id: 'doc-1',
      title: '退货规则',
      content: '第一段：签收后 7 天内可以申请退货。\n\n第二段：商品需要保留原包装。',
    },
  });

  assert.equal(document.id, 'doc-1');
  assert.equal(document.status, 'ready');
  assert.equal(document.chunkCount, 2);
  assert.deepEqual(document.chunks.map((chunk) => chunk.title), ['退货规则', '退货规则']);
  assert.equal(document.chunks[0].knowledgeBaseId, 'kb-1');
  assert.match(document.chunks[0].content, /7 天内/);
});

test('normalizes knowledge base training state from raw documents', () => {
  const kb = normalizeKnowledgeBaseForTraining({
    id: 'kb-1',
    name: '售后知识库',
    documents: [
      { id: 'doc-1', title: '退货规则', content: '7 天内可退货。' },
      { id: '', title: '空文档', content: '' },
    ],
  });

  assert.equal(kb.status, 'partial_failed');
  assert.equal(kb.documentCount, 2);
  assert.equal(kb.readyDocumentCount, 1);
  assert.equal(kb.failedDocumentCount, 1);
  assert.equal(kb.chunkCount, 1);
  assert.equal(kb.documents[0].status, 'ready');
});

test('ingests faq documents with strategy metadata and chunk ids', () => {
  const document = ingestSmartFactoryDocument({
    knowledgeBaseId: 'kb-faq',
    document: {
      id: 'doc-faq',
      title: '售后 FAQ',
      sourceType: 'file',
      fileName: '售后FAQ.txt',
      chunkStrategy: 'faq',
      maxChunkChars: 120,
      content: [
        'Q: 退货规则是什么？',
        'A: 签收后 7 天内可以申请退货。',
        '',
        'Q: 换货规则是什么？',
        'A: 质量问题 15 天内可以申请换货。',
      ].join('\n'),
    },
  });

  assert.equal(document.status, 'ready');
  assert.equal(document.chunkStrategy, 'faq');
  assert.equal(document.maxChunkChars, 120);
  assert.equal(document.fileName, '售后FAQ.txt');
  assert.equal(document.chunkCount, 2);
  assert.deepEqual(document.chunks.map((chunk) => chunk.id), ['doc-faq-chunk-1', 'doc-faq-chunk-2']);
  assert.deepEqual(document.chunks.map((chunk) => chunk.chunkIndex), [0, 1]);
  assert.equal(document.chunks[0].sourceType, 'file');
  assert.match(document.chunks[0].content, /退货规则/);
});

test('keeps failed documents visible instead of silently dropping them', () => {
  const kb = normalizeKnowledgeBaseForTraining({
    id: 'kb-quality',
    name: '质量知识库',
    documents: [
      { id: 'doc-ready', title: '质检规则', content: '质检通过后才能入库。' },
      { id: 'doc-empty', title: '空文件', content: '' },
    ],
  });

  assert.equal(kb.status, 'partial_failed');
  assert.equal(kb.documentCount, 2);
  assert.equal(kb.readyDocumentCount, 1);
  assert.equal(kb.failedDocumentCount, 1);
  assert.equal(kb.documents.find((document) => document.id === 'doc-empty').status, 'failed');
  assert.match(kb.documents.find((document) => document.id === 'doc-empty').error, /文档内容为空/);
});

test('preserves trained chunk embeddings when re-normalizing the same document', () => {
  const kb = normalizeKnowledgeBaseForTraining({
    id: 'kb-trained',
    name: '已训练知识库',
    documents: [{
      id: 'doc-trained',
      title: '退货规则',
      content: '签收后 7 天内可以申请退货。',
      chunks: [{
        id: 'doc-trained-chunk-1',
        content: '签收后 7 天内可以申请退货。',
        embedding: [0.1, 0.2, 0.3],
        embeddingModel: { provider: 'openai_compatible', model: 'text-embedding-3-large' },
        embeddedAt: 1782300000000,
      }],
    }],
  });

  assert.deepEqual(kb.documents[0].chunks[0].embedding, [0.1, 0.2, 0.3]);
  assert.deepEqual(kb.documents[0].chunks[0].embeddingModel, {
    provider: 'openai_compatible',
    model: 'text-embedding-3-large',
  });
  assert.equal(kb.documents[0].chunks[0].embeddedAt, 1782300000000);
});
