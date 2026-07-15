# Agent Edit Image Input Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Agent Center edit/reference requests from ever reaching the image provider with zero input images.

**Architecture:** Keep the existing V2 tool-calling flow, but add a deterministic input-resolution boundary immediately before `generateImage`. Valid tool-provided catalog URLs remain authoritative; when the model omits them, recover only an unambiguous current upload or explicitly referenced `图N`; otherwise fail closed with `missing_image_input` before any paid provider submission.

**Tech Stack:** Node.js ESM, `node:test`, existing Agent Center tool-calling and KIE provider gateway.

## Global Constraints

- Do not change prompt-only `new_image` behavior.
- Do not submit an `edit_image` or explicit image-reference request with zero resolved inputs.
- Do not guess among multiple current images when no image label is explicit.
- Preserve the existing provider single-submit and credit safety boundaries.

---

### Task 1: Lock the production failure into regression tests

**Files:**
- Modify: `server/agentToolConversation.test.mjs`

**Interfaces:**
- Consumes: `runAgentConversationV2(options)`.
- Produces: regression coverage for `edit_image` tool calls with missing `input_image_urls`.

- [ ] **Step 1: Write the failing single-product batch test**

Add a test where one current attachment is present and five `edit_image` calls say `基于图1` but return empty `input_image_urls`; assert every `generateImage` call receives the current attachment URL and the aggregate `imagePlan.inputImageUrls` contains it.

- [ ] **Step 2: Write the failing ambiguous multi-image test**

Add a test where multiple current attachments are present, an `edit_image` call has no URL or image label, and assert `runAgentConversationV2` rejects with `missing_image_input` without invoking `generateImage`.

- [ ] **Step 3: Verify RED**

Run: `node --test --test-name-pattern="洛克回归|多图改图缺少明确输入" server/agentToolConversation.test.mjs`

Expected: the batch test observes empty provider inputs and the ambiguous test calls the provider instead of rejecting.

### Task 2: Add deterministic edit-image input resolution

**Files:**
- Modify: `server/agentToolConversation.mjs`
- Test: `server/agentToolConversation.test.mjs`

**Interfaces:**
- Consumes: normalized tool args, current catalog, `freshUploadUrls`, `currentMessage`, and `maxInputImages`.
- Produces: `resolveAgentToolInputUrls(...) -> string[]`, throwing `missing_image_input` when a required input cannot be resolved safely.

- [ ] **Step 1: Implement the minimal resolver**

Resolve in this order: valid tool-provided catalog URLs; explicit `图N` references from the tool prompt/current message; the sole current upload; the sole current-focus catalog image. If an edit/reference request still has no unambiguous input, throw `missing_image_input` before `generateImage`.

- [ ] **Step 2: Verify GREEN**

Run: `node --test server/agentToolConversation.test.mjs server/agentImagePlan.test.mjs server/providerKieImage.test.mjs`

Expected: all tests pass and no provider call receives zero inputs for edit/reference requests.

- [ ] **Step 3: Run focused source contracts**

Run: `node --test server/agent-image-retrieval.test.mjs server/agentConversationReliability.test.mjs server/agentCenterSource.test.mjs server/providerGateway.test.mjs`

Expected: all tests pass.

### Task 3: Document, verify, review, release, and close the incident

**Files:**
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md` only if the root cause is architectural rather than a local missing guard.

**Interfaces:**
- Consumes: verified implementation and regression evidence.
- Produces: project root-cause record, reviewed commit, cloud deployment evidence, and diagnostics dashboard fix record.

- [ ] **Step 1: Record the root cause and prevention rule**

Add the observed 洛克 timeline, `edit_image + inputImageUrls=[]` root cause, deterministic recovery/fail-closed fix, regression commands, and prevention rule to `docs/agents/repeated-issues.md`.

- [ ] **Step 2: Run full verification**

Run: `npm run verify`

Expected: lint has zero errors, all server/frontend/script tests pass, and the production build succeeds.

- [ ] **Step 3: Review the exact diff**

Run: `git diff --check`, inspect `git diff -- server/agentToolConversation.mjs server/agentToolConversation.test.mjs docs/agents/repeated-issues.md`, and confirm prompt-only `new_image` requests remain unchanged.

- [ ] **Step 4: Commit and deploy**

Commit only the planned files, push `feat/stability-phase2`, then run `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` after readiness reaches zero.

- [ ] **Step 5: Verify cloud and diagnostics closure**

Confirm public and host-local `/api/health`, healthy worker, no deploy marker/mutex, cloud/local hashes for changed runtime files, then run `npm run record-fix`, `npm run dashboard`, `npm test`, and `npm run doctor` in `云上日志诊断看板`.
