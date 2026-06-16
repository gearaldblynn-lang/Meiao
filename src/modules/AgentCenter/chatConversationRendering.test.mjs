import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ChatConversationPane.tsx', import.meta.url), 'utf8');
const displaySource = readFileSync(new URL('./chatMessageDisplay.mjs', import.meta.url), 'utf8');

test('chat conversation rendering hides provider protocol markers from old replies', () => {
  assert.match(source, /stripConversationProtocolMarkersBase/);
  assert.match(source, /const stripConversationProtocolMarkers = \(content: string\): string =>/);
  assert.match(displaySource, /final_answer/);
  assert.match(source, /const displayContent = stripConversationProtocolMarkers\(handoff \? stripHandoffBlock\(message\.content\) : message\.content\);/);
});

test('image generation result summaries do not render raw provider image urls', () => {
  assert.match(source, /stripImageResultUrlsBase/);
  assert.match(displaySource, /aiquickdraw/);
  assert.match(source, /const stripImageResultUrls = \(content: string\): string =>/);
  assert.match(source, /const summaryContent = stripImageResultUrls\(message\.content\);/);
  assert.match(source, /summaryContent \|\| '图片已生成，结果见上方图片。'/);
  assert.doesNotMatch(source, /\{message\.content\}<\/p>/);
});

test('assistant replies render a unified folded run trace across chat and image modes', () => {
  assert.match(source, /const getAssistantRunStages = \(message: AgentChatMessage\) =>/);
  assert.match(source, /思考中/);
  assert.match(source, /检索知识库/);
  assert.match(source, /联网搜索/);
  assert.match(source, /调用工具/);
  assert.match(source, /生成图片/);
  assert.match(source, /完成/);
  assert.match(source, /失败/);
  assert.match(source, /className="assistant-run-trace/);
  assert.match(source, /renderAssistantRunTrace\(message\)/);
});

test('chat conversation uses chat-first reading layout instead of assistant cards', () => {
  assert.match(source, /max-w-\[78%\]/);
  assert.match(source, /isUser \? 'rounded-\[18px\] border px-3\.5 py-2\.5' : 'px-1 py-1'/);
  assert.match(source, /background: 'transparent', borderColor: 'transparent'/);
  assert.match(source, /className="mt-1 h-7 w-7 rounded-\[10px\] text-\[10px\] opacity-70"/);
  assert.doesNotMatch(source, /shadow-\[0_8px_22px/);
});
