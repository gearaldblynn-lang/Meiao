# Task 13 Final Independent Review

## Verdict

**PASS — approved with no findings.**

- Critical: 0
- Important: 0
- Minor: 0

Commit `e4fb6869a34ddb02be35b509040c822f332bf229` closes the final
contract-strength Minor without changing runtime code. Together with
`531e385`, `edd5e88`, `e4a4265`, `08f5118`, and `12379ab`, Task 13 now has a
green tracked server gate and regression coverage for the full authoritative
state-write sequence.

Review scope was local and read-only apart from updating this report. No
provider or paid request was made, and nothing was pushed, deployed, or changed
in cloud state.

## Final contract verification

### Locked writer behavior

The new behavior test calls the real exported
`writeMergedAppStateUnderUserLock`, not a copied implementation. Its spies
prove that:

1. the user lock callback begins first;
2. `readState` runs with the same user and lock resource;
3. `scrubState` receives the real `mergeAppStateForStorage(previous,
   incoming)` result;
4. `saveState` runs after scrub and receives the exact same object returned by
   `scrubState`, verified by reference identity;
5. the writer returns the ordinary `{ ok: true }` response.

This preserves the old asset-scrubbing guarantee under the new shared writer
abstraction while also pinning the lock boundary.

### Transactional MySQL contract

The source contract extracts only
`saveDbAppStateAndQueueRemovedAssetsUnderLock` and requires this order:

```text
beginTransaction
-> INSERT INTO app_states
-> ON DUPLICATE KEY UPDATE
-> queueRemovedStateAssetsForCleanup
-> commit
```

It still requires the real MySQL route to inject
`withManagedAssetUserLock`, `getDbAppStateUnderManagedAssetLock`,
`scrubDbStateBeforeStorage`, and
`saveDbAppStateAndQueueRemovedAssetsUnderLock` into the shared writer. The
independent local JSON merge -> scrub -> save assertion remains unchanged.

### Mutation RED evidence

The implementation report records two temporary uncommitted mutations: plain
insert instead of upsert, and save bypassing the scrubbed object. They produced
two independent failures before the runtime files were restored.

An independent non-mutating probe confirmed that the final contracts reject
both mutations:

```json
{
  "plainInsertMutationRejected": true,
  "scrubBypassMutationRejected": true
}
```

The RED evidence is consistent with the actual assertions: the SQL mutation
cannot satisfy `ON DUPLICATE KEY UPDATE`, and the scrub bypass fails the
`assert.equal(nextState, scrubbedState)` identity check.

## Production and historical regression status

The production MySQL route still holds one user-specific named lock across
read -> merge -> scrub -> transactional save/cleanup -> canonical response
preparation. The save helper has no nested user-lock acquisition, keeps all
transient attempts inside the outer lock, rolls back each started failed
transaction, and releases connections in `finally`. Missing state rows use the
active-user guard followed by the tested upsert. Ordinary state-save and local
JSON behavior remain compatible.

Fresh regressions remain green for:

- cancellation-first manual and single retry, canonical rejection, and zero
  controller/job creation;
- retry-first final cancellation;
- different-user independence and lock release after an injected failure;
- the server-canonical retry authorization matrix;
- `MAX_SAFE` compact causal chains in both merge orders;
- additive, deduplicated analysis-credit ledgers;
- late provider error normalization;
- original cancellation, hydration, and ledger cases.

## Verification evidence

- `node --test server/assetReferenceCleanup.test.mjs`: **8/8 passed**.
- `npm run test:server`: PASS, all 112 server test files.
- Atomicity, state-route, asset cleanup/deletion, and historical Product
  Restoration regression group: **91/91 passed**.
- Independent dual-mutation probe: both regressions rejected.
- `npx tsc -b --pretty false`: PASS.
- `git diff --check` and `git diff --cached --check`: PASS.

Commit isolation is clean: `e4fb686` contains only the Task 13 implementation
report and `server/assetReferenceCleanup.test.mjs`. It has no runtime,
provider, plan, or legacy-label diff. The pre-existing plan edit and the user's
`src/adapters/shellPersistence.ts` changes remain uncommitted and untouched.
