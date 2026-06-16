import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterChatModelsByChannel,
  getChatModelChannelMeta,
  orderChatModelsBySelection,
  resolveDefaultAllowedChatModels,
  shouldRefreshCreateWizardChatModels,
} from './chatModelAllowlist.ts';

test('新中转站模型可用时默认作为新建智能体对话模型', () => {
  const selected = resolveDefaultAllowedChatModels([
    { id: 'gpt-5-4-openai-resp', provider: 'kie' },
    { id: 'gemini-3-flash-openai', provider: 'kie' },
    { id: 'gpt-5.4', provider: 'openai_compatible' },
    { id: 'gpt-5.5', provider: 'openai_compatible' },
  ]);

  assert.deepEqual(selected, ['gpt-5.4', 'gpt-5.5']);
});

test('新建向导仍是旧默认模型时可在中转站模型晚到后刷新', () => {
  const shouldRefresh = shouldRefreshCreateWizardChatModels(
    [
      { id: 'gpt-5-4-openai-resp', provider: 'kie' },
      { id: 'gemini-3-flash-openai', provider: 'kie' },
      { id: 'gpt-5.4', provider: 'openai_compatible' },
      { id: 'gpt-5.5', provider: 'openai_compatible' },
    ],
    ['gpt-5-4-openai-resp', 'gemini-3-flash-openai']
  );

  assert.equal(shouldRefresh, true);
});

test('新建向导已有手动模型选择时不中途覆盖', () => {
  const shouldRefresh = shouldRefreshCreateWizardChatModels(
    [
      { id: 'gpt-5-4-openai-resp', provider: 'kie' },
      { id: 'gemini-3-flash-openai', provider: 'kie' },
      { id: 'gpt-5.4', provider: 'openai_compatible' },
      { id: 'gpt-5.5', provider: 'openai_compatible' },
    ],
    ['claude-sonnet-4-6']
  );

  assert.equal(shouldRefresh, false);
});

test('模型卡片优先展示当前已选模型', () => {
  const ordered = orderChatModelsBySelection(
    [
      { id: 'gpt-5-4-openai-resp', provider: 'kie' },
      { id: 'claude-sonnet-4-6', provider: 'kie' },
      { id: 'gpt-5.4', provider: 'openai_compatible' },
      { id: 'gpt-5.5', provider: 'openai_compatible' },
    ],
    ['gpt-5.4', 'gpt-5.5']
  );

  assert.deepEqual(ordered.map((item) => item.id), [
    'gpt-5.4',
    'gpt-5.5',
    'gpt-5-4-openai-resp',
    'claude-sonnet-4-6',
  ]);
});

test('聊天模型渠道说明区分中转站和 KIE 托管影响', () => {
  const relay = getChatModelChannelMeta({ provider: 'openai_compatible' });
  const kie = getChatModelChannelMeta({ provider: 'kie' });

  assert.equal(relay.label, '中转站');
  assert.match(relay.impact, /tool calling/);
  assert.match(relay.impact, /生图工具/);
  assert.equal(kie.label, 'KIE 托管');
  assert.match(kie.impact, /普通聊天/);
  assert.match(kie.impact, /后备/);
});

test('聊天模型可按渠道筛选', () => {
  const models = [
    { id: 'gpt-5.4', provider: 'openai_compatible' },
    { id: 'gpt-5-4-openai-resp', provider: 'kie' },
    { id: 'claude-sonnet-4-6', provider: 'kie' },
  ];

  assert.deepEqual(filterChatModelsByChannel(models, 'all').map((item) => item.id), [
    'gpt-5.4',
    'gpt-5-4-openai-resp',
    'claude-sonnet-4-6',
  ]);
  assert.deepEqual(filterChatModelsByChannel(models, 'openai_compatible').map((item) => item.id), ['gpt-5.4']);
  assert.deepEqual(filterChatModelsByChannel(models, 'kie').map((item) => item.id), [
    'gpt-5-4-openai-resp',
    'claude-sonnet-4-6',
  ]);
});
