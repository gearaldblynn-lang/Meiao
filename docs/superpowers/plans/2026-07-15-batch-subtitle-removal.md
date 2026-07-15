# Batch Subtitle Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-video subtitle-removal workspace with a batch-first queue, per-video region editor, bounded partial submission, and one durable batch project card.

**Architecture:** Keep Golden as one paid job per video, but give every item a stable result identity under one shared `shellProjectId`. A pure batch utility owns queue selection and summaries; the React workspace owns temporary media sessions; the shell creates durable jobs with bounded concurrency; hydration merges all jobs back into one project.

**Tech Stack:** React 19, TypeScript, Node.js ESM, native `node:test`, existing media-transcode sessions, existing internal job API, Tailwind-style utility classes.

## Global Constraints

- The page must show a batch task list before any full-size video editor.
- Unedited videos use `DEFAULT_SUBTITLE_REGION` (bottom 30%) and remain submittable.
- A broken item must not block other ready items.
- Default limits are 10 items, preparation concurrency 2, submission concurrency 2; all are server-side env knobs with conservative clamps.
- One batch becomes one top-level project; every video remains a separate durable Golden job and result.
- Golden `videoName` remains exactly `x1_y1_x2_y2`.
- Provider POSTs remain zero-retry and Temporal single-attempt; response loss must not cause a duplicate paid submission.
- No real paid batch canary or cloud deployment without a new explicit user authorization.
- Local acceptance must include focused tests, `npm run doctor`, `npm run build`, and a real browser render.

---

### Task 1: Publish conservative batch limits

**Files:**
- Modify: `server/subtitleRemovalContract.mjs`
- Modify: `server/subtitleRemovalContract.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `getSubtitleRemovalConfig(env).batchMaxItems`, `.batchPrepConcurrency`, `.batchSubmitConcurrency`.
- Produces: `SystemPublicConfig.subtitleRemoval` with the same three non-sensitive numbers.

- [ ] **Step 1: Write failing config tests**

Add assertions that defaults are `10/2/2`, low/high values clamp to `1–20/1–4/1–4`, and `JSON.stringify(config)` never contains the token.

```js
assert.deepEqual(getSubtitleRemovalConfig({}), {
  enabled: false,
  configured: false,
  baseUrl: SUBTITLE_REMOVAL_DEFAULTS.baseUrl,
  pollIntervalMs: SUBTITLE_REMOVAL_DEFAULTS.pollIntervalMs,
  timeoutMs: SUBTITLE_REMOVAL_DEFAULTS.timeoutMs,
  batchMaxItems: 10,
  batchPrepConcurrency: 2,
  batchSubmitConcurrency: 2,
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test server/subtitleRemovalContract.test.mjs server/jobRuntime.test.mjs`

Expected: FAIL because the three batch limit fields do not exist.

- [ ] **Step 3: Implement limits and public config**

Extend `SUBTITLE_REMOVAL_DEFAULTS` and `getSubtitleRemovalConfig`:

```js
batchMaxItems: 10,
batchPrepConcurrency: 2,
batchSubmitConcurrency: 2,
minBatchMaxItems: 1,
maxBatchMaxItems: 20,
minBatchConcurrency: 1,
maxBatchConcurrency: 4,
```

```js
batchMaxItems: boundedInteger(
  env.MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS,
  SUBTITLE_REMOVAL_DEFAULTS.batchMaxItems,
  SUBTITLE_REMOVAL_DEFAULTS.minBatchMaxItems,
  SUBTITLE_REMOVAL_DEFAULTS.maxBatchMaxItems,
),
batchPrepConcurrency: boundedInteger(
  env.MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY,
  SUBTITLE_REMOVAL_DEFAULTS.batchPrepConcurrency,
  SUBTITLE_REMOVAL_DEFAULTS.minBatchConcurrency,
  SUBTITLE_REMOVAL_DEFAULTS.maxBatchConcurrency,
),
batchSubmitConcurrency: boundedInteger(
  env.MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY,
  SUBTITLE_REMOVAL_DEFAULTS.batchSubmitConcurrency,
  SUBTITLE_REMOVAL_DEFAULTS.minBatchConcurrency,
  SUBTITLE_REMOVAL_DEFAULTS.maxBatchConcurrency,
),
```

Expose only the numeric limits from `buildPublicSystemConfig`, and type them:

```ts
subtitleRemoval?: {
  batchMaxItems: number;
  batchPrepConcurrency: number;
  batchSubmitConcurrency: number;
};
```

- [ ] **Step 4: Run tests and commit**

Run: `node --test server/subtitleRemovalContract.test.mjs server/jobRuntime.test.mjs`

Expected: PASS.

Commit: `feat: publish subtitle batch limits`

---

### Task 2: Add a pure batch queue contract

**Files:**
- Create: `src/utils/subtitleRemovalBatch.mjs`
- Create: `src/utils/subtitleRemovalBatch.test.mjs`

**Interfaces:**
- Produces: `summarizeSubtitleRemovalBatch(items)`.
- Produces: `pickSubtitlePreparationItems(items, activeIds, concurrency)`.
- Produces: `mapWithSubtitleConcurrency(items, concurrency, worker)`.

- [ ] **Step 1: Write failing behavior tests**

Cover selected-ready totals, total duration, error exclusion, FIFO preparation selection, and maximum observed worker concurrency.

```js
assert.deepEqual(summarizeSubtitleRemovalBatch([
  { clientItemId: 'a', selected: true, phase: 'ready', draft: { durationSeconds: 3 } },
  { clientItemId: 'b', selected: true, phase: 'error', draft: { durationSeconds: 7 } },
]), {
  totalCount: 2,
  selectedCount: 2,
  readySelectedCount: 1,
  errorCount: 1,
  totalSelectedDurationSeconds: 10,
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test src/utils/subtitleRemovalBatch.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure helpers**

```js
const bounded = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const summarizeSubtitleRemovalBatch = (items = []) => ({
  totalCount: items.length,
  selectedCount: items.filter((item) => item.selected).length,
  readySelectedCount: items.filter((item) => item.selected && item.phase === 'ready' && item.draft?.sourceUrl).length,
  errorCount: items.filter((item) => item.phase === 'error').length,
  totalSelectedDurationSeconds: items
    .filter((item) => item.selected)
    .reduce((sum, item) => sum + Math.max(0, Number(item.draft?.durationSeconds || 0)), 0),
});

export const pickSubtitlePreparationItems = (items = [], activeIds = [], concurrency = 2) => {
  const slots = Math.max(0, bounded(concurrency, 2, 1, 4) - new Set(activeIds).size);
  return items.filter((item) => item.phase === 'queued').slice(0, slots);
};

export async function mapWithSubtitleConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await worker(items[index], index) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, bounded(concurrency, 2, 1, 4)) }, lane));
  return results;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `node --test src/utils/subtitleRemovalBatch.test.mjs`

Expected: PASS.

Commit: `feat: add subtitle batch queue contract`

---

### Task 3: Replace the single-video workspace with a batch-first UI

**Files:**
- Modify: `src/shell/components/SubtitleRemovalWorkspace.tsx`
- Create: `src/shell/components/SubtitleRemovalRegionDialog.tsx`
- Modify: `src/shell/components/SubtitleRemovalWorkspace.test.mjs`
- Modify: `src/shell/modules/Video/VideoModule.tsx`

**Interfaces:**
- Consumes: the Task 2 summary and queue helpers.
- Produces: `SubtitleRemovalSubmitInput` with `clientItemId`, `draft`, normalized region, and pixels.
- Produces: `onSubmit(inputs[])` and `limits` props.

- [ ] **Step 1: Add failing workspace contract assertions**

Require `multiple`, a task-list label, default/custom region labels, a batch submit confirmation, and a separate region dialog.

```js
assert.match(source, /multiple/);
assert.match(source, /批量任务/);
assert.match(source, /默认区域/);
assert.match(source, /已调整/);
assert.match(source, /批量开始去字幕/);
assert.match(source, /SubtitleRemovalRegionDialog/);
assert.doesNotMatch(source, /event\.target\.files\?\.\[0\]/);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test src/shell/components/SubtitleRemovalWorkspace.test.mjs`

Expected: FAIL because the workspace is still single-file.

- [ ] **Step 3: Implement batch state and media preparation**

Use this item shape inside the workspace:

```ts
type BatchItem = {
  clientItemId: string;
  selected: boolean;
  file?: File;
  draft?: SubtitleRemovalSourceDraft;
  region: SubtitleRemovalRegion;
  regionMode: 'default' | 'custom';
  phase: 'queued' | 'uploading' | 'analyzing' | 'transcoding' | 'ready' | 'submitting' | 'error';
  uploadProgress: number;
  stageText: string;
  errorMessage?: string;
};
```

Reject an over-limit selection before appending any items. Queue every accepted file with `DEFAULT_SUBTITLE_REGION`, and use one `AbortController` plus media session per `clientItemId`. When one item fails, update only that item and let `pickSubtitlePreparationItems` fill the free slot.

- [ ] **Step 4: Implement list-first JSX and the editor dialog**

The main workspace must render the upload control plus rows; `SubtitleRegionEditor` moves into the dialog:

```tsx
<input ref={inputRef} type="file" accept="video/*" multiple className="hidden" />
<section aria-label="去字幕批量任务">
  {items.map((item) => <SubtitleBatchRow key={item.clientItemId} item={item} />)}
</section>
<SubtitleRemovalRegionDialog
  item={editingItem}
  onCancel={() => setEditingItemId('')}
  onSave={(region) => updateRegion(editingItem.clientItemId, region)}
/>
```

The dialog is centered on desktop, full-screen below the small breakpoint, keeps the full video aspect ratio, and mounts exactly one `SubtitleRegionEditor`.

Define `SubtitleBatchRow` as a local focused component in `SubtitleRemovalWorkspace.tsx` with explicit `item`, `onToggle`, `onEdit`, `onRetry`, `onReplace`, and `onRemove` props. Add `onDragOver`/`onDrop` to the upload surface and pass dropped files through the same over-limit and MIME validation path as the hidden input. Create at most one lightweight poster per item and revoke it when the item leaves the queue.

- [ ] **Step 5: Add batch confirmation and keep the workspace mounted across video subfeature switches**

Pass the workspace to `ProjectListView.beforeProjects` for every video subfeature but wrap it with `hidden={activeSubFeature !== 'subtitle_removal'}`. This preserves temporary queue state while switching among video subfeatures without exposing it elsewhere.

- [ ] **Step 6: Run tests and commit**

Run: `node --test src/utils/subtitleRemovalBatch.test.mjs src/shell/components/SubtitleRemovalWorkspace.test.mjs src/shell/components/SubtitleRegionEditor.test.mjs`

Expected: PASS.

Commit: `feat: add batch subtitle workspace`

---

### Task 4: Create bounded durable jobs under one batch project

**Files:**
- Modify: `src/services/subtitleRemovalClient.ts`
- Modify: `src/services/subtitleRemovalClient.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/modules/Video/VideoModule.tsx`
- Modify: `src/types.ts`
- Modify: `server/jobSubmissionPolicy.mjs`
- Modify: `server/jobSubmissionPolicy.test.mjs`

**Interfaces:**
- Produces: `buildSubtitleRemovalJobRequest` payload fields `batchId`, `batchIndex`, `batchCount`, `shellResultId`.
- Consumes: `mapWithSubtitleConcurrency` and `SystemPublicConfig.subtitleRemoval.batchSubmitConcurrency`.

- [ ] **Step 1: Write failing request-contract tests**

```js
assert.deepEqual(request.payload.batchId, 'batch-1');
assert.equal(request.payload.batchIndex, 0);
assert.equal(request.payload.batchCount, 2);
assert.equal(request.payload.shellResultId, 'batch-1-result-0');
assert.notEqual(first.payload.clientSubmissionKey, second.payload.clientSubmissionKey);
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --experimental-strip-types --test src/services/subtitleRemovalClient.test.mjs`

Expected: FAIL because batch identity is not in the request.

- [ ] **Step 3: Extend the request builder without changing the Golden provider contract**

Add required batch fields to `SubtitleRemovalSubmissionInput` and to the internal payload. Include `shellResultId` and `batchIndex` in the client submission key; do not modify `server/subtitleRemovalContract.mjs` `videoName` formatting.

At the server job policy boundary, reject non-integer `batchCount`, `batchIndex < 0`, `batchIndex >= batchCount`, or `batchCount > subtitleRemovalConfig.batchMaxItems` with `subtitle_batch_invalid`. This is the authoritative anti-bypass limit even though the client sends one `/api/jobs` request per video.

- [ ] **Step 4: Replace `handleSubtitleRemovalSubmit` with bounded batch submission**

Create one `shellProjectId`, one project name, and stable result IDs before calling the job API. Submit only ready selected inputs through:

```ts
const settlements = await mapWithSubtitleConcurrency(
  inputs,
  systemConfig?.subtitleRemoval?.batchSubmitConcurrency || 2,
  async (input, batchIndex) => createInternalJob(buildSubtitleRemovalJobRequest({
    userId: currentUser.id,
    shellProjectId,
    shellProjectName,
    batchId: shellProjectId,
    batchIndex,
    batchCount: inputs.length,
    shellResultId: `${shellProjectId}-result-${batchIndex}`,
    ...input,
  })),
);
```

Build one project whose `results` contain a generating result for each created job and an error result for each job-creation failure. Persist once after the batch settles. Return per-`clientItemId` outcomes so the workspace removes submitted items and retains failed ones.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --experimental-strip-types --test src/services/subtitleRemovalClient.test.mjs`

Run: `node --test server/jobSubmissionPolicy.test.mjs`

Run: `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "subtitle"`

Expected: PASS.

Commit: `feat: submit subtitle removal batches`

---

### Task 5: Hydrate a batch into one project and show partial completion

**Files:**
- Modify: `src/adapters/subtitleRemovalHydration.test.mjs`
- Modify: `src/adapters/shellDataAdapter.ts`
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Consumes: payload `shellProjectId`, `shellResultId`, `batchIndex`, `batchCount`.
- Produces: one project with stable ordered results and derived `部分完成` display state.

- [ ] **Step 1: Write failing multi-job hydration tests**

Create three jobs with the same `shellProjectId`: succeeded index 0, failed index 1, running index 2. Assert one project, three results in index order, `taskCount=3`, `completedCount=1`, and active status. Then make index 2 succeed and assert the project has mixed terminal results suitable for partial display.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --experimental-strip-types --test src/adapters/subtitleRemovalHydration.test.mjs`

Expected: FAIL on stable result identity/order or aggregate count.

- [ ] **Step 3: Preserve batch metadata and stable result identity**

Extend `getSubtitleRemovalResultMetadata`:

```ts
shellResultId: String(result.shellResultId || payload.shellResultId || '').trim() || undefined,
batchId: String(result.batchId || payload.batchId || '').trim() || undefined,
batchIndex: Number.isInteger(Number(result.batchIndex ?? payload.batchIndex))
  ? Number(result.batchIndex ?? payload.batchIndex)
  : undefined,
batchCount: Number.isInteger(Number(result.batchCount ?? payload.batchCount))
  ? Number(result.batchCount ?? payload.batchCount)
  : undefined,
```

Use `shellResultId` before the job-derived fallback ID, and let the existing project merge sort by `batchIndex` and preserve completed-over-stale results.

- [ ] **Step 4: Add a subtitle-specific partial display label**

In `ProjectCard`, derive a display-only state without expanding the shared project status union:

```ts
const subtitleSuccessCount = isSubtitleRemovalProject
  ? project.results.filter((result) => result.status === 'completed' && result.videoUrl).length
  : 0;
const subtitleErrorCount = isSubtitleRemovalProject
  ? project.results.filter((result) => result.status === 'error').length
  : 0;
const isSubtitlePartial = isSubtitleRemovalProject
  && !hasGeneratingResult
  && subtitleSuccessCount > 0
  && subtitleErrorCount > 0;
const st = isSubtitlePartial
  ? { label: '部分完成', color: 'var(--warning)', bg: 'var(--warning-soft)' }
  : statusStyle[displayProjectStatus];
```

Show success/error counts in the detail header and keep one comparison player per currently visible result, not all videos at once.

- [ ] **Step 5: Run tests and commit**

Run: `node --experimental-strip-types --test src/adapters/subtitleRemovalHydration.test.mjs`

Run: `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "subtitle"`

Expected: PASS.

Commit: `feat: hydrate subtitle removal batches`

---

### Task 6: Add safe per-item retry and batch deletion coverage

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/utils/shellDeletionJobs.test.mjs`
- Modify: `src/shell/components/destructiveActions.test.mjs`
- Modify: `src/adapters/subtitleRemovalHydration.test.mjs`

**Interfaces:**
- Produces: failed-result retry that stays under the original `shellProjectId` and `shellResultId`.
- Preserves: existing project tombstone and backend-job aggregation behavior.

- [ ] **Step 1: Write failing retry/deletion tests**

Assert that deleting a subtitle batch with three results collects all three `backendJobId` values. Assert a failed subtitle result exposes a retry action while `provider_submission_unknown` does not.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --experimental-strip-types --test src/utils/shellDeletionJobs.test.mjs src/shell/components/destructiveActions.test.mjs src/adapters/subtitleRemovalHydration.test.mjs`

Expected: FAIL because subtitle retry policy is absent.

- [ ] **Step 3: Implement retry policy**

- When a failed job has a recoverable existing `providerTaskId`, call the existing job retry/recovery endpoint so the provider adapter only queries that ID.
- When the provider has a confirmed terminal failure and a new paid task is required, show a confirm dialog containing `将产生一次新的付费处理` before creating a new job with the same logical result ID and a new retry nonce.
- When `errorCode === 'provider_submission_unknown'`, disable new submission and show the existing administrator-verification guidance.
- Update the original result in place to `generating` with the new `backendJobId`; do not create another top-level project.

- [ ] **Step 4: Verify deletion and retry**

Run the tests from Step 2.

Expected: PASS, including all backend job IDs and no retry for unknown submission state.

- [ ] **Step 5: Commit**

Commit: `feat: retry subtitle batch items safely`

---

### Task 7: Sync env docs, operational docs, and regression coverage

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/project-overview.md`
- Modify: `项目交接上下文.md`
- Modify: `docs/superpowers/specs/2026-07-15-video-subtitle-removal-design.md`

**Interfaces:**
- Documents exactly the three new env knobs and local-first acceptance rule.

- [ ] **Step 1: Add the env entries with conservative defaults**

```dotenv
MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS=10
MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY=2
MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY=2
```

Explain the clamp ranges and that submission concurrency only controls durable job creation, not provider retry policy.

- [ ] **Step 2: Correct the superseded single-video spec**

Replace the obsolete `<safeId>_<x1>_<y1>_<x2>_<y2>` statement with `x1_y1_x2_y2` and link the batch enhancement spec so the two specs cannot contradict each other.

- [ ] **Step 3: Run doc and secret checks**

Run: `git diff --check`

Run: `git grep -l -F 'GOLDEN_C8C' -- . | wc -l`

Expected: no whitespace errors and `0` tracked secret matches.

- [ ] **Step 4: Commit**

Commit: `docs: document subtitle batch controls`

---

### Task 8: Full local verification and browser acceptance

**Files:**
- Modify only if verification exposes a defect in the files already listed above.

**Interfaces:**
- Produces fresh evidence that local code, backend readiness, UI behavior, and build all pass without a paid submission.

- [ ] **Step 1: Run focused subtitle and media tests**

```bash
node --test server/subtitleRemovalContract.test.mjs server/providerSubtitleRemoval.test.mjs server/mediaTranscodeContract.test.mjs server/mediaTranscodeService.test.mjs
node --experimental-strip-types --test src/utils/subtitleRemovalBatch.test.mjs src/utils/subtitleRemovalRegion.test.mjs src/services/subtitleRemovalClient.test.mjs src/adapters/subtitleRemovalHydration.test.mjs src/shell/components/SubtitleRemovalWorkspace.test.mjs src/shell/components/SubtitleRegionEditor.test.mjs src/shell/components/SubtitleComparisonPlayer.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run project health and build**

Run: `npm run doctor`

Run: `npm run build`

Expected: exit 0; local 3000/3100 ready; TypeScript and Vite build succeed.

- [ ] **Step 3: Run non-paid readiness probes**

Run: `npm run probe:subtitle-removal`

Run: `npm run probe:media-transcode`

Expected: readiness `enabled=true`, `configured=true`, `paidSubmissions=0`; media probe PASS.

- [ ] **Step 4: Verify the real local page in the in-app browser**

Use the existing signed-in tab at `http://127.0.0.1:3000/`. Verify:

- the old unavailable banner is absent;
- the upload input accepts multiple videos;
- adding multiple local fixtures shows a task list without automatically opening the editor;
- opening one row mounts one responsive region editor and saving returns to the same list;
- the default-region label remains on untouched rows;
- an invalid file does not block ready rows;
- the batch confirmation reports only selected ready items;
- no console errors occur.

Do not confirm the final paid-submit dialog.

- [ ] **Step 5: Run final repository and secret checks**

Run: `git status -sb`

Run: `git diff --check`

Run: `git grep -l -F 'GOLDEN_C8C' -- . | wc -l`

Expected: only intentional changes before the final commit, no whitespace errors, and zero tracked secret matches.

- [ ] **Step 6: Commit the verified implementation**

Commit any verification-only corrections with: `fix: close subtitle batch acceptance gaps`

Do not push or deploy.
