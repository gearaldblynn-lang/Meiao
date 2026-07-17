# 出海翻译完整模块集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 2026-07-17 出海翻译完整模块集成包按当前主线合同合入梅奥，覆盖翻译范围、配置快照、重试、区域修改、恢复、下载、真实任务与云上发布。

**Architecture:** 先迁入 Translation 命名空间的纯领域模块和行为测试，再逐层接入当前 Shell、适配/持久化、服务/provider。集成包只作为行为和测试来源；当前主线继续拥有账号隔离、任务状态、素材托管、provider 和部署合同的最终解释权。

**Tech Stack:** React 19、TypeScript、Vite、Node `.mjs` contract tests、Canvas/Blob、Sharp、internal jobs/Temporal、KIE 图片 provider、腾讯云 PM2/Nginx。

## Global Constraints

- Source package: `/Users/feiyanglin/Downloads/出海翻译-完整模块集成包-2026-07-17/source-files`.
- Approved spec: `docs/superpowers/specs/2026-07-17-translation-complete-module-integration-design.md`.
- Never replace current `src/ShellMigratedApp.tsx`, `server/index.mjs`, package files, TypeScript configs, or Vite config with package snapshots.
- All production edits use `apply_patch`; the source package remains read-only.
- Preserve current product-restoration repair, shell sync, account guards, managed-asset ownership, MaxForAI sizing, provider retry and deployment ownership behavior.
- No database migration and no secret/config changes.
- Prompts keep RTCFE sections and parser anchors.
- Every changed behavior follows RED → GREEN → REFACTOR.
- Existing `providerTaskId` means resume/query only; never create a second paid task.
- Never set `MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1`; wait for drain.
- Push/deploy `feat/stability-phase2`; do not update `main`.

## File Structure

New domain files:

- `src/modules/Translation/translationRetryUtils.mjs`: snapshot, scope, retry lineage, pipeline and download naming.
- `src/modules/Translation/translationRegionEditUtils.mjs`: geometry, versions, persistence transactions and recovery.
- `src/modules/Translation/translationRegionEditIntent.mjs`: erase/replacement intent classification.
- `src/modules/Translation/translationRegionEditPrompt.mjs`: RTCFE regional-edit prompt.
- `src/modules/Translation/translationRegionEditRequest.mjs`: provider image ordering.
- `src/modules/Translation/translationRegionEditSize.mjs`: immutable first canvas size.
- `src/modules/Translation/translationRegionEditImage.mjs`: guide and protected local composite.
- `src/modules/Translation/translationResultAsset.mjs`: exact Translation asset mirroring.
- `src/modules/Translation/TranslationRegionEditDialog.tsx`: 1-5 rectangle editor.
- `src/utils/browserImageLoader.mjs`: authenticated/proxied canvas image loading.

Current-host integration files:

- Types: `src/types.ts`, `src/shell/types.ts`.
- Input/workflow: `src/shell/components/layout/BottomInputBar.tsx`, `src/adapters/shellWorkflow.ts`, `src/services/arkService.ts`, `src/services/kieAiService.ts`.
- Host: `src/ShellMigratedApp.tsx`.
- State: `src/adapters/shellPersistence.ts`, `src/adapters/shellDataAdapter.ts`, `src/adapters/shellScopeFilters.ts`.
- UI: `src/shell/components/ProjectCard.tsx`, `src/shell/components/ProjectListView.tsx`, both Translation module components.
- Assets/logs: `src/services/internalApi.ts`, `src/services/loggingService.ts`, `src/services/persistedAssetClient.ts`, `src/utils/imageUtils.ts`.
- Server only when RED proves missing behavior: `server/imagePostProcess.mjs`, `server/providerKieTask.mjs`, `server/providerKieImage.mjs`, `server/providerGateway.mjs`, `server/jobManager.mjs`, `server/jobRuntime.mjs`, `server/index.mjs`.

---

### Task 1: Immutable snapshot, translation scope and retry domain

**Files:**
- Create: `src/modules/Translation/translationRetryUtils.test.mjs`
- Create: `src/modules/Translation/translationRetryUtils.mjs`
- Modify: `src/types.ts`
- Test: `src/modules/Translation/translationProcessingUtils.test.mjs`

**Interfaces:**
- Produces: `TranslationScope`, `TranslationConfigSnapshot`, `normalizeTranslationScope`, `createTranslationConfigSnapshot`, `resolveTranslationRetrySnapshot`, `buildTranslationGenerationPrompt`, `buildTranslationRetryDescriptor`, `executeTranslationRetryPipeline`.

- [ ] Add the verified package retry test first with `apply_patch`. It imports the public functions above and covers frozen input, legacy aliases, fail-closed explicit scope, retry lineage, credits and sequential execution.
- [ ] Run RED:

```bash
node --experimental-strip-types --test src/modules/Translation/translationRetryUtils.test.mjs
```

Expected: module-not-found for `translationRetryUtils.mjs`.

- [ ] Add the package implementation with this stable public contract:

```js
export const TRANSLATION_SCOPE_PRODUCT_ISOLATION = 'product_isolation';
export const TRANSLATION_SCOPE_GLOBAL_TRANSLATION = 'global_translation';

export const normalizeTranslationGenerationMode = (value) => {
  const normalized = String(value || '').trim();
  return ['AI优化', '策划分析'].includes(normalized) ? 'AI优化' : 'AI直出';
};
```

- [ ] Merge `TranslationScope`, `TranslationConfigSnapshot` and retry fields into current `src/types.ts`; do not replace unrelated type blocks.
- [ ] Run GREEN plus current MaxForAI sizing regression:

```bash
node --experimental-strip-types --test \
  src/modules/Translation/translationRetryUtils.test.mjs \
  src/modules/Translation/translationProcessingUtils.test.mjs
```

- [ ] Commit:

```bash
git add src/types.ts src/modules/Translation/translationRetryUtils.*
git commit -m "feat(translation): add immutable retry and scope contract"
```

### Task 2: Input selector, RTCFE prompts and first-generation metadata

**Files:**
- Modify/Test: `src/shell/components/layout/BottomInputBar.tsx`, `src/shell/components/layout/BottomInputBar.test.mjs`
- Modify/Test: `src/services/arkService.ts`, `src/services/arkService.test.mjs`
- Modify/Test: `src/services/kieAiService.ts`, `src/services/kieAiService.test.mjs`
- Modify: `src/adapters/shellWorkflow.ts`, `src/ShellMigratedApp.tsx`
- Modify/Test: `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`

**Interfaces:**
- Consumes: Task 1 snapshot/scope helpers.
- Produces: visible `translationScope`, scope-aware prompts, frozen job metadata and hydrated snapshots.

- [ ] Add RED tests requiring `翻译范围` with `产品隔离/全局翻译`, default `产品隔离`, Ark/KIE scope prompt branches, scope in task/log metadata, and snapshot round-trip.
- [ ] Run RED:

```bash
node --experimental-strip-types --test \
  src/shell/components/layout/BottomInputBar.test.mjs \
  src/services/arkService.test.mjs \
  src/services/kieAiService.test.mjs \
  src/adapters/shellDataAdapter.test.mjs
```

- [ ] Add the selector without changing remove-text language hiding or current model/ratio controls.
- [ ] Branch RTCFE rules: product isolation translates product/packaging copy; global translation covers all readable copy while preserving explicit brand exceptions.
- [ ] In current Translation submit flow, freeze `createTranslationConfigSnapshot(generationParams)` before planning/provider submission and save it to project, result, file and internal-job metadata.
- [ ] Run GREEN plus `src/components/uiArchitecture.test.mjs`.
- [ ] Commit `feat(translation): add translation scope to generation`.

### Task 3: Retry persistence, hydration, UI and paid pipeline

**Files:**
- Modify/Test: `src/modules/Translation/translationRetryUtils.mjs`, `.test.mjs`
- Modify/Test: `src/adapters/shellPersistence.ts`, `.test.mjs`
- Modify/Test: `src/adapters/shellDataAdapter.ts`, `.test.mjs`
- Modify: `src/shell/components/ProjectCard.tsx`, `src/ShellMigratedApp.tsx`
- Modify/Test: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Produces retry results with `retryOfResultId`, `retryRootResultId`, `retryAttempt`, `sourceOrder`, immutable snapshot, provider identity and actual credits.

- [ ] Add RED tests: multiple retries stay in one project; root/direct lineage survives refresh; sparse hydration preserves rich fields; terminal states beat stale generating; stable ordering/download names.
- [ ] Run RED for retry utils, persistence, adapter and UI architecture.
- [ ] Merge results by stable result id, never array index. Preserve tombstones and current shell scope rules.
- [ ] Add retry action only for eligible Translation `main/detail`; keep original and prior attempts visible.
- [ ] Implement host transaction: acquire subfeature lock → append/persist generating retry → execute pipeline → write provider id/credits/terminal state into same result → release exact owner.
- [ ] Run GREEN and commit `feat(translation): preserve retry history and lineage`.

### Task 4: Regional-edit validation, intent, prompt, request and size

**Files:**
- Create/Test: `translationRegionEditUtils.mjs`, `translationRegionEditUtils.test.mjs`
- Create/Test: `translationRegionEditIntent.mjs`, `translationRegionEditIntent.test.mjs`
- Create/Test: `translationRegionEditPrompt.mjs`, `translationRegionEditPrompt.test.mjs`
- Create/Test: `translationRegionEditRequest.mjs`, `translationRegionEditRequest.test.mjs`
- Create/Test: `translationRegionEditSize.mjs`, `translationRegionEditSize.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces geometry, `TranslationEditRegion`, `TranslationEditVersion`, `validateTranslationEditRegions`, intent classification, RTCFE prompt, request ordering and immutable canvas size.

- [ ] Add the five verified package test files first. Contract constants are 5 regions, 0.02 minimum ratio, 1000 characters per instruction and 4000 total.
- [ ] Run RED; expected missing modules.
- [ ] Add geometry/version helpers without React/global-state dependencies. Preserve free overflow while drawing; clip only at submission. Reject non-number/NaN, overlap, blank instruction and sixth region.
- [ ] Add affirmative-only pure erase. Negated erase and “删除并替换” use non-destructive/mixed path. Serialize instructions as inert JSON in RTCFE.
- [ ] Pure erase request sends one guide; replacement/mixed sends current source first, guide second.
- [ ] Resolve positive finite initial canvas from persisted metadata, then immutable first snapshot.
- [ ] Run GREEN and commit `feat(translation): add regional edit domain contract`.

### Task 5: Authenticated loading, region guide and protected composite

**Files:**
- Create: `src/utils/browserImageLoader.mjs`
- Create/Test: `src/modules/Translation/translationRegionEditImage.mjs`, `.test.mjs`
- Modify/Test: `src/utils/imageUtils.ts`, `src/utils/imageUtils.test.mjs`

**Interfaces:**
- Produces `createTranslationRegionGuide` and `compositeTranslationRegionEdit` with exact outside-region protection.

- [ ] Add RED tests for edge boxes, erase masking, source/generated composite, exact outside pixels, tiny valid changes, union masks, cancellation, image-load fallback and fixed canvas.
- [ ] Run RED for regional image and image utils.
- [ ] Add authenticated same-origin fetch, asset-proxy fallback, createImageBitmap/image fallback and guaranteed object-URL revocation.
- [ ] Add guide/composite implementation; every load/context/export error rejects explicitly and every async stage observes `signal`.
- [ ] Merge only missing download behavior into current `imageUtils.ts`; preserve current callers and frontend-resource error rules.
- [ ] Run GREEN plus `frontendResourceError.test.mjs`; commit `feat(translation): protect regional image edits`.

### Task 6: Version persistence, hydration and recovery classification

**Files:**
- Modify/Test: `translationRegionEditUtils.mjs`, `.test.mjs`
- Modify/Test: `src/adapters/shellPersistence.ts`, `.test.mjs`
- Modify/Test: `src/adapters/shellDataAdapter.ts`, `.test.mjs`
- Modify: `src/shell/types.ts`

**Interfaces:**
- Produces deep-cloned edit-version round-trip, terminal precedence, recoverable raw-output candidates and account-scoped persistence transactions.

- [ ] Add RED tests for deep clone, sparse merge, canvas retention, protected URL precedence, error vs stale generating, file/result round-trip, missing source identity, account switch, cancellation and one-at-a-time queue.
- [ ] Run RED.
- [ ] Merge edit versions by version id. Sparse jobs may fill identities but never clear source, regions, URLs, canvas, errors or credits.
- [ ] Hydrate edit metadata only with structurally valid module/subfeature/project/result/version identity. Missing source identity becomes explicit version error.
- [ ] Run GREEN and commit `feat(translation): persist regional edit versions`.

### Task 7: Regional editor and Translation-only UI wiring

**Files:**
- Create/Test: `src/modules/Translation/TranslationRegionEditDialog.tsx`, `translationRegionEditUi.test.mjs`
- Modify: `src/shell/components/ProjectCard.tsx`, `ProjectListView.tsx`
- Modify: both Translation module components
- Modify/Test: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Produces `onTranslationRegionEdit`, `onCancelTranslationRegionEdit`, visible version selection and completed-only download behavior.

- [ ] Add UI RED tests for draw/move/resize, pointer cancel, keyboard, image-ready guard, submit lock, short screens, portal layering, pending/error versions and Translation-only prop wiring.
- [ ] Run RED.
- [ ] Add the package dialog through `apply_patch` and adapt current UI imports. Do not add upload/first-generation controls.
- [ ] Expose edit only for completed Translation `main/detail`. Generating/error attempts remain visible; downloads use completed versions only. Other module actions do not change.
- [ ] Run GREEN and `npm run build`; commit `feat(translation): add regional edit interface`.

### Task 8: Live edit transaction, cancellation and refresh recovery

**Files:**
- Modify: `src/ShellMigratedApp.tsx`, `src/services/internalApi.ts`
- Modify/Test: `src/services/loggingService.ts`, `.test.mjs`
- Modify/Test: `src/components/uiArchitecture.test.mjs`, `src/adapters/shellDataAdapter.test.mjs`

**Interfaces:**
- Produces paid edit submission, provider checkpoint, raw-output checkpoint, protected completion, exact-owner cancellation and refresh recovery.

- [ ] Add RED assertions: generating placeholder precedes provider; task id persists immediately; raw output persists before protection; project+file writes precede completed; actual credits; failure keeps prior image; late task id obeys cancellation.
- [ ] Run RED.
- [ ] Implement submit transaction: validate source/regions → fixed canvas → guide/request/prompt → generating version/persist → one provider job → task-id checkpoint → raw-output checkpoint → composite → managed upload → two persistence writes → completed.
- [ ] Use owner key `translation-region-edit:<projectId>:<resultId>` plus version owner. Stale finally cannot release a newer lock.
- [ ] Queue refresh recovery one at a time; re-check account/project/result/version/regions/source/job/lifecycle before every side effect.
- [ ] Run GREEN and build; commit `feat(translation): orchestrate and recover regional edits`.

### Task 9: Managed downloads and required provider/server contracts

**Files:**
- Create/Test: `src/modules/Translation/translationResultAsset.mjs`, `.test.mjs`
- Modify: `src/services/persistedAssetClient.ts`, ProjectCard, ProjectListView, Shell Translation module, `src/ShellMigratedApp.tsx`
- Modify only for observed RED: server provider/job/postprocess files and tests listed in File Structure.

**Interfaces:**
- Produces exact Translation URL replacement, lazy/immediate mirror, authenticated download and one-shot recovery probe.

- [ ] Add RED tests for exact project/result/version URL replacement, `main/detail` scope, account/lifecycle rejection and unrelated module no-op.
- [ ] Run RED for result asset and image utils.
- [ ] Mirror new success immediately; mirror legacy external URLs lazily before download and persist only under current account scope.
- [ ] Run current server tests, then add only package assertions expressing missing Translation behavior:

```bash
node --test \
  server/imagePostProcess.test.mjs server/providerKieTask.test.mjs \
  server/providerKieImage.test.mjs server/providerGateway.test.mjs \
  server/jobManager.test.mjs server/jobRuntime.test.mjs
```

- [ ] Patch server only for genuine RED. Preserve current success aliases, owner-aware scrub, Temporal recovery and paid-task idempotency.
- [ ] Run GREEN and commit `feat(translation): mirror results and harden recovery`.

### Task 10: Local gates, independent review, browser and real tasks

**Files:**
- Modify only for verified failures: Tasks 1-9 files
- Update after evidence: `docs/release-and-handoff.md`

- [ ] Run Hermes changed-file gate for Shell, adapters and `server/index.mjs`.
- [ ] Run all Translation contracts and package server contracts:

```bash
node --experimental-strip-types --test src/modules/Translation/*.test.mjs
node --test server/imagePostProcess.test.mjs server/providerKieTask.test.mjs
```

Expected: at least the package-declared 261 cases pass; current additions may increase count.

- [ ] Run targeted host tests: BottomInputBar, adapters, UI architecture, Ark, KIE, logging, provider gateway, job manager/runtime.
- [ ] Run full gates:

```bash
npm run verify
npm run lint
npm run build
npm run doctor
git diff --check
```

- [ ] Request independent code review from pre-implementation base to HEAD. Fix every Critical/Important finding and rerun affected/full gates.
- [ ] Use the in-app browser at `http://localhost:3000`, wide and 820px. Verify subfeatures, modes/scopes, edge/five-region editing, versions/errors, refresh, downloads, console and other-module isolation.
- [ ] With an internal test account and non-merchant assets, record `user.id`, balance, asset ids and time; run main AI直出/product isolation, detail AI优化/global, one retry, one pure erase and one replacement. Verify internal/provider ids, credits, dimensions, managed URL, refresh and downloads.
- [ ] Update release evidence and commit `docs: record translation integration acceptance` when the document changed.

### Task 11: Push, deploy and production verification

**Files:**
- No implementation changes unless a verified defect is found.

- [ ] Re-run `git status`, diff check, `npm run verify`, build and doctor.
- [ ] Push `feat/stability-phase2`; verify local HEAD equals `git ls-remote origin refs/heads/feat/stability-phase2`.
- [ ] Confirm zero active paid jobs/streams and absent deploy marker/mutex. Wait for natural drain.
- [ ] Deploy:

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

- [ ] Verify server-local and both public `/api/health`, Temporal pollers, PM2 online/restart count, marker/mutex absence, local/cloud hashes for every changed source, and `index.html → index chunk → ShellMigratedApp chunk → Translation chunk`.
- [ ] Run or reuse one production test-account canary, then verify refresh and download without creating a duplicate paid task.
- [ ] If a real bug was fixed, record it in the diagnostics dashboard and verify the fingerprint. Do not record feature-only work.
- [ ] Final report: commits, pushed ref, test counts, screenshots, real task/internal/provider ids, credits, deployment, health/worker/PM2, hashes/chunks, fingerprint when applicable and residual observation items.
