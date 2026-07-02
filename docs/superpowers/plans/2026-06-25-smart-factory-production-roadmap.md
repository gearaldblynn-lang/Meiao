# Smart Factory Production Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在旧智能体旁边新增“智能工厂”主功能，借用 Dify 成熟的模型、Agent、RAG、工具调用能力边界，落成梅奥自己的对话式智能体工作台。

**Architecture:** 不部署完整 Dify 服务栈，不迁入完整 Dify web、租户、插件 daemon、sandbox、Docker Compose 和全量迁移体系。后端在 `server/ai-engine/` 内保留 Dify 源码/能力映射和轻量运行时边界，前端只做梅奥风格的 Codex/Claude 式工作台：对话是主入口，模型、知识库、工具、Trace 是配置和调试面板。

**Tech Stack:** Node `.mjs` 后端、Vite/React/TypeScript 前端、现有 MySQL/本地 JSON 双模式、`node:test`、源码契约测试、浏览器实测。

---

## Current Baseline

已完成阶段 0：

- 新增主功能入口：`src/shell/components/layout/SidebarNavigation.tsx` 显示 `智能工厂`，位于 `智能体` 下方。
- 旧智能体未被替换：`src/shell/modules/AgentCenter/AgentCenterModule.tsx` 不再内嵌智能工厂。
- 新增主模块：`src/shell/modules/SmartFactory/SmartFactoryModule.tsx`。
- 新增预览面板：`src/modules/AgentCenter/SmartFactoryPanel.tsx`。
- 新增预览 API：`GET /api/smart-factory/config`、`POST /api/smart-factory/preview-turn`，MySQL 和本地 JSON 两套 handler 都存在。
- 新增 Dify 能力映射：`server/ai-engine/`，包含 Agent 配置 schema、模型配置验证、工具契约、智能工厂 runtime。
- 当前预览可演示：
  - `退货规则是什么` 走知识库检索。
  - `帮我创建飞书日报表格` 走 `feishu_create_sheet` 白名单工具。
  - Trace 展示 `model_request_built`、`tool_call_started`、`tool_call_completed`。

阶段 0 验收命令：

```bash
node --test server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs server/ai-engine/*.test.mjs
node --experimental-strip-types --test src/shell/components/layout/SidebarNavigation.test.mjs src/shell/modules/AgentCenter/AgentCenterModule.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs src/services/internalApi.test.mjs
npm run lint
npm run build
```

阶段 0 浏览器验收：

- 打开 `http://localhost:3000/`。
- 左侧主功能栏显示 `智能工厂`，位置在 `智能体` 下方。
- 点击 `智能工厂` 后页面标题为 `智能工厂`。
- 发送 `退货规则是什么`，输出包含退货规则，Trace 包含 `knowledge_base_search`。
- 发送 `帮我创建飞书日报表格`，输出包含飞书表格链接，Trace 包含 `feishu_create_sheet`。

---

## Dify Borrowing Boundary

迁入/借用：

- Agent 配置结构：prompt、model、knowledge、tools 的配置边界。
- Model provider / model schema 的归一化逻辑。
- RAG 的数据集、文档、chunk、检索、引用、训练状态概念。
- Tool calling 的工具声明、参数 schema、授权状态、风险等级、执行 Trace 概念。
- Workflow 的节点/边/执行 Trace 概念，放到后期实现。

暂不迁入：

- 整个 Dify web 前端。
- 完整租户/权限体系。
- 完整 plugin daemon。
- 完整 sandbox。
- 完整 Docker Compose 服务栈。
- 完整数据库迁移体系。

原因：

- 梅奥已有登录、管理员、侧边栏、系统设置、MySQL/本地 JSON 双模式，不应被 Dify 的整套权限和前端重写。
- 当前目标是让“智能体能稳定调用模型、知识库、工具”，不是先维护一个 Dify 分叉发行版。
- 工作流编辑器等需要等模型/知识库/工具底座稳定后再做，否则 UI 看起来完整但执行不可靠。

---

## Phase 1: Smart Factory Config Foundation

**Goal:** 把当前硬编码预览配置抽成可归一化、可持久化、不会泄露密钥的智能工厂配置层。

**Files:**

- Create: `server/smartFactoryConfigStore.mjs`
- Create: `server/smartFactoryConfigStore.test.mjs`
- Modify: `server/smartFactoryPreview.mjs`
- Modify: `server/smartFactoryPreview.test.mjs`
- Modify: `server/smartFactoryPreviewRoute.test.mjs`
- Modify: `server/index.mjs`
- Modify: `src/services/internalApi.ts`
- Modify: `src/services/internalApi.test.mjs`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Test: `node --test server/smartFactoryConfigStore.test.mjs server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs`
- Test: `node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs`

**Implementation steps:**

- [ ] Write `server/smartFactoryConfigStore.test.mjs` first.
  - Assert `createDefaultSmartFactoryConfig()` returns one OpenAI-compatible model, one售后知识库, one Feishu CLI tool.
  - Assert `normalizeSmartFactoryConfig()` drops empty/invalid tools and never exposes values containing `sk-`.
  - Assert `toSmartFactoryRuntimeInputs()` returns `{ agentConfig, modelCatalog, knowledgeChunks }` compatible with `runSmartFactoryTurn`.
- [ ] Run the test and verify it fails because `server/smartFactoryConfigStore.mjs` does not exist.
- [ ] Create `server/smartFactoryConfigStore.mjs` with pure functions only.
- [ ] Refactor `server/smartFactoryPreview.mjs` to call `createDefaultSmartFactoryConfig()` and `toSmartFactoryRuntimeInputs()`.
- [ ] Add route source tests that both MySQL and local JSON handlers pass smart-factory config into preview runtime, not hardcoded defaults.
- [ ] Add `PATCH /api/smart-factory/config` only for non-secret config fields: model display name, model id, knowledge base display name, tool enabled/disabled.
- [ ] Store config in existing settings path:
  - MySQL: `system_settings.setting_value_json.smartFactory`
  - Local JSON: `store.systemSettings.smartFactory`
- [ ] Keep API response secret-free. Credential material must be stored as env/credential reference, not returned to frontend.

**Acceptance:**

```bash
node --test server/smartFactoryConfigStore.test.mjs server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs
node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs
curl -s http://127.0.0.1:3100/api/smart-factory/config
```

Visible result:

- 智能工厂配置卡仍显示模型、知识库、工具。
- 修改非密钥配置后刷新页面仍保留。
- API 响应中不出现 `sk-`、`apiKey` 原文。

---

## Phase 2: Model Relay And Multi-Model Runtime

**Goal:** 智能工厂支持接各种中转模型，并能按智能体配置选择模型。

**Files:**

- Create: `server/ai-engine/modelRelayRegistry.mjs`
- Create: `server/ai-engine/modelRelayRegistry.test.mjs`
- Modify: `server/ai-engine/modelConfigValidator.mjs`
- Modify: `server/smartFactoryConfigStore.mjs`
- Modify: `server/smartFactoryPreview.mjs`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `src/services/internalApi.ts`

**Implementation steps:**

- [ ] Test-first define relay provider shape: `providerId`, `baseUrlRef`, `credentialRef`, `models`, `capabilities`.
- [ ] Add OpenAI-compatible relay adapter that reads runtime credentials from env/system settings server-side only.
- [ ] Add model selection rules: default model, per-agent override, model disabled fallback.
- [ ] Add model request Trace fields: provider, model, tools count, knowledge datasets count, no credentials.
- [ ] Expose frontend model picker in config panel, but keep conversation panel primary.

**Acceptance:**

```bash
node --test server/ai-engine/modelRelayRegistry.test.mjs server/ai-engine/modelConfigValidator.test.mjs server/smartFactoryPreview.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryPanel.test.mjs src/services/internalApi.test.mjs
```

Visible result:

- 管理员能看到多个模型。
- 发送对话时 Trace 显示实际使用的 provider/model。
- 禁用当前模型后，系统按规则回落到可用模型或给出可读错误。

---

## Phase 3: Knowledge Base RAG And Training

**Goal:** 智能工厂拥有 Dify 风格知识库：数据集、文档、切片、训练状态、检索引用。

**Files:**

- Create: `server/ai-engine/knowledgeIngestion.mjs`
- Create: `server/ai-engine/knowledgeIngestion.test.mjs`
- Create: `server/ai-engine/knowledgeRetrieval.mjs`
- Create: `server/ai-engine/knowledgeRetrieval.test.mjs`
- Modify: `server/index.mjs`
- Modify: `src/shell/modules/SmartFactory/SmartFactoryModule.tsx`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `src/services/internalApi.ts`

**Implementation steps:**

- [ ] Test-first add document ingestion: plain text/markdown input -> normalized document -> chunks.
- [ ] Add training status: `pending` -> `chunked` -> `ready` / `failed`.
- [ ] Add retrieval function: query -> ranked chunks with `knowledgeBaseId`, `documentId`, `title`, `score`, `content`.
- [ ] Wire RAG retrieval into `runSmartFactoryTurn`.
- [ ] Add UI tab/panel for knowledge bases: list, document count, training status, retrieval test.
- [ ] Keep upload limits env-configurable and conservative.

**Acceptance:**

```bash
node --test server/ai-engine/knowledgeIngestion.test.mjs server/ai-engine/knowledgeRetrieval.test.mjs server/smartFactoryPreview.test.mjs
node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryPanel.test.mjs
```

Visible result:

- 管理员能创建知识库并添加文档。
- 文档训练完成后，对话命中知识库。
- Trace 显示命中的知识库、文档标题和 chunk 数。

---

## Phase 4: Tool / Plugin / CLI Registry

**Goal:** 智能体可以调用工具和 CLI，先落地白名单 CLI/HTTP 工具，不迁完整 Dify plugin daemon。

**Files:**

- Create: `server/ai-engine/toolRegistry.mjs`
- Create: `server/ai-engine/toolRegistry.test.mjs`
- Create: `server/ai-engine/cliToolRunner.mjs`
- Create: `server/ai-engine/cliToolRunner.test.mjs`
- Modify: `server/ai-engine/toolContract.mjs`
- Modify: `server/smartFactoryConfigStore.mjs`
- Modify: `server/smartFactoryPreview.mjs`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`

**Implementation steps:**

- [ ] Test-first define tool registry: `name`, `type`, `description`, `inputSchema`, `riskLevel`, `enabled`, `executorRef`.
- [ ] Add CLI runner with strict allowlist. No arbitrary shell string from model output.
- [ ] Add Feishu example executor contract: `feishu_create_sheet({ title }) -> link result`.
- [ ] Add tool execution timeout from env with conservative default.
- [ ] Add Trace events for tool start, completion, failure, disabled, unauthorized.
- [ ] Add UI tool panel: enable/disable, risk label, last test result.

**Acceptance:**

```bash
node --test server/ai-engine/toolRegistry.test.mjs server/ai-engine/cliToolRunner.test.mjs server/ai-engine/toolContract.test.mjs server/smartFactoryPreview.test.mjs
```

Visible result:

- 对话里要求创建飞书表格时，只能调用白名单 Feishu 工具。
- 禁用工具后，模型请求不再暴露该工具。
- 工具失败时对话给出可读错误，Trace 显示失败原因。

---

## Phase 5: Agent Definitions And Conversation Workspace

**Goal:** 智能工厂可以创建多个智能体，每个智能体有模型、知识库、工具配置和独立会话。

**Files:**

- Create: `server/ai-engine/smartFactoryAgentStore.mjs`
- Create: `server/ai-engine/smartFactoryAgentStore.test.mjs`
- Modify: `server/index.mjs`
- Modify: `src/shell/modules/SmartFactory/SmartFactoryModule.tsx`
- Create: `src/shell/modules/SmartFactory/components/ConversationWorkspace.tsx`
- Create: `src/shell/modules/SmartFactory/components/AgentConfigDrawer.tsx`
- Modify: `src/services/internalApi.ts`

**Implementation steps:**

- [ ] Test-first define agent config persistence: name, prompt, model, knowledge bindings, tool bindings, enabled flag.
- [ ] Add conversation persistence: session id, messages, trace, selected agent id.
- [ ] Build Smart Factory UI split:
  - Left: agent list / session list.
  - Center: conversation.
  - Right: config and trace drawer.
- [ ] Keep old Agent Center routes untouched.
- [ ] Add empty/error/loading states consistent with existing shell style.

**Acceptance:**

```bash
node --test server/ai-engine/smartFactoryAgentStore.test.mjs server/smartFactoryPreview.test.mjs
node --experimental-strip-types --test src/shell/modules/SmartFactory/*.test.mjs src/services/internalApi.test.mjs
npm run build
```

Visible result:

- 管理员能新建智能工厂智能体。
- 不同智能体能绑定不同模型、知识库、工具。
- 对话主窗口像 Codex/Claude 客户端，配置不抢主对话空间。

---

## Phase 6: Workflow Builder

**Goal:** 在模型、知识库、工具稳定后，再做 Dify 风格工作流编辑和执行。

**Files:**

- Create: `server/ai-engine/workflowGraph.mjs`
- Create: `server/ai-engine/workflowGraph.test.mjs`
- Create: `server/ai-engine/workflowRunner.mjs`
- Create: `server/ai-engine/workflowRunner.test.mjs`
- Create: `src/shell/modules/SmartFactory/components/WorkflowEditor.tsx`
- Modify: `src/shell/modules/SmartFactory/SmartFactoryModule.tsx`

**Implementation steps:**

- [ ] Test-first define graph schema: nodes, edges, start node, model node, knowledge node, tool node, answer node.
- [ ] Add runner that executes graph step-by-step with Trace.
- [ ] Add workflow versioning before exposing edit UI.
- [ ] Add editor UI only after runner tests pass.

**Acceptance:**

```bash
node --test server/ai-engine/workflowGraph.test.mjs server/ai-engine/workflowRunner.test.mjs
npm run build
```

Visible result:

- 能创建一个“知识库检索 -> 模型回答 -> 工具调用”的工作流。
- 运行记录显示每个节点输入、输出、耗时、错误。

---

## Phase 7: Hardening, Observability, Deployment

**Goal:** 上线前补齐可靠性、日志、权限、文档和部署验收。

**Files:**

- Modify: `server/index.mjs`
- Modify: `src/services/loggingService.ts`
- Modify: `docs/project-overview.md`
- Modify: `docs/release-and-handoff.md`
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`

**Implementation steps:**

- [ ] Add audit logs for config changes, knowledge training, tool calls.
- [ ] Add env docs for model relay, tool timeout, ingestion limits.
- [ ] Add permission checks: only admin edits config; normal user only uses assigned agents if later opened.
- [ ] Add browser acceptance script/manual checklist.
- [ ] Add deployment notes and rollback notes.

**Acceptance:**

```bash
npm run lint
npm run build
npm run doctor
node --test server/ai-engine/*.test.mjs server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs
find src -name "*.test.mjs" | xargs node --experimental-strip-types --test
git diff --check
```

Visible result:

- 本地和 MySQL 模式都能启动。
- 智能工厂配置不泄露密钥。
- 错误能在 Trace 和服务端日志里定位。
- 旧智能体功能仍可独立使用。

---

## Non-Negotiable Acceptance Gates

每个阶段都必须满足：

- 先写失败测试，再写实现。
- MySQL handler 和本地 JSON handler 不能只改一套。
- 旧智能体不被替换、不被重命名、不被强制迁移。
- 前端主入口必须保留在左侧主功能栏 `智能体` 下方。
- API 返回不得包含原始密钥、token、`sk-` 字符串。
- CLI 工具只能走白名单 executor，模型输出不能直接拼 shell 命令。
- 浏览器实测必须覆盖一次知识库调用和一次工具调用。

