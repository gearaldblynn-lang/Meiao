# Account Credit Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mature account-level credit limits with real provider consumption settlement, including smart-agent image generation.

**Architecture:** Add a focused server credit helper for normalization, reservation, release, settlement, and estimation. Wire it into both MySQL and local JSON job/chat paths so limited accounts cannot submit more generation work than their available credits allow. Expose credit state in user APIs and account management UI.

**Tech Stack:** Node.js ESM server, MySQL via `mysql2/promise`, local JSON store, React 19 + TypeScript frontend, `node:test` regression tests.

---

## Files

- Create: `server/accountCredits.mjs` for pure credit math, estimates, and local-store ledger operations.
- Create: `server/accountCredits.test.mjs` for TDD coverage of credit behavior.
- Modify: `server/index.mjs` for MySQL schema/user mapping, user routes, local routes, job reservation, job settlement hooks, and agent image reservation.
- Modify: `server/jobManager.mjs` and `server/localJobStore.mjs` if terminal job updates need shared metadata support.
- Modify: `src/types.ts` for `AuthUser` credit fields.
- Modify: `src/services/internalApi.ts` for create/update user payload types.
- Modify: `src/shell/modules/Account/accountManagementUtils.mjs` and tests for credit formatting helpers.
- Modify: `src/shell/modules/Account/AccountManagement.tsx` for account credit controls and display.
- Modify: `.env.server.example`, `docs/project-overview.md`, and `项目交接上下文.md` for durable documentation.

## Task 1: Core Credit Engine

**Files:**
- Create: `server/accountCredits.mjs`
- Test: `server/accountCredits.test.mjs`

- [ ] **Step 1: Write failing tests**

Tests must cover:
- unlimited users do not reserve;
- limited users reserve only when available balance is sufficient;
- settlement uses real `creditsConsumed`;
- failure releases reservation;
- over-estimate refunds;
- under-estimate deducts extra and clamps balance at zero;
- estimates derive image counts from payload hints.

Run: `node --test server/accountCredits.test.mjs`
Expected: FAIL because `server/accountCredits.mjs` does not exist.

- [ ] **Step 2: Implement pure helper**

Implement:
- `normalizeCreditAccount(user)`
- `getCreditAvailable(user)`
- `estimateCreditReservation({ module, taskType, provider, payload })`
- `reserveLocalAccountCredits(store, userId, context)`
- `settleLocalAccountCredits(store, reservation, result, context)`
- `releaseLocalAccountCredits(store, reservation, context)`
- `createCreditInsufficientError(required, available)`

- [ ] **Step 3: Verify**

Run: `node --test server/accountCredits.test.mjs`
Expected: PASS.

## Task 2: User Schema and API Exposure

**Files:**
- Modify: `server/index.mjs`
- Modify: `src/types.ts`
- Modify: `src/services/internalApi.ts`

- [ ] **Step 1: Write source/API tests**

Add assertions to an existing source test or create a focused test that checks:
- MySQL schema adds credit columns and ledger table;
- `cleanUser` exposes credit fields;
- local `createUser` includes unlimited default;
- `POST /api/users` and `PATCH /api/users/:id` parse credit fields in both MySQL and local branches.

- [ ] **Step 2: Verify RED**

Run the focused test and confirm it fails on missing credit fields.

- [ ] **Step 3: Implement schema and user mapping**

Add MySQL columns/table, local normalization defaults, API payload parsing, admin adjustment ledger entries, and delete-user ledger cleanup.

- [ ] **Step 4: Verify GREEN**

Run the focused test.

## Task 3: Job Queue Reservation and Settlement

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/jobManager.mjs`
- Modify: `server/localJobStore.mjs`
- Test: `server/accountCredits.test.mjs` plus job source tests.

- [ ] **Step 1: Write failing tests**

Tests must assert:
- MySQL `/api/jobs` reserves after dedupe check and before `createJobRecord`;
- local `/api/jobs` does the same;
- deduped jobs do not reserve twice;
- completed jobs settle with `result.creditsConsumed`;
- failed/cancelled jobs release reservation.

- [ ] **Step 2: Verify RED**

Run focused tests and confirm failure.

- [ ] **Step 3: Implement job hooks**

Store `creditReservation` metadata on job payload. In terminal update paths, settle/release exactly once and write ledger/log metadata.

- [ ] **Step 4: Verify GREEN**

Run:
`node --test server/accountCredits.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs`
Use existing available tests; if `server/jobManager.test.mjs` does not exist, run the source test created in Step 1.

## Task 4: Smart-Agent Image Credits

**Files:**
- Modify: `server/index.mjs`
- Test: `server/agentCenterSource.test.mjs` or a focused source test.

- [ ] **Step 1: Write failing tests**

Assert both MySQL and local chat handlers call image-credit reservation for agent image generation, settle on success, and release on failure. Also assert text chat is not blocked by image credits.

- [ ] **Step 2: Verify RED**

Run the focused source test and confirm failure.

- [ ] **Step 3: Implement agent hooks**

Reserve before image-generation execution, reject with HTTP 402 / `account_credit_insufficient` when insufficient, sum `creditsConsumed` from image results, settle/release in `try/finally`.

- [ ] **Step 4: Verify GREEN**

Run the focused source test and `node --test server/agentConversationReliability.test.mjs server/agentCenterSource.test.mjs`.

## Task 5: Account Management UI

**Files:**
- Modify: `src/shell/modules/Account/accountManagementUtils.mjs`
- Modify: `src/shell/modules/Account/accountManagementUtils.test.mjs`
- Modify: `src/shell/modules/Account/AccountManagement.tsx`

- [ ] **Step 1: Write failing utility tests**

Cover formatting of unlimited and limited credit states.

- [ ] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test src/shell/modules/Account/accountManagementUtils.test.mjs`

- [ ] **Step 3: Implement helpers and UI**

Add create/edit controls, compact list display, staff read-only display, and update payload fields.

- [ ] **Step 4: Verify GREEN**

Run the utility test and `npm run lint` if time permits.

## Task 6: Documentation and Final Verification

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `项目交接上下文.md`

- [ ] **Step 1: Document credit behavior**

Record default unlimited rollout, limited testing accounts, reservation/settlement behavior, and relevant env defaults.

- [ ] **Step 2: Run verification**

Run:
- `node --test server/accountCredits.test.mjs`
- focused server source tests added for route coverage
- `node --experimental-strip-types --test src/shell/modules/Account/accountManagementUtils.test.mjs`
- `npm run lint`

- [ ] **Step 3: Review diff**

Run `git diff --stat` and inspect relevant hunks. Confirm unrelated existing dirty files are not modified unless intentionally part of this feature.
