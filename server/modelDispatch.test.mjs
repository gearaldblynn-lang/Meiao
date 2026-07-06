import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelForNeed } from './modelDispatch.mjs';

const registryFixture = {
  providers: [
    {
      provider: 'relay-main',
      models: [
        { id: 'chat-basic', mode: 'chat', features: ['tool-call'] },
        { id: 'chat-web', mode: 'chat', features: ['tool-call', 'web-search', 'streaming'] },
        { id: 'embed-1', mode: 'embedding', features: ['embedding'] },
      ],
    },
    {
      provider: 'relay-backup',
      models: [
        { id: 'chat-web-2', mode: 'chat', features: ['web-search', 'streaming'] },
        { id: 'image-1', mode: 'image', features: ['image-generation'] },
      ],
    },
  ],
};

test('优先级①:preferredModel 非空永远最高,直接返回', () => {
  const result = resolveModelForNeed({
    need: 'chat',
    preferredModel: '  user-picked-model  ',
    registry: registryFixture,
    env: { MEIAO_DEFAULT_CHAT_MODEL: 'env-chat-model' },
  });
  assert.deepEqual(result, { model: 'user-picked-model', source: 'preferred' });
});

test('优先级②:need=chat 映射 MEIAO_DEFAULT_CHAT_MODEL,env 有值即用', () => {
  const result = resolveModelForNeed({
    need: 'chat',
    registry: registryFixture,
    env: { MEIAO_DEFAULT_CHAT_MODEL: ' env-chat-model ' },
  });
  assert.deepEqual(result, { model: 'env-chat-model', source: 'env' });
});

test('优先级②:need=kie-chat 映射 KIE_CHAT_MODEL', () => {
  const result = resolveModelForNeed({
    need: 'kie-chat',
    env: { KIE_CHAT_MODEL: 'kie-model', MEIAO_DEFAULT_CHAT_MODEL: 'other' },
  });
  assert.deepEqual(result, { model: 'kie-model', source: 'env' });
});

test('优先级②:need=analysis 按 analysisKind 分流 planning/agent 两个 env', () => {
  const env = {
    MEIAO_PLANNING_ANALYSIS_MODEL: 'planning-model',
    MEIAO_AGENT_ANALYSIS_MODEL: 'agent-model',
  };
  assert.deepEqual(
    resolveModelForNeed({ need: 'analysis', analysisKind: 'planning', env }),
    { model: 'planning-model', source: 'env' },
  );
  assert.deepEqual(
    resolveModelForNeed({ need: 'analysis', analysisKind: 'agent', env }),
    { model: 'agent-model', source: 'env' },
  );
});

test('优先级②:analysisKind 只配了另一个 env 时不串用', () => {
  const env = { MEIAO_AGENT_ANALYSIS_MODEL: 'agent-model' };
  const result = resolveModelForNeed({ need: 'analysis', analysisKind: 'planning', env });
  assert.notEqual(result.source, 'env');
});

test('优先级②:env 值仅空白视为未配置,继续往下走', () => {
  const result = resolveModelForNeed({
    need: 'chat',
    registry: registryFixture,
    env: { MEIAO_DEFAULT_CHAT_MODEL: '   ' },
  });
  assert.equal(result.source, 'registry');
});

test('优先级③:注册表按 mode+capabilities 全匹配选第一个', () => {
  const result = resolveModelForNeed({
    need: 'chat',
    capabilities: ['web-search', 'streaming'],
    registry: registryFixture,
    env: {},
  });
  assert.deepEqual(result, { model: 'chat-web', source: 'registry' });
});

test('优先级③:capabilities 为空时选该 mode 第一个模型', () => {
  const result = resolveModelForNeed({ need: 'chat', registry: registryFixture, env: {} });
  assert.deepEqual(result, { model: 'chat-basic', source: 'registry' });

  const embedding = resolveModelForNeed({ need: 'embedding', registry: registryFixture, env: {} });
  assert.deepEqual(embedding, { model: 'embed-1', source: 'registry' });

  const image = resolveModelForNeed({ need: 'image', registry: registryFixture, env: {} });
  assert.deepEqual(image, { model: 'image-1', source: 'registry' });
});

test('优先级③:capabilities 标签归一后匹配(大小写/下划线)', () => {
  const result = resolveModelForNeed({
    need: 'chat',
    capabilities: ['WEB_SEARCH'],
    registry: registryFixture,
    env: {},
  });
  assert.deepEqual(result, { model: 'chat-web', source: 'registry' });
});

test('优先级④:无匹配返回空模型 fallback,不臆造模型名', () => {
  assert.deepEqual(
    resolveModelForNeed({ need: 'chat', capabilities: ['direct-result'], registry: registryFixture, env: {} }),
    { model: '', source: 'fallback' },
  );
  assert.deepEqual(
    resolveModelForNeed({ need: 'chat', registry: { providers: [] }, env: {} }),
    { model: '', source: 'fallback' },
  );
  assert.deepEqual(
    resolveModelForNeed({ need: 'chat', env: {} }),
    { model: '', source: 'fallback' },
  );
});

test('纯函数:env 与 registry 全靠注入,不读全局状态', () => {
  const before = process.env.MEIAO_DEFAULT_CHAT_MODEL;
  process.env.MEIAO_DEFAULT_CHAT_MODEL = 'global-should-not-leak';
  try {
    const result = resolveModelForNeed({ need: 'chat', env: {} });
    assert.deepEqual(result, { model: '', source: 'fallback' });
  } finally {
    if (before === undefined) delete process.env.MEIAO_DEFAULT_CHAT_MODEL;
    else process.env.MEIAO_DEFAULT_CHAT_MODEL = before;
  }
});
