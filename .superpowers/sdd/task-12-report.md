# Task 12 Report: Product Restoration analysis credit ledger

## Outcome

Implemented a durable, additive Product Restoration analysis-attempt ledger at
`generationContext.productRestoreAnalysisAttempts`. The ledger exists before a
valid `productRestore` context, deduplicates by stable analysis job ID, keeps
attempt order, preserves explicit zero separately from missing usage, and is
deep-cloned through persistence and hydration.

## TDD evidence

The mandatory executable tests were added before implementation. The first RED
run had four expected failures:

- invalid structured Ark success dropped model and known credits;
- workflow converted missing usage to zero;
- workflow errors did not expose a durable analysis attempt;
- the ledger utility did not yet exist.

After implementation, the focused Product Restoration aggregate passed
`301/301` tests. Coverage includes unknown valid usage, invalid known usage,
invalid then manual-success accumulation, replay deduplication, single-image
retry ledger stability, explicit zero, historical-context promotion, and
deep-clone persistence/hydration.

## Implementation notes

- `ProductRestoreProjectContext.analysisCreditsConsumed` is now optional and is
  used only as the compatibility fallback when no attempt ledger exists.
- Ark returns job/provider/model and optional actual credits even when provider
  output is structurally invalid.
- Workflow errors carry a typed `analysisAttempt`; initial, resume, and manual
  reanalysis paths merge and persist running/succeeded/invalid/failed attempts.
- Historical contexts are promoted into the attempt ledger before mutation so
  manual reanalysis and recovery cannot discard an older known charge.
- Project totals and the analysis panel read the deduplicated attempt ledger;
  missing usage stays hidden while explicit zero remains displayable.
- Single-image retry reuses the exact generation context and never appends an
  analysis attempt.

## Verification

- Focused Product Restoration aggregate: `301/301` passed.
- `npx tsc -b --pretty false`: passed.
- `npm run lint`: passed (`0` errors; existing warning budget unchanged at
  `660`).
- `npm run build`: passed (Vite production build completed).
- `git diff --check`: passed.

No provider call, paid generation, push, deploy, or cloud mutation was made.

## Residual acceptance boundary

The ledger uses provider-reported actual usage only. A provider response that
omits usage remains intentionally unknown in the project UI; the server job
ledger remains the billing source of truth.
