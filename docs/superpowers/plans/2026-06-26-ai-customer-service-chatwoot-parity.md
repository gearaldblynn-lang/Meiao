# AI Customer Service Chatwoot Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the AI客服 module from a minimal Chatwoot shell into a practical ecommerce customer-service workbench with the Chatwoot APIs that daily agents actually need.

**Architecture:** Keep Chatwoot behind Meiao's authenticated backend proxy. `server/chatwootClient.mjs` owns Chatwoot API details and normalization, `server/index.mjs` exposes `/api/chatwoot/*`, `src/services/internalApi.ts` provides typed frontend calls, and `AiCustomerServiceModule.tsx` presents only store/customer-service relevant controls.

**Tech Stack:** Node HTTP server, Chatwoot REST API, React/TypeScript, FormData for attachments, node:test for adapter behavior, real local Chatwoot Docker acceptance.

---

### Batch 1: Agent Daily Operations

**Files:**
- Modify: `server/chatwootClient.test.mjs`
- Modify: `server/chatwootClient.mjs`
- Modify: `server/index.mjs`
- Modify: `src/services/internalApi.ts`
- Modify: `src/shell/modules/AiCustomerService/AiCustomerServiceModule.tsx`

- [ ] Add adapter tests and implementation for contact notes list/create, contact update, contact conversations.
- [ ] Add adapter tests and implementation for message delete, retry, and translate.
- [ ] Add adapter tests and implementation for macro list and execute against a conversation.
- [ ] Add Meiao backend routes for both DB and local JSON modes.
- [ ] Add typed frontend APIs.
- [ ] Expose controls in `客户资料`, message bubbles, and `自动化`.
- [ ] Verify with unit tests, build, and real local Chatwoot calls.

### Batch 2: Store Operations

**Files:**
- Modify the same API and UI files as Batch 1.

- [ ] Add campaigns list/create/update/delete where relevant to ecommerce store messaging.
- [ ] Add webhooks list/create/update/delete for platform/order/product sync integrations.
- [ ] Add inbox list/show/health/basic update and webhook registration.
- [ ] Expose these under `店铺设置` with dangerous actions hidden or guarded.
- [ ] Verify with unit tests, build, and real local Chatwoot calls.

### Batch 3: Domestic Platform Connectors

**Files:**
- Create connector-oriented server modules only after platform credentials and target channel choice are known.

- [ ] Define platform connector contracts for 淘宝/抖店/小红书/拼多多 authorization, message ingest, outgoing replies, order/product cards, and health checks.
- [ ] Build settings UI for credentials and per-store connector state.
- [ ] Do not claim real platform connectivity until official or ISV credentials are provided and tested.

### Acceptance Standard

- Every visible frontend control must call a Meiao backend API.
- Every Meiao backend API must call a real Chatwoot endpoint or explicitly be marked as platform-credential-gated.
- Unit tests must cover URL, method, payload, and response normalization.
- Real local Chatwoot acceptance must include at least one successful call per implemented feature group.
