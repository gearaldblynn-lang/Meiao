# Smart Factory V1 Production Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Smart Factory into a usable V1 product where admins can configure relay models, upload/train knowledge, create and publish agents, bind tools, chat with published agents, and inspect runtime logs.

**Architecture:** Keep Smart Factory independent from the existing Agent Center. Reuse the current Dify-inspired backend boundaries (`model relay`, `knowledge ingestion/retrieval`, `tool registry`, `runtime trace`) but add product-level managers for model providers, knowledge bases/documents, agent lifecycle, tool configuration, and run logs. The frontend becomes a multi-view workbench with a chat-first surface plus configuration centers.

**Tech Stack:** Node ESM backend in `server/index.mjs`, local/MySQL system settings persistence, focused Smart Factory modules under `server/ai-engine/` and `server/smartFactoryConfigStore.mjs`, React/TypeScript frontend in `src/modules/AgentCenter/SmartFactoryPanel.tsx`, API wrappers in `src/services/internalApi.ts`, Node test runner.

---

## Product Goal

Smart Factory V1 is considered usable only when this full path works:

1. Admin creates or edits a model provider with provider name, base URL, credential reference, model IDs, default model, and fallback model.
2. Admin creates a knowledge base, uploads a file or pastes text, sees document training status, can retrain/delete documents, and can run retrieval tests.
3. Admin creates an agent, edits prompt/personality, binds one model, binds knowledge bases, binds tools, saves as draft, publishes it, and sees it become selectable in chat.
4. Admin registers or edits a CLI tool with executor reference, parameter schema, risk/authorization status, tests it, and binds it to an agent.
5. User selects a published agent, sends a message, sees the answer, knowledge/tool trace, citations/tool output, and run log.

## Acceptance Standards

- The old Agent Center remains available and is not replaced.
- Smart Factory appears as its own top-level module under “智能体”.
- No API key or secret value is returned from any Smart Factory GET response.
- At least one complete browser-tested flow passes: model save/test → knowledge upload/train → agent create/publish → chat with knowledge → CLI tool call → inspect trace/log.
- Automated verification passes:
  - `node --test server/smartFactoryConfigStore.test.mjs server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs server/ai-engine/*.test.mjs`
  - `node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs src/shell/components/layout/SidebarNavigation.test.mjs src/shell/modules/AgentCenter/AgentCenterModule.test.mjs src/components/uiArchitecture.test.mjs`
  - `npm run build`

## File Map

- Modify `server/smartFactoryConfigStore.mjs`: product data model, mutations, public config projection, agent lifecycle, model/tool/knowledge managers.
- Modify `server/smartFactoryConfigStore.test.mjs`: unit tests for model provider, knowledge file documents, agent publish, tool registration, secret stripping, and config preservation.
- Modify `server/smartFactoryPreview.mjs`: use published agents by default, return run logs/citations/tool output in public config.
- Modify `server/smartFactoryPreview.test.mjs`: runtime tests for published agent and trace/log behavior.
- Modify `server/smartFactoryPreviewRoute.test.mjs`: route source tests for all new MySQL/local endpoints.
- Modify `server/index.mjs`: add MySQL/local routes for model providers, agents, knowledge bases/documents, tools, tests, and chat.
- Modify `src/services/internalApi.ts`: add typed Smart Factory product API wrappers.
- Modify `src/services/internalApi.test.mjs`: request tests for new wrappers.
- Replace `src/modules/AgentCenter/SmartFactoryPanel.tsx`: multi-view workbench with chat, agents, models, knowledge, tools, logs.
- Modify `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`: source guard for mature product workflow strings and API usage.

## Task 1: Product Data Model and Mutations

**Files:**
- Modify: `server/smartFactoryConfigStore.mjs`
- Modify: `server/smartFactoryConfigStore.test.mjs`

- [ ] Add failing tests proving:
  - `upsertSmartFactoryModelProvider` stores provider/baseUrl/models/default/fallback but never returns raw `apiKey`.
  - `createSmartFactoryAgent`, `updateSmartFactoryAgent`, and `publishSmartFactoryAgent` support draft/published lifecycle.
  - `createSmartFactoryKnowledgeBase`, `addSmartFactoryKnowledgeDocument`, `retrainSmartFactoryKnowledgeDocument`, and `deleteSmartFactoryKnowledgeDocument` preserve trained chunks.
  - `upsertSmartFactoryTool` registers safe CLI tools with executor refs.
  - `getSmartFactoryPublicConfig` returns models, knowledge documents, tools, agents, sessions, and run logs without secrets.
- [ ] Run `node --test server/smartFactoryConfigStore.test.mjs` and confirm the new tests fail because functions are missing.
- [ ] Implement the mutations and public projection in `server/smartFactoryConfigStore.mjs`.
- [ ] Re-run `node --test server/smartFactoryConfigStore.test.mjs` and confirm pass.

## Task 2: Runtime, Chat, Retrieval, and Logs

**Files:**
- Modify: `server/smartFactoryPreview.mjs`
- Modify: `server/smartFactoryPreview.test.mjs`

- [ ] Add failing tests proving:
  - Chat can target a published agent and rejects unpublished agents for normal use.
  - Runtime output includes selected model, retrieved knowledge references, tool results, and run log entries.
  - Knowledge retrieval tests can query selected knowledge bases without sending a chat message.
- [ ] Run `node --test server/smartFactoryPreview.test.mjs` and confirm failure.
- [ ] Implement published-agent selection, citations, tool result summaries, and run log projection.
- [ ] Re-run `node --test server/smartFactoryPreview.test.mjs` and confirm pass.

## Task 3: Backend API Routes

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/smartFactoryPreviewRoute.test.mjs`

- [ ] Add failing source tests for these routes in both MySQL and local handlers:
  - `POST /api/smart-factory/model-providers`
  - `POST /api/smart-factory/model-providers/test`
  - `POST /api/smart-factory/agents`
  - `PATCH /api/smart-factory/agents/:agentId`
  - `POST /api/smart-factory/agents/:agentId/publish`
  - `POST /api/smart-factory/knowledge-bases`
  - `POST /api/smart-factory/knowledge-documents`
  - `POST /api/smart-factory/knowledge-documents/:documentId/retrain`
  - `DELETE /api/smart-factory/knowledge-documents/:documentId`
  - `POST /api/smart-factory/knowledge-search`
  - `POST /api/smart-factory/tools`
  - `POST /api/smart-factory/tools/:toolName/test`
  - `POST /api/smart-factory/chat`
- [ ] Run `node --test server/smartFactoryPreviewRoute.test.mjs` and confirm failure.
- [ ] Add the routes using one shared save/update pattern for MySQL and local JSON modes.
- [ ] Re-run `node --check server/index.mjs` and `node --test server/smartFactoryPreviewRoute.test.mjs`.

## Task 4: Frontend API Contracts

**Files:**
- Modify: `src/services/internalApi.ts`
- Modify: `src/services/internalApi.test.mjs`

- [ ] Add failing API wrapper tests for model provider save/test, agent create/update/publish, knowledge base create, document upload/retrain/delete/search, tool save/test, chat.
- [ ] Run `node --experimental-strip-types --test src/services/internalApi.test.mjs` and confirm failure.
- [ ] Implement typed wrappers and expanded `SmartFactoryConfig` types.
- [ ] Re-run the API wrapper test and confirm pass.

## Task 5: Smart Factory Product Workbench

**Files:**
- Replace: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`

- [ ] Add failing source tests proving the workbench includes these product areas: `对话`, `智能体发布`, `模型中心`, `知识库训练`, `文件上传`, `工具中心`, `检索测试`, `运行日志`.
- [ ] Run `node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryPanel.test.mjs` and confirm failure.
- [ ] Implement tabbed workbench:
  - Chat tab: published agent selector, session messages, send box, trace/log panel.
  - Agents tab: create/edit/publish agent, prompt, model binding, knowledge binding, tool binding.
  - Models tab: provider/baseUrl/credentialRef/model IDs/default/fallback/test.
  - Knowledge tab: create knowledge base, file picker, paste text, document table, retrain/delete, retrieval test.
  - Tools tab: name/description/executorRef/schema/risk/auth/test.
  - Logs tab: latest run logs with model, knowledge refs, tool calls, and failures.
- [ ] Re-run panel source test and TypeScript build.

## Task 6: End-to-End Verification

**Files:**
- No production files unless verification exposes a bug.

- [ ] Run backend Smart Factory tests.
- [ ] Run frontend Smart Factory/API/sidebar tests.
- [ ] Run `npm run build`.
- [ ] Browser verify at `http://localhost:3000/`:
  - Smart Factory is under Agent Center in main sidebar.
  - Create/update model provider and run model test.
  - Upload or paste a knowledge document and see ready status.
  - Create and publish an agent bound to the model and knowledge.
  - Send a chat message and see answer plus trace/log.
  - Trigger Feishu CLI tool and see tool trace.

## Out of Scope for V1

- Full Dify workflow visual editor.
- Full Dify plugin daemon and sandbox.
- Multi-tenant permission system beyond current admin/staff checks.
- Binary PDF/DOCX server-side parsing if no parser dependency exists in the repo. V1 accepts text-like files and pasted extracted text, while keeping the API ready for parser adapters.

## Plan Self-Review

- Spec coverage: model configuration, knowledge upload/training, agent publish, tool binding, chat usage, logs, and verification are each mapped to tasks.
- Placeholder scan: no placeholder work is required for V1; unsupported workflow editor and daemon scope are explicitly excluded.
- Type consistency: the plan uses one persisted Smart Factory config and one public projection, matching current `systemSettings.smartFactory` storage.
