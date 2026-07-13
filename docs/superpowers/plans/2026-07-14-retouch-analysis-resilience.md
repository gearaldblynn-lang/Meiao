# Retouch Analysis Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep product retouch generation usable when the optional KIE visual-analysis request ends in a confirmed provider failure, without retrying ambiguous paid submissions or bypassing cancellation and pending-result safety.

**Architecture:** The existing KIE GPT-5.4 analysis remains the primary path. A small pure retouch fallback module owns the allowed error classifications and deterministic high-fidelity prompts; `analyzeRetouchTask` uses it only for terminal provider failures, while `job_timeout`, cancellation, validation, and unknown program errors remain failures. The provider transport wrapper also retains sanitized socket metadata so future `fetch failed` incidents are diagnosable without logging credentials or request bodies.

**Tech Stack:** React/TypeScript frontend services, Node.js ESM helpers, Node test runner, MySQL/Temporal job runtime, PM2/Tencent Cloud deployment.

## Global Constraints

- Never automatically retry a paid non-idempotent KIE or Image-2 POST after connection loss.
- Never log API keys, authorization headers, prompts, image URLs, or response content.
- Preserve KIE analysis as the preferred path; fallback only after a terminal provider-class failure.
- `request_cancelled`, `INTERRUPTED`, `job_timeout`, recoverable task sync gaps, invalid input, and unknown program errors must not fall back.
- Real validation is limited to one intentional end-to-end retouch run after deployment.

---

### Task 1: Pure retouch analysis fallback contract

**Files:**
- Create: `src/services/retouchAnalysisFallback.mjs`
- Create: `src/services/retouchAnalysisFallback.test.mjs`

**Interfaces:**
- Produces: `shouldUseRetouchAnalysisFallback(error): boolean`
- Produces: `buildRetouchAnalysisFallback({ mode, hasReference }): string`

- [x] **Step 1: Write failing tests**

Test that `provider_submission_unknown`, provider network/timeout/internal/bad-response/refusal/rate/auth/credit errors fall back; cancellation, `job_timeout`, invalid input, and unknown errors do not. Test that original and white-background prompts preserve logo/text/product identity and encode their distinct composition rules.

- [x] **Step 2: Verify RED**

Run: `node --test src/services/retouchAnalysisFallback.test.mjs`

Expected: FAIL because the fallback module does not exist.

- [x] **Step 3: Implement the minimal pure helper**

Use an explicit allowlist of terminal provider error codes and deterministic English instructions for `original` and `white_bg`. Add the reference-image instruction only when `hasReference` is true.

- [x] **Step 4: Verify GREEN**

Run: `node --test src/services/retouchAnalysisFallback.test.mjs`

Expected: PASS.

### Task 2: Preserve analysis error identity and continue retouch safely

**Files:**
- Modify: `src/services/arkService.ts`
- Modify: `src/types.ts`
- Modify: `src/services/arkService.test.mjs`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `ArkAnalysisResult.errorCode?: string` and `ArkAnalysisResult.fallbackUsed?: boolean`.

- [x] **Step 1: Write failing integration contract tests**

Assert that failed backend analysis jobs preserve `errorCode`; retouch imports the pure helper; allowed provider failures return a successful fallback result and write a `retouch_analysis_fallback` log; cancellation and pending sync errors retain the existing error result.

- [x] **Step 2: Verify RED**

Run: `node --test src/services/arkService.test.mjs`

Expected: FAIL because failed analysis jobs currently become a generic `Error` and retouch always returns `status: 'error'`.

- [x] **Step 3: Implement the minimal integration**

Create terminal analysis errors with the backend `errorCode`, `providerTaskId`, and `jobId`. In `analyzeRetouchTask`, use the Task 1 classifier; on fallback, return the deterministic description with `status: 'success'`, `fallbackUsed: true`, and a clear message. Keep all non-allowlisted errors unchanged.

- [x] **Step 4: Verify GREEN**

Run: `node --test src/services/arkService.test.mjs src/services/retouchAnalysisFallback.test.mjs src/adapters/shellControlJobLifecycle.test.mjs`

Expected: PASS.

### Task 3: Retain sanitized KIE transport diagnostics

**Files:**
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`

**Interfaces:**
- Produces provider error fields: `transportErrorCode`, `transportErrorSyscall`, `transportRemoteAddress`, `transportRemotePort`.
- Produces the same sanitized fields in `buildJobRuntimeLogMeta`.

- [x] **Step 1: Write failing tests**

Simulate a native `TypeError('fetch failed')` whose cause is `UND_ERR_SOCKET`; assert one paid POST attempt, `provider_submission_unknown`, and preserved transport metadata. Assert job runtime metadata includes those fields and still excludes URLs and secrets.

- [x] **Step 2: Verify RED**

Run: `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs`

Expected: FAIL because the current wrapper discards `error.cause`.

- [x] **Step 3: Implement sanitized propagation**

Extract only bounded code/syscall/address/port fields from the native cause (including `AggregateError.errors`), carry them through the submission-unknown wrapper, and expose them in runtime log metadata. Do not add native messages, URLs, headers, bodies, or credentials.

- [x] **Step 4: Verify GREEN**

Run: `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs`

Expected: PASS.

### Task 4: Verification and knowledge closure

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/agents/repeated-issues.md`
- Modify: this plan checklist as execution completes.

- [x] **Step 1: Run focused and full verification**

Run the focused tests from Tasks 1-3, then `npm run verify`, `npm run build`, and `npm run lint`.

Execution evidence: focused retouch and transport suites passed; `npm run lint` passed at 0 errors / 660-warning budget; `npm run build` passed. On local Node 24, the aggregate `npm test` runner left the existing Vite/esbuild handle from `shellOneClickWorkflow.test.mjs` alive after its assertion passed. Re-running all 94 server, 119 frontend, and script test files with Node's `--test-concurrency=1 --test-force-exit` completed with exit code 0; the flag only closes residual handles after tests finish.

- [x] **Step 2: Review the complete diff**

Check fallback boundaries, paid-request retry invariants, log redaction, type compatibility, and unrelated-file preservation. Because the user did not request subagent delegation, perform the mandatory review locally rather than spawning a reviewer.

- [x] **Step 3: Record the root cause and prevention rule**

Document that retouch uniquely treated optional KIE analysis as a hard prerequisite; ambiguous paid POSTs remain non-retryable; terminal analysis-provider failures now use deterministic local guidance; and transport causes must be preserved in sanitized metadata.

### Task 5: Commit, publish, deploy, and real acceptance

**Files:**
- No additional source files unless deployment verification exposes a release-only issue.

- [ ] **Step 1: Commit and push the reviewed change**

Commit only the files in this plan and push the current branch.

- [ ] **Step 2: Deploy with the repository release script**

Run: `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`

Expected: readiness has zero running jobs, build/audit succeed, PM2 restarts, and `/api/health` reports `worker.healthy: true`.

- [ ] **Step 3: Run one real retouch acceptance test**

Have the user submit one product-retouch task using `image-2中转`. Follow the exact `shellProjectId` through `retouch_analysis` and the subsequent `maxforai/kie_image` job. Accept only if the analysis succeeds or explicitly records fallback, the Image-2 job succeeds, the result URL is readable, and the UI project finishes without duplicate provider submissions.

- [ ] **Step 4: Report evidence**

Report commit, push, deployment health, real job IDs, analysis outcome, Image-2 provider/model, result dimensions/readability, and whether fallback was exercised.
