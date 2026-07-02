# AI Customer Service Store Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn AI客服 from a single crowded Chatwoot test page into a store-first multi-shop customer-service module with a clear Chatwoot capability parity map.

**Architecture:** The AI客服 module has two layers: an outer store access page for platform/shop binding status, and an inner per-store workspace. The workspace uses tabs for daily support workflows and Chatwoot feature groups, while Chatwoot remains the backend conversation kernel.

**Tech Stack:** React 19, TypeScript, Vite, existing Meiao shell, existing `/api/chatwoot/*` adapter, Chatwoot local Docker deployment.

---

## Landing Target

This phase must land a usable information architecture, not pretend every Chatwoot feature is complete.

1. The first AI客服 screen is `店铺接入`, showing platform/shop cards.
2. Clicking an already connected shop enters that shop's客服 workspace.
3. The workspace is split into tabs: `客服工作台`, `会话管理`, `客户资料`, `话术库`, `自动化`, `坐席`, `报表`, `店铺设置`, `功能对照`.
4. The `客服工作台` tab keeps the real Chatwoot flow already connected: list conversations, load messages, send reply.
5. Other tabs expose the correct Chatwoot-equivalent surfaces as scoped placeholders with clear `已接入 / 待接入` state.
6. The page no longer shows Chatwoot API Token / Account ID / Inbox ID as the primary daily operator UI.

## Execution Plan

### Task 1: Lock the page structure with tests

**Files:**
- Modify: `src/components/uiArchitecture.test.mjs`

- [ ] Add assertions that `AiCustomerServiceModule.tsx` contains:
  - `店铺接入`
  - `进入客服台`
  - `返回店铺列表`
  - `客服工作台`
  - `会话管理`
  - `客户资料`
  - `话术库`
  - `自动化`
  - `坐席`
  - `报表`
  - `店铺设置`
  - `功能对照`

- [ ] Run:

```bash
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs
```

Expected first result before implementation: fail on missing store-first strings.

### Task 2: Refactor AI客服 layout

**Files:**
- Modify: `src/shell/modules/AiCustomerService/AiCustomerServiceModule.tsx`

- [ ] Introduce outer state:
  - `selectedStoreId: string | null`
  - `activeTab`

- [ ] Render outer store page when no store is selected.

- [ ] Render inner store workspace after selecting a connected store.

- [ ] Keep existing Chatwoot connection data from `.env.local` for the current local test shop.

### Task 3: Preserve the real Chatwoot conversation loop

**Files:**
- Modify: `src/shell/modules/AiCustomerService/AiCustomerServiceModule.tsx`

- [ ] In the `客服工作台` tab, keep:
  - conversation fetch
  - message fetch
  - reply send
  - AI suggestion fill
  - human handoff toggle

- [ ] Verify with local API:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/chatwoot/conversations \
  -H "Authorization: Bearer <local-token>" \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"http://127.0.0.1:3001","accountId":"1","inboxId":"1","apiToken":"<chatwoot-token>"}'
```

Expected: returns at least the local test conversation.

### Task 4: Add Chatwoot parity surfaces

**Files:**
- Modify: `src/shell/modules/AiCustomerService/AiCustomerServiceModule.tsx`

- [ ] Add a local parity list covering:
  - Inbox/channel/store access
  - Conversation filters/status
  - Messages and replies
  - Internal notes
  - Assignment
  - Labels
  - Canned responses
  - Contacts/customer attributes
  - Teams/agents
  - Automations/macros
  - Reports
  - Webhooks/integrations
  - AI agent/bot

- [ ] Render this list under `功能对照` with `已接入 / 部分接入 / 待接入`.

## Acceptance Criteria

1. AI客服 opens to a store access page, not a dense all-in-one workbench.
2. Connected store cards can enter a scoped store workspace.
3. Pending stores are visible but do not pretend to be connected.
4. Store workspace has clear tabs and a back action.
5. Existing real Chatwoot conversation list, message history, and reply send still work.
6. The page explicitly shows which Chatwoot-equivalent functions are missing or partial.
7. Tests and build pass:

```bash
node --test server/chatwootClient.test.mjs
node --experimental-strip-types --test src/components/uiArchitecture.test.mjs
node --experimental-strip-types --test src/shell/components/layout/SidebarNavigation.test.mjs
npm run build
```

## Actual Effect Acceptance

Manual acceptance should check:

1. Open `http://localhost:3000`.
2. Enter `AI客服`.
3. See `店铺接入`.
4. Click `进入客服台` on `梅奥测试客服`.
5. See tabs and enter `客服工作台`.
6. Confirm the local Chatwoot conversation appears.
7. Send a reply and confirm it appears in Chatwoot / API response.
8. Open `功能对照` and confirm missing Chatwoot functions are visibly tracked.
