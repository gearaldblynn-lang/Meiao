# Unified Generation Task State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify generation task status across image, video, and agent chat flows so the UI reflects internal job truth instead of request timing.

**Architecture:** Add a shared task-state adapter over internal jobs, move agent chat image generation onto internal jobs, and make all generation UIs consume the same recoverable/final state semantics. Keep the existing job system and provider gateway, but stop letting individual modules infer final failure from transient polling errors.

**Tech Stack:** React, TypeScript, Node.js, internal MySQL/local job worker, KIE provider gateway.

---

### Task 1: Shared Task-State Adapter

**Files:**
- Modify: `services/kieAiService.ts`
- Modify: `types.ts`
- Test: `services/kieAiService.test.mjs`

- [ ] Add a shared `GenerationTaskUiState` type and helper functions for `queued`, `running`, `recovering`, `succeeded`, `failed_retryable`, `failed_final`, `cancelled`.
- [ ] Add failing tests for retryable vs final KIE failure mapping.
- [ ] Implement the adapter helpers and keep existing `processWithKieAi` API compatible.
- [ ] Run: `node --test services/kieAiService.test.mjs`

### Task 2: Internal Job API State Exposure

**Files:**
- Modify: `server/index.mjs`
- Modify: `types.ts`
- Test: `server/jobLoggingBehavior.test.mjs`

- [ ] Extend job API responses with normalized UI state fields derived from job status, provider status, error code, and provider task id.
- [ ] Keep existing raw job fields intact for backwards compatibility.
- [ ] Ensure failed logs preserve thrown `providerTaskId`.
- [ ] Run: `node --test server/jobLoggingBehavior.test.mjs`

### Task 3: Agent Chat Image Generation Jobification

**Files:**
- Modify: `server/index.mjs`
- Modify: `modules/AgentCenter/AgentCenterModule.tsx`
- Modify: `modules/AgentCenter/ChatConversationPane.tsx`
- Test: `server/agent-image-retrieval.test.mjs`

- [ ] Replace direct provider execution for agent chat image generation with internal job creation + polling/recovery.
- [ ] Return message metadata that includes job id, provider task id, and normalized task state.
- [ ] Update pending assistant messages to show planning/running/recovering/final states.
- [ ] Run: `node --test server/agent-image-retrieval.test.mjs`

### Task 4: Shared Frontend Observer Adoption

**Files:**
- Modify: `modules/BuyerShow/BuyerShowModule.tsx`
- Modify: `modules/OneClick/MainImageSubModule.tsx`
- Modify: `modules/OneClick/DetailPageSubModule.tsx`
- Modify: `modules/OneClick/SkuSubModule.tsx`
- Modify: `modules/Retouch/RetouchModule.tsx`
- Modify: `modules/Video/LongVideoSubModule.tsx`
- Test: `modules/BuyerShow/buyerShowBehavior.test.mjs`
- Test: `modules/OneClick/oneClickRecoveryBehavior.test.mjs`
- Test: `modules/videoRecoveryBehavior.test.mjs`

- [ ] Route module restore logic through the shared retryable/final state helper instead of ad hoc status checks.
- [ ] Update user-facing labels so retryable failures show recovery semantics rather than final failure semantics.
- [ ] Keep manual recover and regenerate actions intact.
- [ ] Run module tests after each cluster of edits.

### Task 5: End-to-End Verification

**Files:**
- Modify: `docs/tencent-cloud-deploy.md` only if deployment/verification notes need clarification.

- [ ] Run: `node --test services/kieAiService.test.mjs`
- [ ] Run: `node --test modules/BuyerShow/buyerShowBehavior.test.mjs`
- [ ] Run: `node --test modules/OneClick/oneClickRecoveryBehavior.test.mjs`
- [ ] Run: `node --test modules/videoRecoveryBehavior.test.mjs`
- [ ] Run: `node --test server/jobLoggingBehavior.test.mjs`
- [ ] Run: `npm run lint`
- [ ] Deploy isolated commit to cloud and check: `curl -i -s http://111.229.66.247:3100/api/health`
