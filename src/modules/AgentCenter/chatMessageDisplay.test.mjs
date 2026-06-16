import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisibleMessageText, resolveRegenerateRequest } from './chatMessageDisplay.mjs';

test('getVisibleMessageText hides provider image urls from image generation summaries', () => {
  const text = getVisibleMessageText({
    role: 'assistant',
    content: '已经把图片上的中文改成更自然的韩文广告表达了：\nhttps://tempfile.aiquickdraw.com/images/chatgpt/file_abc.png',
    metadata: { requestMode: 'image_generation' },
  });

  assert.equal(text, '已经把图片上的中文改成更自然的韩文广告表达了');
  assert.doesNotMatch(text, /aiquickdraw\.com\/images/);
});

test('getVisibleMessageText hides legacy provider image urls from old assistant text replies', () => {
  const text = getVisibleMessageText({
    role: 'assistant',
    content: '画好了，一只可爱的橘猫在这里：\nhttps://tempfile.aiquickdraw.com/images/chatgpt/file_abc.png',
    metadata: { requestMode: 'chat' },
  });

  assert.equal(text, '画好了，一只可爱的橘猫在这里');
  assert.doesNotMatch(text, /aiquickdraw\.com\/images/);
});

test('getVisibleMessageText keeps normal markdown answer text', () => {
  const text = getVisibleMessageText({
    role: 'assistant',
    content: 'final_answer\n\n## 标题\n\n- A\n- B',
    metadata: { requestMode: 'chat' },
  });

  assert.equal(text, '## 标题\n\n- A\n- B');
});

test('resolveRegenerateRequest keeps image generation mode and original run options', () => {
  const assistant = {
    role: 'assistant',
    content: '已生成图片',
    metadata: {
      requestMode: 'image_generation',
      selectedModel: 'gpt-5.5',
      reasoningLevel: 'high',
      webSearchEnabled: true,
    },
  };
  const user = {
    role: 'user',
    content: '把图1文字改韩文',
    attachments: [{ name: '图1', kind: 'image', url: '/assets/a.png' }],
  };

  assert.deepEqual(resolveRegenerateRequest({ assistantMessage: assistant, previousUserMessage: user }), {
    content: '把图1文字改韩文',
    sourceAttachments: [{ name: '图1', kind: 'image', url: '/assets/a.png' }],
    requestMode: 'image_generation',
    selectedModel: 'gpt-5.5',
    reasoningLevel: 'high',
    webSearchEnabled: true,
  });
});

test('resolveRegenerateRequest defaults normal assistant messages to chat mode', () => {
  const assistant = { role: 'assistant', content: '回答', metadata: { selectedModel: 'gpt-5.4' } };
  const user = { role: 'user', content: '解释一下', attachments: [] };

  assert.equal(resolveRegenerateRequest({ assistantMessage: assistant, previousUserMessage: user }).requestMode, 'chat');
});
