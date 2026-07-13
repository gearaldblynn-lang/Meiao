# MaxForAI Image-2 Relay Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unusable three-tier MaxForAI Image-2 channel and replace it everywhere with one selectable model named exactly `image-2中转`, backed by upstream `gpt-image-2` and the replacement server-side credential.

**Architecture:** Keep the existing shared MaxForAI contract, provider adapter, zero-credit behavior, asset preparation, ambiguous-submission guard, and Temporal single-attempt protection. Collapse the public model catalog from three site IDs to one site ID, `maxforai-image-2-relay`, so every existing selector automatically receives the replacement without parallel copies. Replace only the ignored local and preserved cloud secret; never track or print it.

**Tech Stack:** Node.js ESM, TypeScript/React, Node test runner, Temporal, standard Images API, existing Tencent guarded deployment script.

## Global Constraints

- Public display label is exactly `image-2中转`; do not retain `Image-2标准`, `Image-2高`, or `Image-2超高` in any live selector or public model catalog.
- Site model ID is `maxforai-image-2-relay`; upstream model is exactly `gpt-image-2`.
- Existing non-MaxForAI image models remain unchanged.
- Existing size table, text generation, image edit, multi-image input, maximum 16 references, and result parsing remain unchanged.
- The replacement model remains outside the legacy credit system for now.
- Paid generation POST has zero retries in HTTP, job, Agent, and Temporal activity layers; ambiguous disconnect remains `provider_submission_unknown`.
- Do not implement price or point conversion in this replacement. The supplied channel text contains both `$0.1` and `$0.07`; neither value is persisted because billing remains disabled.
- The real credential exists only in ignored local `.env.server` and preserved cloud `.env.server`; no source, diff, build asset, or log may contain it.
- Perform exactly one paid local smoke after all automated checks. Do not submit another request if it fails or becomes ambiguous.
- Push and deploy only after the single paid smoke succeeds and the returned file passes HTTP, MIME, byte-count, and dimension checks.

---

### Task 1: Collapse the shared model contract to `image-2中转`

**Files:**
- Modify: `src/utils/maxforaiImageModels.test.mjs`
- Modify: `src/utils/imageModelAvailability.test.mjs`
- Modify: `src/utils/imageBilling.test.mjs`
- Modify: `src/utils/maxforaiImageModels.mjs`
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Verify: selectors consuming `MAXFORAI_IMAGE_MODELS` in Settings, OneClick, Retouch, BuyerShow, BottomInputBar, and Agent Center.

**Interfaces:**
- Consumes: existing `MAXFORAI_IMAGE_MODELS`, `MAXFORAI_IMAGE_MODEL_IDS`, `isMaxForAiImageModel`, and `resolveMaxForAiImageModelId` APIs.
- Produces: one contract entry `{ id: 'maxforai-image-2-relay', label: 'image-2中转', upstreamModel: 'gpt-image-2' }` without changing consumer signatures.

- [ ] **Step 1: Write failing contract and availability tests**

Update expectations to require the one new ID/label, assert the three retired IDs and labels are absent, and assert legacy non-MaxForAI options remain present.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test \
  src/utils/maxforaiImageModels.test.mjs \
  src/utils/imageModelAvailability.test.mjs \
  src/utils/imageBilling.test.mjs
```

Expected: FAIL because the current contract still exposes three tier IDs and labels.

- [ ] **Step 3: Implement the one-model contract and type unions**

Replace the three contract records and three TypeScript union members with `maxforai-image-2-relay`. Keep the size table and all exported helper names unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/maxforaiImageModels.mjs src/utils/maxforaiImageModels.test.mjs src/utils/imageModelAvailability.test.mjs src/utils/imageBilling.test.mjs src/types.ts src/shell/types.ts
git commit -m "feat: replace Image-2 tiers with relay model"
```

### Task 2: Update runtime, retry, provider, and documentation contracts

**Files:**
- Modify: `server/providerMaxForAiImage.test.mjs`
- Modify: `server/maxforaiIntegration.test.mjs`
- Modify: `server/agentMaxForAiRetry.test.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `src/modules/Translation/translationProcessingUtils.test.mjs`
- Modify: `src/modules/Retouch/retouchSizingUtils.test.mjs`
- Modify: `server/maxforaiEnvDocs.test.mjs`
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Local ignored config only: `.env.server`

**Interfaces:**
- Consumes: the one-model shared contract from Task 1.
- Produces: runtime routing, public catalog, zero-credit reservation, Agent retry budget, provider request construction, and docs that all refer only to `image-2中转` / `maxforai-image-2-relay` / `gpt-image-2`.

- [ ] **Step 1: Write failing runtime and documentation tests**

Replace three-tier fixtures with the relay ID and add negative assertions for retired labels/IDs in public catalogs and docs.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test \
  server/providerMaxForAiImage.test.mjs \
  server/maxforaiIntegration.test.mjs \
  server/agentMaxForAiRetry.test.mjs \
  server/jobRuntime.test.mjs \
  server/maxforaiEnvDocs.test.mjs \
  src/modules/Translation/translationProcessingUtils.test.mjs \
  src/modules/Retouch/retouchSizingUtils.test.mjs
```

Expected: FAIL while fixtures/docs still name the retired three tiers.

- [ ] **Step 3: Update fixtures and public documentation**

Keep provider code generic through the shared contract. Rewrite public text from three tiers to the one relay model, retain all server-only/no-retry/zero-credit warnings, and do not add price arithmetic.

- [ ] **Step 4: Replace the ignored local credential without printing it**

Atomically replace only `MAXFORAI_API_KEY` in `.env.server`; keep base URL and runtime limits. Validate only `configured=true`, key names, ignore status, and secret-like tracked-line counts.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md server src/modules/Translation/translationProcessingUtils.test.mjs src/modules/Retouch/retouchSizingUtils.test.mjs
git commit -m "chore: configure Image-2 relay channel"
```

### Task 3: Verify one real image, then push and deploy

**Files:**
- Verify only: all files changed since `4402129`.
- Remote preserved config: `/www/wwwroot/meiao-internal/.env.server`.

**Interfaces:**
- Consumes: complete relay implementation and the replacement ignored credential.
- Produces: one verified real image, clean reviewed commits, pushed branch, deployed cloud runtime, active asset evidence, and updated diagnostics deployment status.

- [ ] **Step 1: Run focused contract tests and full verification**

Run the Task 1 and Task 2 focused commands, then `npm run verify`. Expected: zero failures and production build success.

- [ ] **Step 2: Run the changed-file, secret, and diff review gates**

Run Hermes changed-file review, `git diff --check`, tracked/build secret-like scans, selector/label searches, and complete diff review. Expected: no retired live labels/IDs, no added secret-like lines, and no unrelated working-tree changes.

- [ ] **Step 3: Restart local services and verify runtime identity**

Restart `com.meiao.current.server` and `com.meiao.current.vite`, then run `npm run doctor`. Expected: ports 3000/3100 use this repository and worker health is true.

- [ ] **Step 4: Verify the replacement key and model catalog without paid generation**

Call `GET /v1/models` with the ignored key, printing only matching non-sensitive model metadata. Expected: `gpt-image-2` supports image generation and image edit.

- [ ] **Step 5: Submit exactly one paid relay smoke through `/api/jobs`**

Use `provider=maxforai`, `model=maxforai-image-2-relay`, `1:1`, `1K`, `n=1` through the existing job contract. Snapshot account credits before/after, poll only that job, and inspect Temporal history. Expected: `succeeded`, `attempt=1`, `retryCount=0`, unchanged credits, one persisted `imageUrl`, HTTP 200 image MIME, nonzero bytes, and valid dimensions.

- [ ] **Step 6: Stop release if the smoke fails**

If the single request fails or becomes ambiguous, do not retry, push, update cloud secrets, or deploy. Report the job ID, sanitized error, attempt count, and unchanged credit evidence.

- [ ] **Step 7: Push only after successful smoke**

```bash
git status --short
git push origin feat/stability-phase2
```

- [ ] **Step 8: Back up and atomically replace cloud MaxForAI environment values**

Pipe only local `MAXFORAI_*` assignments over SSH, back up remote `.env.server`, replace keys with mode 600, and print only `MAXFORAI configured=true`.

- [ ] **Step 9: Run guarded cloud deployment**

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

Expected: readiness and drain gates pass, build succeeds, PM2 restarts, and worker health is true.

- [ ] **Step 10: Verify cloud health and active frontend assets**

Verify `http://meiaoyuntai.com/api/health`, PM2, log tail, active `index.html -> assets/index-*.js -> ShellMigratedApp-*.js` chain, presence of `image-2中转`, absence of retired labels and secrets, and unchanged legacy health signals.

- [ ] **Step 11: Update the existing Temporal retry diagnostic record after deployment**

Update fingerprint `maxforai-temporal-activity-hidden-retry` to the deployed commit/status, regenerate the external dashboard, run its tests and doctor, and report the dashboard entry.
