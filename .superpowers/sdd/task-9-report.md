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
