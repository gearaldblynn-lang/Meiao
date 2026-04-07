import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('image generation analysis prompt can include retrieved knowledge snippets', () => {
  assert.match(serverSource, /knowledgeChunks = \[\]/);
  assert.match(serverSource, /知识库参考：/);
  assert.match(serverSource, /你必须优先遵守这些规则/);
});

test('image generation requests retrieve knowledge before analysis in both db and local modes', () => {
  assert.match(serverSource, /const imageKnowledgeChunks = requestMode === 'image_generation' && version\.retrievalPolicy\?\.enabled/);
  assert.match(serverSource, /searchKnowledgeChunks\(await listDbKnowledgeChunksForVersion\(version\), content,/);
  assert.match(serverSource, /searchKnowledgeChunks\(listLocalKnowledgeChunksForVersion\(store, version\), content,/);
  assert.match(serverSource, /knowledgeChunks: imageKnowledgeChunks/);
});

test('image generation keeps conversation image context across uploaded and generated images', () => {
  assert.match(serverSource, /const buildConversationImageCatalog = \(attachments = \[\], priorMessages = \[\], maxReferenceImages = 10\) =>/);
  assert.match(serverSource, /source: 'current_upload'/);
  assert.match(serverSource, /source: 'history_attachment'/);
  assert.match(serverSource, /source: 'previous_result'/);
  assert.match(serverSource, /若本轮有新上传图，新上传图会优先排在前面；其后才是历史上传图、历史生成图。/);
  assert.match(serverSource, /如果用户没有明确指定使用哪张图，你要根据当前需求自动判断最合适的参考图/);
});

test('image generation analysis keeps text conversation context and summary', () => {
  assert.match(serverSource, /const buildImageConversationTextContext = \(priorMessages = \[\], maxRounds = 6, summary = ''\) =>/);
  assert.match(serverSource, /最近对话上下文：/);
  assert.match(serverSource, /会话摘要：/);
  assert.match(serverSource, /你必须结合最近几轮对话来理解“继续调整”“按上一版修改”“保持刚才风格”这类指代/);
  assert.match(serverSource, /conversationSummary: summary/);
});

test('image generation prefers editing the latest generated result when user asks to adjust layout against a new reference', () => {
  assert.match(serverSource, /const buildImageEditPreferenceHints = \(\{ userMessage = '', imageReferences = \[\] \}\) =>/);
  assert.match(serverSource, /不得因为上传了新的参考图，就直接把新图当成新的主体内容来源/);
  assert.match(serverSource, /优先把最近一张历史生成图作为主编辑对象/);
  assert.match(serverSource, /const preferredInputImageUrls = editPreferenceHints\.preferPreviousResultAsPrimary/);
  assert.match(serverSource, /以最近一张历史生成图为主编辑对象/);
});
