# Video And Storyboard Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task by task. Every behavior change starts with a focused failing test.

**Goal:** Remove mandatory KIE staging from managed storyboard videos, add a one-time task-safe media fallback to Gemini and Seedance, and close reproducible video/storyboard reliability gaps without creating duplicate paid tasks.

**Architecture:** `providerAssetTransfer` owns direct-versus-staged URL selection and destination-aware upload caching. `providerGateway` owns the strict fallback classifier and provider submission boundary. Existing job-level video retry suppression, provider task id persistence, Temporal recovery, and frontend recovery remain independent safety layers and receive regression coverage.

**Tech Stack:** Node.js ESM, `node:test`, React/TypeScript, KIE Gemini/Seedance adapters, Temporal worker, PM2 cloud deployment.

---

## File Map

- Modify `server/providerAssetTransfer.mjs`: make managed Gemini videos obey `direct-first`; add destination-aware cached staging.
- Modify `server/providerAssetTransfer.test.mjs`: direct managed video, forced upload, cache destination, failure eviction regressions.
- Modify `server/providerGateway.mjs`: remove ambiguous 502 media resubmission and add task-safe Seedance media fallback.
- Modify `server/providerGateway.test.mjs`: end-to-end Gemini video routing, explicit fallback, 502 no-resubmit, Seedance fallback, task-id safety.
- Modify `server/providerMediaRouting.mjs` only if tests prove the routing predicate needs a narrower public contract.
- Modify `server/providerMediaRouting.test.mjs` if that predicate changes.
- Modify focused frontend/backend files identified by the parallel audits only when a reproducible failing test proves an unresolved bug.
- Modify `.env.server.example`, `docs/project-overview.md`, `docs/tencent-cloud-deploy.md`, `docs/agents/repeated-issues.md`, and `CLAUDE.md`: runtime contract, rollback, and recurring-root-cause record.

### Task 1: Managed Gemini videos use HTTPS direct-first

**Files:**
- Modify: `server/providerAssetTransfer.test.mjs`
- Modify: `server/providerAssetTransfer.mjs`

- [ ] **Step 1: Write failing direct-route tests**

Add tests for `resolveProviderGeminiChatMediaUrl`:

1. A managed `/api/assets/file/.../source.mp4` with `MEIAO_PUBLIC_BASE_URL=https://meiaoyuntai.com` and `MEIAO_KIE_MANAGED_ASSET_MODE=direct-first` returns the canonical HTTPS URL without downloading or uploading.
2. The same video with `forceUpload:true` downloads once and uploads to `openrouter-chat`.
3. `kie-only` preserves forced staging.
4. Existing non-managed redpanda `openrouter-chat` compatibility still moves the video to aiquickdraw.

- [ ] **Step 2: Write failing destination-aware cache tests**

Start two concurrent forced `openrouter-chat` uploads for the same managed path and assert one real upload. Then stage the same path to `mayo-storage/internal` and assert it performs a separate upload and returns a separate URL. Verify an empty URL or rejection is evicted and can recover on the next call.

- [ ] **Step 3: Run RED**

Run:

```bash
node --test server/providerAssetTransfer.test.mjs --test-name-pattern "managed Gemini video|upload destination"
```

Expected: managed video is currently downloaded and uploaded even in direct-first mode; route-specific caching is unavailable.

- [ ] **Step 4: Implement the minimum route change**

Extend the managed upload helper with an explicit `uploadPath` option. Include `uploadPath` in the cache key and unique provider filename key. In `resolveProviderGeminiChatMediaUrl`:

- managed video + direct-first + not forced -> `resolveProviderChatMediaUrl`;
- managed video + forced/kie-only -> cached managed upload to `openrouter-chat`;
- non-managed video -> preserve the current `convertGeminiVideoToOpenRouterChatUrl` compatibility behavior.

Do not add transcoding or remote content probing to the normal direct path.

- [ ] **Step 5: Run GREEN and full transfer regressions**

Run:

```bash
node --test server/providerAssetTransfer.test.mjs server/providerMediaRouting.test.mjs
```

Expected: zero failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add server/providerAssetTransfer.mjs server/providerAssetTransfer.test.mjs server/providerMediaRouting.mjs server/providerMediaRouting.test.mjs
git commit -m "fix(video): route managed storyboard media directly"
```

### Task 2: Explicit-only Gemini media fallback

**Files:**
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/providerGateway.mjs`

- [ ] **Step 1: Write failing end-to-end direct video test**

Submit a `kie_chat` Gemini 3.1 Pro payload containing text and `input_file` references to a managed MP4. Assert:

- no `/file-stream-upload` request occurs;
- both text URL and structured media URL use `https://meiaoyuntai.com/api/assets/file/...`;
- the result succeeds with `providerMediaRoute` absent or `direct`.

- [ ] **Step 2: Write explicit fallback and no-resubmit tests**

Add three tests:

1. First Gemini response says `Failed to get the file information`; the managed video stages once to `openrouter-chat`; the same model succeeds on the second call; result is marked `providerMediaRoute='kie-fallback'`.
2. A generic HTTP 502 without a provider task id does not upload and does not resubmit the same paid/provider request.
3. An error containing an explicit media-read message plus `providerTaskId` does not upload or resubmit.

- [ ] **Step 3: Run RED**

Run:

```bash
node --test server/providerGateway.test.mjs --test-name-pattern "managed storyboard video|explicit managed video|ambiguous 502|task id prevents"
```

Expected: normal managed video currently uploads before Gemini, and generic 502 currently triggers a media fallback.

- [ ] **Step 4: Tighten the classifier**

Remove the task-type-specific generic HTTP 502 branch from `shouldRetryWithKieManagedAsset`. A media retry is allowed only when `DIRECT_MANAGED_MEDIA_READ_ERROR_PATTERN` matches and all existing managed-asset, direct-route, one-attempt, and no-task-id guards pass.

Preserve existing model fallback behavior only where it cannot repeat an ambiguous paid asynchronous submission. Provider task ids must continue to suppress both media and model fallback.

- [ ] **Step 5: Run GREEN and chat regressions**

Run:

```bash
node --test server/providerGateway.test.mjs --test-name-pattern "managed storyboard video|direct media|ambiguous 502|task id prevents|Gemini"
```

Expected: zero failures and no duplicate create/submit calls in safety assertions.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "fix(video): restrict storyboard media resubmission"
```

### Task 3: Task-safe Seedance direct media fallback

**Files:**
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/providerGateway.mjs`

- [ ] **Step 1: Write failing Seedance fallback test**

Use `MEIAO_PUBLIC_BASE_URL=https://meiaoyuntai.com` and direct-first mode. The first `createTask` call returns a synchronous explicit file-read error without `taskId`; forced staging returns KIE URLs; the second `createTask` succeeds. Assert:

- first request uses our HTTPS URL;
- each managed reference stages at most once;
- second request uses staged URLs;
- both requests use `bytedance/seedance-2-fast` and identical generation parameters;
- result is marked `providerMediaRoute='kie-fallback'`.

- [ ] **Step 2: Write Seedance paid-task safety tests**

Add tests proving:

1. Generic timeout/connection/502 during create does not stage or submit a second task.
2. Any error carrying `providerTaskId` does not stage or submit again.
3. Polling failure after `notifyProviderTaskId` attaches the id and never calls create twice.
4. Existing `options.providerTaskId` recovery path polls the existing task and never calls create.

- [ ] **Step 3: Run RED**

Run:

```bash
node --test server/providerGateway.test.mjs --test-name-pattern "Seedance direct media fallback|Seedance ambiguous|Seedance task id"
```

Expected: explicit direct media failure currently terminates without safe staging.

- [ ] **Step 4: Implement one guarded fallback**

Pass `forceUpload:Boolean(options.forceManagedAssetUpload)` to every Seedance media resolver. Catch only provider creation errors and call the common managed-media classifier with task type `kie_seedance_video`. On match, call `runKieSeedanceVideoJob` once with:

```js
{
  ...options,
  forceManagedAssetUpload: true,
  directMediaFallbackAttempted: true,
}
```

Mark success with `markKieManagedAssetFallback`. Do not wrap polling failures in a path that can recurse into task creation.

- [ ] **Step 5: Run GREEN and full Seedance regressions**

Run:

```bash
node --test server/providerGateway.test.mjs --test-name-pattern "seedance|Seedance"
```

Expected: zero failures.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "fix(video): add task-safe Seedance media fallback"
```

### Task 4: Restore storyboard-specific provider protections

**Files:**
- Modify: `src/services/videoStoryboardService.test.mjs`
- Modify: `src/services/videoStoryboardService.ts`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerKieTask.test.mjs`
- Modify: `server/providerKieTask.mjs`

- [ ] **Step 1: Write failing Gemini-only fallback tests**

Prove the frontend fallback selector only chooses configured Gemini video-analysis models. At the gateway, prove a `module=video, subFeature=storyboard` job ignores caller-provided GPT fallback models, tries default Gemini fallbacks in a bounded order, and does not loop.

- [ ] **Step 2: Write failing KIE chat media concurrency test**

Submit multiple managed media items across more than one message with `MEIAO_KIE_CHAT_MEDIA_RESOLUTION_CONCURRENCY=2`. In forced staging mode, track active downloads and assert the maximum is two while duplicate URLs still share their cached Promise.

- [ ] **Step 3: Write failing video result-shape test**

Call `pollKieTask`/`probeKieTaskOnce` with `isVideo:true`. Assert the result contains `videoUrl` but not `imageUrl`; image mode remains unchanged.

- [ ] **Step 4: Run RED**

Run:

```bash
node --test src/services/videoStoryboardService.test.mjs server/providerGateway.test.mjs server/providerKieTask.test.mjs \
  --test-name-pattern "storyboard.*fallback|storyboard.*concurrency|video success result"
```

- [ ] **Step 5: Implement current-branch equivalents of the proven historical protections**

Filter and prioritize Gemini-only fallbacks, pass job module/sub-feature into gateway options, bound chat media resolution with an env-driven default of two, and make result URL fields media-type exclusive. Adapt the logic to the current direct-first/cache implementation; do not cherry-pick the old branch wholesale.

- [ ] **Step 6: Run GREEN and commit**

```bash
git add src/services/videoStoryboardService.ts src/services/videoStoryboardService.test.mjs \
  server/providerGateway.mjs server/providerGateway.test.mjs \
  server/providerKieTask.mjs server/providerKieTask.test.mjs
git commit -m "fix(video): restore storyboard provider safeguards"
```

### Task 5: Prevent ambiguous or duplicate paid submissions

**Files:**
- Create: `server/jobSubmissionPolicy.mjs`
- Create: `server/jobSubmissionPolicy.test.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerErrorHumanize.mjs`
- Modify: `server/providerErrorText.test.mjs`
- Modify: `server/jobManager.mjs`
- Modify: `server/jobManager.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/userFeaturePermissionsSource.test.mjs`

- [ ] **Step 1: Write failing task/provider policy tests**

Cover all paid KIE task types and Dreamina video. Assert `kie_*` jobs reject `provider=internal`, Dreamina rejects non-Dreamina provider, all video task types require the video feature permission, all video submissions use zero create retry, and unknown internal task types remain compatible.

- [ ] **Step 2: Write failing ambiguous POST tests**

For a non-idempotent create/chat POST, make `fetch` throw `ECONNRESET` after invocation. Assert one request only and a non-retryable `provider_submission_unknown` error. Keep GET and explicitly idempotent KIE upload retry tests green.

- [ ] **Step 3: Write failing concurrent DB submission-lock tests**

Build a stable semantic submission key that ignores volatile request ids and internal credit metadata. Prove the MySQL named-lock wrapper serializes same-key operations across callers and always releases the lock on success/error.

- [ ] **Step 4: Run RED**

```bash
node --test server/jobSubmissionPolicy.test.mjs server/providerGateway.test.mjs \
  server/providerErrorText.test.mjs server/jobManager.test.mjs server/userFeaturePermissionsSource.test.mjs \
  --test-name-pattern "provider policy|submission unknown|submission lock|video permission"
```

- [ ] **Step 5: Implement server-owned policy and cross-process serialization**

Validate provider/task compatibility before credit estimation. Derive video permission, dedupe window, and submit retry policy from the server table. Wrap DB `find reusable -> reserve -> create` in a MySQL named lock keyed by user plus normalized semantic payload; compensate the reservation if job creation fails.

- [ ] **Step 6: Implement non-idempotent network unknown state**

Only retry network exceptions when the request is idempotent or explicitly marked safe (asset upload). Map ambiguous submit transport failures to `provider_submission_unknown`; keep it out of `RETRYABLE_ERROR_CODES` and give users a message explaining automatic retry was stopped to prevent duplicate billing.

- [ ] **Step 7: Run GREEN and commit**

```bash
git add server/jobSubmissionPolicy.mjs server/jobSubmissionPolicy.test.mjs \
  server/providerGateway.mjs server/providerGateway.test.mjs \
  server/providerErrorHumanize.mjs server/providerErrorText.test.mjs \
  server/jobManager.mjs server/jobManager.test.mjs server/index.mjs server/userFeaturePermissionsSource.test.mjs
git commit -m "fix(video): enforce paid submission safety"
```

### Task 6: Make cancellation, retry, and task-id recovery credit-safe

**Files:**
- Modify: `server/accountCredits.mjs`
- Modify: `server/accountCredits.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `server/jobManager.mjs`
- Modify: `server/jobManager.test.mjs`
- Modify: `server/localJobStore.mjs`
- Modify: `server/localJobStore.test.mjs`
- Modify: `server/temporalWorker.mjs`
- Modify: `server/temporalWorker.test.mjs`

- [ ] **Step 1: Write failing credit lifecycle tests**

Cover:

1. queued cancellation immediately releases its reservation;
2. running cancellation with a provider task id keeps the reservation pending;
3. retry/poll of that same id settles the original reservation exactly once;
4. retry after a released failure creates and attaches a new reservation before any new provider submit;
5. create failure after reserving compensates the reservation.

- [ ] **Step 2: Write failing recovery-budget tests**

Prove video creation stays at zero job retries without a task id, while a retryable polling/download error carrying a task id enters `retry_waiting` within a separate env-driven recovery budget and the next attempt only polls the old task.

- [ ] **Step 3: Write failing restart and Dreamina checkpoint tests**

Providerless running jobs on restart must become `provider_submission_unknown`, not requeue for create. Dreamina must call `onProviderTaskId` immediately after receiving `submitId`, before polling.

- [ ] **Step 4: Implement lifecycle and recovery state**

Keep submitted-cancel reservations pending, release queued cancels immediately, refresh only processed reservations on true resubmission, and pass task-id presence into failure-state calculation. Use `MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES` with a conservative default; never apply it to create-stage unknown submissions.

- [ ] **Step 5: Run focused suites and commit**

```bash
node --test server/accountCredits.test.mjs server/jobRuntime.test.mjs \
  server/jobManager.test.mjs server/localJobStore.test.mjs server/temporalWorker.test.mjs \
  server/providerGateway.test.mjs --test-name-pattern "credit|cancel|retry|provider task|Dreamina"
git add server/accountCredits.mjs server/accountCredits.test.mjs server/index.mjs \
  server/jobRuntime.mjs server/jobRuntime.test.mjs server/jobManager.mjs server/jobManager.test.mjs \
  server/localJobStore.mjs server/localJobStore.test.mjs server/temporalWorker.mjs server/temporalWorker.test.mjs \
  server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "fix(video): preserve paid task recovery accounting"
```

### Task 7: Block duplicate frontend submits and preserve generating state

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: focused shell/UI tests
- Create if useful: a pure storyboard result-status helper and its test

- [ ] **Step 1: Write failing interaction/state tests**

Cover rapid double click, active tasks with backend/provider identity, upload-in-progress submit, and all initial/confirm/regenerate/edit storyboard image paths receiving `status=generating`. Assert pending/generating boards never become completed or failed without a terminal provider result.

- [ ] **Step 2: Keep the submit guard to terminal/cancel state**

Remove early releases from job-created callbacks and material preparation. Make the click handler re-check the disabled/lock state. Active scoped tasks remain active regardless of runtime identity.

- [ ] **Step 3: Centralize storyboard image status mapping**

Use one pure mapping for every entry point so `success`, `generating`, `failed`, and `cancelled` produce consistent project/board status.

- [ ] **Step 4: Run affected frontend suites and commit**

```bash
node --test src/shell/generationSubmitLockBehavior.test.mjs \
  src/shell/components/destructiveActions.test.mjs \
  src/shell/components/layout/BottomInputBar.test.mjs \
  src/components/uiArchitecture.test.mjs
git add src/ShellMigratedApp.tsx src/shell/components/layout/BottomInputBar.tsx src/shell \
  src/components/uiArchitecture.test.mjs
git commit -m "fix(video): keep submits and storyboard states stable"
```

### Task 8: Bind storyboard jobs to durable project identity

**Files:**
- Modify: `src/services/videoStoryboardService.ts`
- Modify: `src/services/videoStoryboardService.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/adapters/shellDataAdapter.ts`
- Modify: `src/adapters/shellDataAdapter.test.mjs`
- Modify: persistence tests as needed

- [ ] **Step 1: Write failing refresh-recovery tests**

Create a scripting placeholder with a stable project id, a completed `kie_chat` job carrying `shellProjectId/planningPurpose`, and structured storyboard content. Hydration must reconstruct the script/shots/boards and clear the stuck scripting state. Add board job identity/cancel-target coverage.

- [ ] **Step 2: Expose job-created identity immediately**

Pass `shellProjectId`, `planningPurpose`, phase, and board id in job payloads. Add `onJobCreated` callbacks to storyboard planning/board creation and persist backend/provider ids before waiting.

- [ ] **Step 3: Reuse one pure parser for live and recovered results**

Move the existing structured storyboard parsing/building into a reusable pure helper. The live service and hydration adapter must consume the same output contract; do not duplicate prompt parsing logic.

- [ ] **Step 4: Run adapter/persistence suites and commit**

```bash
node --test src/services/videoStoryboardService.test.mjs \
  src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs \
  src/adapters/stateReconciliationConsistency.test.mjs
git add src/services/videoStoryboardService.ts src/services/videoStoryboardService.test.mjs \
  src/ShellMigratedApp.tsx src/adapters/shellDataAdapter.ts src/adapters/shellDataAdapter.test.mjs \
  src/adapters/shellPersistence.test.mjs
git commit -m "fix(video): recover storyboard jobs by project identity"
```

### Task 9: Reconcile remaining audit findings

- [ ] **Step 1: Mark evidence-based deferrals explicitly**

Do not merge H.265 transcoding before the direct-provider smoke proves codec rejection. Do not change the five-credit video reservation estimate without an approved pricing policy. Record both as decision gates, not fixed bugs.

- [ ] **Step 2: Bound large result persistence if a focused test proves current memory risk**

Prefer streaming to an atomic temporary file with an env-driven byte limit. If the existing asset-store interface makes that a cross-cutting redesign, document it as the next isolated hardening task instead of mixing an unverified storage rewrite into the incident fix.

- [ ] **Step 3: Verify the diagnostics dashboard freshness fix**

The separate dashboard task must detect or regenerate stale analysis when raw metadata is newer. Run its tests independently; it must not deploy or trigger provider work.

### Task 10: Documentation and full verification

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document behavior and rollback**

Document that direct-first includes managed storyboard videos, KIE is an explicit-read-error fallback only, upload caching is destination-aware, and `kie-only` is the rollback switch. Record that generic 502/timeout must not cause asynchronous video resubmission.

- [ ] **Step 2: Run Hermes guardrails**

Run:

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs \
  --changed server/providerAssetTransfer.mjs \
  --changed server/providerGateway.mjs \
  --changed server/providerMediaRouting.mjs
```

- [ ] **Step 3: Run focused stability suites**

Run:

```bash
node --test \
  server/providerMediaRouting.test.mjs \
  server/providerAssetTransfer.test.mjs \
  server/providerGateway.test.mjs \
  server/providerKieTask.test.mjs \
  server/jobRuntime.test.mjs \
  server/jobManager.test.mjs \
  server/temporalWorker.test.mjs \
  server/appStateMerge.test.mjs \
  server/jobLoggingBehavior.test.mjs
```

- [ ] **Step 4: Run repository gates**

Run:

```bash
npm run lint
npm run build
npm run security:audit
```

Run additional frontend tests named by the audit findings. Expected: all commands exit 0, apart from explicitly documented pre-existing dependency advisories if `security:audit` reports them without a safe scoped upgrade.

- [ ] **Step 5: Request independent code review**

Review specifically for duplicate billable submissions, missing provider task id propagation, cache-key collisions, fallback loops, and cancellation leaks. Address all high-confidence findings, then rerun focused tests.

- [ ] **Step 6: Commit documentation**

```bash
git add .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md docs/agents/repeated-issues.md CLAUDE.md
git commit -m "docs(video): record paid task stability rules"
```

### Task 11: Safe cloud release and non-paid verification

- [ ] **Step 1: Confirm deployment drain**

Run the deployment preflight and wait until active paid jobs are zero. Do not override the drain guard without explicit user approval.

- [ ] **Step 2: Deploy the reviewed commit**

Run:

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

- [ ] **Step 3: Verify production health**

Check `https://meiaoyuntai.com/api/health`, PM2 status, Temporal worker health, active frontend asset chain, and the target managed MP4 with HEAD/Range requests.

- [ ] **Step 4: Run a controlled storyboard smoke**

Use the existing H.265 managed video for one Gemini storyboard analysis only. Confirm logs show direct media route, no KIE file upload, no duplicate provider submit, and a completed or explicit codec error. Do not launch a Seedance generation.

- [ ] **Step 5: Apply the codec decision gate**

If direct H.265 succeeds, keep automatic transcoding out. If the provider explicitly rejects the codec/container, stop and prepare a separately reviewed H.264 transcoding change; do not silently merge the old experimental branch.

- [ ] **Step 6: Record the production fix**

Use the cloud diagnostics dashboard `npm run record-fix` workflow with the incident fingerprint, commits, deployment timestamp, health evidence, and smoke result.
