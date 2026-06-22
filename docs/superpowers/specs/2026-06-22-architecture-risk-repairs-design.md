# Architecture Risk Repairs Design

## Goal

Reduce the highest-risk architecture findings from the weekly review with small, verified changes. This is local development work only: no deploy, no GitHub operation, and no cloud state changes.

## Scope

This repair pass covers three focused items:

1. OneClick generation/recovery status handling has repeated logic across first image, main image, detail page, and SKU.
2. Provider task identity and checkpoint behavior must stay protected while `providerGateway.mjs` remains large.
3. `internalApi.ts` needs behavior-level tests for chat streaming fallback and internal job polling.

This pass does not split `server/providerGateway.mjs` into multiple adapters. That is a larger refactor and should wait until the behavior protections above are in place.

## Design

### OneClick Generation Run Helper

Create a small pure helper for the common OneClick scheme update decisions:

- Before a new generation run, clear stale `taskId` and `resultUrl`.
- Before a recovery run, keep the existing identity and only clear the visible error.
- When a backend job is created, expose `backendJobId` immediately.
- When an upstream provider task id arrives, expose it as the visible `taskId`.
- When no provider task id is available yet, do not substitute the internal job id as `taskId`.

The helper is intentionally small. It creates locality for the most repeated state transition without forcing a UI rewrite.

### Provider Checkpoint Protection

Add focused tests around existing provider behavior instead of changing provider implementation first:

- `onProviderTaskId` must fire as soon as KIE createTask returns a task id.
- Retry with existing `providerTaskId` must poll the old task instead of creating a new task.
- `kie_probe` must remain single-query and preserve `providerTaskId`.

Existing code likely already satisfies these behaviors; the goal is to keep the seam protected before any future provider split.

### Internal API Behavior Tests

Strengthen `src/services/internalApi.test.mjs` so it verifies behavior rather than only source shape:

- `sendChatMessage` falls back to JSON when the server does not return `text/event-stream`.
- `sendChatMessage` throws `stream_incomplete` when a stream ends without a `done` event.
- `waitForInternalJob` keeps polling through `retry_waiting` and returns only terminal states.

## Validation

Run focused tests first:

```bash
node --experimental-strip-types --test src/modules/OneClick/oneClickGenerationRun.test.mjs
node --experimental-strip-types --test src/services/internalApi.test.mjs
node --test server/providerGateway.test.mjs --test-name-pattern "providerTaskId|probe|reuses"
```

Then run the nearby regression set:

```bash
node --experimental-strip-types --test src/modules/OneClick/oneClickBehavior.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/services/kieAiService.test.mjs src/services/internalApi.test.mjs
node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs
```
