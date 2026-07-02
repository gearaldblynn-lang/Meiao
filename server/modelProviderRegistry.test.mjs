import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultModelProviderRegistry,
  deleteModelProvider,
  extractSmartFactoryModelProvidersForMigration,
  getModelProviderPresets,
  getPublicModelProviderRegistry,
  mergeModelProviderRegistryUpdate,
  normalizeModelProviderRegistry,
  upsertModelProvider,
} from './modelProviderRegistry.mjs';

test('default model provider registry excludes local model providers', () => {
  const registry = createDefaultModelProviderRegistry();
  const providerIds = registry.providers.map((provider) => provider.provider);

  assert.ok(providerIds.includes('openai_compatible'));
  assert.ok(providerIds.includes('openai'));
  assert.ok(providerIds.includes('anthropic'));
  assert.ok(providerIds.includes('google'));
  assert.equal(providerIds.includes('ollama'), false);
  assert.equal(providerIds.includes('vllm'), false);
  assert.equal(providerIds.includes('lm_studio'), false);
});

test('public model provider registry hides raw credentials and exposes capability matrix', () => {
  const registry = normalizeModelProviderRegistry({
    providers: [{
      provider: 'relay-main',
      displayName: '主中转',
      baseUrl: 'https://relay.example.com/v1/',
      credentialRef: 'secret:relay-main',
      apiKey: 'sk-raw-should-never-return',
      defaultModel: 'gpt-5.5',
      fallbackModel: 'gpt-4.1-mini',
      models: [
        'chat:gpt-5.5',
        'embedding:text-embedding-3-large',
        'rerank:bge-reranker-v2-m3',
        'image:gpt-image-1',
        'video:sora',
      ],
    }],
  });

  const publicRegistry = getPublicModelProviderRegistry(registry);
  const provider = publicRegistry.providers.find((item) => item.provider === 'relay-main');

  assert.equal(provider.baseUrl, 'https://relay.example.com/v1');
  assert.equal(provider.hasCredential, true);
  assert.equal('credentialRef' in provider, false);
  assert.equal('apiKey' in provider, false);
  assert.deepEqual(provider.capabilityCounts, {
    chat: 1,
    embedding: 1,
    rerank: 1,
    image: 1,
    video: 1,
  });
});

test('model provider registry migrates existing smart factory providers', () => {
  const migrated = extractSmartFactoryModelProvidersForMigration({
    smartFactory: {
      modelProviders: [{
        provider: 'custom_relay',
        displayName: '自定义中转',
        baseUrl: 'https://relay.example.com/v1',
        credentialRef: 'env:CUSTOM_RELAY_API_KEY',
        models: [
          { id: 'your-chat-model', mode: 'chat', features: ['tool-call'] },
          { id: 'your-embedding-model', mode: 'embedding', features: ['embedding'] },
        ],
      }],
    },
  });

  assert.equal(migrated.providers.length, 1);
  assert.equal(migrated.providers[0].provider, 'custom_relay');
  assert.equal(migrated.providers[0].models[1].mode, 'embedding');
});

test('registry CRUD preserves selected defaults and deletes providers safely', () => {
  const registry = createDefaultModelProviderRegistry();
  const withRelay = upsertModelProvider(registry, {
    provider: 'relay-main',
    displayName: '主中转',
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-local-only',
    modelsText: 'chat:gpt-5.5\nembedding:text-embedding-3-large\nvideo:sora',
    defaultModel: 'gpt-5.5',
    fallbackModel: 'sora',
  });

  const relay = withRelay.providers.find((item) => item.provider === 'relay-main');
  assert.equal(relay.credentialRef, 'secret:relay-main');
  assert.equal(relay.defaultModel, 'gpt-5.5');
  assert.equal(relay.fallbackModel, 'sora');

  const withoutRelay = deleteModelProvider(withRelay, 'relay-main');
  assert.equal(withoutRelay.providers.some((item) => item.provider === 'relay-main'), false);

  const merged = mergeModelProviderRegistryUpdate(registry, { providers: withRelay.providers });
  assert.equal(merged.providers.some((item) => item.provider === 'relay-main'), true);
});

test('model provider presets include mature cloud and relay channels only', () => {
  const presets = getModelProviderPresets();
  const ids = presets.map((item) => item.provider);

  assert.deepEqual(ids.includes('openai_compatible'), true);
  assert.deepEqual(ids.includes('openrouter'), true);
  assert.deepEqual(ids.includes('ollama'), false);
  assert.ok(presets.some((item) => item.models.some((model) => model.mode === 'image')));
  assert.ok(presets.some((item) => item.models.some((model) => model.mode === 'video')));
});
