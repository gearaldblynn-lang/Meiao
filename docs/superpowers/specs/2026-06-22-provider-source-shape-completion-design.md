# Provider Gateway and Source-Shape Completion Design

## Goal

Finish the first two architecture efforts from the weekly review without turning them into a broad rewrite:

1. Deepen the Provider 网关 by moving cohesive KIE image and asset-transfer behavior out of `server/providerGateway.mjs`.
2. Migrate the remaining high-risk source-shape tests to behavior tests where behavior can be exercised directly.

This is local development work only. It does not deploy, change cloud data, or migrate the `app_states` storage model.

## Current Baseline

The current working tree already contains one verified Provider 网关 slice:

- `server/providerBodyRead.mjs` owns provider body reads, stream timeouts, and abort listener budget handling.
- `server/providerKieTask.mjs` owns KIE recordInfo polling, probing, task id attachment, and usage metadata extraction.
- `server/chatSessionRules.mjs` owns chat session visibility and reasoning default rules.
- Several source-shape tests were replaced with behavior tests around provider body reading, KIE task polling, internal API fallback, and chat session rules.

That slice is treated as the starting point for this design. It should be revalidated before new implementation begins.

## Architecture

### Provider 网关 Deepening

`server/providerGateway.mjs` should become a thinner dispatcher plus shared provider utilities. It should not keep accumulating provider-specific orchestration.

The next two deepened modules are:

- `server/providerKieImage.mjs`
  - Owns KIE image createTask request construction.
  - Owns input image URL resolution through an injected resolver.
  - Owns prompt augmentation inputs and model alias payload shape.
  - Calls `onProviderTaskId` immediately after createTask returns a task id.
  - Delegates polling to `pollKieTask`.
  - Preserves `providerTaskId`, `providerStage`, and `providerStatus` on success and failure.

- `server/providerAssetTransfer.mjs`
  - Owns managed asset download.
  - Owns remote provider media download with SSRF guard, timeout, and size limit.
  - Owns inline data URL upload to KIE.
  - Owns KIE upload fallback from stream upload to base64 upload.
  - Exposes small functions that can be tested without invoking full provider jobs.

The deletion test should hold for both modules: deleting either module should force its complexity back into multiple provider call sites, not merely remove a pass-through file.

### Source-Shape Test Migration

Source-shape tests are split into three categories:

- **Migrate now:** tests that assert runtime behavior but currently grep implementation details.
  - Provider timeout, task id, and upload/download behavior.
  - Internal API streaming, timeout, dedupe, and polling behavior.
  - Chat/session rules that can be imported as pure helpers.
  - MySQL/local JSON chat route behavior once a route harness exists.

- **Migrate after a seam exists:** `server/index.mjs` chat and agent route tests that currently grep both handlers.
  - These should move only after a route harness can drive MySQL and local JSON modes with fake request/response/store/pool adapters.
  - The harness must prove both modes, because `CLAUDE.md` records this as a real production recurrence source.

- **Keep as source scan for now:** tests whose purpose is coverage of source inventory or prompt/documentation anchors.
  - Log action label inventory.
  - Environment variable documentation coverage.
  - Prompt wording anchors where the contract is literal text, not executable behavior.

The target is not "zero `readFileSync` in tests". The target is that source-shape tests no longer block safe refactoring of modules that have clear behavior seams.

## Execution Strategy

### Phase 0: Baseline Verification

Before touching new code, re-run the focused tests and Hermes harness for the current working tree. If this fails, fix the current slice first instead of stacking a new refactor on top.

### Phase 1: KIE Image Module

Use TDD. First add behavior tests for `providerKieImage.mjs`, then move code from `runKieImageJob` behind a narrow interface.

Required behaviors:

- GPT image alias payloads preserve text-to-image and image-edit request shape.
- Input image URLs are resolved once per raw URL and limited by alias `maxInputImages`.
- Text media URLs embedded in the prompt are rewritten through the same resolver.
- `onProviderTaskId` fires immediately after createTask succeeds.
- Poll failure rethrows with the provider task id attached.

`server/providerGateway.mjs` should call the new module instead of owning this orchestration directly.

### Phase 2: Provider Asset Transfer Module

Use TDD. First add behavior tests for download/upload conversion, then move asset-transfer functions behind a narrow interface.

Required behaviors:

- Managed asset URLs prefer public reachable URLs unless forced to upload.
- Forced managed asset upload downloads with timeout and uploads through KIE.
- Remote media rejects localhost, private IPv4, local hostnames, and invalid protocols.
- Remote media enforces content-length and post-read byte limits.
- Inline data URLs upload with inferred filename extension.
- Stream upload falls back to base64 upload only for approved transient provider error codes.

`server/providerGateway.mjs` should import these functions and keep provider job orchestration readable.

### Phase 3: Route Harness for Chat Source-Shape Migration

Create a small server-side test harness instead of trying to unit test all of `server/index.mjs`.

Required harness capabilities:

- Drive the local JSON chat path with fake `req`, `res`, and store adapters.
- Drive the MySQL chat path with fake pool/query adapters.
- Assert duplicate `clientRequestId` behavior.
- Assert active pending run conflict behavior.
- Assert `image_task_submitted` and `image_result_ready` checkpoint behavior for both modes when the underlying helper is injected.

This phase should migrate only the high-risk `agentConversationReliability` source-shape assertions that correspond to executable chat behavior. Inventory and prompt scans stay out of scope.

## Error Handling

Provider errors must preserve the existing error taxonomy:

- Provider timeout remains `provider_timeout`.
- Bad remote asset input remains `provider_bad_request`.
- KIE task creation failure still flows through `normalizeKieTaskCreationError`.
- Polling failures after createTask must keep the provider task id attached for recovery.

No new broad catch-all wrappers should be added. Each module should keep the current stage labels, especially `asset_download`, `submitted`, and `completed`.

## Testing

Each phase has its own focused tests before broader regression:

- `server/providerKieImage.test.mjs`
- `server/providerAssetTransfer.test.mjs`
- `server/providerGateway.test.mjs`
- `server/providerBodyRead.test.mjs`
- `server/providerKieTask.test.mjs`
- `server/agentConversationReliability.test.mjs`
- `src/services/internalApi.test.mjs`

After a phase changes high-risk server files, run Hermes harness with the changed paths.

Before claiming the work complete, run:

```bash
node --test server/providerKieImage.test.mjs server/providerAssetTransfer.test.mjs server/providerKieTask.test.mjs server/providerBodyRead.test.mjs server/providerGateway.test.mjs server/agentConversationReliability.test.mjs server/agentToolConversation.test.mjs server/agentImagePlan.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs
node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/OneClick/oneClickGenerationRun.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/services/kieAiService.test.mjs
npm run lint
npm run build
git diff --check
```

## Non-Goals

- Do not migrate `app_states` storage in this work.
- Do not deploy to Tencent Cloud.
- Do not rewrite all of `server/index.mjs`.
- Do not mechanically delete every source-shape test.
- Do not change provider request schemas unless a failing behavior test proves the need.

## Success Criteria

- `providerGateway.mjs` loses the KIE image and asset-transfer implementation details while preserving its public `runProviderJob` behavior.
- New provider modules have behavior tests that would fail if task id checkpointing, polling, timeout, upload fallback, or SSRF guard behavior regresses.
- High-risk source-shape tests are either migrated to behavior tests or explicitly classified as intentionally retained scans.
- MySQL/local JSON chat behavior receives a route harness before more `server/index.mjs` source grep assertions are removed.
- Verification evidence is fresh and recorded before any completion claim.
