# Task 12 Fix 2 Report

## Scope

Closed the two Important findings in `.superpowers/sdd/task-12-rereview.md` without provider calls, paid generation, push, deploy, or cloud changes.

## Fixes

### Additive legacy-ledger promotion

- `mergeProductRestoreGenerationContext` now uses `cloneProductRestoreAnalysisAttemptsForMutation(existingContext)` as the base whenever the incoming context explicitly supplies an attempt array.
- An incoming empty array can no longer erase either a materialized ledger or the historical `productRestore.analysisCreditsConsumed` fallback.
- Legacy usage is promoted exactly once before additive merge.
- Empty attempt arrays are not persisted when no historical or current attempt exists.

### Strict known-credit normalization

- Added one shared `normalizeKnownProductRestoreCredits` utility.
- Accepted representations are finite non-negative numbers and strict trimmed non-negative decimal strings.
- Explicit numeric zero remains known.
- Booleans, arrays, objects, whitespace-only strings, `NaN`, and negative values remain unknown.
- The attempt ledger, legacy fallback, total-credit calculation, Product Restoration hydration, Ark initial/recovery boundaries, and Product Restoration UI all reuse the same normalizer.
- Ordinary module hydration continues using its existing positive-credit behavior.

## TDD evidence

RED run:

```text
node --test \
  src/utils/productRestoreAnalysisCredits.test.mjs \
  src/adapters/shellProductRestoreCancellation.test.mjs \
  src/adapters/shellPersistence.test.mjs \
  src/services/arkService.test.mjs

81 tests: 76 passed, 5 failed
```

The failures reproduced both defects at the pure merge, real persistence/hydration, utility, and Ark boundaries. A separate UI RED run reproduced malformed `false` being rendered as known zero.

GREEN focused run:

```text
node --test \
  src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs \
  src/utils/productRestoreAnalysisCredits.test.mjs \
  src/adapters/shellProductRestoreCancellation.test.mjs \
  src/adapters/shellPersistence.test.mjs \
  src/services/arkService.test.mjs

91 tests passed, 0 failed
```

## Verification

- Extended Task 12 aggregate: `490 passed, 0 failed`.
- `npx tsc -b --pretty false`: passed.
- `npm run lint`: passed with `0 errors`; the existing warning budget remained `660/660`.
- `npm run build`: passed; Vite built 2178 modules.
- `git diff --check`: passed before report creation and is rerun during final handoff.

## Files

- `src/utils/productRestoreAnalysisCredits.ts`
- `src/utils/productRestoreAnalysisCredits.test.mjs`
- `src/adapters/shellProductRestoreCancellation.mjs`
- `src/adapters/shellProductRestoreCancellation.test.mjs`
- `src/adapters/shellDataAdapter.ts`
- `src/adapters/shellPersistence.test.mjs`
- `src/services/arkService.ts`
- `src/services/arkService.test.mjs`
- `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.tsx`
- `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs`
