# Agent Managed Image Owner Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every Agent Center edit-image request from losing managed image inputs during owner-aware payload scrubbing and silently degrading to text-to-image.

**Architecture:** Keep the existing managed-asset scrub as the ownership boundary, but require owner context whenever a provider payload contains `/api/assets/file/...` references. Add a second fail-closed invariant for `kie_image`: scrubbing must preserve every requested image input, otherwise stop before provider submission. Pass the current user id through all three Agent Center image execution paths.

**Tech Stack:** Node.js ESM, Node test runner, MySQL/local managed asset registry, KIE provider gateway.

## Global Constraints

- Do not change prompts, model selection, credits, or image result persistence behavior.
- Never allow an edit request with managed image inputs to become text-to-image after payload scrubbing.
- Preserve account isolation: only the current active owner may resolve managed assets.
- Do not include unrelated dirty-worktree changes in the fix commit or cloud release.
- Do not submit a paid production image task without separate user authorization; verify the provider boundary with deterministic tests and read-only production evidence.

---

### Task 1: Provider submission fail-closed guard

**Files:**
- Create: `server/managedAssetSubmissionGuard.mjs`
- Create: `server/managedAssetSubmissionGuard.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `assertManagedAssetSubmissionUserContext({ payload, userId })`.
- Produces: `assertManagedImageInputsPreserved({ taskType, originalPayload, scrubbedPayload })`.
- Guarantees: managed references cannot be scrubbed without owner context; `kie_image` cannot proceed after any requested image input is removed.

- [ ] **Step 1: Write failing unit tests**

Test missing owner context, valid owner context, complete image preservation, zero-input text-to-image, and full/partial input loss.

- [ ] **Step 2: Run RED test**

Run: `node --test server/managedAssetSubmissionGuard.test.mjs`

Expected: FAIL because `server/managedAssetSubmissionGuard.mjs` does not exist.

- [ ] **Step 3: Implement the minimal guard and wire it around managed payload scrubbing**

Call the owner-context guard before querying stored assets, and the image-preservation guard immediately after scrubbing but before `executeProviderJob`.

- [ ] **Step 4: Run GREEN test**

Run: `node --test server/managedAssetSubmissionGuard.test.mjs`

Expected: PASS.

---

### Task 2: Propagate Agent Center owner context

**Files:**
- Modify: `server/index.mjs`
- Create: `server/agentManagedAssetSubmissionSource.test.mjs`

**Interfaces:**
- Consumes: current `user.id` in MySQL chat, local chat, and shared image conversation paths.
- Guarantees: the shared image planner, MySQL tool-calling image generator, and local tool-calling image generator submit provider jobs with `userId: user.id`.

- [ ] **Step 1: Write failing source-contract regression test**

Assert that each of the three `kie_image` Agent Center submissions contains `userId: user.id` and that the shared image-analysis submission also carries the same owner context.

- [ ] **Step 2: Run RED test**

Run: `node --test server/agentManagedAssetSubmissionSource.test.mjs`

Expected: FAIL on the current missing `userId` fields.

- [ ] **Step 3: Add the minimal owner-context fields**

Add `userId: user.id` to the identified Agent Center provider job objects only.

- [ ] **Step 4: Run GREEN and focused regression tests**

Run: `node --test server/agentManagedAssetSubmissionSource.test.mjs server/managedAssetSubmissionGuard.test.mjs server/agentToolConversation.test.mjs server/agentImagePlan.test.mjs server/providerKieImage.test.mjs server/agentCenterSource.test.mjs server/providerGateway.test.mjs`

Expected: PASS.

---

### Task 3: Root-cause record, release verification, and cloud deployment

**Files:**
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: a durable incident record explaining the planning-versus-scrub boundary and the mandatory fail-closed invariant.
- Produces: an isolated fix commit safe to cherry-pick into a clean deployment worktree.

- [ ] **Step 1: Record the recurring root cause and prevention rule**

Document the Lin Yi evidence, missing owner context, KIE text-to-image downgrade, fixed call sites, guard behavior, and exact regression commands.

- [ ] **Step 2: Run project gates**

Run: Hermes changed-file check, focused tests, `npm run doctor`, `npm run lint`, and `npm run build`.

Expected: all commands exit 0 and doctor reports a healthy worker.

- [ ] **Step 3: Review and commit only the scoped files**

Inspect the staged diff for user isolation, provider submission, logging, and unrelated-file leakage; create one bug-fix commit.

- [ ] **Step 4: Deploy from a clean isolated worktree**

Run: `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`

Expected: readiness passes, no active tasks are overridden, cloud build succeeds, PM2 restarts, and public plus host-local health are green.

- [ ] **Step 5: Verify cloud source and close the diagnostics loop**

Confirm the deployed guard/call-site hashes, verify `/api/health`, run a non-billing provider-boundary probe, and record the fix in the cloud diagnostics dashboard with its fingerprint and commit.

