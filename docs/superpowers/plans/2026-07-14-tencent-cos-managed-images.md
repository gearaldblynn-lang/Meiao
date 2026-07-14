# Tencent COS Managed Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every newly uploaded user source/reference/chat image in a dedicated private Tencent COS bucket, serve fresh signed URLs to browsers and external models, and durably delete COS objects when their owning data is deleted, while preserving historical local images and existing generated-result storage.

**Architecture:** Keep `/api/assets/file/:assetId/:name` as the durable application URL and extend `stored_assets` with an explicit storage state. Route new image uploads through a provider-neutral asset store whose Tencent COS implementation owns object operations and signing. Route all logical deletes through a durable cleanup queue and idempotent worker so account, project/task, chat/session, explicit asset, and expiry deletion survive process restarts. Historical `internal` assets and generated outputs continue using local disk.

**Tech Stack:** Node.js ESM, MySQL/local registry adapters, `cos-nodejs-sdk-v5`, Node test runner, Express, Tencent COS private bucket, PM2, Hermes Harness.

## Global Constraints

- Scope is future user-uploaded source/reference/chat images only; historical images are not migrated and generated result images remain on the current local storage path.
- Production image upload mode is `cos` or `disabled`. COS upload failures retry the same deterministic object key and fail closed; they never fall back to local disk or KIE temporary storage.
- `stored_assets.public_url` remains the stable application URL. Signed COS URLs are generated at read/provider time and are never persisted or logged.
- Existing retention values remain unchanged, including permanent Agent Center/Agent Chat assets until their owner is deleted.
- All object deletion is exact-key, idempotent, durable, and reference-aware. User/account deletion must not delete the cleanup task before physical cleanup completes.
- The image bucket, credentials, environment variables, permissions, object prefix, and lifecycle rules are independent of the Gemini video COS integration.
- Capacity, retry, timeout, URL TTL, cleanup interval, batch size, and alert thresholds are environment-configurable with conservative defaults.
- Every changed runtime behavior is locked by a failing regression test before implementation. Do not claim completion without fresh local and cloud evidence.

---

### Task 1: Lock and implement the Tencent COS image object contract

**Files:**
- Create: `server/tencentCosImageStore.mjs`
- Create: `server/tencentCosImageStore.test.mjs`

**Interfaces:**

```js
buildCosImageObjectKey({ userId, assetType, assetId, fileName })
putTencentCosImage({ storageKey, fileBuffer, mimeType }, env, signal, options)
createTencentCosImageReadUrl(storageKey, purpose, env, options)
headTencentCosImage(storageKey, env, options)
deleteTencentCosImage(storageKey, env, options)
```

- [ ] Add failing tests proving object keys stay below `managed-images/users/`, contain opaque server IDs, sanitize user filenames, and cannot traverse paths.
- [ ] Add failing tests proving missing or cross-purpose image COS configuration returns a sanitized `provider_config_error` without exposing secrets.
- [ ] Add failing tests proving upload retries reuse exactly the same key, obey configured attempts/timeouts/backoff, and never invoke a local-storage fallback.
- [ ] Add failing tests proving browser/provider signing use separate TTLs and do not mutate stored metadata.
- [ ] Add failing tests proving delete success and COS object-not-found are both idempotent success, while transient failures remain retryable.
- [ ] Run `node --test server/tencentCosImageStore.test.mjs` and confirm RED because the module/behavior does not yet exist.
- [ ] Implement the smallest COS image object client, including an injectable fake client factory for tests and sanitized error normalization.
- [ ] Run `node --test server/tencentCosImageStore.test.mjs` and confirm GREEN.
- [ ] Commit this task as `feat: add Tencent COS managed image store`.

### Task 2: Add storage states and a durable cleanup queue

**Files:**
- Modify: `server/assetStore.mjs`
- Modify: `server/assetStore.test.mjs`
- Create: `server/assetLifecycleStore.mjs`
- Create: `server/assetLifecycleStore.test.mjs`
- Create: `server/assetCleanupWorker.mjs`
- Create: `server/assetCleanupWorker.test.mjs`

**Interfaces:**

```js
createUploadingAssetRecord(input)
markStoredAssetActive(assetId)
markStoredAssetUploadFailed(assetId, errorCode)
requestStoredAssetDeletion(asset, reason)
enqueueAssetCleanupTask(input)
claimDueAssetCleanupTasks(limit)
completeAssetCleanupTask(taskId)
retryAssetCleanupTask(taskId, error)
processAssetCleanupBatch(options)
reconcileManagedAssetStorage(options)
```

- [ ] Add failing schema/mapping tests for `storage_status = uploading|active|delete_pending|deleted|upload_failed`, with legacy rows defaulting to `active`.
- [ ] Add failing MySQL/local-adapter tests for `asset_cleanup_tasks`, including an exact provider/bucket/region/key snapshot, uniqueness by action+object, retry metadata, and no user foreign-key dependency.
- [ ] Add failing worker tests for successful delete, object-not-found completion, exponential retry after restart, `manual_review` escalation without dropping the record, and bounded batch processing.
- [ ] Add failing reconciliation tests for stale `uploading`, missing cleanup tasks for `delete_pending`, and completed physical deletes whose asset state is stale.
- [ ] Run `node --test server/assetStore.test.mjs server/assetLifecycleStore.test.mjs server/assetCleanupWorker.test.mjs` and confirm the new assertions fail.
- [ ] Extend `ensureAssetSchema` with idempotent, backwards-compatible DDL for the state column and cleanup table/indexes.
- [ ] Implement the DB and local-registry lifecycle adapters so development mode has the same durable semantics.
- [ ] Implement the provider-neutral cleanup worker; keep local-file deletion compatible and make COS delete idempotent.
- [ ] Run the focused tests and confirm GREEN.
- [ ] Commit this task as `feat: add durable managed asset lifecycle`.

### Task 3: Route only new uploaded images to COS and fail closed

**Files:**
- Modify: `server/assetStore.mjs`
- Modify: `server/assetStore.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/assetReferenceCleanup.test.mjs`
- Create: `server/managedImageUpload.test.mjs`

**Interfaces:**

```js
persistUploadedAssetBuffer({ userId, module, assetType, fileName, mimeType, fileBuffer, ... })
```

- [ ] Add failing tests proving source/reference/chat `image/*` creates `uploading`, uploads to COS, transitions to `active`, and returns the same stable `/api/assets/file/...` URL contract.
- [ ] Add failing tests proving COS upload failure transitions to `upload_failed`, enqueues exact-key cleanup, returns a retryable human-facing upload error, and performs zero local writes/KIE fallback calls.
- [ ] Add failing tests proving generated output persistence and non-image uploads retain existing behavior.
- [ ] Add failing tests proving the base64 and streamed upload endpoints share the same storage path in both MySQL and local development modes.
- [ ] Add failing tests proving only `active` COS assets and existing, active historical local assets are accepted as managed references.
- [ ] Run `node --test server/assetStore.test.mjs server/managedImageUpload.test.mjs server/assetReferenceCleanup.test.mjs` and confirm RED.
- [ ] Implement the new upload orchestration with one preallocated asset ID/object key and a `MEIAO_MANAGED_IMAGE_UPLOAD_MODE=cos|disabled` gate.
- [ ] Remove local/KIE fallback only from the managed image branch; preserve unrelated media routing.
- [ ] Run the focused tests and confirm GREEN.
- [ ] Commit this task as `feat: route managed image uploads to COS`.

### Task 4: Resolve COS images for browsers and external models

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/providerAssetTransfer.mjs`
- Modify: `server/providerAssetTransfer.test.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Create: `server/managedAssetReadResolver.test.mjs`

**Interfaces:**

```js
resolveManagedAssetReadUrl(value, { purpose, userId })
assetTransferDeps.resolveManagedAssetReadUrl(value, options)
```

- [ ] Add failing route tests proving historical `internal` assets keep the existing local/X-Accel response, while active `tencent_cos` assets receive a fresh browser-TTL 302 signed URL.
- [ ] Add failing authorization/state tests proving deleted, failed, pending-delete, missing, and cross-user assets cannot obtain a signed URL.
- [ ] Add failing provider tests proving managed COS image URLs resolve directly to a fresh provider-TTL signed COS URL before KIE/model submission and never go through KIE temporary file storage.
- [ ] Add failing tests proving provider options propagate `assetTransferDeps` through all image/message resolution call sites.
- [ ] Add a regression assertion that signed query strings are not persisted in jobs/app state and are redacted from application logs.
- [ ] Run `node --test server/managedAssetReadResolver.test.mjs server/providerAssetTransfer.test.mjs server/providerGateway.test.mjs` and confirm RED.
- [ ] Implement provider-aware read routing and the injected resolver, preserving legacy local behavior and public URL format.
- [ ] Run the focused tests and confirm GREEN.
- [ ] Commit this task as `feat: serve managed COS images with signed URLs`.

### Task 5: Centralize every deletion trigger and reconciliation path

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/assetStore.mjs`
- Modify: `server/accountDataRetention.test.mjs`
- Modify: `server/assetReferenceCleanup.test.mjs`
- Create: `server/managedAssetDeletion.test.mjs`

**Deletion matrix:**

| Trigger | Required behavior |
| --- | --- |
| Explicit asset delete | Mark `delete_pending`, enqueue exact object, reject new reads |
| Expiry cleanup | Recheck all live references before enqueue |
| Project/task/app-state removal | Compare committed references and enqueue only assets no longer referenced anywhere |
| Chat/session/history delete | Enqueue referenced permanent images before deleting rows |
| Account deletion | Persist cleanup tasks before deleting assets/user rows |
| Worker completion | Mark `deleted`; retain bounded audit metadata |

- [ ] Add failing tests for each deletion-matrix row in both MySQL transaction and local-development paths.
- [ ] Add failing race tests proving a still-referenced asset is protected and a newly re-referenced pending asset is not physically deleted.
- [ ] Add failing account deletion tests proving cleanup tasks survive user and `stored_assets` row deletion with bucket/region/key intact.
- [ ] Add failing worker/timer tests proving cleanup resumes after process restart and cleanup errors never make the user-facing delete transaction roll back after it is durably queued.
- [ ] Run `node --test server/accountDataRetention.test.mjs server/assetReferenceCleanup.test.mjs server/managedAssetDeletion.test.mjs server/assetCleanupWorker.test.mjs` and confirm RED.
- [ ] Replace direct file/object deletion call sites with the lifecycle service, preserving exact current retention and reference protection.
- [ ] Start the cleanup/reconciliation loop alongside existing asset cleanup with an overlap guard and configurable interval/batch/retry thresholds.
- [ ] Add structured counts for upload failure, cleanup backlog, oldest pending task, retries, manual review, and reconciliation repair; never log signed URLs or secrets.
- [ ] Run the focused tests and confirm GREEN.
- [ ] Commit this task as `fix: make managed image deletion durable`.

### Task 6: Add operational configuration, probe, documentation, and reusable diagnosis

**Files:**
- Create: `scripts/probe-managed-image-cos.mjs`
- Create: `scripts/probe-managed-image-cos.test.mjs`
- Modify: `package.json`
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/project-overview.md`
- Modify: `CLAUDE.md`
- Modify: `docs/agents/repeated-issues.md`

**Probe contract:**

```text
put -> head -> signed HTTPS GET -> byte equality -> delete -> head/not-found
```

- [ ] Add a failing probe test using an injected fake COS client and assert output never includes secrets or signed query parameters.
- [ ] Implement `npm run probe:managed-image-cos` with a random tiny image object under a dedicated probe prefix and guaranteed best-effort cleanup.
- [ ] Document every `MEIAO_IMAGE_COS_*`, upload-mode, retry/timeout, cleanup/reconciliation, batch, and alert variable with conservative defaults.
- [ ] Document the private bucket, versioning off, HTTPS-only, incomplete-multipart lifecycle, exact `managed-images/*` CAM permissions, credential rotation, budget alerts, and rollback to `disabled`.
- [ ] Record the root cause/fix/prevention rule in the project root-cause library: app-disk stable URLs are not a reliable external model asset origin; generated outputs and historical assets intentionally remain local.
- [ ] Run `node --test scripts/probe-managed-image-cos.test.mjs` and the focused documentation/config checks, then confirm GREEN.
- [ ] Commit this task as `docs: document managed image COS operations`.

### Task 7: Complete local verification and code review gate

**Files:**
- Review: every file changed by Tasks 1-6

- [ ] Run `git diff --check` and inspect the complete diff for scope creep, credential exposure, signed-URL leakage, authorization bypass, deletion races, and accidental migration of generated/historical images.
- [ ] Run the changed-file Hermes command required by the repository instructions and resolve every blocking finding.
- [ ] Run the focused test set from Tasks 1-6.
- [ ] Run `npm run test:server`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run `npm run doctor` and require `0 FAIL`.
- [ ] Run `npm run security:audit`; separately record non-blocking dependency advisories from release blockers.
- [ ] Run the applicable acceptance/smoke command and distinguish newly introduced failures from documented pre-existing static-contract failures.
- [ ] Perform the required high-risk code review; fix material findings and rerun affected gates.
- [ ] Commit any review corrections, verify the worktree is intentional, and push `feat/stability-phase2`.

### Task 8: Create cloud resources and deploy in safe stages

**Cloud resources:**

```text
Region: ap-guangzhou
Private bucket: meiao-managed-images-1406860462
Prefix: managed-images/*
Versioning: off
Lifecycle: abort incomplete multipart uploads after 1 day only
Credential: dedicated least-privilege CAM identity
```

- [ ] Confirm current cloud health, PM2 status, free disk/memory, deployment branch/commit, and absence of a conflicting live release.
- [ ] Create or verify the dedicated private image bucket, lifecycle, HTTPS/private ACL, CORS posture, budget alerts, and least-privilege CAM credential without displaying secrets.
- [ ] Add the new production environment variables to the preserved cloud `.env.server`; keep upload mode `disabled` for the compatibility deployment.
- [ ] Deploy the COS-aware compatibility baseline through `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` and verify `/api/health`, worker health, PM2 logs, build/resource hashes, and historical local asset reads.
- [ ] Run `npm run probe:managed-image-cos` on the server and prove put/head/signed-get/delete/head-not-found all pass with no residual probe object.
- [ ] Enable COS uploads for an internal canary account, restart through the documented service path, and verify one upload in each shared path: project/reference, Agent Chat, and Luo Ke buyer-show analysis.
- [ ] For the real model read, prove the object is in the image bucket, the provider received a fresh signed COS URL, KIE temporary image upload was not used, and the model returned a valid result; delete the canary assets and prove cleanup task completion/object absence.
- [ ] Expand to all future image uploads only after upload error rate, provider asset-fetch failures, cleanup backlog, oldest pending deletion, PM2 errors, and cost signals remain healthy.
- [ ] If any canary gate fails, set upload mode to `disabled`, keep the COS-aware build so existing COS objects remain readable/deletable, and record the failed stage before retrying.

### Task 9: Close release evidence and the diagnostic dashboard

**Files:**
- External record: `../云上日志诊断看板/data/*` through `npm run record-fix`

- [ ] Record one bug-fix entry with fingerprint `managed_image_storage:app_disk_model_fetch_failure:cos_source_storage`, including root cause, affected paths, tests, commit, cloud deployment evidence, rollback, and cleanup verification.
- [ ] Rebuild and smoke-test the diagnostic dashboard; require `doctor = 0 FAIL` and report any unrelated known static-property contract failures separately.
- [ ] Recheck cloud `/api/health`, PM2 restart count/log tail, production HEAD/runtime file hashes, and a fresh signed-read/delete cycle after the final restart.
- [ ] Provide the user a concise handoff covering what now uses COS, what deliberately remains local, what was deployed, the real canary result, deletion guarantees, remaining dependency advisories, and exact rollback control.

## Plan Self-Review Checklist

- [ ] Every behavior in the approved design maps to a task and verification step.
- [ ] The plan never persists or logs a signed URL and never exposes a secret to the browser.
- [ ] Upload failure has no local or KIE fallback.
- [ ] Account/project/task/chat/session/expiry deletion all converge on the same durable queue.
- [ ] Historical local reads and generated result storage remain compatible.
- [ ] All thresholds and TTLs are environment-configurable.
- [ ] Local verification, required code review, cloud canary, rollback, monitoring, and diagnostic closure are explicit.
