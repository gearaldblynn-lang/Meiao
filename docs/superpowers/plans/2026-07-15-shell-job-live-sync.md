# Project Card Live Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every queue-backed project card discovers terminal backend job results without a manual browser refresh.

**Architecture:** Keep the existing `/api/jobs` hydration and shell data adapter as the authoritative recovery path. Add one small browser lifecycle coordinator that runs hydration periodically while a module workspace is open, triggers an immediate refresh when the page becomes usable again, and coalesces overlapping triggers so stale requests cannot overwrite newer state.

**Tech Stack:** React 19, TypeScript, browser lifecycle events, Node test runner.

## Global Constraints

- Preserve existing provider submission, job adapter, deletion tombstone, and project persistence behavior.
- Apply the fix once at the shared shell layer so one-click, translation, buyer show, retouch, everything replacement, video, and Xiaohongshu cover all inherit it.
- Polling interval is configurable through `VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS` with a conservative 10000 ms default and a 1000 ms lower bound.
- Initial repair session: do not deploy, submit paid tasks, commit, or modify unrelated dirty subtitle/upload work. On 2026-07-16 the user explicitly authorized an isolated commit after fresh verification; deployment and paid canaries remain out of scope.

---

### Task 1: Browser lifecycle sync coordinator

**Files:**
- Create: `src/utils/shellJobSync.ts`
- Create: `src/utils/shellJobSync.test.mjs`

**Interfaces:**
- Produces: `createCoalescedAsyncRunner(operation)`, `getShellJobSyncIntervalMs(rawValue)`, and `startShellJobSync(options)`.
- Guarantees: at most one hydration runs at once; concurrent triggers collapse into one trailing run; focus, pageshow, online, visible-state, and interval events all request hydration; cleanup removes every listener and timer.

- [x] **Step 1: Write failing coordinator tests**

```js
test('coalesces concurrent refresh requests into one trailing run', async () => {
  const run = createCoalescedAsyncRunner(blockingOperation);
  const first = run();
  const second = run();
  assert.equal(operationCount, 1);
  releaseFirst();
  await second;
  assert.equal(operationCount, 2);
  await first;
});

test('refreshes on foreground and network lifecycle events', async () => {
  const stop = startShellJobSync({ run, windowTarget, documentTarget, intervalMs: 10000 });
  fireInitialTimer();
  dispatchVisibleFocusPageshowOnlineAndInterval();
  assert.equal(runCount, 6);
  stop();
  assert.equal(activeListenerCount, 0);
});
```

- [x] **Step 2: Run RED test**

Run: `node --experimental-strip-types --test src/utils/shellJobSync.test.mjs`

Expected: FAIL because `src/utils/shellJobSync.ts` does not exist.

- [x] **Step 3: Implement the minimal coordinator**

```ts
export const createCoalescedAsyncRunner = (operation: () => Promise<void>) => {
  let inFlight: Promise<void> | null = null;
  let trailingRunRequested = false;
  return () => {
    if (inFlight) {
      trailingRunRequested = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        trailingRunRequested = false;
        await operation();
      } while (trailingRunRequested);
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
};
```

- [x] **Step 4: Run GREEN test**

Run: `node --experimental-strip-types --test src/utils/shellJobSync.test.mjs`

Expected: all coordinator tests pass.

### Task 2: Integrate one shared live-sync loop

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Create: `src/shell/shellJobLiveSyncBehavior.test.mjs`

**Interfaces:**
- Consumes: the coordinator from Task 1 and the existing `hydrateShellJobs()` operation.
- Produces: one stable coalesced hydration callback and one module-workspace lifecycle effect.

- [x] **Step 1: Write failing shell integration tests**

```js
test('shell project cards refresh independently of locally remembered active jobs', () => {
  assert.match(shellSource, /startShellJobSync/);
  assert.doesNotMatch(liveSyncEffect, /hasActiveBackendTask|hasActiveBackendProject/);
  assert.match(liveSyncEffect, /pageMode !== 'module'/);
});

test('account changes invalidate an old hydration before it can apply', () => {
  assert.match(shellSource, /jobsHydrationEpochRef/);
  assert.match(hydrationBody, /if \(hydrationEpoch !== jobsHydrationEpochRef\.current\) return/);
});
```

- [x] **Step 2: Run RED integration test**

Run: `node --test src/shell/shellJobLiveSyncBehavior.test.mjs`

Expected: FAIL because the shared coordinator is not wired into `ShellMigratedApp.tsx`.

- [x] **Step 3: Wire hydration through the coordinator**

```ts
const hydrateShellJobsOperationRef = useRef<() => Promise<void>>(async () => undefined);
const hydrateShellJobsRunnerRef = useRef<(() => Promise<void>) | null>(null);
if (!hydrateShellJobsRunnerRef.current) {
  hydrateShellJobsRunnerRef.current = createCoalescedAsyncRunner(
    () => hydrateShellJobsOperationRef.current(),
  );
}
```

Replace the active-task-gated interval effect with `startShellJobSync`, retain the `pageMode === 'module'` scope, and invalidate the captured async account scope during account reset, module exit, and component unmount.

- [x] **Step 4: Run GREEN integration and adapter tests**

Run: `node --experimental-strip-types --test src/shell/shellJobLiveSyncBehavior.test.mjs src/utils/shellJobSync.test.mjs src/adapters/shellDataAdapter.test.mjs src/utils/syncedProjectPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs`

Expected: all tests pass, including every existing queue-backed module recovery case.

### Task 3: Configuration and recurring-issue documentation

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/agents/repeated-issues.md`

**Interfaces:**
- Documents: `VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS=10000`, the confirmed dual-polling root cause, the shared-shell fix, and the regression commands.

- [x] **Step 1: Document the build-time interval**

Add the environment key beside existing `VITE_MEIAO_*` browser settings and state that changing it requires a frontend rebuild.

- [x] **Step 2: Record the recurring root cause**

Record symptom, environment, provider/job/state evidence, fix, regression check, and prevention rule. Mark deployment state explicitly as `not_deployed` until a later release is verified.

- [x] **Step 3: Verify documentation references**

Run: `rg -n "VITE_MEIAO_SHELL_JOB_SYNC_INTERVAL_MS|manual refresh|手动刷新|not_deployed" .env.server.example docs/project-overview.md docs/agents/repeated-issues.md`

Expected: configuration and recurring-issue entries are present and consistent.

### Task 4: Fresh completion gate

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: fresh evidence that the focused regression, frontend suite, type build, and project health gate pass.

- [x] **Step 1: Run focused regression**

Run: `node --experimental-strip-types --test src/utils/shellJobSync.test.mjs src/shell/shellJobLiveSyncBehavior.test.mjs src/adapters/shellDataAdapter.test.mjs src/utils/syncedProjectPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs`

- [x] **Step 2: Run frontend and build gates**

Run: `npm run test:frontend && npm run build && npm run doctor`

- [x] **Step 3: Review only the intended diff**

Run: `git diff -- src/utils/shellJobSync.ts src/utils/shellJobSync.test.mjs src/shell/shellJobLiveSyncBehavior.test.mjs src/ShellMigratedApp.tsx .env.server.example docs/project-overview.md docs/agents/repeated-issues.md docs/superpowers/plans/2026-07-15-shell-job-live-sync.md`

Expected: no provider submission, task deletion, unrelated subtitle, upload, or account behavior changes.

### Task 5: Review hardening before the isolated commit

**Files:**
- Modify: `src/utils/shellJobSync.ts`
- Modify: `src/utils/shellJobSync.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/shell/shellJobLiveSyncBehavior.test.mjs`

- [x] **Step 1: Preserve a trailing refresh after an in-flight failure**

The coalesced runner consumes an already-requested trailing operation even when the current attempt rejects; a successful trailing attempt becomes the final outcome.

- [x] **Step 2: Guard deferred UI and persistence work by account scope**

Captured work is invalidated on account change, logout/unmount, and module exit. Deferred React updaters and queued persistence writers re-check the scope after awaited reads and before any local or remote write.

- [x] **Step 3: Bound missing-job backfill to active identities**

The recent 200-job window still discovers unknown completed jobs. Per-ID fallback fetches only locally known planning/generating/retry-waiting identities, so terminal history cannot create a recurring N+1 request fanout.

- [x] **Step 4: Re-run the isolated-index completion gate and inspect the final staged diff**
