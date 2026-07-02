import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeModelRelayRegistry,
  selectSmartFactoryModel,
  toModelCatalog,
} from './modelRelayRegistry.mjs';

test('normalizes relay providers without leaking credentials', () => {
  const registry = normalizeModelRelayRegistry([
    {
      provider: ' relay-a ',
      baseUrlRef: 'env:RELAY_A_BASE_URL',
      credentialRef: 'env:RELAY_A_KEY',
      apiKey: 'sk-hidden',
      models: [
        { id: ' model-a ', mode: ' chat ', enabled: true, features: ['tool-call', ''] },
        { id: 'disabled-model', enabled: false },
        { id: '', mode: 'chat' },
      ],
    },
  ]);

  assert.deepEqual(registry, [{
    provider: 'relay-a',
    baseUrlRef: 'env:RELAY_A_BASE_URL',
    credentialRef: 'env:RELAY_A_KEY',
    models: [{ id: 'model-a', mode: 'chat', enabled: true, features: ['tool-call'] }],
  }]);
  assert.equal(JSON.stringify(registry).includes('sk-'), false);
  assert.equal(JSON.stringify(registry).includes('apiKey'), false);
});

test('selects requested model and falls back when disabled or missing', () => {
  const registry = normalizeModelRelayRegistry([
    {
      provider: 'relay-a',
      models: [
        { id: 'model-a', mode: 'chat', enabled: true, features: ['tool-call'] },
        { id: 'model-b', mode: 'chat', enabled: false },
      ],
    },
    {
      provider: 'relay-b',
      models: [{ id: 'model-c', mode: 'chat', enabled: true }],
    },
  ]);

  assert.deepEqual(selectSmartFactoryModel(registry, { provider: 'relay-b', model: 'model-c' }), {
    provider: 'relay-b',
    model: { id: 'model-c', mode: 'chat', enabled: true, features: [] },
    fallbackUsed: false,
  });
  assert.deepEqual(selectSmartFactoryModel(registry, { provider: 'relay-a', model: 'model-b' }), {
    provider: 'relay-a',
    model: { id: 'model-a', mode: 'chat', enabled: true, features: ['tool-call'] },
    fallbackUsed: true,
  });
});

test('converts registry to smart factory model catalog', () => {
  const catalog = toModelCatalog([
    {
      provider: 'relay-a',
      models: [{ id: 'model-a', mode: 'chat', enabled: true, features: ['tool-call'] }],
    },
  ]);

  assert.deepEqual(catalog, [{
    provider: 'relay-a',
    models: [{ id: 'model-a', mode: 'chat', features: ['tool-call'] }],
  }]);
});
