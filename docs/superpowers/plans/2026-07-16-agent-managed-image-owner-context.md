# Agent Managed Image Owner Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every Agent Center edit-image request from losing managed image inputs during owner-aware payload scrubbing and silently degrading to text-to-image.

**Architecture:** Keep the existing managed-asset scrub as the ownership boundary, but require owner context whenever a provider payload contains `/api/assets/file/...` references. Add a second fail-closed invariant for `kie_image`: scrubbing must preserve every requested image input, otherwise stop before provider submission. Pass the current user id through all Agent Center image execution paths.

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

- [x] **Step 1: Write failing unit tests**
- [x] **Step 2: Run RED test**
- [x] **Step 3: Implement the minimal guard and wire it around managed payload scrubbing**
- [x] **Step 4: Run GREEN test**

---

### Task 2: Propagate Agent Center owner context

**Files:**
- Modify: `server/index.mjs`
- Create: `server/agentManagedAssetSubmissionSource.test.mjs`

**Interfaces:**
- Consumes: current `user.id` in MySQL chat, local chat, and shared image conversation paths.
- Guarantees: shared image planning/generation and MySQL/local tool-calling paths submit provider jobs with `userId: user.id`.

- [x] **Step 1: Write failing source-contract regression test**
- [x] **Step 2: Run RED test**
- [x] **Step 3: Add the minimal owner-context fields**
- [x] **Step 4: Run GREEN and focused regression tests**

---

### Task 3: Root-cause record, release verification, and cloud deployment

**Files:**
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: a durable incident record explaining the planning-versus-scrub boundary and mandatory fail-closed invariant.
- Produces: an isolated fix commit safe to deploy without unrelated dirty-worktree changes.

- [x] **Step 1: Record the recurring root cause and prevention rule**
- [x] **Step 2: Run project gates**
- [x] **Step 3: Review and commit only the scoped files**
- [ ] **Step 4: Deploy from the clean isolated worktree**
- [ ] **Step 5: Verify cloud source and close the diagnostics loop**
