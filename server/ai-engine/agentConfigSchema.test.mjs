import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFY_AGENT_SOURCE_NOTICE,
  normalizeSmartFactoryAgentConfig,
  validateSmartFactoryAgentConfig,
} from './agentConfigSchema.mjs';

test('agent config preserves Dify source metadata for migration traceability', () => {
  assert.equal(DIFY_AGENT_SOURCE_NOTICE.commit, '599d92ef6b59adcaffc82f5231391749fa1ef94c');
  assert.ok(DIFY_AGENT_SOURCE_NOTICE.paths.includes('api/models/agent_config_entities.py'));
});

test('normalizes prompt model knowledge tools and env without leaking secret values', () => {
  const config = normalizeSmartFactoryAgentConfig({
    prompt: { system_prompt: '你是电商运营智能体' },
    model: {
      plugin_id: 'openai-compatible',
      model_provider: 'openai_compatible',
      model: 'gpt-5.5',
      credential_ref: {
        type: 'api-key',
        id: 'cred-1',
        provider: 'openai_compatible',
        value: 'sk-secret',
      },
      model_settings: { temperature: 0.2, stop: ['END'] },
    },
    knowledge: {
      datasets: [{ id: 'kb-1', name: '售后知识库' }],
      query_mode: 'user_query',
      query_config: { top_k: 5, score_threshold: 0.35, score_threshold_enabled: true },
    },
    tools: {
      cli_tools: [{
        id: 'cli-1',
        name: 'feishu_create_sheet',
        description: '创建飞书表格',
        command: 'feishu sheets create',
        install_commands: [' npm i -g @larksuite/cli ', ''],
        env: {
          variables: [{ name: 'FEISHU_APP_ID', value: 'app-id' }],
          secret_refs: [{ name: 'FEISHU_APP_SECRET', ref: 'secret-1', value: 'plain-secret' }],
        },
        authorization_status: 'authorized',
        risk_level: 'safe',
      }],
    },
  });

  assert.equal(config.prompt.system_prompt, '你是电商运营智能体');
  assert.equal(config.model.model_provider, 'openai_compatible');
  assert.equal(config.knowledge.datasets[0].id, 'kb-1');
  assert.deepEqual(config.tools.cli_tools[0].install_commands, ['npm i -g @larksuite/cli']);
  assert.equal(config.tools.cli_tools[0].env.secret_refs[0].ref, 'secret-1');
  assert.equal(JSON.stringify(config).includes('sk-secret'), false);
  assert.equal(JSON.stringify(config).includes('plain-secret'), false);
});

test('rejects invalid cli tools and missing model identity', () => {
  assert.throws(
    () => validateSmartFactoryAgentConfig({ model: { model_provider: '', model: '' } }),
    /model.plugin_id is required/
  );
  assert.throws(
    () => validateSmartFactoryAgentConfig({ tools: { cli_tools: [{ name: 'bad tool', command: 'rm -rf /' }] } }),
    /cli tool name must match/
  );
});
