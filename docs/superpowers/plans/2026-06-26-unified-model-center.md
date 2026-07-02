# Unified Model Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cloud, relay, and task model provider configuration into Settings Center, while Smart Factory and other modules consume one shared model registry.

**Architecture:** `systemSettings.modelProviders` becomes the canonical model provider registry. Smart Factory keeps agent, knowledge, tool, and session state, but reads provider/model capability data from the unified registry. Settings Center owns provider CRUD, connection testing, default/fallback model selection, and capability labels.

**Tech Stack:** Node ESM server, React 19, TypeScript, local JSON/MySQL settings storage, existing Smart Factory Dify-derived provider normalization.

---

### Scope

Included:
- Cloud and relay providers only: OpenAI-compatible relay, OpenAI, Anthropic, Gemini, DeepSeek, Moonshot, OpenRouter, and custom OpenAI-compatible providers.
- Model capabilities: chat, embedding, rerank, image generation, video generation, vision, tool calling, structured output.
- Settings Center provider management and Smart Factory consumption.
- Backward migration from `systemSettings.smartFactory.modelProviders`.

Excluded:
- Local models such as Ollama, vLLM, LM Studio.
- Full plugin marketplace.
- Moving every legacy module to the registry in this pass. Existing analysis/video settings remain working; the new registry is exposed so those modules can migrate next.

### Files

- Create: `server/modelProviderRegistry.mjs`
  - Canonical provider presets, normalization, public-safe projection, merge/upsert/delete helpers, default model resolution.
- Create: `server/modelProviderRegistry.test.mjs`
  - TDD coverage for migration, public projection, capability matrix, provider CRUD.
- Modify: `server/index.mjs`
  - Add `modelProviders` to system settings, migrate from Smart Factory provider config, add `/api/system/model-providers` endpoints, make Smart Factory config use unified providers.
- Modify: `server/smartFactoryPreview.mjs`
  - Accept provider override from unified registry.
- Modify: `server/smartFactoryPreviewRoute.test.mjs`
  - Assert Smart Factory routes pass unified provider registry.
- Modify: `src/services/internalApi.ts`
  - Add model provider types and API clients.
- Modify: `src/services/internalApi.test.mjs`
  - Add API contract tests.
- Modify: `src/shell/modules/Settings/GlobalApiSettings.tsx`
  - Add Settings Center model provider management UI.
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
  - Remove provider CRUD from Smart Factory model page; show registry-derived available models and link guidance to Settings Center.
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`
  - Assert Smart Factory no longer owns provider CRUD copy and still supports model selection.

### Acceptance

- Settings Center can create/update/delete/test a custom relay provider with model capabilities.
- Smart Factory loads configured providers from Settings Center without showing fake/local config.
- Existing Smart Factory agents retain their selected model IDs after migration.
- Knowledge base embedding/rerank choices read from the same registry.
- No raw API keys are returned to frontend.
- Logged-in non-admin users can consume Smart Factory; admin-only controls are limited to system provider management.
- Tests pass and browser verification covers `?meiaoLocalPreview` while logged in.

### Task 1: Canonical Backend Registry

**Files:**
- Create: `server/modelProviderRegistry.mjs`
- Create: `server/modelProviderRegistry.test.mjs`

- [ ] Write failing tests for:
  - default registry excludes local providers
  - public config hides raw credentials
  - migration preserves Smart Factory providers
  - custom provider supports chat/embedding/rerank/image/video capability entries
- [ ] Run: `node --test server/modelProviderRegistry.test.mjs`
  - Expected: fail because module does not exist.
- [ ] Implement registry helpers:
  - `createDefaultModelProviderRegistry`
  - `normalizeModelProviderRegistry`
  - `getPublicModelProviderRegistry`
  - `mergeModelProviderRegistryUpdate`
  - `upsertModelProvider`
  - `deleteModelProvider`
  - `getModelProviderPresets`
  - `extractSmartFactoryModelProvidersForMigration`
- [ ] Run: `node --test server/modelProviderRegistry.test.mjs`
  - Expected: pass.

### Task 2: System Settings Integration

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/smartFactoryPreviewRoute.test.mjs`

- [ ] Write failing route/source tests that assert:
  - `normalizeSystemSettings` includes `modelProviders`
  - model providers are migrated from `smartFactory.modelProviders`
  - Smart Factory public config receives unified providers
  - system model provider endpoints exist
- [ ] Run: `node --test server/smartFactoryPreviewRoute.test.mjs server/modelProviderRegistry.test.mjs`
  - Expected: fail on missing integration.
- [ ] Modify system settings normalization to persist `modelProviders`.
- [ ] Add routes:
  - `GET /api/system/model-providers`
  - `POST /api/system/model-providers`
  - `DELETE /api/system/model-providers/:provider`
  - `POST /api/system/model-providers/test`
- [ ] Make Smart Factory config and chat routes compose `smartFactory` state with unified `modelProviders`.
- [ ] Run backend tests.

### Task 3: Frontend API Contract

**Files:**
- Modify: `src/services/internalApi.ts`
- Modify: `src/services/internalApi.test.mjs`

- [ ] Write failing API tests for the new Settings Center model provider endpoints.
- [ ] Run: `node --experimental-strip-types --test src/services/internalApi.test.mjs`
  - Expected: fail on missing functions.
- [ ] Add frontend types and API functions:
  - `fetchSystemModelProviders`
  - `saveSystemModelProvider`
  - `deleteSystemModelProvider`
  - `testSystemModelProvider`
- [ ] Run frontend API tests.

### Task 4: Settings Center UI

**Files:**
- Modify: `src/shell/modules/Settings/GlobalApiSettings.tsx`

- [ ] Add source-level tests where practical, or extend existing UI architecture tests to require:
  - `模型供应商`
  - `能力矩阵`
  - `连接测试`
  - `默认模型`
  - `备用模型`
  - no local model copy.
- [ ] Implement a Settings Center section for provider cards, editable side panel, model catalog textarea, capability summary, save/test/delete buttons.
- [ ] Keep admin-only writes; non-admin users can see safe public provider status where current settings allow.

### Task 5: Smart Factory Consumption

**Files:**
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.tsx`
- Modify: `src/modules/AgentCenter/SmartFactoryPanel.test.mjs`

- [ ] Write failing tests that assert Smart Factory model page does not present provider installation/CRUD as the owning surface.
- [ ] Keep model selection, default/fallback display, knowledge embedding/rerank binding, and provider availability status.
- [ ] Add clear CTA text pointing to Settings Center for provider management.
- [ ] Run Smart Factory panel tests.

### Task 6: Verification

- [ ] Run backend tests:
  - `node --test server/modelProviderRegistry.test.mjs server/smartFactoryConfigStore.test.mjs server/smartFactoryPreviewRoute.test.mjs`
- [ ] Run frontend tests:
  - `node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/AgentCenter/SmartFactoryPanel.test.mjs`
- [ ] Run build:
  - `npm run build`
- [ ] Restart backend if server files changed.
- [ ] Browser verify:
  - Open `http://127.0.0.1:3000/?meiaoLocalPreview`
  - Confirm Settings Center shows model provider management.
  - Confirm Smart Factory no longer shows fake provider configuration and reads available models.
  - Save screenshot to `/tmp/unified-model-center-verified.png`.
