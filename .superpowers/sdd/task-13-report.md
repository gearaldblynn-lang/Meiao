# Task 13 Report: Monotonic Product Restoration app-state merge

## Outcome

Implemented a server-authoritative, JSON-safe Product Restoration merge contract.
A stale app-state snapshot can no longer erase a durable user cancellation or
analysis-credit attempt ledger. Explicit retry is represented by a typed
`productRestoreCancellationReset` event, persisted before any retry controller
or provider job can be created.

## Implementation

- Added the pure server-safe `src/utils/productRestoreDurableState.mjs` contract.
  It normalizes and orders cancellation/reset events and additively merges
  analysis attempts by stable `jobId`.
- `server/appStateMerge.mjs` now deep-merges Product Restoration generation
  context and gives an effective cancellation precedence over missing targets,
  active rows, completed snapshots, and stale root errors.
- Frontend cancellation, persistence, hydration, and data-clone paths now carry
  the typed reset event. The TypeScript analysis-credit utility calls the same
  pure ledger merger used by the server.
- Manual reanalysis and single-result retry persist the reset first; persistence
  failure leaves the in-memory guard intact and creates zero controllers/jobs.
- Added the recurring root cause and prevention rule to
  `docs/agents/repeated-issues.md`.

## Review hardening

The three Important review findings were reproduced with failing regression
tests and fixed without widening the provider boundary:

- shared analysis-credit merge now normalizes both existing and incoming
  ledgers, removes pre-existing duplicate `jobId` rows, and preserves the
  strongest known credit value independently of snapshot order;
- cancellation/reset events now use JSON-safe causal identities in addition to
  safe integer timestamps, so equal timestamps, clock rollback, and precision
  limits cannot silently revive or suppress a cancellation;
- explicit retry consumes the server-canonical persisted transition and fails
  closed unless the stored reset actually supersedes the effective cancellation;
- hydration canonicalizes an effectively cancelled project after late provider
  rows are folded, preventing failed late rows from replacing the root manual
  cancellation error or polluting completed media children.

## Re-review hardening

The Critical and Important findings from the second independent review were
also reproduced before implementation:

- a production-equivalent stale tab received boolean success after the real
  server merge retained an unseen newer cancellation, and incorrectly
  authorized both manual and single-result retry work;
- `C1 -> R1 -> C2 -> R2` at `MAX_SAFE_INTEGER` lost the intermediate ancestry
  after compaction, so merging the stale original `C1` re-locked the project in
  both server write orders.

The retry write now explicitly requests the canonical state produced after the
authenticated server merge and storage write. The caller accepts only the same
reset `eventId` in that canonical project while cancellation is ineffective;
boolean-only acknowledgments, missing canonical projects, and server-retained
newer cancellations all fail closed before guard clearing, controller creation,
or workflow entry. Ordinary app-state writes keep their existing compact
`{ ok: true }` acknowledgment.

Cancellation/reset events now also carry a compact JSON-safe causal epoch and
decimal generation. The timestamp input is bounded to a legal Unix date range,
while generation supplies monotonic ordering across equal times, clock rollback,
and compacted intermediate events. An effective reset also canonicalizes a
stale manual-error root back to `generating`, so hydration and `shouldResume`
remain write-order independent.

## Third-review atomicity hardening

The third review found that the MySQL route still read and merged app state
before acquiring the per-user managed-asset lock. A cancel write could therefore
commit first while an already-merged stale retry later overwrote it and received
canonical authorization.

The MySQL write path now holds one per-user named lock across the complete
read -> merge -> scrub -> transactional write/asset-cleanup scheduling ->
canonical response sequence. The transactional helper no longer acquires a
nested lock, and `runWithTransientRetry` executes inside the outer lock, so all
retry attempts remain serialized. The existing active-owner check, owned-asset
validation, app-state upsert, cleanup enqueue, commit/rollback, binlog handling,
and connection release semantics remain in the locked transactional helper.

Barrier regressions cover cancel-first and retry-first orders, both manual and
single-result retry, cross-user independence, and lock release after an injected
write failure. The source-contract tests also pin the real route to
`withManagedAssetUserLock` and prohibit lock reacquisition in the transactional
helper.

## TDD evidence

Mandatory RED failures were captured first against the real
`mergeAppStateForStorage` path:

- cancelled project became `generating` after stale write;
- cancellation/reset disappeared during shallow generation-context replacement;
- existing analysis attempts disappeared or duplicated across snapshot replay;
- typed reset and frontend retry persistence interfaces were absent.
- boolean-only persistence authorized retry against a newer server cancellation;
- a compact MAX_SAFE multi-retry chain re-locked after stale-root replay.

The final expanded Product Restoration focused suite is green:

```text
427 tests, 427 passed, 0 failed
```

It covers real server merge in both snapshot orders, JSON round trips,
cancel -> reset -> stale cancel -> later cancel ordering, unsafe/future/equal
timestamps and clock rollback, additive and duplicate ledger replay, known
credits versus stale zero in both write orders, persistence/hydration,
`shouldResume=false` with zero recovery creates, late failed-provider rows,
manual/single retry fail-closed ordering, ordinary module compatibility,
Product Restoration lifecycle/workflow, rollout, Ark analysis, UI, and displayed
credits. It also covers canonical response opt-in for both MySQL and local state
routes while confirming ordinary writes do not request or return the full state,
plus same-user MySQL serialization, opposite commit orders, user isolation, and
error-path lock release.

## Verification

- `npx tsc -b --pretty false`: PASS.
- `npm run lint`: PASS, 0 errors and 660 warnings at the existing 660-warning
  budget.
- Full `npm run verify`: server phase completed; frontend reached the known
  retained-handle condition in `shellOneClickWorkflow.test.mjs` and did not
  return, so the owned process was stopped rather than reported as passing.
- `npm run build`: PASS, 2179 modules transformed.
- `git diff --check`: PASS.
- No provider request, paid generation, push, deployment, or cloud mutation.

## Worktree isolation

The pre-existing plan edit remains unstaged. The pre-existing legacy-label
changes in `src/adapters/shellPersistence.ts` are intentionally excluded from
the review-fix commit. The original Task 13 reset type/import/clone hunks were
already committed separately.
