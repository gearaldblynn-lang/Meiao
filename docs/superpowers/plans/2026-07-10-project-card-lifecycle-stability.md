# Project Card Lifecycle Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate buyer-show planning ghost cards, preserve newest-first ordering, and make every project deletion durable across all referenced backend jobs.

**Architecture:** Keep `internal_jobs` as execution truth and `app_state` as the durable user-facing project snapshot. Correlate buyer-show planning jobs to their pre-created shell project with explicit structured metadata, reject unbound planning-control jobs at the adapter boundary, and make deletion collect every backend job identity before writing tombstones. Preserve the existing single sorting function and server tombstone merge.

**Tech Stack:** React 19, TypeScript, Node test runner, Node `.mjs` backend, MySQL-backed cloud state.

---

### Task 1: Lock buyer-show planning correlation and orphan filtering

**Files:**
- Modify: `src/adapters/shellDataAdapter.test.mjs`
- Modify: `src/adapters/shellJobVisibility.test.mjs`
- Modify: `src/modules/BuyerShow/buyerShowShellContract.test.mjs`

- [ ] **Step 1: Write failing adapter tests**

Add cases proving that an active legacy `buyer_show/kie_chat` job with `shellPlanningPurpose='buyer_show_planning'` but no `shellProjectId` creates neither a project nor a fallback task, and that a persisted `job-<id>` planning ghost is absent when the matching control job is loaded.

- [ ] **Step 2: Write failing correlation contract**

Assert that buyer-show workflow passes `input.taskMetadata` into planning and that the planning request records `shellProjectId`, `shellProjectName`, and `subFeature`.

- [ ] **Step 3: Run RED tests**

Run:

```bash
node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs src/adapters/shellJobVisibility.test.mjs src/modules/BuyerShow/buyerShowShellContract.test.mjs
```

Expected: the new assertions fail because orphan planning jobs currently create visible job cards and planning metadata lacks the shell project binding.

### Task 2: Implement explicit planning binding and legacy ghost filtering

**Files:**
- Modify: `src/services/arkService.ts`
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/adapters/shellJobVisibility.ts`
- Modify: `src/adapters/shellDataAdapter.ts`

- [ ] **Step 1: Forward structured project metadata**

Extend `generateBuyerShowPrompts` with optional task metadata. Pass it from `runShellBuyerShowWorkflow`, and copy only `shellProjectId`, `shellProjectName`, and `subFeature` into `requestAnalysisResponseDetailed` metadata together with `shellPlanningPurpose='buyer_show_planning'`.

- [ ] **Step 2: Identify planning-control jobs structurally**

Add a shared predicate based on module, task type, and `shellPlanningPurpose/taskPurpose`. An unbound buyer-show planning job must not become a user-facing result or fallback task.

- [ ] **Step 3: Filter already-persisted legacy ghosts**

At the adapter read boundary, remove only projects whose identity is exactly `job-<planning backend job id>` and whose matching job is a buyer-show planning-control job without a shell project binding. Do not filter real buyer-show projects or error/image jobs.

- [ ] **Step 4: Run GREEN tests**

Run the Task 1 test command and expect all tests to pass.

### Task 3: Lock full project deletion and storyboard tombstones

**Files:**
- Modify: `src/shell/components/destructiveActions.test.mjs`
- Modify: `src/utils/persistedDeletion.test.mjs`
- Modify: `src/adapters/shellScopeFilters.test.mjs`

- [ ] **Step 1: Write failing multi-job deletion contract**

Assert that project deletion collects the top-level backend job, every result backend job, and every matching task backend job before calling `deleteInternalJob` and persisting deletion tombstones.

- [ ] **Step 2: Add storyboard behavior regression**

Build a persisted state with a storyboard project, delete it through `prunePersistedAppStateForDeletion`, then merge the incoming deletion tombstone path and assert the project cannot reappear.

- [ ] **Step 3: Add real-timestamp ordering regression**

Use the observed Luo Ke buyer-show timestamps in shuffled order and assert `7月10日项目2` is first and older cards remain descending.

- [ ] **Step 4: Run RED tests**

Run:

```bash
node --experimental-strip-types --test src/shell/components/destructiveActions.test.mjs src/utils/persistedDeletion.test.mjs src/adapters/shellScopeFilters.test.mjs
```

Expected: the deletion contract fails because the current handler only collects the project-level backend job; existing storyboard and sort behavior should remain green.

### Task 4: Implement complete job identity deletion

**Files:**
- Modify: `src/ShellMigratedApp.tsx`

- [ ] **Step 1: Collect every project job identity**

Add a project-deletion collector using the existing structured identity helpers. Include `project.backendJobId`, `job-<id>`, all result `backendJobId` values, and all matching task `backendJobId` values. Do not treat provider task ids as internal job ids.

- [ ] **Step 2: Preserve tombstone success independently**

Keep `Promise.allSettled` for physical job deletion, always perform in-memory removal and `persistDeletionToSharedState`, and base the user message on the two independent outcomes.

- [ ] **Step 3: Run GREEN tests**

Run the Task 3 test command and expect all tests to pass.

### Task 5: Full verification and knowledge reconciliation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/agents/repeated-issues.md` only if an operational rule not already covered by `CLAUDE.md` is needed

- [ ] **Step 1: Run focused frontend tests**

```bash
node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs src/adapters/shellJobVisibility.test.mjs src/utils/syncedProjectPersistence.test.mjs src/utils/persistedDeletion.test.mjs src/adapters/shellScopeFilters.test.mjs src/shell/components/destructiveActions.test.mjs src/modules/BuyerShow/buyerShowShellContract.test.mjs src/components/uiArchitecture.test.mjs
```

- [ ] **Step 2: Run provider stability regression**

```bash
node --test server/providerGateway.test.mjs server/providerKieImage.test.mjs server/jobRuntime.test.mjs server/providerErrorHumanize.test.mjs
```

- [ ] **Step 3: Run project gates**

```bash
npm run lint
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] **Step 4: Run Hermes changed-file gate**

Run the Hermes harness with every modified high-risk state/card file.

- [ ] **Step 5: Record the root cause**

Add one root-cause entry covering structured planning-job binding, control-job visibility, and deletion identity completeness. Do not duplicate the existing KIE provider incident entry.

- [ ] **Step 6: Record the fix in the external diagnostics dashboard**

Use `npm run record-fix -- ...` after the code commit exists. Include environment `local`, the commit, tests, deployment status `not_deployed`, and a stable fingerprint.
