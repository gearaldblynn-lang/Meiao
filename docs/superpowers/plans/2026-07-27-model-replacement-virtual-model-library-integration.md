# 模特替换与虚拟模特库完整集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. The user
> explicitly approved continuous inline execution without another review gate.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“模特替换 + 虚拟模特库”完整、安全地合入梅奥本地当前版本，并完成自动化、真实浏览器和最小真实生成效果验证。

**Architecture:** 专属文件以 2026-07-25 集成包为行为基线；共享文件只迁移 `model_replace`、`virtual_model`、`VirtualModel` 和 `ModelReplace` 相关符号。服务端先建立永久素材、版本化存储、可信快照和 provider 边界，再接入前端管理页、选择器、工作流、持久化与单项重试。

**Tech Stack:** Node.js ESM、React 19、TypeScript 5.9、Vite 7、Node test runner、MySQL/本地 JSON 双存储、Sharp、现有 Provider 网关。

## Global Constraints

- 设计规格：
  `docs/superpowers/specs/2026-07-27-model-replacement-virtual-model-library-integration-design.md`
- 集成包：
  `/Users/feiyanglin/Downloads/模特替换与虚拟模特库-集成包-20260725`
- 当前目标：
  `/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本`
- 不整文件覆盖 `src/ShellMigratedApp.tsx`、`server/index.mjs` 或其他
  `integration-point` 文件。
- 不覆盖目标仓库的 `package.json`、lockfile、tsconfig、Vite、Tailwind 或
  `components.json`；现有依赖已满足 React、Lucide、Sharp、MySQL 和 Dialog。
- 不修改、不暂存
  `docs/superpowers/specs/2026-07-27-video-voiceover-translation-design.md`。
- 不创建 worktree；用户批准在当前 `feat/stability-phase2` 功能分支连续实施。
- 不推送 GitHub，不部署腾讯云，不修改远端分支。
- 新行为执行 RED→GREEN；每个 RED 必须确认是因功能缺失而失败。
- 新增/迁移 prompt 保留集成包现有 RTCFE 结构、图片编号和解析锚点。
- 已有 `providerTaskId` 的任务只能恢复/查询，不能再次提交付费任务。
- 技术验证与视觉效果观察分开报告。

---

### Task 1: 固化源码完整性与虚拟模特存储合同

**Files:**
- Create test first:
  - `server/virtualModelStore.test.mjs`
  - `server/virtualModelHttpApi.test.mjs`
  - `server/virtualModelApi.test.mjs`
- Create after RED:
  - `server/virtualModelStore.mjs`
  - `server/virtualModelHttpApi.mjs`
- Modify:
  - `server/assetStore.mjs`
  - `server/assetStore.test.mjs`
  - `server/assetReferenceCleanup.test.mjs`
  - `server/index.mjs`

**Interfaces:**
- Produces:
  - `VIRTUAL_MODEL_ASSET_SLOTS`
  - `ensureVirtualModelSchema(pool)`
  - `normalizeVirtualModelLocalStore(store)`
  - `createVirtualModelGenerationJobSnapshot(options)`
  - `resolveHistoricalVirtualModelSelectedAssets(options)`
  - `handleVirtualModelApiRequest(context)`
- Persists:
  - `virtual_models`
  - `virtual_model_versions`
  - `virtual_model_assets`
- Adds permanent asset module: `virtual_model`

- [ ] **Step 1: Verify the package manifest without trusting CRLF paths**

Run a Node script that strips `\r`, parses every line in
`05-manifest/checksums.sha256`, hashes the referenced file, and exits non-zero
on the first mismatch.

Expected: all 111 package files match their SHA-256 entries.

- [ ] **Step 2: Add only the three backend contract tests**

Apply the exact test sources from:

```text
01-source-files/server/virtualModelStore.test.mjs
01-source-files/server/virtualModelHttpApi.test.mjs
01-source-files/server/virtualModelApi.test.mjs
```

- [ ] **Step 3: Run RED**

Run:

```bash
node --test \
  server/virtualModelStore.test.mjs \
  server/virtualModelHttpApi.test.mjs \
  server/virtualModelApi.test.mjs
```

Expected: FAIL because `virtualModelStore.mjs` and
`virtualModelHttpApi.mjs` do not exist.

- [ ] **Step 4: Add the feature-owned store and HTTP implementation**

Apply the exact implementation sources from:

```text
01-source-files/server/virtualModelStore.mjs
01-source-files/server/virtualModelHttpApi.mjs
```

Preserve these contracts:

```js
export const VIRTUAL_MODEL_ASSET_SLOTS = [
  'front_close',
  'left_45_close',
  'right_45_close',
  'profile_close',
  'front_half',
  'three_quarter_half',
  'front_full',
  'three_quarter_full',
];
```

Published versions are immutable; `front_close` is the only primary slot;
delete is soft delete; historical selected asset order is preserved.

- [ ] **Step 5: Merge permanent-asset and route symbols**

In `server/assetStore.mjs`, add `virtual_model` to the permanent module set and
preserve permanent asset IDs/previews during cleanup.

In `server/index.mjs`:

```js
await ensureVirtualModelSchema(pool);
normalizeVirtualModelLocalStore(store);
```

Add the three local arrays, register `handleVirtualModelApiRequest` after
session resolution, and ensure admin write authorization occurs before body
reading.

- [ ] **Step 6: Run GREEN and asset regression**

Run:

```bash
node --test \
  server/virtualModelStore.test.mjs \
  server/virtualModelHttpApi.test.mjs \
  server/virtualModelApi.test.mjs \
  server/assetStore.test.mjs \
  server/assetReferenceCleanup.test.mjs
```

Expected: PASS, including incomplete eight-slot rejection, immutable published
versions, employee 403, safe public summaries, permanent sources and previews.

- [ ] **Step 7: Commit**

```bash
git add server/virtualModelStore.mjs server/virtualModelStore.test.mjs \
  server/virtualModelHttpApi.mjs server/virtualModelHttpApi.test.mjs \
  server/virtualModelApi.test.mjs server/assetStore.mjs \
  server/assetStore.test.mjs server/assetReferenceCleanup.test.mjs \
  server/index.mjs
git commit -m "feat: add virtual model storage and api"
```

---

### Task 2: 建立可信任务快照、provider 输入和计费合同

**Files:**
- Create test first:
  - `src/utils/virtualModelSelection.test.mjs`
  - `src/utils/virtualModelSnapshot.test.mjs`
- Create after RED:
  - `src/utils/virtualModelSelection.mjs`
  - `src/utils/virtualModelSnapshot.mjs`
- Modify:
  - `server/index.mjs`
  - `server/jobRuntime.mjs`
  - `server/jobRuntime.test.mjs`
  - `server/providerGateway.mjs`
  - `server/providerGateway.test.mjs`
  - `server/providerKieImage.mjs`
  - `server/providerKieImage.test.mjs`
  - `server/providerMaxForAiImage.mjs`
  - `server/providerMaxForAiImage.test.mjs`
  - `server/modelCapabilities.mjs`
  - `server/accountCredits.mjs`
  - `server/accountCredits.test.mjs`
  - `server/accountCreditsSource.test.mjs`

**Interfaces:**
- Consumes:
  `createVirtualModelGenerationJobSnapshot`,
  `resolveHistoricalVirtualModelSelectedAssets`
- Produces:

```ts
type VirtualModelJobSnapshot = {
  identitySource: 'library';
  virtualModelId: string;
  virtualModelVersionId: string;
  selectedAssetIds: string[];
  selectedIdentitySlots: string[];
  identityImageCount: number;
  identitySelectionStrategy:
    | 'reference_analysis'
    | 'fallback'
    | 'historical_snapshot';
};
```

- [ ] **Step 1: Add selection/snapshot tests and run RED**

Apply the two package test files, then run:

```bash
node --test \
  src/utils/virtualModelSelection.test.mjs \
  src/utils/virtualModelSnapshot.test.mjs
```

Expected: FAIL because both implementation modules are missing.

- [ ] **Step 2: Add selection/snapshot implementations and run GREEN**

Apply the two feature-owned implementations. Verify default selection is
`front_close + left_45_close + right_45_close`, while known framing/direction
selects the matching three slots.

Run the same command. Expected: PASS.

- [ ] **Step 3: Merge trusted payload reconstruction**

In the job creation path, ignore all client-provided `assets`,
`identityProfile`, URLs, model names and codes when
`identitySource === 'library'`.

Use only:

```js
{
  virtualModelId,
  virtualModelVersionId,
  referenceAnalysis,
}
```

to rebuild the trusted payload. Before provider execution, resolve
`selectedAssetIds` and prepend their URLs to the current reference image.

- [ ] **Step 4: Merge runtime/provider/credits fields**

Carry `identitySource`, `virtualModelSnapshot`, `preserveInputImageOrder` and
image quality into job payload/result/checkpoints. Preserve the current
repository's KIE, GPT Image, MaxForAI, queue retry and `providerTaskId`
behavior; do not copy unrelated provider branches from the bundle snapshot.

- [ ] **Step 5: Run provider and billing GREEN**

Run:

```bash
node --test \
  server/jobRuntime.test.mjs \
  server/providerGateway.test.mjs \
  server/providerKieImage.test.mjs \
  server/providerMaxForAiImage.test.mjs \
  server/accountCredits.test.mjs \
  server/accountCreditsSource.test.mjs
```

Expected: PASS with identity images before the reference image, provider input
limits enforced, idempotent credit source keys, and no resubmission when
`providerTaskId` exists.

- [ ] **Step 6: Commit**

```bash
git add src/utils/virtualModelSelection.mjs \
  src/utils/virtualModelSelection.test.mjs \
  src/utils/virtualModelSnapshot.mjs \
  src/utils/virtualModelSnapshot.test.mjs \
  server/index.mjs server/jobRuntime.mjs server/jobRuntime.test.mjs \
  server/providerGateway.mjs server/providerGateway.test.mjs \
  server/providerKieImage.mjs server/providerKieImage.test.mjs \
  server/providerMaxForAiImage.mjs server/providerMaxForAiImage.test.mjs \
  server/modelCapabilities.mjs server/accountCredits.mjs \
  server/accountCredits.test.mjs server/accountCreditsSource.test.mjs
git commit -m "feat: secure virtual model generation snapshots"
```

---

### Task 3: 集成模特替换预检、RTCFE 提示词和生成工作流

**Files:**
- Create test first:
  - `src/utils/modelReplacePreflight.test.mjs`
  - `src/utils/modelReplacePrompt.test.mjs`
  - `src/utils/modelQuality.test.mjs`
  - `src/adapters/shellWorkflowModelReplace.test.mjs`
- Create after RED:
  - `src/utils/modelReplacePreflight.mjs`
  - `src/utils/modelReplacePrompt.mjs`
  - `src/utils/modelReplacePromptInput.mjs`
  - `src/utils/modelQuality.ts`
- Modify:
  - `src/adapters/shellWorkflow.ts`
  - `src/services/arkService.ts`
  - `src/services/arkService.test.mjs`
  - `src/services/kieAiService.ts`
  - `src/services/kieAiService.test.mjs`
  - `src/services/loggingService.ts`
  - `src/services/loggingService.test.mjs`
  - `src/utils/imageBilling.mjs`
  - `src/utils/imageBilling.test.mjs`
  - `src/utils/imageUtils.ts`
  - `src/utils/imageUtils.test.mjs`
  - `src/utils/modelCapabilities.mjs`
  - `src/utils/modelCapabilities.test.mjs`

**Interfaces:**
- Produces:
  - `runShellModelReplacePreflight(options)`
  - `buildModelReplacePrompt(options)`
  - `normalizeModelReplacePromptInput(prompt)`
  - `analyzeModelReplaceMaterials(options)`
- Preserves:
  - `replacementScope: 'identity_only' | 'full_person'`
  - 1–4 identity images
  - 1–40 reference images
  - one-based `ModelReplaceReferenceAnalysis.index`

- [ ] **Step 1: Add four behavior tests and run RED**

Run:

```bash
node --experimental-strip-types --test \
  src/utils/modelReplacePreflight.test.mjs \
  src/utils/modelReplacePrompt.test.mjs \
  src/utils/modelQuality.test.mjs \
  src/adapters/shellWorkflowModelReplace.test.mjs
```

Expected: FAIL because the model-replacement implementation modules and
workflow branch do not exist.

- [ ] **Step 2: Add pure implementations**

Apply the package's preflight, prompt, prompt-input and model-quality sources.
Do not rewrite the prompt. Confirm its sections are exactly:

```text
R Role
T Task
C Constraint
F Format
E Example
```

and the final input role order is identity images first, current reference
last.

- [ ] **Step 3: Merge structured visual analysis**

Add `analyzeModelReplaceMaterials` to `arkService.ts` using strict JSON
parsing and structured error codes:

```text
IDENTITY_COUNT_INVALID
PERSON_COUNT_INVALID
IDENTITY_MISMATCH
FACE_NOT_USABLE
REFERENCE_PERSON_TOO_SMALL
FULL_REPLACE_SOURCE_INCOMPLETE
```

No Chinese error text may determine job state.

- [ ] **Step 4: Merge the workflow branch**

In `runShellRetouchWorkflow`, add only the `model_replace` branch. It must
build one task per reference, set `preserveInputImageOrder: true`, prevent
compiled prompt nesting, and include reference analysis in each task context.

- [ ] **Step 5: Run GREEN and shared regressions**

Run:

```bash
node --experimental-strip-types --test \
  src/utils/modelReplacePreflight.test.mjs \
  src/utils/modelReplacePrompt.test.mjs \
  src/utils/modelQuality.test.mjs \
  src/adapters/shellWorkflowModelReplace.test.mjs \
  src/services/arkService.test.mjs \
  src/services/kieAiService.test.mjs \
  src/services/loggingService.test.mjs \
  src/utils/imageBilling.test.mjs \
  src/utils/imageUtils.test.mjs \
  src/utils/modelCapabilities.test.mjs
```

Expected: PASS for both replacement scopes, dynamic image numbering, input
limits, pixel/quality guards, preflight failures before project creation and
existing image workflows.

- [ ] **Step 6: Commit**

```bash
git add src/utils/modelReplacePreflight.mjs \
  src/utils/modelReplacePreflight.test.mjs src/utils/modelReplacePrompt.mjs \
  src/utils/modelReplacePrompt.test.mjs src/utils/modelReplacePromptInput.mjs \
  src/utils/modelQuality.ts src/utils/modelQuality.test.mjs \
  src/adapters/shellWorkflow.ts src/adapters/shellWorkflowModelReplace.test.mjs \
  src/services/arkService.ts src/services/arkService.test.mjs \
  src/services/kieAiService.ts src/services/kieAiService.test.mjs \
  src/services/loggingService.ts src/services/loggingService.test.mjs \
  src/utils/imageBilling.mjs src/utils/imageBilling.test.mjs \
  src/utils/imageUtils.ts src/utils/imageUtils.test.mjs \
  src/utils/modelCapabilities.mjs src/utils/modelCapabilities.test.mjs
git commit -m "feat: add model replacement workflow"
```

---

### Task 4: 集成前端 API、虚拟模特管理页和选择器

**Files:**
- Create test first:
  - `src/modules/VirtualModelLibrary/VirtualModelLibraryModule.test.mjs`
  - `src/modules/VirtualModelLibrary/virtualModelDeleteSubmission.test.mjs`
  - `src/shell/components/VirtualModelPicker.test.mjs`
  - `src/shell/components/SubFeatureTabs.test.mjs`
  - `src/shell/components/ui/dialog.test.mjs`
- Create after RED:
  - `src/modules/VirtualModelLibrary/VirtualModelLibraryModule.tsx`
  - `src/modules/VirtualModelLibrary/virtualModelDeleteSubmission.mjs`
  - `src/shell/components/VirtualModelPicker.tsx`
- Modify:
  - `src/services/internalApi.ts`
  - `src/services/internalApi.test.mjs`
  - `src/shell/types.ts`
  - `src/types.ts`
  - `src/shell/components/SubFeatureTabs.tsx`
  - `src/shell/components/UploadTypeSelector.tsx`
  - `src/shell/components/layout/SidebarNavigation.tsx`
  - `src/shell/components/layout/SidebarNavigation.test.mjs`
  - `src/shell/components/ui/dialog.tsx`
  - `src/index.css`

**Interfaces:**
- Produces:
  - `VirtualModelLibraryModule`
  - `VirtualModelPicker`
  - `VirtualModelAsset`
  - `VirtualModelSummary`
  - `validateVirtualModelLibrarySelection(selection)`
  - `AppModuleObj.VIRTUAL_MODEL_LIBRARY`

- [ ] **Step 1: Add UI/API contract tests and run RED**

Run:

```bash
node --experimental-strip-types --test \
  src/modules/VirtualModelLibrary/VirtualModelLibraryModule.test.mjs \
  src/modules/VirtualModelLibrary/virtualModelDeleteSubmission.test.mjs \
  src/shell/components/VirtualModelPicker.test.mjs \
  src/shell/components/SubFeatureTabs.test.mjs \
  src/shell/components/ui/dialog.test.mjs
```

Expected: FAIL because the library module, picker and subfeature registration
do not exist.

- [ ] **Step 2: Add feature-owned UI**

Apply the management module, delete helper and picker. Preserve:

```ts
type VirtualModelSelection = {
  virtualModelId: string;
  virtualModelVersionId: string;
};
```

The picker may expose only published model summaries. The management module
must await publish/delete requests before refreshing.

- [ ] **Step 3: Merge API client and module types**

Add all `/api/virtual-models` and `/api/admin/virtual-models` client methods.
Register `virtual_model_library` as an admin module and `model_replace` as the
fourth `everything_replace` tab.

- [ ] **Step 4: Merge navigation and shared UI**

Only administrators see the virtual model library navigation item. Preserve
all current target repository navigation items and withdrawn-module guards.
Merge only Dialog capability required by the library and its scoped styles.

- [ ] **Step 5: Run GREEN and typecheck**

Run:

```bash
node --experimental-strip-types --test \
  src/modules/VirtualModelLibrary/VirtualModelLibraryModule.test.mjs \
  src/modules/VirtualModelLibrary/virtualModelDeleteSubmission.test.mjs \
  src/shell/components/VirtualModelPicker.test.mjs \
  src/shell/components/SubFeatureTabs.test.mjs \
  src/shell/components/ui/dialog.test.mjs \
  src/services/internalApi.test.mjs \
  src/shell/components/layout/SidebarNavigation.test.mjs
npx tsc --noEmit -p tsconfig.app.json
```

Expected: PASS; non-admin navigation has no library entry; direct module
access remains guarded by the shell.

- [ ] **Step 6: Commit**

```bash
git add src/modules/VirtualModelLibrary \
  src/shell/components/VirtualModelPicker.tsx \
  src/shell/components/VirtualModelPicker.test.mjs \
  src/services/internalApi.ts src/services/internalApi.test.mjs \
  src/shell/types.ts src/types.ts src/shell/components/SubFeatureTabs.tsx \
  src/shell/components/SubFeatureTabs.test.mjs \
  src/shell/components/UploadTypeSelector.tsx \
  src/shell/components/layout/SidebarNavigation.tsx \
  src/shell/components/layout/SidebarNavigation.test.mjs \
  src/shell/components/ui/dialog.tsx \
  src/shell/components/ui/dialog.test.mjs src/index.css
git commit -m "feat: add virtual model library ui"
```

---

### Task 5: 接入主壳、输入器、持久化和单结果重试

**Files:**
- Create test first:
  - `src/shell/modelReplaceRetry.test.mjs`
- Create after RED:
  - `src/utils/modelReplaceRetry.mjs`
- Modify:
  - `src/ShellMigratedApp.tsx`
  - `src/shell/components/layout/BottomInputBar.tsx`
  - `src/shell/components/layout/BottomInputBar.test.mjs`
  - `src/shell/components/ProjectCard.tsx`
  - `src/adapters/shellPersistence.ts`
  - `src/adapters/shellPersistence.test.mjs`
  - `src/adapters/shellDataAdapter.ts`
  - `src/adapters/shellDataAdapter.test.mjs`
  - `src/shell/components/destructiveActions.test.mjs`

**Interfaces:**
- Produces:
  - `ModelReplaceIdentityDraft`
  - `sanitizeModelReplaceGenerationContext(context)`
  - `buildModelReplaceRetryContext(options)`
  - `runModelReplaceRetryLifecycle(options)`
- Persists safe `identitySource`, `virtualModelSnapshot`,
  `preflight.referenceAnalysis`, `replacementScope` and batch order.

- [ ] **Step 1: Add retry/lifecycle test and run RED**

Run:

```bash
node --experimental-strip-types --test \
  src/shell/modelReplaceRetry.test.mjs
```

Expected: FAIL because `src/utils/modelReplaceRetry.mjs` does not exist.

- [ ] **Step 2: Add retry implementation and run unit GREEN**

Apply the package implementation and verify the retry lifecycle:

```text
mark only target result processing
→ submit one retry
→ replace only target result
→ preserve original batch order
→ release retry lock on success/failure
```

- [ ] **Step 3: Merge shell state and submission**

In `ShellMigratedApp.tsx`:

- lazy-load `VirtualModelLibraryModule`;
- add guarded admin routing;
- maintain upload/library drafts separately;
- validate active source before project creation;
- run reference analysis and preflight;
- pass the safe generation context to each task/result;
- route failed `model_replace` results through the dedicated retry lifecycle.

Do not copy unrelated shell code from the bundle snapshot.

- [ ] **Step 4: Merge bottom input and project display**

Add the upload/library segmented control, 1–4 identity inputs, 1–40 reference
inputs, replacement scope and library selection summary. Hide the shared
composer on the admin library page. Project cards display only public model
name, code and version.

- [ ] **Step 5: Merge persistence and hydration**

Add `sanitizeModelReplaceGenerationContext` to both persistence and data
adapter paths. Run the project ownership comparison probe before editing
normalization: the same `model_replace` payload must resolve to the same
`module`, `subFeature` and `shellProjectId` in frontend hydration and backend
state merge.

- [ ] **Step 6: Run shell GREEN**

Run:

```bash
node --experimental-strip-types --test \
  src/shell/modelReplaceRetry.test.mjs \
  src/shell/components/layout/BottomInputBar.test.mjs \
  src/adapters/shellPersistence.test.mjs \
  src/adapters/shellDataAdapter.test.mjs \
  src/shell/components/destructiveActions.test.mjs
npx tsc --noEmit -p tsconfig.app.json
```

Expected: PASS for mutually exclusive active identity source, no empty project
on preflight failure, safe refresh/hydration, public-only display, partial
failure preservation and single-result retry.

- [ ] **Step 7: Commit**

```bash
git add src/utils/modelReplaceRetry.mjs \
  src/shell/modelReplaceRetry.test.mjs src/ShellMigratedApp.tsx \
  src/shell/components/layout/BottomInputBar.tsx \
  src/shell/components/layout/BottomInputBar.test.mjs \
  src/shell/components/ProjectCard.tsx \
  src/adapters/shellPersistence.ts src/adapters/shellPersistence.test.mjs \
  src/adapters/shellDataAdapter.ts src/adapters/shellDataAdapter.test.mjs \
  src/shell/components/destructiveActions.test.mjs
git commit -m "feat: connect model replacement shell lifecycle"
```

---

### Task 6: 文档、完整回归与本地真实效果验收

**Files:**
- Modify:
  - `README.md`
  - `项目交接上下文.md`
  - `docs/project-overview.md`
  - `docs/release-and-handoff.md`
- Verify:
  - all files changed by Tasks 1–5

**Interfaces:**
- Documents the new user/admin module, API summary, local-only delivery state,
  and manual acceptance evidence.

- [ ] **Step 1: Update module/API documentation**

Document `model_replace`, `virtual_model_library`, the admin/public API split,
eight-slot publishing rule, trusted snapshot boundary and local-only status.
Do not claim cloud availability.

- [ ] **Step 2: Run the package-focused suites**

Run the exact server and frontend commands in:

```text
/Users/feiyanglin/Downloads/模特替换与虚拟模特库-集成包-20260725/04-tests/TESTING.md
```

Expected: all migrated focused tests PASS.

- [ ] **Step 3: Run project-wide fresh verification**

Run:

```bash
npm run verify
npm run doctor
git diff --check
git diff --name-only 90bf681..HEAD -z |
  xargs -0 -n 1 node \
    /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs \
    --changed
```

Expected: verify exits 0; doctor reports no FAIL; diff check and Hermes gate
exit 0. Existing warnings, if any, are listed verbatim and separated from new
feature results.

- [ ] **Step 4: Restart the local current version**

Use the project's `npm run local`/launchd path. Compare process start time with
the latest feature commit time, then verify:

```bash
curl -fsS http://127.0.0.1:3100/api/health
curl -fsSI http://127.0.0.1:3000/
```

Expected: both services use the new build and return healthy responses.

- [ ] **Step 5: Browser acceptance**

Using the in-app browser:

1. Admin sees the library, creates a test model/version, binds eight safe local
   test images, publishes it, and can later unpublish/soft-delete it.
2. Regular user cannot see or directly open the management module.
3. Model replacement shows upload/library source switching without draft
   contamination.
4. Published library model is selectable; unpublished/deleted model is not.
5. Refresh preserves project source/name/code/version.
6. Default width and 820px width do not clip the picker, input area or result.

- [ ] **Step 6: Minimal real provider effect**

With local configured credentials and safe local test assets:

1. submit exactly one reference image with one identity source;
2. record the internal job ID and provider task ID;
3. confirm only one provider create operation occurred;
4. wait for terminal state without resubmission;
5. verify managed result URL, HTTP media type, non-zero bytes and decodable
   image;
6. visually compare identity, reference and result for identity transfer and
   protected product/scene structure.

If credentials or suitable assets are unavailable, stop at the exact external
blocker and report that effect verification remains incomplete.

- [ ] **Step 7: Review and final commit**

Review the complete diff against the design. Fix all Critical/Important review
findings, rerun affected tests, then:

```bash
git add README.md 项目交接上下文.md docs/project-overview.md \
  docs/release-and-handoff.md
git commit -m "docs: document model replacement integration"
```

No push or deployment follows this commit.
