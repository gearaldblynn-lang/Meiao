import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFY_MODEL_CONFIG_SOURCE_NOTICE,
  toPublicModelProviderCatalog,
  validateModelConfig,
} from './modelConfigValidator.mjs';

const catalog = [
  {
    provider: 'openai_compatible',
    label: '中转模型',
    credentials: { apiKey: 'sk-secret' },
    models: [
      { id: 'gpt-5.5', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'gpt-5.4', mode: 'chat', features: ['tool-call'] },
    ],
  },
  {
    provider: 'volcengine',
    label: '火山方舟',
    credentials: { apiKey: 'ark-secret' },
    models: [{ id: 'doubao-embedding', mode: 'embedding', features: ['embedding'] }],
  },
];

test('model config validator preserves Dify source metadata', () => {
  assert.equal(DIFY_MODEL_CONFIG_SOURCE_NOTICE.commit, '599d92ef6b59adcaffc82f5231391749fa1ef94c');
  assert.ok(DIFY_MODEL_CONFIG_SOURCE_NOTICE.paths.includes('api/core/app/app_config/easy_ui_based_app/model_config/manager.py'));
});

test('validates model provider name and defaults stop sequences', () => {
  const result = validateModelConfig({
    model: {
      provider: 'openai_compatible',
      name: 'gpt-5.5',
      completion_params: { temperature: 0.2 },
    },
  }, catalog);

  assert.deepEqual(result, {
    model: {
      provider: 'openai_compatible',
      name: 'gpt-5.5',
      mode: 'chat',
      completion_params: { temperature: 0.2, stop: [] },
    },
  });
});

test('rejects missing or unknown model config values', () => {
  assert.throws(() => validateModelConfig({}, catalog), /model is required/);
  assert.throws(
    () => validateModelConfig({ model: { provider: 'missing', name: 'gpt-5.5', completion_params: {} } }, catalog),
    /model.provider is required and must be in/
  );
  assert.throws(
    () => validateModelConfig({ model: { provider: 'openai_compatible', name: 'unknown', completion_params: {} } }, catalog),
    /model.name must be in the specified model list/
  );
});

test('rejects invalid completion params and too many stop sequences', () => {
  assert.throws(
    () => validateModelConfig({ model: { provider: 'openai_compatible', name: 'gpt-5.5', completion_params: { stop: 'END' } } }, catalog),
    /stop in model.completion_params must be of list type/
  );
  assert.throws(
    () => validateModelConfig({ model: { provider: 'openai_compatible', name: 'gpt-5.5', completion_params: { stop: ['a', 'b', 'c', 'd', 'e'] } } }, catalog),
    /stop sequences must be less than 4/
  );
});

test('public model provider catalog strips credentials', () => {
  const publicCatalog = toPublicModelProviderCatalog(catalog);
  assert.deepEqual(publicCatalog[0], {
    provider: 'openai_compatible',
    label: '中转模型',
    models: [
      { id: 'gpt-5.5', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'gpt-5.4', mode: 'chat', features: ['tool-call'] },
    ],
  });
  assert.equal(JSON.stringify(publicCatalog).includes('secret'), false);
});
