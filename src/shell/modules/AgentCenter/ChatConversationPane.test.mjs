import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const paneSource = readFileSync(new URL('../../../modules/AgentCenter/ChatConversationPane.tsx', import.meta.url), 'utf8');

test('assistant messages render through MarkdownMessage while user messages stay plain text', () => {
  assert.match(paneSource, /import MarkdownMessage from '\.\/MarkdownMessage';/);
  assert.match(paneSource, /const assistantDisplayContent = !isUser \? stripImageResultUrls\(protocolDisplayContent\) : protocolDisplayContent;/);
  assert.match(paneSource, /!isUser\s*\?\s*<MarkdownMessage content=\{assistantDisplayContent\}/);
  assert.match(paneSource, /<p className="select-text whitespace-pre-wrap break-words">\{assistantDisplayContent\}<\/p>/);
});

test('MarkdownMessage keeps raw HTML disabled and adds copy controls for code blocks', () => {
  const markdownSource = readFileSync(new URL('../../../modules/AgentCenter/MarkdownMessage.tsx', import.meta.url), 'utf8');
  assert.match(markdownSource, /react-markdown/);
  assert.match(markdownSource, /remark-gfm/);
  assert.doesNotMatch(markdownSource, /rehype-raw/);
  assert.match(markdownSource, /copyTextToClipboard\(text\)/);
});

test('streaming assistant messages render content with a typewriter cursor instead of spinner-only progress', () => {
  assert.match(paneSource, /progressStage !== 'streaming'/);
  assert.match(paneSource, /agent-streaming-cursor/);
  assert.match(paneSource, /isStreamingMessage/);
});

test('image generation progress exposes validation and retry stages', () => {
  assert.match(paneSource, /正在检查生成结果/);
  assert.match(paneSource, /生成结果未通过检查，准备重试/);
  assert.match(paneSource, /正在根据检查结果重新生成/);
  assert.match(paneSource, /key: 'image_validating'/);
});
