# Video Subtitle Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe “去字幕” video subfeature that accepts a completed managed video or a local upload, lets the user select one subtitle rectangle, executes the Golden provider exactly once, persists the temporary result into MEIAO managed storage, and restores an independent comparison task card after refresh or restart.

**Architecture:** A dedicated React workspace owns source preparation and normalized-region editing. Local uploads reuse the existing media session with a new `subtitle_removal` profile; compatible H.264 MP4 sources bypass FFmpeg while incompatible sources are transcoded without changing aspect ratio. Submission creates one durable `subtitle_remove_video` job. A server-only provider adapter revalidates the owned managed source with FFprobe, checkpoints the provider task ID before polling, queries only when an ID already exists, and returns a remote result that the existing managed-output persistence gate must store before the job can succeed. Generic shell hydration rebuilds the independent task card, while a dedicated comparison player synchronizes original and result playback.

**Tech Stack:** React 19, TypeScript, Node.js ESM, Node test runner, Temporal, FFmpeg/FFprobe, existing internal job ledger, managed asset store, and Golden subtitle-removal HTTP API.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-15-video-subtitle-removal-design.md`; if implementation reality conflicts with the approved spec, stop and amend the spec before coding past the conflict.
- Never place `GOLDEN_SUBTITLE_API_TOKEN` in browser code, Git, job payloads, results, error details, command output, screenshots, or logs.
- `subtitle_remove_video` is a paid, externally observable job. Provider submission and Temporal activity submission attempts are exactly one; any execution with an existing `providerTaskId` is query-only.
- A providerless interrupted submission becomes `provider_submission_unknown`; it must never be requeued or resubmitted automatically.
- Input must resolve through the current user's managed-asset ownership boundary. Do not accept arbitrary public URLs from the browser.
- The server owns duration, dimensions, byte size, and pixel-region conversion. Browser metadata is display-only.
- The provider's `resultUrl` is temporary. The job cannot become `succeeded` until `persistJobOutputAssetsIfEnabled` has replaced it with a MEIAO managed `videoUrl`.
- Deleting a subtitle-removal card must use existing project tombstones and reference-aware asset cleanup; it must not delete a source video still referenced by its original project.
- Once provider submission may have happened, the UI must not imply that MEIAO can cancel the provider operation.
- All capacity, poll, timeout, and enablement values are environment-controlled with conservative defaults.
- Preserve unrelated worktree changes. Before every commit, inspect `git status --short` and stage only files owned by the current task.
- Before touching task lifecycle, persistence, or provider retry code, run the exact Hermes Harness commands listed in the applicable task.
- Production release requires a reviewed diff, a clean verification run, normal active-job drain, `MEIAO_CODE_REVIEW_CONFIRMED=1`, and one authorized 2–3 second live canary. Do not use the active-job override.

---

## File Structure

- `src/utils/subtitleRemovalRegion.mjs`: shared normalized-region clamp, drag, resize, and pixel conversion rules.
- `server/subtitleRemovalContract.mjs`: feature configuration, provider request construction, response/status normalization, and authoritative metadata validation.
- `server/providerSubtitleRemoval.mjs`: managed-source resolution, FFprobe revalidation, exactly-once submit/query state machine, polling, and sanitized provider errors.
- `server/jobSubmissionPolicy.mjs`, `server/temporal/workflows.mjs`, `server/providerGateway.mjs`, `server/index.mjs`: task authorization, single-attempt policy, provider dispatch, runtime dependencies, health, and managed result persistence integration.
- `server/mediaTranscodeContract.mjs`, `server/mediaTranscodeSessionStore.mjs`, `server/mediaTranscodeApi.mjs`, `server/mediaTranscodeService.mjs`: `subtitle_removal` media profile and no-op compatible-source path.
- `src/services/mediaTranscodeClient.ts`: profile-aware session client with byte upload progress.
- `src/shell/components/SubtitleRegionEditor.tsx`: responsive video overlay with drag and eight resize handles.
- `src/utils/subtitleComparisonSync.mjs`, `src/shell/components/SubtitleComparisonPlayer.tsx`: shared-clock comparison logic and optimized dual-video UI.
- `src/shell/components/SubtitleRemovalWorkspace.tsx`: source preparation, upload/transcode state, region editing, and submit UI.
- `src/ShellMigratedApp.tsx`, `src/shell/modules/Video/VideoModule.tsx`, `src/shell/components/ProjectListView.tsx`, `src/shell/components/ProjectCard.tsx`, `src/adapters/shellDataAdapter.ts`: subfeature, entry callback, durable job hydration, card actions, and independent result display.
- `scripts/probe-subtitle-removal.mjs`: readiness probe plus explicit one-shot live canary mode.

### Task 1: Shared Region Rules and Provider Contract

**Files:**
- Create: `src/utils/subtitleRemovalRegion.mjs`
- Create: `src/utils/subtitleRemovalRegion.test.mjs`
- Create: `server/subtitleRemovalContract.mjs`
- Create: `server/subtitleRemovalContract.test.mjs`

**Interfaces:**
- Produces `DEFAULT_SUBTITLE_REGION`, `clampSubtitleRegion(region)`, `moveSubtitleRegion(region, delta)`, `resizeSubtitleRegion(region, handle, delta)`, and `subtitleRegionToPixels(region, width, height)`.
- Produces `getSubtitleRemovalConfig(env)`, `assertSubtitleRemovalInput(input)`, `buildSubtitleRemovalSubmitBody(input)`, `normalizeSubtitleRemovalSubmitResponse(body)`, and `normalizeSubtitleRemovalProgressResponse(body, taskId)`.

- [ ] **Step 1: Write failing region tests**

```js
test('default region is the bottom thirty percent', () => {
  assert.deepEqual(DEFAULT_SUBTITLE_REGION, { x: 0, y: 0.7, width: 1, height: 0.3 });
});

test('resize clamps to a two-percent minimum and stays inside the frame', () => {
  const resized = resizeSubtitleRegion(
    { x: 0.8, y: 0.8, width: 0.2, height: 0.2 },
    'nw',
    { x: 0.5, y: 0.5 },
  );
  assert.ok(resized.width >= 0.02 && resized.height >= 0.02);
  assert.ok(resized.x >= 0 && resized.y >= 0);
  assert.ok(resized.x + resized.width <= 1 && resized.y + resized.height <= 1);
});

test('pixel conversion works for portrait and landscape videos', () => {
  assert.deepEqual(subtitleRegionToPixels(DEFAULT_SUBTITLE_REGION, 1080, 1920), {
    x1: 0, y1: 1344, x2: 1080, y2: 1920,
  });
  assert.deepEqual(subtitleRegionToPixels(DEFAULT_SUBTITLE_REGION, 1920, 1080), {
    x1: 0, y1: 756, x2: 1920, y2: 1080,
  });
});
```

- [ ] **Step 2: Run the region tests and confirm RED**

Run: `node --test src/utils/subtitleRemovalRegion.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `subtitleRemovalRegion.mjs`.

- [ ] **Step 3: Implement normalized-region behavior**

Use normalized coordinates only, a constant `MIN_SUBTITLE_REGION_SIZE = 0.02`, round output pixels to integers, and perform a final pixel clamp so `0 <= x1 < x2 <= width` and `0 <= y1 < y2 <= height`. The eight handles are `n`, `ne`, `e`, `se`, `s`, `sw`, `w`, and `nw`.

- [ ] **Step 4: Run the region tests and confirm GREEN**

Run: `node --test src/utils/subtitleRemovalRegion.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Write failing provider-contract tests**

Cover the exact API document fields and error mapping:

```js
test('submit body uses authoritative metadata and pixel region', () => {
  assert.deepEqual(buildSubtitleRemovalSubmitBody({
    safeTaskId: 'job_123',
    sourceUrl: 'https://managed.example/video.mp4?access=short-lived',
    sizeBytes: 15.2 * 1024 * 1024,
    durationSeconds: 9.01,
    width: 720,
    height: 1280,
    region: { x: 0, y: 0.7, width: 1, height: 0.3 },
  }), {
    biz: 'aiRemoveSubtitleSubmitTask',
    fileSize: 15.2,
    duration: 10,
    resolution: '720x1280',
    videoName: 'job_123_0_896_720_1280',
    coverUrl: '',
    url: 'https://managed.example/video.mp4?access=short-lived',
  });
});

test('minus twenty-five maps to a balance error', () => {
  assert.throws(
    () => normalizeSubtitleRemovalSubmitResponse({ code: -25, msg: 'balance' }),
    (error) => error.code === 'provider_balance_insufficient',
  );
});
```

Also test: missing task ID, waiting, doing, success with and without `resultUrl`, failed with `emsg`, unknown status, max duration 600 seconds, invalid dimensions, and bounded env parsing.

- [ ] **Step 6: Run the contract tests and confirm RED**

Run: `node --test server/subtitleRemovalContract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `subtitleRemovalContract.mjs`.

- [ ] **Step 7: Implement the pure provider contract**

Use these config defaults and bounds:

```js
export const SUBTITLE_REMOVAL_DEFAULTS = Object.freeze({
  baseUrl: 'https://goodline.simplemokey.com/api/openAi',
  pollIntervalMs: 5_000,
  timeoutMs: 1_800_000,
  minPollIntervalMs: 2_000,
  maxPollIntervalMs: 30_000,
  minTimeoutMs: 300_000,
  maxTimeoutMs: 7_200_000,
  maxDurationSeconds: 600,
});
```

`getSubtitleRemovalConfig` returns only `{ enabled, configured, baseUrl, pollIntervalMs, timeoutMs }`; callers must never serialize the token. `normalizeSubtitleRemovalProgressResponse` returns a tagged value `{ state: 'waiting' | 'doing' | 'success' | 'failed' | 'unknown', resultUrl?, providerMessage? }` and never treats unknown as success.

- [ ] **Step 8: Run Task 1 tests, harness, and commit**

Run:

```bash
node --test src/utils/subtitleRemovalRegion.test.mjs server/subtitleRemovalContract.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed src/utils/subtitleRemovalRegion.mjs --changed server/subtitleRemovalContract.mjs
```

Expected: all tests PASS and harness reports no blocking violation.

```bash
git add src/utils/subtitleRemovalRegion.mjs src/utils/subtitleRemovalRegion.test.mjs server/subtitleRemovalContract.mjs server/subtitleRemovalContract.test.mjs
git commit -m "feat: define subtitle removal contract"
```

### Task 2: Exactly-Once Golden Provider Adapter

**Files:**
- Create: `server/providerSubtitleRemoval.mjs`
- Create: `server/providerSubtitleRemoval.test.mjs`

**Interfaces:**
- Produces `runSubtitleRemovalJob({ job, env, signal, onProviderTaskId, deps })`.
- Requires `deps.resolveManagedAssetReadUrl(value, options)`, `deps.probeVideo(value, signal)`, injectable `deps.fetchImpl`, `deps.sleep`, and `deps.now`.

- [ ] **Step 1: Write failing submit/query state-machine tests**

Test all of the following with fake network and probe dependencies:

```js
test('new job checkpoints provider task id before the first progress query', async () => {
  const events = [];
  const result = await runSubtitleRemovalJob({
    job: newSubtitleJob(),
    env: enabledEnv(),
    onProviderTaskId: async (taskId) => events.push(`checkpoint:${taskId}`),
    deps: fakeProviderDeps({
      onSubmit: () => events.push('submit'),
      onQuery: () => events.push('query'),
      progress: ['waiting', 'success'],
    }),
  });
  assert.deepEqual(events.slice(0, 3), ['submit', 'checkpoint:provider-1', 'query']);
  assert.equal(result.result.videoUrl, 'https://provider.example/result.mp4');
});

test('existing provider task id is query-only', async () => {
  const deps = fakeProviderDeps({ rejectSubmit: true, progress: ['success'] });
  await runSubtitleRemovalJob({
    job: newSubtitleJob({ providerTaskId: 'provider-existing' }),
    env: enabledEnv(),
    deps,
  });
  assert.equal(deps.calls.submit, 0);
  assert.equal(deps.calls.query, 1);
});
```

Also cover: managed URL resolution before probe, authoritative probe values overriding browser fields, `authorization` header presence without asserting its secret value, `code=-25`, provider `failed`, submit network ambiguity mapped to `provider_submission_unknown`, abort, total timeout, and success without result URL.

- [ ] **Step 2: Run provider tests and confirm RED**

Run: `node --test server/providerSubtitleRemoval.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `providerSubtitleRemoval.mjs`.

- [ ] **Step 3: Implement safe HTTP and polling behavior**

The submit path is:

```js
const readableUrl = await deps.resolveManagedAssetReadUrl(job.payload.sourceUrl, {
  purpose: 'provider',
  signal,
});
const metadata = await deps.probeVideo(readableUrl, signal);
const submitBody = buildSubtitleRemovalSubmitBody({
  safeTaskId: job.id,
  sourceUrl: readableUrl,
  sizeBytes: metadata.sizeBytes,
  durationSeconds: metadata.durationSeconds,
  width: metadata.width,
  height: metadata.height,
  region: job.payload.subtitleRegionNormalized,
});
```

POST JSON to the configured base URL with `authorization: token`. Do not retry the submit POST inside the adapter. After a successful checkpoint, poll with `{ biz: 'aiRemoveSubtitleProgress', taskId }`. On success return:

```js
{
  providerTaskId,
  providerStage: 'provider_wait',
  providerStatus: 'success',
  result: {
    videoUrl: progress.resultUrl,
    sourceUrl: job.payload.sourceUrl,
    subtitleRegionNormalized: clampSubtitleRegion(job.payload.subtitleRegionNormalized),
    subtitleRegionPixels,
    sourceProjectId: job.payload.sourceProjectId || undefined,
    sourceResultId: job.payload.sourceResultId || undefined,
    providerTaskId,
  },
}
```

Errors may include job ID, task ID, stage, status, and a bounded provider message. They may not include authorization values, signed URL query strings, or a serialized request body.

- [ ] **Step 4: Run provider tests and confirm GREEN**

Run: `node --test server/providerSubtitleRemoval.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Run the harness and commit**

Run: `node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/providerSubtitleRemoval.mjs`

Expected: no blocking violation.

```bash
git add server/providerSubtitleRemoval.mjs server/providerSubtitleRemoval.test.mjs
git commit -m "feat: add golden subtitle removal provider"
```

### Task 3: Durable Job Policy, Dispatch, Recovery, and Managed Result Gate

**Files:**
- Modify: `server/jobSubmissionPolicy.mjs`
- Modify: `server/jobSubmissionPolicy.test.mjs`
- Modify: `server/jobManager.test.mjs`
- Modify: `server/temporal/workflows.mjs`
- Modify: `server/jobLoggingBehavior.test.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/managedAssetDeletion.test.mjs`

**Interfaces:**
- Registers task type `subtitle_remove_video` and provider `golden_subtitle`.
- Adds query recovery only when `providerTaskId` exists.
- Makes `golden_subtitle` use the single-attempt Temporal activity proxy.
- Injects owned URL resolution plus FFprobe into the provider adapter.
- Reuses the existing `persistJobOutputAssetsIfEnabled` video persistence boundary.

- [ ] **Step 1: Add failing policy and recovery tests**

Update the exact video task set expectation to include `subtitle_remove_video`. Assert:

```js
const policy = resolveJobSubmissionPolicy({
  module: 'video',
  taskType: 'subtitle_remove_video',
  provider: 'golden_subtitle',
  payload: { subFeature: 'subtitle_removal' },
  hasVideoPermission: true,
  subtitleRemovalEnabled: true,
  subtitleRemovalConfigured: true,
});
assert.equal(policy.maxCreateRetries, 0);
assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
assert.equal(canRecoverProviderTaskById({ taskType: 'subtitle_remove_video', providerTaskId: 'golden-1' }), true);
```

Also assert: wrong provider rejected; video permission required; disabled/unconfigured new submissions rejected with `subtitle_removal_unavailable`; existing recovery remains allowed when the feature flag is later turned off; providerless restarted jobs fail as submission unknown; submitted stale jobs with `golden-1` become `retry_waiting`.

- [ ] **Step 2: Run policy and reconciler tests and confirm RED**

Run:

```bash
node --test server/jobSubmissionPolicy.test.mjs server/jobManager.test.mjs
```

Expected: FAIL because the task/provider and recovery policy are not registered.

- [ ] **Step 3: Implement authorization and recoverability**

Add `subtitle_remove_video` to `VIDEO_JOB_TASK_TYPES` and `RECOVERABLE_PROVIDER_TASK_TYPES`, and add:

```js
['subtitle_remove_video', new Set(['golden_subtitle'])]
```

to `TASK_PROVIDER_POLICIES`. Extend `resolveJobSubmissionPolicy` with `subtitleRemovalEnabled` and `subtitleRemovalConfigured`. Apply the unavailable guard only to `submissionOperation === 'create'`; recovery/query of an already submitted job must remain possible while the UI feature is disabled.

Pass the two values from `resolveAuthorizedJobSubmissionPolicy` using `getSubtitleRemovalConfig(process.env)`. Keep `KIE_RECOVERY_SOURCE_TASK_TYPES` KIE-only so `/api/jobs/recover` cannot forge a Golden recovery; Golden recovery happens only by requeueing the same durable job.

- [ ] **Step 4: Run policy and reconciler tests and confirm GREEN**

Run: `node --test server/jobSubmissionPolicy.test.mjs server/jobManager.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Add failing Temporal and gateway tests**

Add source/behavior assertions that `golden_subtitle` selects `singleAttemptActivities`, and gateway tests that:

- a new `subtitle_remove_video` job calls `runSubtitleRemovalJob` with no provider task ID;
- an existing task ID reaches the same adapter and never a submit-specific branch;
- `assetTransferDeps.resolveManagedAssetReadUrl` and `assetTransferDeps.probeVideo` are forwarded.

Run:

```bash
node --test server/jobLoggingBehavior.test.mjs server/providerGateway.test.mjs
```

Expected: FAIL because the provider is not dispatched and Temporal only special-cases `maxforai`.

- [ ] **Step 6: Wire the provider and single-attempt activity**

Import `runSubtitleRemovalJob` in `server/providerGateway.mjs` and add:

```js
case 'subtitle_remove_video':
  return runSubtitleRemovalJob({
    job,
    env,
    signal,
    onProviderTaskId: options.onProviderTaskId,
    deps: options.assetTransferDeps,
  });
```

Select single-attempt activities with an explicit set:

```js
const SINGLE_ATTEMPT_PROVIDERS = new Set(['maxforai', 'golden_subtitle']);
const activities = SINGLE_ATTEMPT_PROVIDERS.has(String(input?.provider || ''))
  ? singleAttemptActivities
  : defaultActivities;
```

In `executeProviderJobWithManagedAssetScrub`, extend `assetTransferDeps` with:

```js
probeVideo: (value, probeSignal) => mediaTranscodeService.probe(value, 'video', probeSignal),
```

- [ ] **Step 7: Add and run managed-result persistence regression**

Extend `server/managedAssetDeletion.test.mjs` with a focused source contract around `persistJobOutputAssetsIfEnabled`. Assert that the locked persistence block calls `persistRemoteField('videoUrl', 'video', ...)`, the worker completion wrappers return `persistJobOutputAssetsIfEnabled(job, output)`, and no subtitle-specific branch can mark a remote `videoUrl` complete before that wrapper. Provider behavior tests continue to prove the adapter returns the temporary URL; the cloud canary in Task 11 proves the real download and managed replacement.

Run:

```bash
node --test server/managedAssetDeletion.test.mjs
```

Expected before the focused assertions are wired: FAIL. Expected after using the existing `persistRemoteField('videoUrl', 'video', ...)` boundary: PASS without adding a second persistence implementation.

- [ ] **Step 8: Run Task 3 tests, harness, and commit**

Run:

```bash
node --test server/jobSubmissionPolicy.test.mjs server/jobManager.test.mjs server/jobLoggingBehavior.test.mjs server/providerGateway.test.mjs server/managedAssetDeletion.test.mjs
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/jobSubmissionPolicy.mjs --changed server/temporal/workflows.mjs --changed server/providerGateway.mjs --changed server/index.mjs
```

Expected: all tests PASS and harness reports no blocking violation.

```bash
git add server/jobSubmissionPolicy.mjs server/jobSubmissionPolicy.test.mjs server/jobManager.test.mjs server/temporal/workflows.mjs server/jobLoggingBehavior.test.mjs server/providerGateway.mjs server/providerGateway.test.mjs server/index.mjs server/managedAssetDeletion.test.mjs
git commit -m "feat: integrate durable subtitle removal jobs"
```

### Task 4: Subtitle-Removal Media Profile and Compatible-Source Fast Path

**Files:**
- Modify: `server/mediaTranscodeContract.mjs`
- Modify: `server/mediaTranscodeContract.test.mjs`
- Modify: `server/mediaTranscodeSessionStore.mjs`
- Modify: `server/mediaTranscodeSessionStore.test.mjs`
- Modify: `server/mediaTranscodeService.mjs`
- Modify: `server/mediaTranscodeService.test.mjs`
- Modify: `server/mediaTranscodeApi.mjs`
- Modify: `server/mediaTranscodeApi.test.mjs`
- Modify: `server/index.mjs`
- Modify: `src/services/mediaTranscodeClient.ts`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Adds `MediaTranscodeProfile = 'seedance_reference' | 'subtitle_removal'` with the existing path defaulting to `seedance_reference`.
- Adds `profile` to session creation and persistence.
- Adds `isMediaCompatibleForProfile(profile, probe)` and profile-aware trim/output validation and FFmpeg arguments.
- Adds optional `onUploadProgress({ loaded, total, ratio })` to `createMediaTranscodeSession`.
- Returns `transcoded: boolean` from conversion.

- [ ] **Step 1: Write failing profile contract tests**

Cover:

```js
test('subtitle removal allows a full six-hundred-second selection', () => {
  assert.deepEqual(validateTrimRange({
    profile: 'subtitle_removal',
    durationSeconds: 600,
    startSeconds: 0,
    endSeconds: 600,
  }).durationSeconds, 600);
});

test('subtitle removal ffmpeg keeps the source ratio without pad or forced fps', () => {
  const args = buildVideoTranscodeArgs({
    profile: 'subtitle_removal', inputPath: 'in.mov', outputPath: 'out.mp4',
    startSeconds: 0, endSeconds: 20, width: 721, height: 1281, hasAudio: true,
  });
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.some((value) => value.includes('trunc(iw/2)*2')));
  assert.ok(!args.some((value) => value.includes('pad=')));
  assert.ok(!args.includes('-r'));
});

test('compatible H264 MP4 skips transcode', () => {
  assert.equal(isMediaCompatibleForProfile('subtitle_removal', {
    durationSeconds: 30, sizeBytes: 1_000_000, formatNames: ['mov', 'mp4'],
    videoCodec: 'h264', width: 1080, height: 1920,
  }), true);
});
```

Also assert duration `600.001` is rejected and Seedance's existing 2–15 second rules remain unchanged.

- [ ] **Step 2: Run contract tests and confirm RED**

Run: `node --test server/mediaTranscodeContract.test.mjs`

Expected: FAIL because media functions do not accept profiles.

- [ ] **Step 3: Implement profile-aware pure rules**

Keep current exports backward compatible by defaulting `profile = 'seedance_reference'`. For subtitle removal:

- duration is `> 0 && <= 600`;
- valid direct source is MP4 container + H.264 video + positive dimensions/bytes;
- output is MP4 + H.264 + `yuv420p` + optional AAC + positive dimensions/bytes;
- do not enforce Seedance's 50 MB, pixel range, aspect range, or 24–60 FPS rules;
- FFmpeg uses `scale=trunc(iw/2)*2:trunc(ih/2)*2`, no `pad`, no forced frame rate, and `+faststart`.

- [ ] **Step 4: Run contract tests and confirm GREEN**

Run: `node --test server/mediaTranscodeContract.test.mjs`

Expected: all old and new tests PASS.

- [ ] **Step 5: Add failing session/API/service tests**

Assert the store writes and hydrates `profile`; the API reads it from the owned session instead of trusting convert-body overrides; compatible input persists the original source bytes and reports `transcoded: false`; incompatible MOV invokes FFmpeg and reports `transcoded: true`; subtitle conversion passes the profile into output validation; and cancellation still removes the session.

Run:

```bash
node --test server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.test.mjs server/mediaTranscodeService.test.mjs
```

Expected: FAIL because profile and no-op persistence are absent.

- [ ] **Step 6: Implement the server media path**

Add `profile` to create-session multipart parsing and store sidecars. Validate it against the two-value allowlist. Inject `readSource = readFile` into `createMediaTranscodeApi`. In `convertSession`, when `isMediaCompatibleForProfile(session.profile, session.probe)` is true, read `session.sourcePath`, validate the existing probe, and call `persistAsset` directly; otherwise call `service.transcode` with the profile. Always remove the temporary session in `finally`.

- [ ] **Step 7: Implement authenticated byte upload progress**

Extend `createMediaTranscodeSession` to append `profile`. When `onUploadProgress` is provided, use an `XMLHttpRequest` implementation that sets the existing bearer token, updates only from `xhr.upload.onprogress`, respects abort, parses the JSON error contract, and never logs response headers. Existing callers without progress continue using `requestMediaJson`.

- [ ] **Step 8: Run Task 4 tests, type checks, and commit**

Run:

```bash
node --test server/mediaTranscodeContract.test.mjs server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeApi.test.mjs server/mediaTranscodeService.test.mjs src/components/uiArchitecture.test.mjs
npx tsc -b --pretty false
```

Expected: all tests and type checks PASS.

```bash
git add server/mediaTranscodeContract.mjs server/mediaTranscodeContract.test.mjs server/mediaTranscodeSessionStore.mjs server/mediaTranscodeSessionStore.test.mjs server/mediaTranscodeService.mjs server/mediaTranscodeService.test.mjs server/mediaTranscodeApi.mjs server/mediaTranscodeApi.test.mjs server/index.mjs src/services/mediaTranscodeClient.ts src/components/uiArchitecture.test.mjs
git commit -m "feat: add subtitle removal transcode profile"
```

### Task 5: Responsive Subtitle Region Editor

**Files:**
- Create: `src/shell/components/SubtitleRegionEditor.tsx`
- Create: `src/shell/components/SubtitleRegionEditor.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Adds `SubtitleRemovalRegion`, `SubtitleRemovalPixels`, and `SubtitleRemovalSourceDraft` types.
- Produces `<SubtitleRegionEditor source region onRegionChange disabled />`.

- [ ] **Step 1: Write failing component contract tests**

Read the component source and assert it:

- uses a video element with `preload="metadata"`;
- calculates overlay bounds from the actual contained video rectangle, not the outer card;
- calls `setPointerCapture` on drag/resize start;
- exposes eight resize handles with stable `data-handle` values;
- routes movement through shared `moveSubtitleRegion` / `resizeSubtitleRegion` functions;
- pauses video and removes window/document listeners during cleanup;
- renders current `x1, y1, x2, y2` values.

- [ ] **Step 2: Run the editor test and confirm RED**

Run: `node --test src/shell/components/SubtitleRegionEditor.test.mjs`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the editor**

Use a `ResizeObserver` to calculate the contained media rectangle from source and container aspect ratios. Pointer deltas are divided by the displayed media width/height before calling the shared normalized rules. The rectangle uses existing CSS variables (`--accent`, `--bg-elevated`, `--border-subtle`) and remains usable at narrow widths. Keyboard accessibility provides arrow-key movement and Shift+arrow resizing on the active rectangle/handle.

- [ ] **Step 4: Run editor test and type check**

Run:

```bash
node --test src/shell/components/SubtitleRegionEditor.test.mjs
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 5: Commit the region editor**

```bash
git add src/types.ts src/shell/components/SubtitleRegionEditor.tsx src/shell/components/SubtitleRegionEditor.test.mjs
git commit -m "feat: add subtitle region editor"
```

### Task 6: Optimized Original/Result Comparison Player

**Files:**
- Create: `src/utils/subtitleComparisonSync.mjs`
- Create: `src/utils/subtitleComparisonSync.test.mjs`
- Create: `src/shell/components/SubtitleComparisonPlayer.tsx`
- Create: `src/shell/components/SubtitleComparisonPlayer.test.mjs`

**Interfaces:**
- Produces `getComparisonDriftCorrection({ masterTime, followerTime, thresholdSeconds })` and `shouldPauseForComparisonBuffer(input)`.
- Produces `<SubtitleComparisonPlayer sourceUrl resultUrl title />` with one control surface.

- [ ] **Step 1: Write failing synchronization tests**

```js
test('does not seek for drift at or below 120 milliseconds', () => {
  assert.equal(getComparisonDriftCorrection({ masterTime: 10, followerTime: 9.88, thresholdSeconds: 0.12 }), null);
});

test('returns master time when drift exceeds threshold', () => {
  assert.equal(getComparisonDriftCorrection({ masterTime: 10, followerTime: 9.7, thresholdSeconds: 0.12 }), 10);
});
```

Test buffer gating so playback pauses when either visible comparison stream lacks future data and resumes only after both are playable.

- [ ] **Step 2: Run sync tests and confirm RED**

Run: `node --test src/utils/subtitleComparisonSync.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement pure sync rules and confirm GREEN**

Run: `node --test src/utils/subtitleComparisonSync.test.mjs`

Expected: PASS.

- [ ] **Step 4: Write failing component contract tests**

Assert the comparison component:

- renders both videos with initial `preload="metadata"`;
- keeps original muted and result as the only audio output;
- exposes one play/pause, seek, playback-rate, volume, and fullscreen control set;
- uses the result video as master clock and the 120 ms correction helper;
- changes both streams to active buffering only after play intent;
- supports desktop side-by-side plus a narrow-screen original/result toggle without resetting `currentTime`;
- pauses both on `visibilitychange`, unmount, and dialog close;
- emits a document-level playback ownership event so another comparison instance pauses.

- [ ] **Step 5: Run component test and confirm RED**

Run: `node --test src/shell/components/SubtitleComparisonPlayer.test.mjs`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement the player and verify**

Reuse the existing video buffering environment values `VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS` and `VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS`. Do not render two native control bars. Preserve each source's aspect ratio with `object-contain`, show loading/buffering text, and fall back to a readable per-side playback error without breaking downloads.

Run:

```bash
node --test src/utils/subtitleComparisonSync.test.mjs src/shell/components/SubtitleComparisonPlayer.test.mjs
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 7: Commit the comparison player**

```bash
git add src/utils/subtitleComparisonSync.mjs src/utils/subtitleComparisonSync.test.mjs src/shell/components/SubtitleComparisonPlayer.tsx src/shell/components/SubtitleComparisonPlayer.test.mjs
git commit -m "feat: add synchronized subtitle comparison player"
```

### Task 7: Subtitle-Removal Workspace and Submission Orchestration

**Files:**
- Create: `src/services/subtitleRemovalClient.ts`
- Create: `src/services/subtitleRemovalClient.test.mjs`
- Create: `src/shell/components/SubtitleRemovalWorkspace.tsx`
- Create: `src/shell/components/SubtitleRemovalWorkspace.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/modules/Video/VideoModule.tsx`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Produces `buildSubtitleRemovalJobRequest(input)` and `buildSubtitleRemovalSubmissionKey(input)`.
- Produces `<SubtitleRemovalWorkspace draft onDraftChange onSubmit submitting featureAvailable />`.
- Adds shell state and handlers for task-card source selection and durable job creation.

- [ ] **Step 1: Write failing client payload tests**

Assert the request is exactly:

```ts
{
  module: 'video',
  taskType: 'subtitle_remove_video',
  provider: 'golden_subtitle',
  maxRetries: 0,
  payload: {
    taskPurpose: 'subtitle_removal',
    subFeature: 'subtitle_removal',
    sourceUrl,
    subtitleRegionNormalized,
    sourceProjectId,
    sourceResultId,
    shellProjectId,
    shellProjectName,
    clientSubmissionKey,
  },
}
```

The stable key must include current user ID, managed source identity, four normalized region values, `subtitle_removal`, and a draft nonce; it must not include a bearer token or signed URL query string.

- [ ] **Step 2: Run client test and confirm RED**

Run: `node --test src/services/subtitleRemovalClient.test.mjs`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the request builder and confirm GREEN**

Run: `node --test src/services/subtitleRemovalClient.test.mjs`

Expected: PASS.

- [ ] **Step 4: Write failing workspace contract tests**

Assert the workspace:

- accepts `video/*` only;
- creates a media session with `{ kind: 'video', profile: 'subtitle_removal' }` immediately after selection;
- displays byte upload progress from `onUploadProgress` and uses indeterminate stage text while server conversion runs;
- calls convert over the full source range and uses `transcoded` to say whether conversion was needed;
- rejects `durationSeconds > 600` before conversion and again relies on the server for authority;
- initializes the region to `DEFAULT_SUBTITLE_REGION` for both task-card and local-upload sources;
- cancels an unfinished media session when the draft is cleared or the component unmounts;
- disables duplicate submission synchronously;
- renders “开始去字幕” only after a managed source URL and valid region exist.

- [ ] **Step 5: Run workspace test and confirm RED**

Run: `node --test src/shell/components/SubtitleRemovalWorkspace.test.mjs`

Expected: FAIL because the workspace does not exist.

- [ ] **Step 6: Implement the workspace UI**

Compose `SubtitleRegionEditor`; do not duplicate pointer math. Use phase states `idle`, `uploading`, `analyzing`, `transcoding`, `ready`, `submitting`, and `error`. Show source filename, duration, resolution, codec, and whether MEIAO reused or transcoded it. Keep the approved page design language: compact rounded surfaces, existing CSS variables, responsive stacking, and no bottom prompt input.

- [ ] **Step 7: Add shell orchestration tests before wiring**

Extend `src/components/uiArchitecture.test.mjs` to assert:

- `MODULE_SUB_FEATURES.video` contains `subtitle_removal`;
- `BottomInputBar` is hidden for that subfeature;
- `ShellMigratedApp` keeps a `SubtitleRemovalSourceDraft` and passes it to `VideoModule`;
- submit calls `createInternalJob(buildSubtitleRemovalJobRequest(...))` before creating any success result;
- immediate project/result placeholder contains `backendJobId`, `sourceUrl`, normalized/pixel regions, and `subFeature='subtitle_removal'`;
- the placeholder is persisted with `persistSyncedProjectsToSharedState`;
- failed creation updates the independent project to error without modifying the source project.

Run: `node --test src/components/uiArchitecture.test.mjs`

Expected: FAIL on the new assertions.

- [ ] **Step 8: Wire the workspace and durable submission**

Add the subfeature and Shell state. `handleSubtitleRemovalSubmit` must:

1. synchronously set the submit lock;
2. generate one `shellProjectId` and stable submission key;
3. call `createInternalJob` with `maxRetries: 0`;
4. create an independent generating project using the returned job ID;
5. persist only the new project, never mutate the source project;
6. clear or preserve the draft according to success/error while keeping safe retry identity.

Hide `BottomInputBar` with an explicit guard:

```tsx
!(activeModule === AppModuleObj.VIDEO && activeSubFeature === 'subtitle_removal')
```

For subtitle tasks, pass no `onCancelTask` into `ProjectListView`, because the provider exposes no cancel endpoint and the UI cannot safely distinguish a submit in flight from an unsubmitted queue item.

- [ ] **Step 9: Run workspace, architecture, and type checks**

Run:

```bash
node --test src/services/subtitleRemovalClient.test.mjs src/shell/components/SubtitleRemovalWorkspace.test.mjs src/components/uiArchitecture.test.mjs
npx tsc -b --pretty false
```

Expected: PASS.

- [ ] **Step 10: Commit the workspace**

```bash
git add src/services/subtitleRemovalClient.ts src/services/subtitleRemovalClient.test.mjs src/shell/components/SubtitleRemovalWorkspace.tsx src/shell/components/SubtitleRemovalWorkspace.test.mjs src/ShellMigratedApp.tsx src/shell/modules/Video/VideoModule.tsx src/components/uiArchitecture.test.mjs
git commit -m "feat: add subtitle removal workspace"
```

### Task 8: Task-Card Entry, Durable Hydration, and Comparison Results

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/modules/Video/VideoModule.tsx`
- Modify: `src/shell/components/ProjectListView.tsx`
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/adapters/shellDataAdapter.ts`
- Create: `src/adapters/subtitleRemovalHydration.test.mjs`
- Modify: `src/components/uiArchitecture.test.mjs`
- Modify: `src/shell/components/destructiveActions.test.mjs`
- Modify: `server/assetReferenceCleanup.test.mjs`

**Interfaces:**
- Adds `onRemoveVideoSubtitles(projectId, resultId)` through ProjectCard → ProjectListView → VideoModule → ShellMigratedApp.
- Extends `GeneratedResult` with `subtitleRegionNormalized`, `subtitleRegionPixels`, `sourceProjectId`, and `sourceResultId`.
- Hydrates `subtitle_remove_video` jobs into `subFeature='subtitle_removal'` projects.
- Uses `SubtitleComparisonPlayer` for completed subtitle-removal results.

- [ ] **Step 1: Write failing hydration tests**

Use a succeeded job whose result `videoUrl` is already managed and assert:

```js
assert.equal(project.id, payload.shellProjectId);
assert.equal(project.subFeature, 'subtitle_removal');
assert.equal(project.status, 'completed');
assert.equal(project.results[0].sourceUrl, payload.sourceUrl);
assert.equal(project.results[0].videoUrl, job.result.videoUrl);
assert.equal(project.results[0].backendJobId, job.id);
assert.deepEqual(project.results[0].subtitleRegionNormalized, payload.subtitleRegionNormalized);
assert.deepEqual(project.results[0].subtitleRegionPixels, job.result.subtitleRegionPixels);
```

Also cover queued/running task restoration, provider failure with humanized error, refresh merge where durable success overrides a stale generating placeholder, and an unrelated generation project remaining untouched.

- [ ] **Step 2: Run hydration test and confirm RED**

Run: `node --test src/adapters/subtitleRemovalHydration.test.mjs`

Expected: FAIL because video subfeature normalization falls back to `generation` and region/source fields are dropped.

- [ ] **Step 3: Implement subtitle-specific normalization without a parallel ledger**

Update `normalizeJobSubFeature` so `subtitle_removal` and `subtitle_remove_video` resolve to `subtitle_removal`. Extend `resultFromItem` and the generic terminal/running job mapping to carry source IDs and region fields from payload/result. Prefer `payload.shellProjectId` over `job-${id}` for this task so the immediate placeholder and hydrated job merge by identity. Keep durable job state authoritative over stale shell status.

- [ ] **Step 4: Run hydration test and confirm GREEN**

Run: `node --test src/adapters/subtitleRemovalHydration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Add failing card-entry and comparison assertions**

Extend `src/components/uiArchitecture.test.mjs` to assert:

- “去字幕” appears only for a completed result with `videoUrl` and not inside an existing subtitle-removal result;
- clicking it forwards the exact project/result IDs and switches to `subtitle_removal` with a managed source draft;
- a completed subtitle-removal result renders `SubtitleComparisonPlayer` with original and result URLs;
- generating subtitle-removal results render stage text and no false cancel action;
- other video result cards retain current preview/download/regenerate behavior.

Run: `node --test src/components/uiArchitecture.test.mjs`

Expected: FAIL on the new assertions.

- [ ] **Step 6: Wire the callback chain and card rendering**

Add a full-width card action using the existing `Scissors` icon and label `去字幕`. In `ShellMigratedApp`, resolve the source result from the current project list, require a managed non-blob URL, set draft metadata/source IDs, then call `handleSubFeatureChange('subtitle_removal')`. Do not write back to the original result.

For completed `subtitle_removal` results, render the comparison player in the media panel. Keep download bound to the managed result video. Use the generic delete path and existing card tombstones.

- [ ] **Step 7: Add deletion regression**

Extend `src/shell/components/destructiveActions.test.mjs` with a source project and a subtitle-removal project referencing the same source URL. Call `collectShellDeletionJobIds` for only the subtitle project and assert it returns only that project's backend job identities; the source project remains unchanged and the normal delete path writes the subtitle project ID into `deletedProjectIds`. Extend `server/assetReferenceCleanup.test.mjs` to assert `collectStateManagedAssetUrls` participates in the protected-reference set before expiry filtering, so a source URL still present in the original project cannot be queued merely because the subtitle card was removed.

Run: `node --test src/shell/components/destructiveActions.test.mjs server/assetReferenceCleanup.test.mjs`

Expected: PASS after using the existing deletion collector; if it fails, fix the collector rather than special-casing asset deletion in the card.

- [ ] **Step 8: Run Task 8 tests, harness, and commit**

Run:

```bash
node --test src/adapters/subtitleRemovalHydration.test.mjs src/components/uiArchitecture.test.mjs src/shell/components/destructiveActions.test.mjs server/assetReferenceCleanup.test.mjs src/shell/components/SubtitleComparisonPlayer.test.mjs
npx tsc -b --pretty false
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed src/adapters/shellDataAdapter.ts --changed src/ShellMigratedApp.tsx --changed src/shell/components/ProjectCard.tsx
```

Expected: all tests and type checks PASS; harness reports no blocking violation.

```bash
git add src/ShellMigratedApp.tsx src/shell/modules/Video/VideoModule.tsx src/shell/components/ProjectListView.tsx src/shell/components/ProjectCard.tsx src/adapters/shellDataAdapter.ts src/adapters/subtitleRemovalHydration.test.mjs src/components/uiArchitecture.test.mjs src/shell/components/destructiveActions.test.mjs server/assetReferenceCleanup.test.mjs
git commit -m "feat: connect subtitle removal task cards"
```

### Task 9: Safe Configuration, Health, Documentation, and Probe

**Files:**
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/envDocumentationSource.test.mjs`
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Create: `scripts/probe-subtitle-removal.mjs`
- Create: `scripts/probe-subtitle-removal.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Public config exposes `providers.goldenSubtitle.configured` and `featureRollouts.subtitleRemoval` as booleans only.
- Health exposes `subtitleRemoval: { enabled, configured }` and no secret/base URL.
- Adds `npm run probe:subtitle-removal` with readiness mode by default and explicit `--live` mode.

- [ ] **Step 1: Add failing config and documentation tests**

Assert `buildPublicSystemConfig` and `/api/health` never contain the token or authorization header and only expose booleans. Extend env documentation coverage for:

```text
GOLDEN_SUBTITLE_API_TOKEN
MEIAO_SUBTITLE_REMOVAL_ENABLED
MEIAO_SUBTITLE_REMOVAL_BASE_URL
MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS
MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS
```

Run:

```bash
node --test server/jobRuntime.test.mjs server/envDocumentationSource.test.mjs
```

Expected: FAIL on missing public state and documentation entries.

- [ ] **Step 2: Implement safe config and health output**

Use `getSubtitleRemovalConfig(env)` as the only parser. Public config and health may return only `enabled` and `configured`. Frontend entry remains visible for history, but workspace submission shows `去字幕功能暂未开放，请联系管理员。` when unavailable.

- [ ] **Step 3: Document operations without including a token value**

`.env.server.example` uses an empty `GOLDEN_SUBTITLE_API_TOKEN=`. Deployment docs specify disabled-first rollout, server-only secret placement, defaults/bounds, rollback by feature flag, and the one-canary gate. Project overview documents the new task/provider/subfeature and temporary-result persistence invariant.

- [ ] **Step 4: Write failing probe tests**

Test argument parsing and redaction:

- default mode requests health/config only and makes no provider submission;
- `--live` requires explicit confirmation `MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM=1`;
- live mode requires an authenticated MEIAO base URL plus a 2–3 second fixture path;
- logs contain job ID, provider task ID presence, managed result URL presence, and duration, but never print session token, Golden token, authorization, or signed query parameters;
- live mode creates one job, polls the MEIAO job API, verifies `providerTaskId`, verifies succeeded `videoUrl` is managed and Range-readable, then deletes only the canary project/job through supported APIs.

Run: `node --test scripts/probe-subtitle-removal.test.mjs`

Expected: FAIL because the probe does not exist.

- [ ] **Step 5: Implement readiness and explicit live modes**

The probe must not call the Golden endpoint directly. It exercises the MEIAO API so ownership, job policy, checkpoint, worker, persistence, and authorization are all covered. It accepts `--fixture /absolute/path/to/canary.mp4`, uploads through `/api/assets/upload-stream`, creates one durable `subtitle_remove_video` job with a bottom-30% region, polls `/api/jobs/:id`, verifies the managed result, and performs scoped cleanup. It exits nonzero on timeout, missing task ID, non-managed result, or unreadable Range response.

- [ ] **Step 6: Run Task 9 tests and commit**

Run:

```bash
node --test server/jobRuntime.test.mjs server/envDocumentationSource.test.mjs scripts/probe-subtitle-removal.test.mjs
npm run probe:subtitle-removal
```

Expected: tests PASS; readiness probe reports enablement/configuration without submitting or exposing secrets.

```bash
git add server/jobRuntime.mjs server/jobRuntime.test.mjs server/index.mjs server/envDocumentationSource.test.mjs .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md scripts/probe-subtitle-removal.mjs scripts/probe-subtitle-removal.test.mjs package.json
git commit -m "docs: add subtitle removal operations"
```

### Task 10: Local Acceptance and Regression Closure

**Files:**
- Modify if a discovered regression requires it: files already listed in Tasks 1–9
- Modify only for a confirmed reusable root cause: `CLAUDE.md`
- Create through existing diagnostics only for a real bug fix: cloud diagnosis board record

- [ ] **Step 1: Run the focused feature suite**

Run:

```bash
node --test \
  src/utils/subtitleRemovalRegion.test.mjs \
  server/subtitleRemovalContract.test.mjs \
  server/providerSubtitleRemoval.test.mjs \
  server/jobSubmissionPolicy.test.mjs \
  server/jobManager.test.mjs \
  server/jobLoggingBehavior.test.mjs \
  server/providerGateway.test.mjs \
  server/managedAssetDeletion.test.mjs \
  server/mediaTranscodeContract.test.mjs \
  server/mediaTranscodeSessionStore.test.mjs \
  server/mediaTranscodeApi.test.mjs \
  server/mediaTranscodeService.test.mjs \
  src/services/subtitleRemovalClient.test.mjs \
  src/shell/components/SubtitleRegionEditor.test.mjs \
  src/utils/subtitleComparisonSync.test.mjs \
  src/shell/components/SubtitleComparisonPlayer.test.mjs \
  src/shell/components/SubtitleRemovalWorkspace.test.mjs \
  src/adapters/subtitleRemovalHydration.test.mjs \
  src/shell/components/destructiveActions.test.mjs \
  server/assetReferenceCleanup.test.mjs \
  scripts/probe-subtitle-removal.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run the full local gates**

Run:

```bash
npm run lint
npm run build
npm run verify
npm audit --audit-level=high --omit=dev
npm run doctor
npm run probe:media-transcode
npm run probe:subtitle-removal
```

Expected: all commands exit 0; doctor reports `worker.healthy: true`; readiness probes submit no paid work.

- [ ] **Step 3: Run browser acceptance at `http://127.0.0.1:3000/`**

Verify with a local non-paid video source:

1. task-card “去字幕” switches subfeature and carries the correct source;
2. direct H.264 MP4 upload reports reuse, incompatible MOV/HEVC reports transcode;
3. vertical and horizontal sources keep the default bottom 30% and clamp drag/resize;
4. narrow and desktop layouts remain usable;
5. submit is unavailable while the server feature flag is off;
6. historical fixture cards remain visible while disabled;
7. comparison fixture uses one control surface, one audio stream, stable seek/rate, and pauses on close.

Capture screenshots only if they contain no user data or signed asset query strings.

- [ ] **Step 4: Review the complete diff**

Run:

```bash
git status --short
git diff --check
git diff --stat cb3d686..HEAD
git log --oneline cb3d686..HEAD
```

Review specifically for token leaks, arbitrary URL acceptance, retry/requeue paths, provider ID checkpoint order, source/result asset ownership, stale placeholder merge, false cancel UI, and duplicate video-player buffering.

- [ ] **Step 5: Record only confirmed reusable root causes**

If implementation or testing reveals a genuine recurring defect, add one `CLAUDE.md` root-cause entry containing root cause, fix, and avoidance rule, then run the relevant regression test. If no recurring defect was found, do not add a ceremonial root-cause entry and do not record the feature as a bug fix.

- [ ] **Step 6: Route any acceptance correction back to its owning task**

If Steps 1–5 reveal a failure, return to the task that owns the behavior, add the smallest failing regression there, implement the single fix, rerun that task's exact test and `git add` list, and commit with `fix: close subtitle removal acceptance gap`. If no tracked files changed, make no empty commit.

### Task 11: Tencent Cloud Release and One Authorized Live Canary

**Files:**
- No source edits expected
- Server-only edit: `/www/wwwroot/meiao-internal/.env.server`
- Deployment backups/logs created by existing release tooling

- [ ] **Step 1: Confirm release preconditions**

Confirm the reviewed local HEAD, clean owned diff, all Task 10 gates, normal active-job drain, and the server secret present without printing it:

```bash
SERVER_HOST="${MEIAO_SERVER_HOST:-111.229.66.247}"
SERVER_USER="${MEIAO_SERVER_USER:-root}"
SERVER_PORT="${MEIAO_SERVER_PORT:-22}"
SSH_KEY_PATH="${MEIAO_SSH_KEY:-$HOME/.ssh/MEIAO.pem}"
REMOTE_APP_DIR="${MEIAO_REMOTE_APP_DIR:-/www/wwwroot/meiao-internal}"
ssh -o IdentitiesOnly=yes -i "$SSH_KEY_PATH" -p "$SERVER_PORT" "${SERVER_USER}@${SERVER_HOST}" \
  "cd '$REMOTE_APP_DIR' && set -a && . ./.env.server >/dev/null 2>&1 && set +a && test -n \"\$GOLDEN_SUBTITLE_API_TOKEN\""
```

When executing, replace the host through the existing deployment configuration rather than documenting credentials. Redirect remote env loading output and never use `set -x`.

- [ ] **Step 2: Deploy disabled-first**

Keep `MEIAO_SUBTITLE_REMOVAL_ENABLED=0`, then run:

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

Expected: deployment gate drains normally, build switches atomically, PM2 app and worker are healthy, and no active-job override is used.

- [ ] **Step 3: Verify cloud health before paid work**

Verify public `/api/health`, PM2 status, Temporal pollers, frontend assets, `subtitleRemoval.enabled=false`, `subtitleRemoval.configured=true`, and absence of secrets in health/config/log output. Run the remote readiness probe in non-live mode.

- [ ] **Step 4: Enable for the canary window and run exactly one 2–3 second canary**

Generate or use a local H.264 MP4 fixture whose FFprobe duration is between 2 and 3 seconds. Set the cloud feature flag to `1`, restart through the normal service mechanism, then run:

```bash
MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM=1 npm run probe:subtitle-removal -- --live --fixture /absolute/path/to/2-3s-canary.mp4
```

Expected evidence:

- one MEIAO job ID;
- one checkpointed provider task ID;
- no second provider submission;
- provider success;
- final managed `videoUrl`, not the 24-hour provider URL;
- HTTP 200 plus Range playback for original and result;
- independent subtitle-removal project restoration after refresh;
- synchronized comparison playback and downloadable result;
- scoped canary cleanup succeeds without touching user projects.

Do not repeat the paid canary automatically if submission status becomes unknown. Stop and inspect the durable job/provider task ID.

- [ ] **Step 5: Final enablement and rollback proof**

If the canary passes, keep `MEIAO_SUBTITLE_REMOVAL_ENABLED=1`, restart normally, and recheck health/worker/frontend. Prove the rollback path by documenting that changing only the flag to `0` prevents new submissions while history remains readable; do not actually disable after a successful release unless rollback is needed.

- [ ] **Step 6: Final production evidence**

Record, without secrets or signed queries:

- deployed commit/hash and matching critical-file hashes;
- `/api/health` summary;
- PM2 app/worker status;
- normal gate drain result;
- canary MEIAO job ID and masked provider task ID presence;
- managed original/result asset status and Range support;
- browser screenshot of the comparison UI with test-only content;
- rollback flag and exact normal restart command.

If production reveals a real bug fix rather than a feature/config issue, use the existing cloud diagnosis board `npm run record-fix` workflow and include its fingerprint; do not create a fake bug-fix record for ordinary feature delivery.
