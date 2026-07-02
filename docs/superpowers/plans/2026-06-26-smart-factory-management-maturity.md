# Smart Factory Management Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Smart Factory model, knowledge, and tool management closer to Dify's usable management surface, with real CRUD paths and clearer setup flows.

**Architecture:** Keep the current Smart Factory config store as the source of truth. Add missing backend config operations first, expose typed frontend API helpers, then upgrade the existing SmartFactoryPanel and SmartFactoryKnowledgeManager UI instead of introducing a parallel product surface.

**Tech Stack:** Node `.mjs` config store and route handlers, React/TypeScript frontend, source-contract tests, `node --test`, `npm run build`, in-app browser screenshots.

---

### Task 1: Backend Management Operations

**Files:**
- Modify: `server/smartFactoryConfigStore.mjs`
- Modify: `server/smartFactoryConfigStore.test.mjs`
- Modify: `server/index.mjs`
- Modify: `src/services/internalApi.ts`

- [ ] Add failing tests for deleting a knowledge base and unbinding it from agents.
- [ ] Add failing tests for deleting a model provider and tool while keeping config normalized.
- [ ] Add model provider preset metadata and default model setting support.
- [ ] Implement store helpers and DB/local route handlers.
- [ ] Add typed frontend API helpers.
- [ ] Run `node --test server/smartFactoryConfigStore.test.mjs`.

### Task 2: Knowledge Base Management UI

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryKnowledgeManager.tsx`
- Modify: `src/modules/AgentCenter/SmartFactoryKnowledgeManager.test.mjs`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`

- [ ] Add failing source-contract checks for delete knowledge base, settings save, danger confirmation, document management entry, and retrieval policy visibility.
- [ ] Add delete knowledge base action with confirmation.
- [ ] Keep upload/train/retrain/delete document in the detail page.
- [ ] Make list cards expose manage and delete actions clearly.
- [ ] Run frontend source tests.

### Task 3: Model Provider Management UI

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`

- [ ] Add failing source-contract checks for provider presets, configured provider list, install provider, configure provider, default model, capability tags, delete provider, and connection test.
- [ ] Add common provider preset cards for OpenAI, Anthropic, Google, DeepSeek, Moonshot, OpenRouter, and OpenAI Compatible.
- [ ] Replace the raw model form with a provider configuration panel that can load presets, edit base URL/key ref/model list/default/fallback, test, save, and delete.
- [ ] Run frontend source tests.

### Task 4: Tool Management UI

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`

- [ ] Add failing source-contract checks for tool templates, Feishu tool entry, HTTP API tool entry, CLI tool entry, visual parameter schema, save, test, and delete tool.
- [ ] Add template buttons that populate tool draft with common executor/schema.
- [ ] Show existing tools with enabled/authorized state and explicit delete/test actions.
- [ ] Keep schema editable as JSON but explain fields through visible labels and template cards.
- [ ] Run frontend source tests.

### Task 5: Verification

**Files:**
- No new files.

- [ ] Run `node --test server/smartFactoryConfigStore.test.mjs server/smartFactoryPreview.test.mjs server/smartFactoryPreviewRoute.test.mjs`.
- [ ] Run `node --experimental-strip-types --test src/modules/AgentCenter/SmartFactoryKnowledgeManager.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs`.
- [ ] Run `npm run build`.
- [ ] Use browser screenshots to verify model, knowledge, and tool management pages.
