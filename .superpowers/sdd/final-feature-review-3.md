# Final Feature Review 3: Image Upgrade / Product Restoration

## Verdict

**PASS — approved with no findings.**

- Critical: 0
- Important: 0
- Minor: 0

Strict runtime HEAD `d275735ce4de494ce214da4159998ae7d0465758`
contains the complete local Product Restoration feature and the historical
Product Retouch label compatibility fix. The two blockers from
`final-feature-review-2.md` are closed: stale app-state writes can no longer
erase either an effective user cancellation or the additive analysis-attempt
ledger. No Task 1-12 regression was found.

The review was local and non-provider. It created no internal/provider job,
made no paid request, and performed no push, deployment, cloud mutation, or
production configuration change.

## Prior blocker closure

### Cancellation is monotonic and terminal

Product Restoration project merges now use the shared durable generation-
context merger instead of replacing the complete context with a stale incoming
snapshot. Cancellation and explicit retry are JSON-safe causal events. An
effective cancellation is evaluated before missing-target status derivation,
forces the root project to `error`, preserves completed media, and marks
unfinished children interrupted.

An independent real-function probe merged a cancelled partial project with a
stale active snapshot in both storage orders, then hydrated the result. Both
orders produced:

```json
{
  "status": "error",
  "cancelled": true,
  "shouldResume": false,
  "attemptIds": ["a1", "a2"],
  "credits": { "present": true, "analysis": 5, "images": 7, "total": 12 }
}
```

This closes the former paid-fan-out revival path: hydration cannot authorize
automatic recovery after cancellation.

### Analysis attempts and known credits are additive

The server-safe ledger merger normalizes both snapshots, deduplicates by stable
analysis `jobId`, preserves first-seen order, retains explicit zero separately
from unknown usage, and keeps the strongest terminal/status and known-credit
facts. Absence or an empty stale ledger cannot clear persisted attempts.

The same independent probe confirmed that an invalid attempt with 2 known
credits plus a later successful attempt with 3 remains `[a1, a2]` and totals 5
exactly once in both write orders. Image usage remains independently additive.

## Retry and app-state authority

- Manual reanalysis and single-image retry persist a typed retry-reset before
  clearing the in-memory cancellation registry, creating an abort controller,
  or entering a job-creation path.
- A compact boolean acknowledgment is not retry authority. The client requests
  the authenticated server-canonical state and accepts only the same reset
  `eventId` while no effective cancellation remains. A newer server-side
  cancellation therefore fails closed with zero controller/job creates.
- The MySQL state route holds one per-user named lock across read -> merge ->
  scrub -> transactional upsert and removed-asset enqueue -> canonical response.
  The save helper does not reacquire the lock, keeps transient retries inside
  the outer critical section, rolls back failed transactions, and releases its
  connection in `finally`.
- Local non-read requests remain serialized by the local-store mutation lock,
  and canonical state is returned only when explicitly requested.

Barrier regressions cover cancellation-first and retry-first orders, manual and
single retry, different-user independence, failed-write lock release, JSON
round trips, equal/rollback/extreme timestamps, and compact multi-retry causal
chains.

## Whole-feature contract coverage

The implementation and fresh focused suites cover:

- the visible rename from `产品精修` to `图片升级`, with `retouch` and historical
  persisted module/mode keys unchanged;
- the `产品还原` workspace, two ordered upload roles, whole-selection 10-target
  and 5-reference limits, hover guidance, reservation-safe rapid uploads, and
  deterministic reorder behavior;
- six multi-select restoration emphases, defaults for `形态与结构` and
  `材质与纹理`, and supplemental user requirements;
- selectable capable image models, 2K/4K only, no 1K route, original target
  ratio inheritance, and no Product Restoration ratio/custom-size selector;
- exactly one application-level image-capable analysis job for the batch,
  structured-output validation, zero image jobs on invalid analysis, and
  durable analysis persistence before image fan-out;
- one independent generation task per target with strict target-first followed
  by all ordered product references, shared restoration truth, and composition/
  people/text/background preservation constraints;
- partial success, refresh recovery without replacement analysis, stable
  per-target submission keys, single-result retry without reanalysis, and
  deliberate manual reanalysis only after a confirmed terminal analysis state;
- server-authoritative `off/admin/all` creation rollout before dedupe/reserve/
  create, with a narrow non-forgeable dedicated recovery exemption;
- additive analysis/image/total credit display, strict malformed-value handling,
  replay dedupe, explicit zero, and historical fallback promotion;
- cancellation/deletion aggregation across analysis and late image identities,
  late-provider normalization, durable refresh behavior, and no automatic paid
  resume after cancellation; and
- ordinary Retouch, Logo Replace, media, translation, one-click, and historical
  Product Restoration compatibility.

The final packaging gap found during this review is closed by isolated commit
`d275735`: storage cleanup recognizes both the new `图片升级` label and the old
`产品精修` fallback label. A clean checkout therefore does not revive an old
identityless `generating` placeholder after the rename.

## Verification evidence

- Strict-HEAD Product Restoration/rollout/state/UI/workflow aggregate:
  **702/702 passed**, 0 failed.
- Historical reconciliation plus persistence after `d275735`: **34/34 passed**.
- Full server gate: **112/112 test files passed**.
- Additional ordinary-module compatibility group: **27/27 passed**.
- Independent cancellation/hydration/ledger probe: both merge orders passed.
- `npx tsc -b --pretty false`: PASS.
- `npm run lint`: PASS, 0 errors and 660 warnings at the existing 660-warning
  budget.
- `npm run build`: PASS, 2179 modules transformed.
- `git diff --check` and `git diff --cached --check`: PASS.
- Integration-runner cross-check: full server, 17 script files, and the full
  frontend force-exit gate are green.

The only remaining tracked working-tree edit is the pre-existing plan evidence
document. No runtime source is dirty. Added network literals inspected in the
feature patches are test/example fixtures or existing public documentation;
no credential or live provider endpoint was introduced.

## Acceptance boundary

Prior local browser evidence covers the visible labels, tab, upload guidance,
default controls, absence of 1K/ratio/custom dimensions, and the start action
without clicking paid generation. File-input injection and a historical card
were covered by executable UI/component contracts because the browser tooling
could not safely supply those fixtures. Actual restoration quality still needs
one separately approved real-provider acceptance batch; that external quality
check is outside this local, non-billable implementation review.
