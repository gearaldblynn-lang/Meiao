# Task 12 Review Fix Report

## Findings closed

1. Hydration no longer creates an own
   `productRestoreAnalysisAttempts: undefined` property for historical projects
   that never had a ledger. Ordinary persist -> hydrate -> persist therefore
   keeps the legacy context fallback and does not persist an authoritative empty
   ledger. The additive merge also ignores an own `undefined` ledger value.
2. Product Restoration result and project credits now use a scoped optional-aware
   non-negative normalizer during hydration. Explicit provider-reported zero
   remains known while missing, invalid, and negative values remain absent. The
   existing shared `> 0` behavior for other modules was not changed.

## TDD evidence

Both real round-trip tests failed before implementation:

- historical fallback round-trip fabricated an own ledger property;
- explicit-zero image round-trip hydrated `creditsConsumed` as `undefined`.

After the fixes, both round trips pass using the real persisted state, shell
persistence, shell hydration, and total-summary helpers.

## Verification

- Product Restoration focused aggregate: `303/303` passed.
- `npx tsc -b --pretty false`: passed.
- `npm run lint`: passed with `0` errors and the existing `660` warning budget.
- `npm run build`: passed.
- `git diff --check`: passed.

No provider call, paid generation, push, deploy, or cloud mutation was made.
