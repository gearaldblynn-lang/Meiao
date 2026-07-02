# Smart Factory Dify Migration Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Dify-derived Smart Factory core layer for A. model relay + agent config, B. knowledge RAG tool contract, and C. tool/plugin/CLI schema, without changing the old Agent Center product flow.

**Architecture:** Migrate selected Dify backend contracts into a new `server/ai-engine/` boundary. This batch does not build the full UI and does not touch workflow canvas. The first runnable slice is schema + validation + tool-contract code that later conversation runtime and frontend can consume.

**Tech Stack:** Node `.mjs`, Node test runner, existing server conventions, Dify source commit `599d92ef6b59adcaffc82f5231391749fa1ef94c`.

---

## File Structure

- Create: `server/ai-engine/difySourceNotice.mjs`
  - Central source/license metadata for migrated Dify contracts.
- Create: `server/ai-engine/agentConfigSchema.mjs`
  - Dify AgentSoul-derived config normalization and validation.
- Create: `server/ai-engine/agentConfigSchema.test.mjs`
  - TDD tests for prompt/model/knowledge/tools/CLI/env/secret behavior.
- Create: `server/ai-engine/modelConfigValidator.mjs`
  - Dify model config manager-derived model config validation.
- Create: `server/ai-engine/modelConfigValidator.test.mjs`
  - Tests for provider/model/completion params validation.
- Create: `server/ai-engine/toolContract.mjs`
  - Dify tool/plugin/knowledge tool-derived schema and observation helpers.
- Create: `server/ai-engine/toolContract.test.mjs`
  - Tests for `knowledge_base_search`, tool parameter schema, and observation conversion.
- Modify: `docs/superpowers/specs/2026-06-25-dify-source-map.md`
  - Mark Batch 1 target files as selected.

## Task 1: Agent Config Schema

**Dify Sources:**
- `api/models/agent_config_entities.py`
  - `AgentSoulConfig`
  - `AgentSoulPromptConfig`
  - `AgentSoulModelConfig`
  - `AgentSoulKnowledgeConfig`
  - `AgentSoulToolsConfig`
  - `AgentCliToolConfig`
  - `AgentEnvVariableConfig`
  - `AgentSecretRefConfig`

**Files:**
- Create: `server/ai-engine/difySourceNotice.mjs`
- Create: `server/ai-engine/agentConfigSchema.mjs`
- Create: `server/ai-engine/agentConfigSchema.test.mjs`

- [x] **Step 1: Write failing tests**

Create `server/ai-engine/agentConfigSchema.test.mjs`:

```js
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
      credential_ref: { type: 'api-key', id: 'cred-1', provider: 'openai_compatible', value: 'sk-secret' },
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
        env: { variables: [{ name: 'FEISHU_APP_ID', value: 'app-id' }], secret_refs: [{ name: 'FEISHU_APP_SECRET', ref: 'secret-1', value: 'plain-secret' }] },
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
```

- [x] **Step 2: Verify RED**

Run:

```bash
node --test server/ai-engine/agentConfigSchema.test.mjs
```

Expected: FAIL with module not found.

- [x] **Step 3: Implement minimal schema**

Create `server/ai-engine/difySourceNotice.mjs` and `server/ai-engine/agentConfigSchema.mjs` with validation, normalization, source notice, and secret stripping.

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --test server/ai-engine/agentConfigSchema.test.mjs
```

Expected: PASS.

## Task 2: Model Config Validator

**Dify Sources:**
- `api/core/app/app_config/easy_ui_based_app/model_config/manager.py`
- `api/services/entities/model_provider_entities.py`

**Files:**
- Create: `server/ai-engine/modelConfigValidator.mjs`
- Create: `server/ai-engine/modelConfigValidator.test.mjs`

- [x] **Step 1: Write failing tests**

Tests must cover:
- `model` object is required.
- `model.provider` must exist in allowed providers.
- `model.name` must exist under provider models.
- `completion_params.stop` defaults to `[]`.
- more than 4 stop sequences are rejected.
- returned object does not contain credentials.

- [x] **Step 2: RED**

Run:

```bash
node --test server/ai-engine/modelConfigValidator.test.mjs
```

Expected: FAIL with module not found.

- [x] **Step 3: Implement validator**

Implement `validateModelConfig(config, catalog)` and `toPublicModelProviderCatalog(catalog)`.

- [x] **Step 4: GREEN**

Run:

```bash
node --test server/ai-engine/modelConfigValidator.test.mjs
```

Expected: PASS.

## Task 3: Knowledge and Tool Contracts

**Dify Sources:**
- `dify-agent/src/dify_agent/layers/knowledge/layer.py`
- `dify-agent/src/dify_agent/layers/dify_plugin/tools_layer.py`
- `api/core/tools/entities/tool_entities.py`

**Files:**
- Create: `server/ai-engine/toolContract.mjs`
- Create: `server/ai-engine/toolContract.test.mjs`

- [x] **Step 1: Write failing tests**

Tests must cover:
- `createKnowledgeSearchToolDefinition()` returns model-visible `knowledge_base_search` with strict `{ query }` schema.
- `normalizeToolParameters()` merges runtime parameters, model arguments, and defaults using Dify precedence.
- required hidden/manual parameters without runtime value are rejected.
- tool response observations convert text/json/link/image-style outputs into model-friendly text.

- [x] **Step 2: RED**

Run:

```bash
node --test server/ai-engine/toolContract.test.mjs
```

Expected: FAIL with module not found.

- [x] **Step 3: Implement contracts**

Implement the minimal Dify-derived tool contract helpers.

- [x] **Step 4: GREEN**

Run:

```bash
node --test server/ai-engine/toolContract.test.mjs
```

Expected: PASS.

## Task 4: Verification

- [x] **Run focused AI engine tests**

```bash
node --test server/ai-engine/*.test.mjs
```

- [x] **Run nearby regression tests**

```bash
node --test server/jobRuntime.test.mjs server/ragRetrieval.test.mjs server/knowledgeToolDefinition.test.mjs
```

- [x] **Run static gates**

```bash
npm run lint
npm run build
git diff --check
```

Expected: all exit 0; existing lint warnings are acceptable only if there are no errors.
