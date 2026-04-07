import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentPromptMessages,
  buildConversationSummary,
  chunkKnowledgeText,
  KNOWLEDGE_CHUNK_STRATEGY_META,
  createDefaultVersionName,
  estimateCostByTokens,
  estimateTokenCount,
  normalizeAgentConfig,
  normalizeKnowledgeChunkStrategy,
  resolveActiveAgentId,
  searchKnowledgeChunks,
} from './agentCenterUtils.mjs';

test('normalizeAgentConfig fills in missing policy defaults', () => {
  const config = normalizeAgentConfig({ systemPrompt: '  expert  ' });

  assert.equal(config.systemPrompt, 'expert');
  assert.equal(config.modelPolicy.defaultModel, 'doubao-seed-1-6-thinking-250715');
  assert.equal(config.modelPolicy.cheapModel, 'doubao-seed-1-6-flash-250615');
  assert.equal(config.modelPolicy.multimodalModel, 'nano-banana-2');
  assert.equal(config.modelPolicy.imageGenerationEnabled, false);
  assert.equal(config.retrievalPolicy.topK, 3);
  assert.equal(config.toolPolicy.supportsFileInput, false);
});

test('chunkKnowledgeText splits long paragraphs into bounded chunks', () => {
  const longText = `第一段内容。\n\n${'A'.repeat(900)}`;
  const chunks = chunkKnowledgeText(longText, { maxChunkChars: 300 });

  assert.equal(chunks[0], '第一段内容。');
  assert.equal(chunks.length, 4);
  assert.ok(chunks.every((chunk) => chunk.length <= 300));
});

test('chunkKnowledgeText uses rule strategy to keep rule blocks more complete', () => {
  const text = `规则：默认比例\n触发条件：\n- 用户未说明比例\n处理策略：\n- aspect_ratio = auto\n\n规则：赠品大小\n触发条件：\n- 存在赠品\n处理策略：\n- 赠品缩小`;
  const chunks = chunkKnowledgeText(text, { strategy: 'rule' });

  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /默认比例/);
  assert.match(chunks[1], /赠品大小/);
});

test('chunkKnowledgeText uses faq strategy to split by question answer units', () => {
  const text = `Q：没写比例怎么办？\nA：默认 auto。\n\nQ：赠品能放大吗？\nA：不建议。`;
  const chunks = chunkKnowledgeText(text, { strategy: 'faq' });

  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /没写比例怎么办/);
  assert.match(chunks[1], /赠品能放大吗/);
});

test('knowledge chunk strategy helpers expose safe defaults', () => {
  assert.equal(normalizeKnowledgeChunkStrategy('rule'), 'rule');
  assert.equal(normalizeKnowledgeChunkStrategy('unknown'), 'general');
  assert.equal(KNOWLEDGE_CHUNK_STRATEGY_META.rule.maxChunkChars, 360);
});

test('searchKnowledgeChunks prioritizes relevant faq and sop snippets', () => {
  const results = searchKnowledgeChunks(
    [
      { id: '1', content: '退款流程需要先登记售后工单，再联系仓库。', sourceType: 'sop', documentTitle: '退款SOP' },
      { id: '2', content: '客服话术：如未找到订单，请先确认手机号。', sourceType: 'faq', documentTitle: '客服FAQ' },
      { id: '3', content: '买家秀案例展示', sourceType: 'case', documentTitle: '案例库' },
    ],
    '退款流程怎么走',
    { topK: 2, maxChunks: 2, similarityThreshold: 1, maxContextChars: 1000, sourcePriority: ['faq', 'sop', 'case'] }
  );

  assert.equal(results.length, 2);
  assert.equal(results[0].id, '1');
  assert.equal(results[1].id, '2');
});

test('buildAgentPromptMessages combines system prompt, summary, knowledge and current message', () => {
  const messages = buildAgentPromptMessages({
    systemPrompt: '你是售后专家',
    summary: '用户正在咨询退款',
    recentMessages: [{ role: 'assistant', content: '请提供订单号。' }],
    knowledgeChunks: [{ content: '退款前需要登记售后工单。', sourceType: 'sop', documentTitle: '退款SOP' }],
    userMessage: '现在想退款',
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[1].content, /会话摘要/);
  assert.match(messages[2].content, /退款SOP/);
  assert.equal(messages.at(-1)?.content, '现在想退款');
});

test('summary, token estimate, and cost estimate stay bounded and deterministic', () => {
  const summary = buildConversationSummary([
    { role: 'user', content: '第一句' },
    { role: 'assistant', content: '第二句' },
  ], 20);

  assert.ok(summary.includes('用户：第一句'));
  assert.equal(estimateTokenCount('12345678'), 2);
  assert.equal(estimateCostByTokens(1000, 500), 0.003);
});

test('createDefaultVersionName builds an editable default label from version number and timestamp', () => {
  const result = createDefaultVersionName(3, new Date('2026-04-03T14:30:45+08:00').getTime());

  assert.equal(result, 'V3 · 2026-04-03 14:30');
});

test('resolveActiveAgentId keeps plaza preview independent from previously selected sessions', () => {
  assert.equal(
    resolveActiveAgentId({
      workspacePage: 'plaza',
      selectedAgentId: 'agent-preview',
      selectedSession: { agentId: 'agent-session' },
    }),
    'agent-preview'
  );

  assert.equal(
    resolveActiveAgentId({
      workspacePage: 'chat',
      selectedAgentId: 'agent-preview',
      selectedSession: { agentId: 'agent-session' },
    }),
    'agent-session'
  );
});
