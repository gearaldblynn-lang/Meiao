# 梅奥生产稳定性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不自动重试未知 KIE 提交的前提下，对齐云上稳定代码、补齐管理员人工处置入口，并用类型和活跃链路测试防止项目身份与付费任务保护回退。

**Architecture:** 先串行合并 `fix/video-storyboard-stability`，保留双分支行为；第一波并行完成 `JobContext` 契约和 OneClick/Provider 特征测试，第二波在稳定共享类型上完成任务平台处置。所有生产行为通过现有 `jobManager`、`jobSubmissionPolicy`、任务平台 API 和新壳活跃工作流扩展，不新增第二套任务状态机。

**Tech Stack:** Node.js 20、TypeScript、React、Node test runner、Vite、MySQL/Temporal、PM2、Hermes Harness。

## Global Constraints

- 不自动重试 `provider_submission_unknown`。
- 未核对 KIE Logs 时，不对真实任务 `32b3f0fe6f867a4cee5dddc7` 执行 `bind`、`release` 或重试。
- 不整文件覆盖分支冲突；逐个保留双边行为和测试。
- 不进行 `providerGateway.mjs` 大规模拆分，只补付费任务安全契约测试。
- 云上发布前必须完成最终代码审查并使用 `MEIAO_CODE_REVIEW_CONFIRMED=1`。
- 每个实际 bug fix 必须写入外部云上日志诊断看板。

---

## Execution Graph

```text
Task 1 baseline merge
        |
        +--> Task 3 JobContext --------+
        |                               |
        +--> Task 4 active-path tests --+--> Task 2 admin resolution --> Task 5 release
```

Task 3 and Task 4 may run in parallel because their file sets do not overlap. Task 2 starts only after Task 3 is integrated because both touch `src/types.ts` and `src/services/internalApi.ts`.

---

### Task 1: 合并云上稳定基线

**Files:**
- Merge source: `fix/video-storyboard-stability`
- Resolve: `CLAUDE.md`
- Resolve: `docs/project-overview.md`
- Resolve: `src/ShellMigratedApp.tsx`
- Resolve: `src/adapters/shellDataAdapter.test.mjs`
- Resolve: `src/adapters/shellDataAdapter.ts`
- Resolve: `src/adapters/shellWorkflow.ts`
- Resolve: `src/services/videoStoryboardService.ts`
- Resolve: `src/shell/components/destructiveActions.test.mjs`
- Resolve: `src/utils/persistedDeletion.test.mjs`
- Modify: `docs/CURRENT.md`

**Interfaces:**
- Consumes: 云上源码等价提交 `fix/video-storyboard-stability@0794826`。
- Produces: 同时包含云上稳定线和当前 `feat/stability-phase2` 后续提交的单一可测试基线。

- [ ] **Step 1: 保存合并前证据**

Run:

```bash
git status --short --branch
git rev-list --left-right --count HEAD...fix/video-storyboard-stability
git merge-base HEAD fix/video-storyboard-stability
git diff --name-only HEAD...fix/video-storyboard-stability
```

Expected: 工作树干净；分支双向分叉；merge base 为 `a1be5e8`。

- [ ] **Step 2: 执行非快进合并并列出冲突**

Run:

```bash
git merge --no-ff fix/video-storyboard-stability
git diff --name-only --diff-filter=U
```

Expected: 仅出现设计规格列出的九个冲突文件；Git 进入 merge 状态。

- [ ] **Step 3: 逐文件解决冲突**

Resolution rules:

```text
ShellMigratedApp/shellWorkflow/shellDataAdapter:
  preserve current active shell wiring AND cloud project-card/job identity fixes
videoStoryboardService:
  preserve cloud submission-unknown and storyboard recovery behavior
destructiveActions/persistedDeletion tests:
  preserve all deletion aggregation and tombstone cases from both branches
CLAUDE/project-overview:
  combine non-duplicated root-cause and API documentation entries chronologically
```

Run:

```bash
rg -n '^(<<<<<<<|=======|>>>>>>>)' CLAUDE.md docs/project-overview.md src
git diff --check
```

Expected: 没有冲突标记，没有空白错误。

- [ ] **Step 4: 验证合并保护**

Run:

```bash
node --test server/jobSubmissionPolicy.test.mjs server/jobManager.test.mjs server/jobRuntime.test.mjs server/providerGateway.test.mjs
node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs src/shell/components/destructiveActions.test.mjs src/utils/persistedDeletion.test.mjs
```

Expected: 全部通过；未知提交、项目卡恢复、删除墓碑均无回退。

- [ ] **Step 5: 更新当前事实并提交 merge**

Run:

```bash
npm run status:write
git add CLAUDE.md docs/CURRENT.md docs/project-overview.md src server
git commit
```

Expected: 生成一个 merge commit；`docs/CURRENT.md` 对应新基线。

---

### Task 2: 管理员未知提交处置与 API 验形

**Files:**
- Modify: `server/taskPlatform.mjs`
- Test: `server/taskPlatform.test.mjs`
- Modify: `src/types.ts`
- Modify: `src/services/internalApi.ts`
- Test: `src/services/internalApi.test.mjs`
- Modify: `src/shell/modules/Account/AccountManagement.tsx`
- Test: `src/shell/modules/Account/accountManagementBehavior.test.mjs`

**Interfaces:**
- Consumes: `POST /api/admin/task-platform/jobs/:id/submission-resolution` and `canRecoverProviderTaskById` from merged cloud baseline.
- Produces: `TaskPlatformJob.submissionResolution`, `resolveTaskPlatformSubmission(jobId, input)`, validated task list/timeline responses, and an admin-only confirmation UI.

- [ ] **Step 1: Write server capability tests**

Add cases proving the mapper returns:

```js
submissionResolution: { allowed: true, canBind: false }
```

for failed `kie_chat/provider_submission_unknown`, and `{ allowed: false, canBind: false }` for ordinary failures. Add a recoverable task type case with `canBind: true`.

Run:

```bash
node --test server/taskPlatform.test.mjs
```

Expected: FAIL because `submissionResolution` is absent.

- [ ] **Step 2: Expose server-declared capabilities**

Import `canRecoverProviderTaskById` in `server/taskPlatform.mjs` and map:

```js
const submissionResolutionAllowed = row.status === 'failed'
  && row.error_code === 'provider_submission_unknown';

submissionResolution: {
  allowed: submissionResolutionAllowed,
  canBind: submissionResolutionAllowed && canRecoverProviderTaskById({
    taskType: row.task_type,
    providerTaskId: 'verified-provider-task',
  }),
},
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write API validation and action tests**

In `src/services/internalApi.test.mjs`, mock valid and malformed responses for list and timeline, and assert malformed successful responses throw:

```js
error instanceof api.ApiError
  && error.code === 'invalid_response'
  && error.status === 502
```

Also assert `resolveTaskPlatformSubmission('job-1', { action: 'release' })` sends:

```json
{"action":"release"}
```

to `/api/admin/task-platform/jobs/job-1/submission-resolution` with `POST` and `dedupe: false`.

Run:

```bash
node --experimental-strip-types --test src/services/internalApi.test.mjs
```

Expected: FAIL because validators and action function do not exist.

- [ ] **Step 4: Implement narrow runtime validators and action client**

Add `TaskPlatformJob.submissionResolution` to `src/types.ts`:

```ts
submissionResolution: {
  allowed: boolean;
  canBind: boolean;
};
```

In `internalApi.ts`, request `unknown`, validate object/array/number/string fields required by the task UI, and return the typed value. Add:

```ts
export const resolveTaskPlatformSubmission = async (
  jobId: string,
  input: { action: 'bind' | 'release'; providerTaskId?: string },
) => request<{ action: 'bind' | 'release'; job: InternalJob }>(
  `/api/admin/task-platform/jobs/${encodeURIComponent(jobId)}/submission-resolution`,
  { method: 'POST', body: JSON.stringify(input), dedupe: false },
);
```

Run API tests. Expected: PASS.

- [ ] **Step 5: Write admin UI behavior tests**

Assert the active account component:

```js
assert.match(source, /provider_submission_unknown/);
assert.match(source, /submissionResolution\.canBind/);
assert.match(source, /已确认 KIE 无任务且未扣费/);
assert.match(source, /resolveTaskPlatformSubmission/);
assert.doesNotMatch(source, /provider_submission_unknown[\s\S]{0,500}retryInternalJob/);
```

Run:

```bash
node --test src/shell/modules/Account/accountManagementBehavior.test.mjs
```

Expected: FAIL before UI implementation.

- [ ] **Step 6: Implement explicit confirmation UI**

Add selected unknown-job state, action state, optional provider task id, and confirmation checkbox. Render the panel only when:

```ts
selectedJob?.errorCode === 'provider_submission_unknown'
  && selectedJob.submissionResolution.allowed
```

Show bind only when `canBind`; disable release until the exact KIE confirmation checkbox is checked. On success, close the panel, refresh the same page, and reopen the refreshed timeline. On failure, preserve input and show the API error.

Run UI behavior, API and build checks. Expected: PASS.

- [ ] **Step 7: Commit task**

```bash
git add server/taskPlatform.mjs server/taskPlatform.test.mjs src/types.ts src/services/internalApi.ts src/services/internalApi.test.mjs src/shell/modules/Account/AccountManagement.tsx src/shell/modules/Account/accountManagementBehavior.test.mjs
git commit -m "fix: add safe submission unknown resolution"
```

---

### Task 3: 类型化 JobContext 与关键创建点

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/internalApi.ts`
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/services/videoStoryboardService.ts`
- Test: `src/adapters/shellControlJobLifecycle.test.mjs`
- Test: `src/components/uiArchitecture.test.mjs`

**Interfaces:**
- Consumes: existing open provider payload objects.
- Produces: exported `JobContext` and `InternalJobPayload = Record<string, unknown> & JobContext`; no runtime schema or API wire change.

- [ ] **Step 1: Write type/source contract tests**

Add assertions that `src/types.ts` exports:

```ts
export interface JobContext {
  taskPurpose?: string;
  shellProjectId?: string;
  shellProjectName?: string;
  shellPlanId?: string;
  shellBoardId?: string;
  shellPurpose?: string;
  subFeature?: string;
  traceId?: string;
}
```

and that active OneClick, buyer-show and storyboard job creation sites construct named `JobContext` values before spreading them into payloads.

Run:

```bash
node --experimental-strip-types --test src/adapters/shellControlJobLifecycle.test.mjs src/components/uiArchitecture.test.mjs
```

Expected: FAIL because the shared contract is absent.

- [ ] **Step 2: Implement the additive type contract**

Add to `src/types.ts`:

```ts
export interface JobContext {
  taskPurpose?: string;
  shellProjectId?: string;
  shellProjectName?: string;
  shellPlanId?: string;
  shellBoardId?: string;
  shellPurpose?: string;
  subFeature?: string;
  traceId?: string;
}

export type InternalJobPayload = Record<string, unknown> & JobContext;
```

Change `createInternalJob` payload from `Record<string, unknown>` to `InternalJobPayload`.

- [ ] **Step 3: Type critical active workflow contexts**

At each critical creation point, construct a local context such as:

```ts
const jobContext = {
  taskPurpose: 'storyboard_planning',
  shellProjectId: taskMetadata?.shellProjectId,
  shellProjectName: taskMetadata?.shellProjectName,
  subFeature: taskMetadata?.subFeature,
} satisfies JobContext;
```

Spread `jobContext` into the existing provider payload without removing any existing fields. Apply the same pattern to OneClick planning/generation, buyer-show planning, storyboard planning and board images.

Run:

```bash
npm run lint
node --experimental-strip-types --test src/adapters/shellControlJobLifecycle.test.mjs src/components/uiArchitecture.test.mjs
```

Expected: PASS with no runtime response changes.

- [ ] **Step 4: Commit task**

```bash
git add src/types.ts src/services/internalApi.ts src/adapters/shellWorkflow.ts src/services/videoStoryboardService.ts src/adapters/shellControlJobLifecycle.test.mjs src/components/uiArchitecture.test.mjs
git commit -m "refactor: type internal job context metadata"
```

---

### Task 4: 活跃 OneClick 与 Provider 付费安全特征测试

**Files:**
- Create: `src/adapters/shellOneClickWorkflow.test.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/jobSubmissionPolicy.test.mjs`

**Interfaces:**
- Consumes: current `runShellOneClickPlanning`, `runShellImageGeneration`, provider gateway and submission policy behavior.
- Produces: behavior-level regression protection only; no production code change expected.

- [ ] **Step 1: Add active OneClick characterization tests**

Test the exported active workflow functions with mocked `fetch` and browser storage. Assert generated job payloads include:

```js
{
  module: 'one_click',
  taskType: 'kie_chat' | 'kie_image',
  payload: {
    shellProjectId: 'project-1',
    shellPlanId: 'plan-1',
    subFeature: 'main_image'
  }
}
```

and that the planning result/task id is propagated. These tests target `src/adapters/shellWorkflow.ts`, not legacy OneClick components.

Run:

```bash
node --experimental-strip-types --test src/adapters/shellOneClickWorkflow.test.mjs
```

Expected: PASS if merged behavior is intact; a failure identifies a real regression and must be fixed in the smallest active function.

- [ ] **Step 2: Add provider safety characterization tests**

Lock these behaviors with explicit call counts and structured errors:

```js
assert.equal(createRequestCount, 1);
assert.equal(error.code, 'provider_submission_unknown');
assert.equal(retryDecision.maxRetries, 0);
```

Cover connection loss before response, known `providerTaskId`, direct-first media fallback, and upload-only retry. Do not assert implementation strings when a callable export exists.

Run:

```bash
node --test server/providerGateway.test.mjs server/jobSubmissionPolicy.test.mjs
```

Expected: PASS; production code remains unchanged unless a merged behavior regression is discovered.

- [ ] **Step 3: Commit task**

```bash
git add src/adapters/shellOneClickWorkflow.test.mjs server/providerGateway.test.mjs server/jobSubmissionPolicy.test.mjs
git commit -m "test: protect active generation submission contracts"
```

---

### Task 5: 集成评审、记录、发布与云上复查

**Files:**
- Modify if warranted: `docs/agents/repeated-issues.md`
- Modify: `docs/CURRENT.md`
- External record: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板`

**Interfaces:**
- Consumes: Tasks 1-4 reviewed commits.
- Produces: verified Git commit, pushed branch, cloud deployment, health/log evidence, diagnostics fix record.

- [ ] **Step 1: Run changed-file Hermes gate**

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed $(git diff --name-only origin/feat/stability-phase2...HEAD)
```

Expected: no unresolved high-risk finding.

- [ ] **Step 2: Run focused and full verification**

```bash
node --test server/jobSubmissionPolicy.test.mjs server/jobManager.test.mjs server/jobRuntime.test.mjs server/providerGateway.test.mjs server/taskPlatform.test.mjs
node --experimental-strip-types --test src/services/internalApi.test.mjs src/shell/modules/Account/accountManagementBehavior.test.mjs src/adapters/shellOneClickWorkflow.test.mjs src/adapters/shellControlJobLifecycle.test.mjs src/adapters/shellDataAdapter.test.mjs src/shell/components/destructiveActions.test.mjs src/utils/persistedDeletion.test.mjs
npm run verify
```

Expected: all tests, lint and build pass with fresh output.

- [ ] **Step 3: Perform final code review**

Review `git diff origin/feat/stability-phase2...HEAD` for admin authorization, user isolation, public asset URLs, log/stat retention, provider duplicate-charge protection, task state transitions and conflict artifacts. Resolve all critical/high findings and rerun affected tests.

- [ ] **Step 4: Record the production bug fix**

Inspect `npm run record-fix -- --help`, then record primary fingerprint `230327dafc5f7e0e` with job `32b3f0fe6f867a4cee5dddc7`, root cause, commit and verification. Mark related fingerprints `79d3dd3cf0e3829a` and `f9f8bc8e62528395` as the same incident when the dashboard supports linkage.

Expected: dashboard lookup returns the committed fix record and validation status.

- [ ] **Step 5: Push and deploy**

```bash
git status --short --branch
git push origin feat/stability-phase2
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

Expected: clean tree, remote updated, deployment guard reports no active-job conflict, PM2 restart completes.

- [ ] **Step 6: Verify cloud health and logs**

```bash
curl -fsS http://meiaoyuntai.com/api/health
curl -fsS http://www.meiaoyuntai.com/api/health
```

Then pull and analyze 2026-07-13 logs in the external dashboard.

Expected: `ok=true`, worker healthy, workflow/activity poller each `1`, no new PM2 restart loop, and no new post-deploy `provider_submission_unknown` caused by the release. Absence of paid-task errors is observational only because no automatic paid smoke test is run.
