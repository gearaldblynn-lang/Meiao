# Task 9 Report: Product Restoration cancellation is terminal

## Scope

Fixed Critical finding 1 from `final-review.md` without provider calls, paid
generation, deployment, or cloud mutation.

## TDD evidence

- RED: added an executable three-target cancellation race and ran
  `node --experimental-strip-types --test src/adapters/shellProductRestoreCancellation.test.mjs`.
  It failed with `ERR_MODULE_NOT_FOUND` because the cancellation helper did not
  exist yet.
- GREEN: implemented the cancellation registry, terminal project transition,
  resume predicate, and controlled fan-out. The focused race and Product
  Restoration workflow suite passed 67/67.
- REGRESSION: the Product Restoration workflow/lifecycle/data/persistence
  aggregate passed 218/218.

## Implementation

- Registers a per-project cancellation tombstone before controller abort and
  job-ID collection.
- Aggregates persisted/task IDs and every observed Product Restoration ID.
  Racing `onJobCreated` identities are cancelled once and included in the
  cumulative audit payload.
- Marks the Product Restoration project terminal while preserving completed
  media and every result/backend identity.
- Centralizes the automatic-resume predicate and checks the cancellation guard
  before and after persistence, fetch, module-load, and image-create boundaries.
- Replaces unbounded image fan-out with a controlled worker queue that retains
  the configured concurrency and stops claiming new targets after cancellation.
- Clears the tombstone only in explicit rollout-gated reanalysis or result retry
  actions. Automatic recovery never clears it.
- Leaves generic cancellation and Product Restoration deletion behavior intact.

## Verification

- `node --experimental-strip-types --test src/adapters/shellProductRestoreCancellation.test.mjs src/adapters/shellProductRestoreWorkflow.test.mjs src/adapters/shellControlJobLifecycle.test.mjs src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs` — 218 passed, 0 failed.
- `npx tsc -b` — passed.
- `npm run lint` — passed with 0 errors and the existing 660-warning budget.
- `npm run build` — passed; Vite transformed 2177 modules.
- `git diff --check` — passed.

## Safety and isolation

Only Task 9 source/tests/report are included in the Task 9 commit. The unrelated
pre-existing `assetType: 'result'` hunk in `src/ShellMigratedApp.tsx`, concurrent
managed-asset/provider work, and all other dirty files remain unstaged.

## Review correction: durable cancellation across refresh

The first review found that an `error` project without a structured marker was
revived as `generating` by hydration. A new integration RED now runs the real
path `cancel -> upsertShellProjectIntoPersistedState -> buildShellDataSnapshot`
with one completed target, one still-running child, and one uncreated target.
On commit `085c0b9` it failed with `actual: generating, expected: error`. A
second RED showed a media-bearing stale `generating` row remained active with a
zero `completedCount`.

The correction adds the typed additive marker
`generationContext.productRestoreCancellation` with version, cancelled status,
user-request reason, timestamp, and aggregated job IDs. Explicit clone and merge
helpers preserve the marker through persistence and hydration; only an explicit
`undefined` written by a user retry clears it. Product Restoration normalization
forces a marked project and all non-media rows terminal even when a known child
job is still running, while media-bearing rows become completed without losing
identity or credits. Both automatic resume entry and every guarded async
boundary check the durable marker together with the in-memory registry.

Manual reanalysis and single-result retry now persist the marker-cleared project
before clearing the registry, constructing a controller, or loading/creating any
workflow job. Persistence failure therefore creates zero provider jobs. A late
`onJobCreated` identity is still cancelled once and is also merged into the
durable marker/audit aggregate.

Review-correction verification:

- Executable persisted cancellation/hydration race and stale-media test: 2/2.
- Lifecycle source sequencing test: 11/11.
- Product Restoration workflow/lifecycle/data/persistence exact aggregate:
  220/220 with `--test-concurrency=1 --test-force-exit`.
- `npx tsc -b`: passed.
- `npm run lint`: passed with 0 errors and the existing 660-warning budget.
- `npm run build`: passed; Vite transformed 2177 modules.
- `git diff --check`: passed.

The initial non-force-exit aggregate had already reported all assertions green
but retained the repository's known Vite/esbuild handle. Only that Task 9 runner
and its child were terminated; the documented force-exit rerun above exited 0.
