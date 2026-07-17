# Shell Project Scope Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every durable generation project remains in its originating module sub-feature across creation, job hydration, retry, persistence, and server merge, including automatic repair of the observed product-restoration cards misclassified as original retouch.

**Architecture:** Introduce one structured shell-scope contract shared by frontend hydration, persistence, filtering, and server state merge. Explicit structured job metadata wins over prompt heuristics; durable product-restoration evidence repairs historical `original` pollution and recovers the canonical `shellProjectId` from result metadata. Existing cross-feature derivative results remain readable and no user media or job rows are deleted.

**Tech Stack:** TypeScript, ESM JavaScript, Node test runner, React/Vite, Node server app-state merge.

## Global Constraints

- Do not delete or overwrite user media, jobs, credits, or project history.
- Keep `subFeature` structured; do not infer new task ownership from display text when durable metadata exists.
- Preserve historical mixed-result projects unless there is deterministic product-restoration evidence.
- Product-restoration retries for the same `shellProjectId + targetMaterialId + batchIndex` must converge to one current project result.
- Run frontend tests with `node --experimental-strip-types --test`; backend tests use `node --test`.
- Complete `npm run verify`, `npm run doctor`, `npm run build`, and a browser scope check before cloud release.

---

### Task 1: Lock the production-shaped failure with regression tests

**Files:**
- Modify: `src/adapters/shellDataAdapter.test.mjs`
- Modify: `src/adapters/shellScopeFilters.test.mjs`
- Modify: `src/adapters/shellPersistence.test.mjs`
- Modify: `server/appStateMerge.test.mjs`

**Interfaces:**
- Consumes: existing `buildShellDataSnapshot`, `filterProjectsForScope`, `upsertShellProjectIntoPersistedState`, and `mergeAppStateForStorage`.
- Produces: failing tests for product-restoration scope repair, canonical project convergence, and tab isolation.

- [ ] **Step 1: Write the failing adapter replay**

  Add the observed shape: two `retouch/original` job cards whose result metadata contains `clientSubmissionKey=<shellProjectId>:product_restore:<analysisJobId>:<targetId>:v2`, with the retry card carrying `generationContext.productRestore`. Assert that hydration returns one `retouch/product_restore` project under the canonical shell project ID and one latest target result.

- [ ] **Step 2: Write the failing filter and persistence tests**

  Assert that the corrupted card is absent from `original`, present in `product_restore`, and that persisting the corrected project collapses the two legacy `job-*` cards without dropping media.

- [ ] **Step 3: Write the failing server merge test**

  Assert that canonical app-state merge repairs the same corrupted cards and converges them by stable product-restoration target identity.

- [ ] **Step 4: Verify RED**

  Run:
  `node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs src/adapters/shellScopeFilters.test.mjs src/adapters/shellPersistence.test.mjs`
  and `node --test server/appStateMerge.test.mjs`.
  Expected: failures showing `original`/`job-*` instead of `product_restore`/canonical project ID.

### Task 2: Add the shared structured scope contract

**Files:**
- Create: `src/utils/shellProjectScope.mjs`
- Create: `src/utils/shellProjectScope.test.mjs`
- Modify: `src/adapters/shellDataAdapter.ts`
- Modify: `src/adapters/shellScopeFilters.ts`

**Interfaces:**
- Produces: `normalizeStructuredShellSubFeature(module, value)`, `hasDurableProductRestoreScope(project)`, and `normalizeShellProjectScope(project)`.
- Consumes: structured `payload.subFeature`, persisted project/result scope, product-restoration generation context, and `clientSubmissionKey`.

- [ ] **Step 1: Add a scope matrix test**

  Cover every enabled durable project scope: one-click (`first_image/main_image/detail_page/sku`), translation (`main/detail/remove_text`), retouch (`original/white_bg/product_restore` plus historical `background_replace`), everything replace (`product_replace/background_replace/logo_replace`), buyer show (`image/copy`), video (`generation/storyboard/subtitle_removal/diagnosis`), XHS cover (`cover`), and image crop (`long_slice/resize`).

- [ ] **Step 2: Implement structured normalization**

  Return a known structured ID before any legacy prompt heuristic. Treat product-restoration generation context and `:product_restore:` submission identity as authoritative evidence, repair project/result scope together, and recover only the deterministic product-restoration shell project ID.

- [ ] **Step 3: Bind jobs to their payload project identity**

  In hydration, use a non-empty `payload.shellProjectId` as the project ID for every shell job, retaining `job-<id>` only for truly unbound legacy jobs. Keep the existing special control-job visibility rules.

- [ ] **Step 4: Verify GREEN at the adapter seam**

  Re-run the Task 1 frontend tests plus `src/utils/shellProjectScope.test.mjs`; expected all pass.

### Task 3: Make persistence and server merge self-healing

**Files:**
- Modify: `src/adapters/shellPersistence.ts`
- Modify: `server/appStateMerge.mjs`
- Modify: `src/utils/taskResultReconcile.mjs`

**Interfaces:**
- Consumes: `normalizeShellProjectScope` before stable-key registration and product-restoration target reconciliation.
- Produces: canonical project arrays that do not reintroduce `original` pollution after a save or cross-tab merge.

- [ ] **Step 1: Normalize before frontend upsert**

  Normalize incoming and existing project records before ID matching; collapse legacy aliases to the canonical project ID while preserving the newest completed media result.

- [ ] **Step 2: Normalize before server stable-key merge**

  Apply the same contract before key registration and project normalization so canonical responses repair persisted state rather than only hiding it in the UI.

- [ ] **Step 3: Make product-restoration result keys durable-evidence aware**

  Allow target identity and expected-target calculations to recognize a corrupted historical record from its durable restoration evidence before its `subFeature` is repaired.

- [ ] **Step 4: Verify GREEN at persistence boundaries**

  Re-run all Task 1 tests and the scope-contract test; expected all pass.

### Task 4: Audit, release, and verify all module scopes

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/agents/repeated-issues.md`
- Use: `skills/meiao-cloud-release/SKILL.md`

**Interfaces:**
- Consumes: the shared contract and regression matrix.
- Produces: verified local build, cloud deployment, current health evidence, and a documented root-cause rule.

- [ ] **Step 1: Run targeted and full verification**

  Run the four targeted test files, the complete scope matrix, Hermes changed-file check, `npm run verify`, `npm run doctor`, `npm run build`, and `git diff --check`.

- [ ] **Step 2: Replay the exact local store**

  Run the production-shaped read-only replay against `server/data/internal-store.json`; assert zero product-restoration projects under `original`, one canonical product-restoration project, and no media loss.

- [ ] **Step 3: Browser acceptance**

  Refresh local `/`; verify the two observed cards no longer appear under 原图精修 and the canonical card appears under 产品还原. Inspect other enabled tabs for scope leakage without issuing paid model requests.

- [ ] **Step 4: Review and release**

  Review the diff for shared-contract/data risks, wait for cloud jobs to drain, deploy with the repository release skill, then verify `/api/health`, PM2/worker, deployed commit/hash, and a read-only cloud scope audit.

- [ ] **Step 5: Record the fix**

  Add root cause, fix, and prevention to the project root-cause documentation and the diagnostic board using the repository's bug-fix recording workflow.
