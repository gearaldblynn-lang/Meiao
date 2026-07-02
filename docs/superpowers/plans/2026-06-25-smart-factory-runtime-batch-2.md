# Smart Factory Runtime Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next Smart Factory vertical runtime layer on top of the Dify-derived contracts, so model, knowledge, and CLI/tool capability can be exercised by tests before UI wiring.

**Architecture:** Keep Smart Factory separate from the old Agent Center. Add focused runtime helpers under `server/ai-engine/` that consume the already migrated Dify-style agent config, model config, knowledge tool contract, and tool observation contract. This batch intentionally does not add frontend UI or database migrations.

**Tech Stack:** Node `.mjs`, Node test runner, existing `server/ai-engine/*` contracts, existing RAG helper when execution is introduced.

---

## Result Slices and Acceptance

| Slice | Concrete Goal | Acceptance Command | Expected Effect |
| --- | --- | --- | --- |
| 1. Runtime request builder | Convert Smart Factory agent config into a safe model request with model identity, system prompt, knowledge tool, and enabled CLI tools. | `node --test server/ai-engine/smartFactoryRuntime.test.mjs` | A model-ready request is produced; disabled/dangerous tools are not exposed; secrets are not serialized. |
| 2. Knowledge execution adapter | Execute `knowledge_base_search({ query })` against bound knowledge chunks and return a Dify-style observation. | `node --test server/ai-engine/smartFactoryRuntime.test.mjs` | The runtime can call RAG as a tool instead of silently stuffing context. |
| 3. CLI/tool execution adapter | Execute only registered, authorized, safe CLI tool adapters and return observation text. | `node --test server/ai-engine/smartFactoryRuntime.test.mjs` | Feishu/CLI-style tools have a safe whitelist path; arbitrary shell is not possible. |
| 4. One-turn orchestration | Run one model call, execute requested tools, and return a trace the future UI can render. | `node --test server/ai-engine/smartFactoryRuntime.test.mjs` | A complete test conversation turn shows model request -> tool call -> observation trace. |
| Final gates | Ensure no project-level breakage. | `node --test server/ai-engine/*.test.mjs`, nearby server tests, `npm run lint`, `npm run build`, `git diff --check` | Batch can be safely handed to UI/API work. |

## File Structure

- Create: `server/ai-engine/smartFactoryRuntime.mjs`
  - Builds model requests and later executes Smart Factory tools.
- Create: `server/ai-engine/smartFactoryRuntime.test.mjs`
  - TDD coverage for each slice.
- Modify: `docs/superpowers/specs/2026-06-25-dify-source-map.md`
  - Record Batch 2 runtime files after implementation.

## Task 1: Runtime Request Builder

**Files:**
- Create: `server/ai-engine/smartFactoryRuntime.test.mjs`
- Create: `server/ai-engine/smartFactoryRuntime.mjs`

- [x] **Step 1: Write failing test**

Create `server/ai-engine/smartFactoryRuntime.test.mjs` with a test that imports `buildSmartFactoryModelRequest` and asserts:

```js
const request = buildSmartFactoryModelRequest({
  agentConfig: {
    prompt: { system_prompt: '你是电商运营智能体' },
    model: {
      plugin_id: 'openai-compatible',
      model_provider: 'openai_compatible',
      model: 'gpt-5.5',
      credential_ref: { id: 'cred-1', value: 'sk-secret' },
    },
    knowledge: { datasets: [{ id: 'kb-1', name: '售后知识库' }] },
    tools: {
      cli_tools: [{
        name: 'feishu_create_sheet',
        description: '创建飞书表格',
        invoke_metadata: {
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
            additionalProperties: false,
          },
        },
        authorization_status: 'authorized',
        risk_level: 'safe',
      }, {
        name: 'dangerous_shell',
        description: '不应暴露',
        authorization_status: 'authorized',
        risk_level: 'dangerous',
      }],
    },
  },
  modelCatalog: [{
    provider: 'openai_compatible',
    models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
  }],
  messages: [{ role: 'user', content: '创建日报表' }],
});
```

Expected:
- `request.model.provider === 'openai_compatible'`
- `request.model.name === 'gpt-5.5'`
- tool names include `knowledge_base_search` and `feishu_create_sheet`
- tool names do not include `dangerous_shell`
- serialized request does not include `sk-secret`

- [x] **Step 2: Verify RED**

Run:

```bash
node --test server/ai-engine/smartFactoryRuntime.test.mjs
```

Expected: FAIL with module not found or missing export.

- [x] **Step 3: Implement request builder**

Create `server/ai-engine/smartFactoryRuntime.mjs` exporting:

```js
buildSmartFactoryModelRequest({ agentConfig, modelCatalog, messages })
```

It must:
- normalize Smart Factory config through `normalizeSmartFactoryAgentConfig`.
- validate model through `validateModelConfig`.
- always expose `knowledge_base_search` when datasets exist.
- expose only enabled, authorized, non-dangerous CLI tools.
- use CLI `invoke_metadata.parameters` as the model-visible JSON schema.
- return a request-safe object without credentials.

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --test server/ai-engine/smartFactoryRuntime.test.mjs
```

Expected: PASS.

## Task 2: Knowledge Execution Adapter

**Files:**
- Modify: `server/ai-engine/smartFactoryRuntime.test.mjs`
- Modify: `server/ai-engine/smartFactoryRuntime.mjs`

Acceptance:
- `executeSmartFactoryToolCall({ context, toolCall })` supports `knowledge_base_search`.
- It searches only chunks belonging to configured datasets.
- It returns a model observation string containing matched text and source names.
- Status: completed and covered by `executes knowledge_base_search against configured datasets only`.

## Task 3: CLI/Tool Execution Adapter

**Files:**
- Modify: `server/ai-engine/smartFactoryRuntime.test.mjs`
- Modify: `server/ai-engine/smartFactoryRuntime.mjs`

Acceptance:
- `executeSmartFactoryToolCall` can execute `feishu_create_sheet` only when a matching executor is explicitly registered.
- Unknown CLI tool names fail before execution.
- Dangerous or disabled CLI tools are never executable.
- Status: completed and covered by `executes only registered safe cli tools and returns observation text`.

## Task 4: One-Turn Runtime Orchestration

**Files:**
- Modify: `server/ai-engine/smartFactoryRuntime.test.mjs`
- Modify: `server/ai-engine/smartFactoryRuntime.mjs`

Acceptance:
- `runSmartFactoryTurn` accepts a mocked `callModel`.
- First model request contains model, messages, and tools.
- Returned trace contains `model_request_built`, `tool_call_started`, `tool_call_completed`.
- This trace shape can be used by future frontend without exposing secrets.
- Status: completed and covered by `runs one smart factory turn with tool execution trace`.

## Final Verification

- [x] `node --test server/ai-engine/*.test.mjs`
- [x] `node --test server/jobRuntime.test.mjs server/ragRetrieval.test.mjs server/knowledgeToolDefinition.test.mjs`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `git diff --check`
