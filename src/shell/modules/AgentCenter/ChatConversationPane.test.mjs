import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const paneSource = readFileSync(new URL('../../../modules/AgentCenter/ChatConversationPane.tsx', import.meta.url), 'utf8');

test('assistant messages render through MarkdownMessage while user messages stay plain text', () => {
  assert.match(paneSource, /import MarkdownMessage from '\.\/MarkdownMessage';/);
  assert.match(paneSource, /!isUser\s*\?\s*<MarkdownMessage content=\{displayContent\}/);
  assert.match(paneSource, /<p className="select-text whitespace-pre-wrap break-words">\{displayContent\}<\/p>/);
});

test('MarkdownMessage keeps raw HTML disabled and adds copy controls for code blocks', () => {
  const markdownSource = readFileSync(new URL('../../../modules/AgentCenter/MarkdownMessage.tsx', import.meta.url), 'utf8');
  assert.match(markdownSource, /react-markdown/);
  assert.match(markdownSource, /remark-gfm/);
  assert.doesNotMatch(markdownSource, /rehype-raw/);
  assert.match(markdownSource, /navigator\.clipboard\.writeText/);
});
