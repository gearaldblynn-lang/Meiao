import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleChatwootAiWebhook,
  resolveChatwootAiConfig,
} from './chatwootAiResponder.mjs';

test('resolveChatwootAiConfig accepts VITE Chatwoot env aliases for local webhook testing', () => {
  assert.deepEqual(resolveChatwootAiConfig({
    VITE_CHATWOOT_BASE_URL: 'http://127.0.0.1:3001/',
    VITE_CHATWOOT_ACCOUNT_ID: '1',
    VITE_CHATWOOT_INBOX_ID: '7',
    VITE_CHATWOOT_API_TOKEN: 'token',
    OPENAI_COMPATIBLE_API_KEY: 'sk-test',
    OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test',
    OPENAI_COMPATIBLE_MODELS: 'gpt-5.4,gemini-3-flash',
  }), {
    chatwoot: {
      baseUrl: 'http://127.0.0.1:3001',
      accountId: '1',
      inboxId: '7',
      apiToken: 'token',
    },
    openai: {
      apiKey: 'sk-test',
      baseUrl: 'https://relay.test',
      model: 'gpt-5.4',
    },
  });
});

test('handleChatwootAiWebhook replies to incoming Chatwoot messages through the configured model and Chatwoot API', async () => {
  const calls = { list: [], generate: [], send: [] };
  const result = await handleChatwootAiWebhook({
    payload: {
      event: 'message_created',
      id: 91,
      message_type: 'incoming',
      content: '这个套装敏感肌能用吗？',
      conversation: { id: 101, inbox_id: 7 },
      inbox: { id: 7 },
    },
    env: {
      CHATWOOT_BASE_URL: 'https://chatwoot.test',
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '7',
      CHATWOOT_API_TOKEN: 'token',
      OPENAI_COMPATIBLE_API_KEY: 'sk-test',
      OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test',
      OPENAI_COMPATIBLE_MODELS: 'gpt-5.4,gpt-5.5',
    },
    listMessagesImpl: async (config, conversationId) => {
      calls.list.push({ config, conversationId });
      return {
        messages: [
          { role: 'customer', content: '这个套装敏感肌能用吗？' },
          { role: 'agent', content: '可以，建议先局部测试。' },
        ],
      };
    },
    generateReplyImpl: async ({ messages, env, model }) => {
      calls.generate.push({ messages, env, model });
      return { content: '您好，敏感肌可以先做耳后局部测试，确认无不适后再使用。', modelUsed: model };
    },
    sendMessageImpl: async (config, conversationId, content) => {
      calls.send.push({ config, conversationId, content });
      return { message: { id: '200', content } };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.replyMessageId, '200');
  assert.equal(calls.list[0].conversationId, '101');
  assert.equal(calls.generate[0].model, 'gpt-5.4');
  assert.equal(calls.generate[0].messages.at(-1).content, '这个套装敏感肌能用吗？');
  assert.equal(calls.send[0].content, '您好，敏感肌可以先做耳后局部测试，确认无不适后再使用。');
});

test('handleChatwootAiWebhook skips outgoing messages to avoid reply loops', async () => {
  let called = false;
  const result = await handleChatwootAiWebhook({
    payload: {
      event: 'message_created',
      id: 92,
      message_type: 'outgoing',
      content: '客服回复',
      conversation: { id: 101, inbox_id: 7 },
      inbox: { id: 7 },
    },
    env: {
      CHATWOOT_BASE_URL: 'https://chatwoot.test',
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '7',
      CHATWOOT_API_TOKEN: 'token',
      OPENAI_COMPATIBLE_API_KEY: 'sk-test',
      OPENAI_COMPATIBLE_MODELS: 'gpt-5.4',
    },
    generateReplyImpl: async () => {
      called = true;
      return { content: '不应该生成' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});

test('handleChatwootAiWebhook skips messages from other inboxes', async () => {
  const result = await handleChatwootAiWebhook({
    payload: {
      event: 'message_created',
      id: 93,
      message_type: 'incoming',
      content: '你好',
      conversation: { id: 101, inbox_id: 9 },
      inbox: { id: 9 },
    },
    env: {
      CHATWOOT_BASE_URL: 'https://chatwoot.test',
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '7',
      CHATWOOT_API_TOKEN: 'token',
      OPENAI_COMPATIBLE_API_KEY: 'sk-test',
      OPENAI_COMPATIBLE_MODELS: 'gpt-5.4',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /inbox/i);
});
