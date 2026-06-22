# Architecture Risk Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the highest-risk weekly architecture findings with small tested changes.

**Architecture:** Add a focused OneClick state helper, protect provider checkpoint behavior with tests, and replace weak internal API source-shape checks with behavior tests. Avoid broad provider or UI rewrites.

**Tech Stack:** React 19, TypeScript, Node native test runner, Vite project structure.

---

### Task 1: OneClick Generation Run Helper

**Files:**
- Create: `src/modules/OneClick/oneClickGenerationRun.mjs`
- Create: `src/modules/OneClick/oneClickGenerationRun.test.mjs`
- Modify: `src/modules/OneClick/FirstImageSubModule.tsx`
- Modify: `src/modules/OneClick/MainImageSubModule.tsx`
- Modify: `src/modules/OneClick/DetailPageSubModule.tsx`
- Modify: `src/modules/OneClick/SkuSubModule.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/modules/OneClick/oneClickGenerationRun.test.mjs` with tests for new-run start, recovery start, job-created updates, and provider task id visibility.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test src/modules/OneClick/oneClickGenerationRun.test.mjs
```

Expected: fail because `oneClickGenerationRun.mjs` does not exist.

- [ ] **Step 3: Implement helper**

Create `oneClickGenerationRun.mjs` with:

- `buildOneClickRunStartPatch(mode)`
- `buildOneClickJobCreatedPatch(jobId, providerTaskId)`

- [ ] **Step 4: Use helper in the four OneClick submodules**

Replace duplicated inline update objects for generation start and `onJobCreated`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/modules/OneClick/oneClickGenerationRun.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs
```

### Task 2: Provider Checkpoint Behavior Tests

**Files:**
- Modify: `server/providerGateway.test.mjs`

- [ ] **Step 1: Add focused behavior tests**

Add or tighten tests proving task id notification, existing provider task reuse, and `kie_probe` single-query behavior.

- [ ] **Step 2: Verify RED or existing GREEN**

Run:

```bash
node --test server/providerGateway.test.mjs --test-name-pattern "providerTaskId|probe|reuses"
```

If tests pass immediately, record that this task is protective coverage for existing behavior and make no production change.

### Task 3: Internal API Behavior Tests

**Files:**
- Modify: `src/services/internalApi.test.mjs`

- [ ] **Step 1: Add behavior tests**

Test JSON fallback for non-SSE chat responses, `stream_incomplete`, and `waitForInternalJob` polling through `retry_waiting`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test src/services/internalApi.test.mjs
```

Expected: fail if current module lacks test hooks needed for deterministic fetch/timer control.

- [ ] **Step 3: Minimal implementation if needed**

Only add test hooks or small behavior fixes required by the failing tests. Do not change public call sites.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --experimental-strip-types --test src/services/internalApi.test.mjs
```

### Task 4: Focused Regression

Run:

```bash
node --experimental-strip-types --test src/modules/OneClick/oneClickGenerationRun.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/services/kieAiService.test.mjs src/services/internalApi.test.mjs
node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs
```

Expected: all selected tests pass.
