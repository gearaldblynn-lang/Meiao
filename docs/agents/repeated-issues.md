# Repeated Issues Log

Use this file to stop the same problems from being rediscovered and re-fixed in slightly different ways.

Before debugging a recurring issue, search this file, related tests, and recent handoff/release docs. After fixing a repeated issue, append a concise entry.

## Entry Format

```markdown
## YYYY-MM-DD - Short issue name

- Symptom:
- Environment: cloud production / local development / local backup / GitHub comparison
- Root cause:
- Fix:
- Regression check:
- Files/tests:
- Avoid next time:
```

## Standing Lessons

## 2026-05-21 - Shell duplicate submit before visible feedback

- Symptom: 用户点击底部提交后短时间没有明显反馈，连续点击会创建多个生成任务卡片；已在白底精修/产品精修入口复现，同类问题会影响所有未纳入提交锁的底部生成入口。
- Environment: local development / cloud production frontend shell
- Root cause: 新版底部提交锁只覆盖 `video:generation`，白底精修等生成入口在素材上传和 job 创建前没有同步 ref 锁；后端 job 去重只能复用已创建的 active job，挡不住前端先创建多个独立项目占位。
- Fix: `shouldGuardGenerationSubmit` 覆盖所有可运行底部生成模块：`one_click`、`translation`、`buyer_show`、`retouch`、`video`、`xhs_cover`；`handleGenerate` 使用同步 ref 短锁保护“点击到任务卡/后端 job 创建确认”这段临界区，收到 `onJobCreated` 或已创建可见任务后立即释放提交按钮，不能用活跃任务状态把整个生成周期串行锁死。
- Regression check: `node --test src/shell/components/destructiveActions.test.mjs src/components/uiArchitecture.test.mjs`
- Files/tests: `src/ShellMigratedApp.tsx`, `src/shell/components/destructiveActions.test.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 新增任务入口时先确认“点击到可见项目卡片出现前”的同步锁，不要只依赖 React 状态、按钮 disabled 或后端 job dedupe。

### Cloud, local, and GitHub are different sources of truth

- Symptom: A change appears fixed locally or exists on GitHub, but cloud behavior is unchanged.
- Root cause: GitHub is version storage, not the running application. Local dev is for verification, not proof of cloud deployment.
- Avoid next time: State the target environment at the start of the task. For production issues, check Tencent Cloud state and deployment docs before claiming completion.

### Prompt changes must preserve parsing anchors

- Symptom: A prompt improvement breaks downstream parsing, output fields, or historical constraints.
- Root cause: Prompt text changed without preserving RTCFE structure, required fields, or parser assumptions.
- Avoid next time: Read `docs/prompt-rtcfe-migration-map.md` before prompt edits. Preserve existing output fields and add regression tests around parsing-sensitive behavior.

### One-click modules are related but not interchangeable

- Symptom: Fixing first image behavior changes main image, detail page, or SKU behavior unexpectedly.
- Root cause: Shared utilities or prompts were edited without checking each workflow's separate constraints.
- Avoid next time: Name the target workflow explicitly. Run focused tests for the touched workflow and smoke tests for neighboring one-click workflows.

### Model-readable image URLs must stay plain public URLs

- Symptom: KIE image tasks fail with `File type not supported`, or generated tasks receive strings like `[https://...jpg](https://...jpg)` instead of plain URLs.
- Root cause: Public image URLs can pass through model text, Markdown rendering, history messages, and retry flows; checking only upload/display code misses these second-hop paths.
- Avoid next time: Before provider submission, always normalize media references back to plain model-readable URLs. Tests must cover historical attachments, model-produced `inputImageUrls`, and final `image_input`/`input_urls` payloads.

### Restarted cloud jobs are not final failures

- Symptom: Refresh/crash/restart leaves one-click cards marked failed or disappearing even though KIE may still be processing the provider task.
- Root cause: Cloud MySQL job reconciliation marked `running` jobs as `failed/service_restarted`, and the shell UI treated recoverable KIE timeout/restart responses as final failed history.
- Avoid next time: Reconcile restarted jobs back to `retry_waiting` when a provider task may still be recoverable. In the frontend, any KIE result with a recoverable task id should remain `generating`/pending sync until the backend explicitly returns a terminal failure.

### Long-running planning jobs must persist their project card immediately

- Symptom: A one-click planning task is visible as running in `internal_jobs`, but after browser crash/refresh the project card is gone.
- Root cause: The shell created the planning project only in React state and waited until planning success/failure to write `/api/state`; if Chrome crashed while `kie_chat` was running, the backend job survived but the project card had no stable shared-state record. Completed planning jobs are text-only, so they were also dropped by job hydration when no image URL existed.
- Avoid next time: Persist the planning project as soon as it is created, then persist again when the backend `jobId` is known. Running jobs can hydrate as fallback cards from `/api/jobs`; completed one-click `kie_chat` jobs may parse their text result back into selectable plans only when they match an existing persisted project placeholder. Never synthesize unpersisted completed planning jobs from `/api/jobs`, even if they are the newest one, or refresh will resurrect old策划 as ghost "处理中" cards. When a user deletes a job-backed card, persist the deleted backend `jobId` as a tombstone so `/api/jobs` history cannot rehydrate it on the next refresh.
- Every one-click planning `kie_chat` job must carry its shell project binding in the job payload (`shellPlanningPurpose`, `shellProjectId`, `subFeature`). This covers the crash window where the project placeholder has been saved but the later `backendJobId` write has not completed; hydration can reconnect by `shellProjectId` instead of creating an orphan job card.
- Terminal failed one-click jobs with no result URL must not be synthesized from `/api/jobs` unless they match an existing persisted project placeholder. Historical failed image jobs are logs, not project cards; otherwise refreshing can repopulate the workspace with old "图片结果待同步" failure cards.
- Refresh hydration should never open a project detail/plan modal by itself. Planning cards can show "打开确认生图", but `ProjectCard` must not auto-run `setDetailOpen(true)` just because restored data has `plans`; otherwise the latest recovered planning job becomes a random popup on page load.
- Deletion must be a real remote prune, not a draft-only write. `persistDeletionToSharedState` has to save the pruned state with replace semantics and keep `deletedProjectIds` / `deletedResultIds` / `deletedJobIds`; draft autosave must preserve those tombstones. Server-side state merge should apply tombstones before merging arrays, or old `shellProjects` / one-click branch projects will reappear after refresh.

### Shared state must not store recursive project history or inline images

- Symptom: `/api/state` grows into multi-MB or tens-of-MB payloads, making refresh slow and increasing Chrome out-of-memory risk.
- Root cause: One-click branch objects were copied into individual project records, nesting `projects` inside each project; translation history also stored `data:image/...base64` source previews.
- Avoid next time: Compact shared state before storage and client return. One-click saved projects must exclude branch-level `projects`, `activeProjectId`, and runtime flags; translation files must store remote URLs or lightweight metadata, not inline base64 previews.

### Browser-local recovery caches need size guards

- Symptom: A cloud account has a small `/api/state`, but Chrome can still show `Out Of Memory` while loading or running a long task.
- Root cause: The shell reads account-scoped `localStorage` runtime/draft snapshots synchronously before cloud hydration. If an older build left oversized or corrupted browser-local recovery data, the cloud database can look clean while the user's current browser still crashes.
- Avoid next time: Put byte limits in front of every browser-local recovery parse, discard oversized local snapshots, and log startup diagnostics with localStorage key sizes and JS heap figures so the next cloud investigation has evidence instead of guesses. Browser OOM cannot be logged at the exact crash moment; keep a local session heartbeat and report `frontend_previous_session_interrupted` on the next successful load when the previous session was not cleanly closed.

### Model submission must wait for uploaded material URLs

- Symptom: After uploading a material, generation immediately says the material has no model-readable public URL.
- Root cause: The shell optimistically adds a local `blob:` preview first and uploads the public URL in the background. Some generation paths submitted before the background upload had filled `remoteUrl`, or reused stored generation context that still contained only local draft material data.
- Avoid next time: Every generation entry point must run uploaded-material normalization immediately before provider submission. If a material only has `localAssetId`, load the draft blob from IndexedDB and upload it first; only pass remote/public URLs into `shellWorkflow` and model services.

### Cloud deployment requires code review every time

- Symptom: A fix reaches cloud without a fresh review of diff, data isolation, URL handling, logs/statistics, permissions, or task-chain impact.
- Root cause: Deployment was treated as a mechanical copy step instead of a guarded production release.
- Avoid next time: Do not deploy unless code review is complete. Use the deploy script only with `MEIAO_CODE_REVIEW_CONFIRMED=1`; the script intentionally blocks unconfirmed cloud releases.
