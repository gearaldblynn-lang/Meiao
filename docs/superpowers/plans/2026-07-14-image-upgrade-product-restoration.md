# Image Upgrade Product Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the user-facing Product Retouch workspace to Image Upgrade and add a locally testable Product Restoration workflow that restores product identity across up to ten generated images from up to five product references without changing the existing composition, people, text, decoration, or background.

**Architecture:** Keep the stable internal module id `retouch` and route the new `product_restore` subfeature into an isolated orchestration service. One mandatory vision-analysis control job reads the whole target set, the ordered reference set, the user's requirement, and the selected restoration emphases, then persists one normalized analysis and one shared restoration prompt. Each target image then becomes an independent image-generation job using that target first and every product reference after it; backend queueing controls concurrency, results settle independently, and a single-image retry reuses the persisted analysis.

**Tech Stack:** React 18, TypeScript, Vite, Node.js ESM, KIE chat/image jobs, existing shell project persistence, Node test runner, local in-app browser QA.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-07-14-image-upgrade-product-restoration-design.md`.
- Keep the internal module key `retouch`, existing routes, persisted historical projects, and job filtering compatible.
- Rename user-facing `产品精修` to `图片升级` everywhere in the active shell; do not rename internal database or workflow identifiers.
- The new subfeature key is `product_restore`. Existing `original` and `white_bg` behavior remains unchanged; `enhance` stays unavailable.
- One task handles exactly one SKU. Reject the whole new file selection if it would exceed ten restore targets or five product references; never silently truncate.
- Product identity is always protected. Selected focus options only change emphasis. Default focus is `shape_structure` plus `material_texture`.
- The analysis model follows public system configuration and is not selectable in this UI.
- A Product Restoration batch creates exactly one application-level `kie_chat` analysis job. Provider fallback models may run inside that job, but a structurally invalid successful response must fail the batch and must not create another paid analysis job.
- Analysis is mandatory. Do not start any image job until the normalized analysis and shared prompt have been persisted on the shell project.
- Create one independent `kie_image` job per target. Pass the current target first and all ordered product references after it.
- Preserve each target's original aspect ratio automatically. Product Restoration supports 2K by default and 4K only when the selected model declares support; 1K is never offered or submitted.
- Only the product body and necessary contact shadow, reflection, and occlusion edges may change. Background, people, pose, crop, camera view, layout, marketing text, decorations, and non-product content remain unchanged.
- Partial failures keep successful results. Retrying one failed result reuses the stored batch analysis and creates only one new image job.
- Rollout is `MEIAO_PRODUCT_RESTORE_ROLLOUT=off|admin|all`, with invalid or missing values normalized to `off`. It gates new submission only; historical projects remain viewable.
- This implementation and acceptance are local only. Do not push, deploy, change cloud configuration, or run a real paid-provider smoke test without a separate explicit instruction.
- Preserve unrelated working-tree changes. Use `apply_patch` for hand edits and run fresh verification before every completion claim.

## Stable Contracts

### Material and focus ids

```ts
export type ProductRestoreMaterialType = 'restoreTarget' | 'productReference';

export type ProductRestoreFocusId =
  | 'shape_structure'
  | 'proportion_contour'
  | 'material_texture'
  | 'color_gloss'
  | 'logo_label_text'
  | 'component_craft';

export const DEFAULT_PRODUCT_RESTORE_FOCUS_IDS = [
  'shape_structure',
  'material_texture',
] as const;
```

### Persisted project context

```ts
export interface ProductRestoreNormalizedAnalysis {
  productIdentitySummary: string;
  invariantFeatures: string[];
  shapeAndStructure: string[];
  proportionAndContour: string[];
  materialAndTexture: string[];
  colorAndGloss: string[];
  logoLabelAndText: string[];
  componentsAndCraft: string[];
  targetSetIssues: string[];
  nonProductPreservationRules: string[];
}

export interface ProductRestoreProjectContext {
  version: 1;
  analysisJobId: string;
  analysisProviderTaskId?: string;
  analysisModel: string;
  analysisCreditsConsumed: number;
  normalizedAnalysis: ProductRestoreNormalizedAnalysis;
  sharedRestorationPrompt: string;
  focusIds: ProductRestoreFocusId[];
  targetMaterialIds: string[];
  productReferenceMaterialIds: string[];
  selectedImageModel: string;
  resolution: '2K' | '4K';
  userRequirement: string;
  createdAt: number;
}
```

### Job metadata

Analysis control job:

```ts
{
  taskType: 'kie_chat',
  taskPurpose: 'product_restore_analysis',
  module: 'retouch',
  subFeature: 'product_restore',
  shellProjectId,
  shellProjectName,
  batchCount,
  clientSubmissionKey,
}
```

Image job:

```ts
{
  taskType: 'kie_image',
  taskPurpose: 'product_restore_generation',
  module: 'retouch',
  subFeature: 'product_restore',
  shellProjectId,
  shellProjectName,
  batchIndex,
  batchCount,
  targetMaterialId,
  analysisJobId,
  clientSubmissionKey,
}
```

---

### Task 1: Rollout contract and public configuration

**Files:**
- Create: `src/utils/productRestoreRollout.mjs`
- Create: `src/utils/productRestoreRollout.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `src/types.ts`
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`

**Interfaces:**
- Produces: `normalizeProductRestoreRollout(value): 'off' | 'admin' | 'all'`.
- Produces: `canCreateProductRestore(mode, role): boolean`.
- Adds: `SystemPublicConfig.featureRollouts.productRestore`.

- [x] **Step 1: Write rollout RED tests**

Add table-driven tests proving that missing, empty, mixed-case invalid, and unknown values become `off`; `admin` permits only admin roles; `all` permits authenticated normal and admin roles; and `off` permits no one.

```js
assert.equal(normalizeProductRestoreRollout(undefined), 'off');
assert.equal(normalizeProductRestoreRollout('ADMIN'), 'admin');
assert.equal(normalizeProductRestoreRollout(' all '), 'all');
assert.equal(normalizeProductRestoreRollout('beta'), 'off');
assert.equal(canCreateProductRestore('admin', 'admin'), true);
assert.equal(canCreateProductRestore('admin', 'user'), false);
assert.equal(canCreateProductRestore('all', 'user'), true);
```

- [x] **Step 2: Verify RED**

Run: `node --test src/utils/productRestoreRollout.test.mjs`

Expected: FAIL because the rollout helper does not exist.

- [x] **Step 3: Implement the pure rollout helper**

Use an explicit allowlist and never treat truthy strings as enabled.

```js
export const PRODUCT_RESTORE_ROLLOUT_MODES = Object.freeze(['off', 'admin', 'all']);

export const normalizeProductRestoreRollout = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return PRODUCT_RESTORE_ROLLOUT_MODES.includes(normalized) ? normalized : 'off';
};

export const canCreateProductRestore = (mode, role) => {
  const normalized = normalizeProductRestoreRollout(mode);
  if (normalized === 'all') return Boolean(role);
  if (normalized === 'admin') return role === 'admin';
  return false;
};
```

- [x] **Step 4: Expose the normalized flag in public configuration**

Add this top-level response shape in `buildPublicSystemConfig` and its TypeScript type:

```ts
featureRollouts: {
  productRestore: normalizeProductRestoreRollout(
    process.env.MEIAO_PRODUCT_RESTORE_ROLLOUT,
  ),
},
```

Test the public response for unset, `admin`, `all`, and invalid environment values. Restore `process.env` after each test.

- [x] **Step 5: Document the environment contract**

Add `MEIAO_PRODUCT_RESTORE_ROLLOUT=off` to `.env.server.example` and document all three values, the conservative default, and the fact that it gates task creation rather than project visibility.

- [x] **Step 6: Verify GREEN and commit**

Run:

```bash
node --test src/utils/productRestoreRollout.test.mjs server/jobRuntime.test.mjs
npx tsc -b
git diff --check
```

Expected: all pass.

Commit: `feat: add product restoration rollout contract`

Execution evidence: commit `dd2977f`; focused suites passed 45/45; `npm run lint` passed the repository's `tsc -b` and ESLint gate; task review passed spec compliance and code quality with no findings. The plan's unavailable `npm run typecheck` command was corrected to `npx tsc -b` for later tasks.

---

### Task 2: Product Restoration domain, input, and prompt contracts

**Files:**
- Create: `src/modules/Retouch/productRestoreContract.mjs`
- Create: `src/modules/Retouch/productRestoreContract.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces focus option metadata and defaults.
- Produces `validateProductRestoreInput`, `normalizeProductRestoreFocusIds`, `getProductRestoreResolutionOptions`, and `normalizeProductRestoreResolution`.
- Produces `buildProductRestoreAnalysisPrompt`, `parseProductRestoreAnalysis`, and `buildProductRestoreGenerationPrompt`.
- Adds `ProductRestoreNormalizedAnalysis` and `ProductRestoreProjectContext` to `OneClickGenerationContext.productRestore?`.

- [ ] **Step 1: Write input and selection RED tests**

Cover empty target/reference sets, 1/1 valid input, target counts 10 and 11, reference counts 5 and 6, duplicate focus ids, unknown ids, empty focus input, model-dependent 2K/4K filtering, and any attempt to normalize 1K.

Required results:

```js
assert.deepEqual(normalizeProductRestoreFocusIds(undefined), [
  'shape_structure',
  'material_texture',
]);
assert.deepEqual(normalizeProductRestoreFocusIds('logo_label_text,shape_structure,logo_label_text'), [
  'shape_structure',
  'logo_label_text',
]);
assert.deepEqual(getProductRestoreResolutionOptions('maxforai-image-2-relay'), ['2K']);
assert.equal(normalizeProductRestoreResolution('gpt-image-2', '1K'), '2K');
```

- [ ] **Step 2: Write parser and prompt RED tests**

Test that:

- a code-fenced JSON object with every required field is normalized;
- missing arrays, blank identity summary, non-string array entries, malformed JSON, or extra prose fail with `product_restore_analysis_invalid`;
- the analysis prompt names every target and ordered reference, describes selected focus as emphasis rather than scope, and demands JSON only;
- the generation prompt contains the normalized analysis, strict non-product preservation, current-target-first semantics, original-ratio preservation, and the user requirement;
- user text is data inside explicit delimiters and cannot remove the invariant preservation rules.

Use the exact normalized schema from “Stable Contracts”.

- [ ] **Step 3: Verify RED**

Run: `node --test src/modules/Retouch/productRestoreContract.test.mjs`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 4: Implement constants, validation, and resolution filtering**

Use these stable labels:

```js
export const PRODUCT_RESTORE_FOCUS_OPTIONS = Object.freeze([
  { id: 'shape_structure', label: '形态与结构' },
  { id: 'proportion_contour', label: '比例与轮廓' },
  { id: 'material_texture', label: '材质与纹理' },
  { id: 'color_gloss', label: '颜色与光泽' },
  { id: 'logo_label_text', label: 'Logo/标签/包装文字' },
  { id: 'component_craft', label: '关键部件与工艺细节' },
]);

export const PRODUCT_RESTORE_LIMITS = Object.freeze({
  restoreTarget: 10,
  productReference: 5,
});
```

For resolution support, follow the existing `getQualityOptionsForModel` semantics: when a model declares resolutions, intersect them with `['2K', '4K']`; when the catalog omits resolution metadata, keep the existing assumed `['2K', '4K']` support. Always default the Product Restoration selection to `2K`.

- [ ] **Step 5: Implement strict structured analysis parsing**

Strip at most one surrounding Markdown code fence, parse one JSON object, require every schema key, trim strings, reject empty identity text, reject non-string list entries, and return:

```js
{
  ok: true,
  value: normalizedAnalysis,
}
```

or:

```js
{
  ok: false,
  errorCode: 'product_restore_analysis_invalid',
  message: '分析模型未返回可用的产品还原结构，请重试分析。',
}
```

Do not repair partial semantic output with a second model call.

- [ ] **Step 6: Implement the analysis and generation prompts**

The analysis prompt must include:

1. image ordering and role;
2. the selected focus labels;
3. the user's optional requirement;
4. the invariant product-identity and non-product preservation policy;
5. the exact JSON schema.

The generation prompt must begin with a concise operation statement, then the shared normalized product truth, then the selected emphasis, and end with negative constraints:

```text
Do not redesign, restyle, add, remove, translate, rewrite, crop, recompose, or move any non-product element.
Preserve all original text pixels outside the product body.
Modify only the product body and the minimal contact shadow, reflection, or occlusion edge required for physical consistency.
```

- [ ] **Step 7: Add persisted context types and clone compatibility**

Add the stable interfaces above and:

```ts
export interface OneClickGenerationContext {
  prompt: string;
  params: Record<string, string>;
  materials: Record<string, OneClickMaterialSnapshot[]>;
  productRestore?: ProductRestoreProjectContext;
}
```

Keep `productRestore` optional so historical projects deserialize unchanged.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```bash
node --test src/modules/Retouch/productRestoreContract.test.mjs
npx tsc -b
git diff --check
```

Expected: all pass.

Commit: `feat: define product restoration contracts`

---

### Task 3: One-job mandatory batch analysis

**Files:**
- Modify: `src/services/arkService.ts`
- Modify: `src/services/arkService.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Extends `requestAnalysisResponseDetailed` with `allowSemanticRetry?: boolean` and additive `jobId` / `modelUsed` return fields.
- Produces `analyzeProductRestoreBatch(input): Promise<ProductRestoreAnalysisRunResult>`.
- Produces `recoverProductRestoreAnalysisBatch(input): Promise<ProductRestoreAnalysisRunResult>` without creating a job.

```ts
export interface AnalyzeProductRestoreBatchInput {
  targetUrls: string[];
  productReferenceUrls: string[];
  focusIds: ProductRestoreFocusId[];
  userRequirement: string;
  apiConfig?: ApiConfig;
  signal?: AbortSignal;
  jobMetadata: Record<string, unknown>;
  onJobCreated?: (jobId: string, providerTaskId?: string) => void | Promise<void>;
}

export type ProductRestoreAnalysisRunResult =
  | {
      status: 'success';
      jobId: string;
      providerTaskId?: string;
      modelUsed: string;
      creditsConsumed: number;
      normalizedAnalysis: ProductRestoreNormalizedAnalysis;
      sharedRestorationPrompt: string;
    }
  | {
      status: 'generating';
      jobId: string;
      providerTaskId?: string;
      errorCode: 'analysis_result_pending';
      message: string;
    }
  | {
      status: 'error';
      errorCode: string;
      message: string;
      jobId?: string;
      providerTaskId?: string;
    };
```

- [ ] **Step 1: Write RED service-contract tests**

Assert source and behavior contracts:

- the new entry point submits one multimodal message containing every target and every product reference URL;
- `taskPurpose` is `product_restore_analysis`;
- `allowSemanticRetry` is `false`;
- one successful structured response returns normalized analysis, prompt, job id, model, and credits;
- queued/running/retry-waiting or a recoverable polling gap returns `generating` with the already-created job id;
- provider failure returns an error and no fallback prompt;
- successful invalid structure returns `product_restore_analysis_invalid` and performs one application-level submission;
- cancellation remains cancellation.

Use injected or existing mocked `createJob`/`waitForJob` facilities; count created analysis jobs rather than provider fallback attempts within a job.

- [ ] **Step 2: Verify RED**

Run: `node --test src/services/arkService.test.mjs`

Expected: FAIL because the product-restoration service and semantic-retry switch do not exist.

- [ ] **Step 3: Make analysis response identity additive**

Keep every existing consumer compatible and return:

```ts
{
  content,
  creditsConsumed,
  taskId: providerTaskId,
  jobId: job.id,
  modelUsed: job.model || selectedModel,
}
```

Default `allowSemanticRetry` to `true` so existing analysis flows retain their current behavior.

- [ ] **Step 4: Disable application-level semantic retry only for Product Restoration**

When `allowSemanticRetry === false`, the first successful provider response is the only content evaluated. If it is structurally invalid, return the explicit analysis error. Keep the backend job's configured `fallbackModels` intact so transport/provider fallback still occurs inside the same control job.

- [ ] **Step 5: Implement `analyzeProductRestoreBatch`**

Build one message with this deterministic image order:

```ts
[
  ...targetUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ...productReferenceUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  { type: 'text', text: analysisPrompt },
]
```

Resolve the analysis model through the existing system configuration path, pass `allowSemanticRetry: false`, strictly parse the returned structure, build the shared generation prompt once, and never use the existing optional retouch deterministic fallback.

- [ ] **Step 6: Recover an already-created analysis job without resubmission**

Implement `recoverProductRestoreAnalysisBatch` by fetching the supplied internal job id. Return `generating` for queued/running/retry-waiting states, parse and normalize a succeeded job through the same success helper, and return the durable terminal error for failed/cancelled jobs. This function must not call `createInternalJob`.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
node --test src/services/arkService.test.mjs src/modules/Retouch/productRestoreContract.test.mjs
npx tsc -b
git diff --check
```

Expected: all pass.

Commit: `feat: add batch product restoration analysis`

---

### Task 4: Isolated image-job orchestration and partial settlement

**Files:**
- Create: `src/adapters/shellProductRestoreWorkflow.ts`
- Create: `src/adapters/shellProductRestoreWorkflow.test.mjs`
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/services/kieAiService.ts` only if an additive callback/result field is required.

**Interfaces:**
- Produces `runShellProductRestoreWorkflow` for a full batch.
- Produces `runShellProductRestoreItem` for one initial or retry image.
- Routes `runShellRetouchWorkflow` mode `product_restore` to the isolated workflow.

```ts
export interface ProductRestoreWorkflowCallbacks {
  onAnalysisCompleted?: (
    context: ProductRestoreProjectContext,
  ) => void | Promise<void>;
  onItemChanged?: (
    result: ShellWorkflowImageResult,
    index: number,
  ) => void | Promise<void>;
}

export interface ProductRestoreWorkflowDeps {
  analyzeBatch: typeof analyzeProductRestoreBatch;
  generateImage: typeof processWithKieAi;
  persistImage: (
    url: string,
    fileName: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

export interface ShellProductRestoreWorkflowResult {
  results: ShellWorkflowImageResult[];
  creditsConsumed?: number;
  analysisStatus: 'completed' | 'generating';
  productRestoreContext?: ProductRestoreProjectContext;
  analysisJobId?: string;
  message?: string;
}
```

- [ ] **Step 1: Write RED orchestration tests with injected fakes**

Cover these observable behaviors:

1. one analysis call receives all targets and ordered references;
2. `onAnalysisCompleted` resolves before the first image call;
3. N targets create N image calls;
4. every image call receives `[currentTarget, ...allReferences]`;
5. generated metadata contains the target id, analysis job id, batch index/count, purpose, and submission key;
6. pending backend job identity is emitted immediately;
7. mixed success/error/pending results keep input order and successful URLs;
8. analysis failure creates zero image calls;
9. a recoverable pending analysis returns planning state and creates zero image calls;
10. resuming a succeeded analysis uses the existing analysis job and creates zero new chat jobs;
11. `runShellProductRestoreItem` consumes existing context and creates one image call with zero analysis calls;
12. 1K input is normalized to 2K and original ratio is not replaced by a selector value;
13. every target receives a stable key derived from project id, analysis job id, and target material id, so resume deduplicates the same logical job.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test src/adapters/shellProductRestoreWorkflow.test.mjs
```

Expected: FAIL because the isolated workflow does not exist.

- [ ] **Step 3: Implement dependency-injected workflow boundaries**

The production defaults call `analyzeProductRestoreBatch`, `processWithKieAi`, and the existing generated-asset persistence utilities. Tests pass fakes through the final optional `deps` argument.

```ts
export async function runShellProductRestoreWorkflow(
  input: ShellGenerateInput,
  config: ModuleConfig,
  callbacks: ProductRestoreWorkflowCallbacks = {},
  deps: ProductRestoreWorkflowDeps = DEFAULT_PRODUCT_RESTORE_DEPS,
): Promise<ShellProductRestoreWorkflowResult>
```

The implementation must not silently recover from terminal analysis errors. A recoverable analysis sync gap returns `analysisStatus: 'generating'`, preserves the internal job id, and does not start image work.

- [ ] **Step 4: Persist analysis before fan-out**

Construct `ProductRestoreProjectContext` from the analysis result plus material ids, image model, normalized resolution, requirement, and timestamp. Await `onAnalysisCompleted(context)` before creating any image promise.

- [ ] **Step 5: Fan out one logical promise per target**

Use `Promise.all` over target entries so every task is registered independently while the backend queue controls actual provider concurrency. For each item:

1. emit a generating result when `onJobCreated` receives the backend identity;
2. submit the current target first and all references after it;
3. send the shared generation prompt;
4. persist the successful provider image;
5. emit completed, error, or still-generating state without discarding siblings.

Use this stable submission-key shape:

```ts
const clientSubmissionKey = [
  shellProjectId,
  'product_restore',
  context.analysisJobId,
  target.id,
  'v1',
].join(':');
```

Preserve array order with `batchIndex` and return total credits as analysis credits plus all settled image credits. The existing job manager's `clientSubmissionKey` deduplication is the backend guard against a refresh creating the same logical target job twice.

- [ ] **Step 6: Emit bounded structured lifecycle logs**

Record `product_restore_batch_started`, analysis started/succeeded/failed, generation created/succeeded/failed, and `product_restore_partial_completed` through `safeCreateInternalLog`. Include user/project/job identities, target/reference counts, focus ids, batch index/count, model, resolution, duration, credits, provider task id, and structured error code. Do not log API keys, Authorization, image bytes, full image URLs, or complete prompts.

- [ ] **Step 7: Route the new mode without changing old modes**

Extend:

```ts
type ShellRetouchMode =
  | 'original'
  | 'white_bg'
  | 'product_restore'
  | 'product_replace'
  | 'background_replace'
  | 'logo_replace';
```

Branch to `runShellProductRestoreWorkflow` before the legacy `original`/`white_bg` loop. Do not route through `EverythingReplace`.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```bash
node --experimental-strip-types --test src/adapters/shellProductRestoreWorkflow.test.mjs
node --test src/adapters/shellWorkflowLogoReplace.test.mjs src/services/kieAiService.test.mjs
npx tsc -b
git diff --check
```

Expected: all pass.

Commit: `feat: orchestrate product restoration image jobs`

---

### Task 5: Shell project lifecycle, durable analysis, and job visibility

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/adapters/shellJobVisibility.ts`
- Modify: `src/adapters/shellControlJobLifecycle.test.mjs`
- Modify: `src/adapters/shellDataAdapter.test.mjs`
- Modify: `src/types.ts` if callback result typing needs an additive field.

**Interfaces:**
- Persists `generationContext.productRestore` before image submission.
- Creates a root shell project whose `taskCount` equals target count, not target count plus analysis.
- Treats `product_restore_analysis` as an internal control job bound to the root project.

- [ ] **Step 1: Write RED lifecycle tests**

Test source/adapter behavior for:

- `product_restore_analysis` is a control purpose and cannot become a standalone ghost card;
- its `shellProjectId` binds it to the root project;
- analysis completion does not increment image `completedCount`;
- `taskCount` is exactly the number of restore targets;
- persisted `generationContext.productRestore` survives project clone/normalization;
- N image jobs can be recovered by `targetMaterialId` and `batchIndex` after reload;
- a planning project with a pending analysis job stays planning and never resubmits analysis;
- a planning project whose existing analysis job has succeeded persists the recovered context and resumes missing image jobs once;
- project cancellation collects the analysis backend job id plus every image backend job id;
- project deletion passes the same aggregate ids into the existing tombstone flow;
- historical Product Restoration projects remain readable when rollout is `off`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test src/adapters/shellControlJobLifecycle.test.mjs src/adapters/shellDataAdapter.test.mjs
```

Expected: FAIL because the purpose and context are not known.

- [ ] **Step 3: Extend generation-context cloning safely**

Deep-clone the optional Product Restoration context:

```ts
productRestore: context.productRestore
  ? {
      ...context.productRestore,
      focusIds: [...context.productRestore.focusIds],
      targetMaterialIds: [...context.productRestore.targetMaterialIds],
      productReferenceMaterialIds: [...context.productRestore.productReferenceMaterialIds],
      normalizedAnalysis: cloneProductRestoreAnalysis(
        context.productRestore.normalizedAnalysis,
      ),
    }
  : undefined,
```

Historical contexts without the field must retain the existing result.

- [ ] **Step 4: Persist the analysis callback before image callbacks**

In the Product Restoration submit branch:

1. create one root project with `status: 'planning'`, `taskCount: targetCount`, and the normal material snapshot;
2. pass `onProductRestoreAnalysisCompleted` into `runShellRetouchWorkflow`;
3. update the root project with `generationContext.productRestore`, `planningTaskId`, analysis credits, and `status: 'generating'`;
4. only then accept item callbacks that write backend image job ids and results.

If analysis is still recoverably pending, keep the root project in `planning`, persist the internal analysis job id in `backendJobId`, and do not synthesize image results. If analysis reaches a terminal failure, set the root project to `error`, keep its inputs, job identity, and error message, and do not synthesize image results.

- [ ] **Step 5: Preserve pending and partial image identities**

Use the existing `onSpecialItemCompleted` mechanics, but key Product Restoration items by `targetMaterialId` plus `batchIndex`. A later callback replaces the same logical row instead of appending a duplicate. Project status becomes:

- `generating` while any item is pending;
- `completed` only when every item succeeds;
- `error` when any settled item fails and none remain pending, while retaining every successful result and the accurate `completedCount`.

- [ ] **Step 6: Resume from the durable analysis job after refresh**

Add a guarded Product Restoration planning resume path. For a root project with `status: 'planning'`, `subFeature: 'product_restore'`, and `backendJobId`:

1. call `recoverProductRestoreAnalysisBatch` with that job id;
2. leave pending jobs unchanged;
3. on success, persist the recovered Product Restoration context before image work;
4. query/hydrate existing child image jobs for the same `shellProjectId` and `targetMaterialId`;
5. submit only missing targets with the same stable per-target `clientSubmissionKey`;
6. guard the browser process with an in-flight project-id set and rely on backend submission-key deduplication across reloads.

This is continuation of the original job, not a new analysis request.

- [ ] **Step 7: Preserve cancellation and deletion semantics**

Ensure the normal shell collectors include root `backendJobId`, successful `productRestore.analysisJobId`, and every result `backendJobId`. Cancelling while analysis is pending cancels that job and prevents fan-out; cancelling during generation keeps successful images and interrupts remaining jobs. Deletion continues through the existing tombstone and multi-job aggregate flow. Emit the bounded `product_restore_cancelled` log.

- [ ] **Step 8: Make analysis job classification explicit**

Add `product_restore_analysis` to the control-purpose allowlist even though `retouch` chat jobs are already broadly classified. Test the explicit value to protect the contract from a later narrowing of the module rule.

- [ ] **Step 9: Verify GREEN and commit**

Run:

```bash
node --test src/adapters/shellControlJobLifecycle.test.mjs src/adapters/shellDataAdapter.test.mjs
npx tsc -b
git diff --check
```

Expected: all pass.

Commit: `feat: persist product restoration lifecycle`

---

### Task 6: Image Upgrade workspace, uploads, choices, and rollout gate

**Files:**
- Modify: `src/shell/modules/Retouch/RetouchModule.tsx`
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/shell/components/UploadTypeSelector.tsx`
- Modify: `src/shell/components/MaterialPreviewBar.tsx`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/services/loggingService.ts`
- Modify: `src/components/uiArchitecture.test.mjs`
- Create: `src/shell/modules/Retouch/productRestoreUi.test.mjs`
- Modify: `docs/project-overview.md`
- Modify: `项目交接上下文.md`
- Modify: `docs/release-and-handoff.md`

**Interfaces:**
- Adds material types `restoreTarget` and `productReference`.
- Adds `onMoveMaterial(type, id, direction)` and visible count/limit metadata.
- Adds a six-option Product Restoration emphasis multi-select.
- Adds model-aware 2K/4K controls with no ratio or 1K control.

- [ ] **Step 1: Write RED UI contract tests**

Assert:

- active user-facing labels contain `图片升级` and no active shell label contains `产品精修`;
- retouch tabs are `原图精修`, `白底精修`, `产品还原`, and disabled `智能增强`;
- Product Restoration exposes only `restoreTarget` and `productReference` upload types;
- material labels are `待还原套图` and `产品参考图`;
- hover descriptions state maximum counts, ordering importance, one-SKU scope, and whole-selection rejection;
- target/reference group headers show `current/10` and `current/5`;
- focus options and defaults match Task 2;
- quick controls contain model and quality but no ratio;
- quality never contains 1K and defaults to 2K;
- 4K appears only for a supporting model;
- generation label is `开始产品还原`;
- rollout `off`/unauthorized `admin` disables new submission with a clear reason but does not remove the tab.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test src/components/uiArchitecture.test.mjs src/shell/modules/Retouch/productRestoreUi.test.mjs
```

Expected: FAIL because the workspace still exposes the legacy name and inputs.

- [ ] **Step 3: Rename the active user-facing surface**

Change active shell navigation, page title, module description, empty-state copy, workflow label, and logging display label from `产品精修` to `图片升级`. Do not rename `retouch`, source folders, existing persisted `module` values, or legacy mode keys.

Add `product_restore` to the subfeature map and URL-param normalization:

```ts
{ id: 'original', label: '原图精修', enabled: true },
{ id: 'white_bg', label: '白底精修', enabled: true },
{ id: 'product_restore', label: '产品还原', enabled: true },
{ id: 'enhance', label: '智能增强', enabled: false },
```

- [ ] **Step 4: Add the two upload roles with hover guidance**

Extend `MaterialType` and the material catalog. Use native `title` plus visible description text so mouse hover and keyboard focus both surface:

- 待还原套图：最多 10 张；每张都会单独生成；同一任务只放一个 SKU；超限整次拒绝。
- 产品参考图：最多 5 张；按结构、细节、材质、颜色的参考价值从左到右排序；超限整次拒绝。

- [ ] **Step 5: Enforce caps before material creation**

In `handleMaterialUpload`, calculate `existingCount + files.length` before reading any file. If over cap, issue one toast and return without adding any of the selection. Include remaining capacity in the message.

```ts
const nextCount = scopedMaterials.length + files.length;
if (limit && nextCount > limit) {
  showToast(
    '本次选择未上传：' + label + '最多 ' + limit
      + ' 张，当前已有 ' + scopedMaterials.length
      + ' 张，还可上传 ' + Math.max(0, limit - scopedMaterials.length) + ' 张。',
  );
  return;
}
```

- [ ] **Step 6: Add ordered preview and reordering**

Show count/limit on each new material group. Add left/right actions on each preview item and implement `handleMoveMaterial` inside the current module/subfeature scope. Disable the left action on the first item and right action on the last. Preserve object URLs, ids, and metadata while only changing array order.

- [ ] **Step 7: Add focus, model, and resolution controls**

Store focus ids as a stable comma-separated parameter `restoreFocusIds`; normalize them through Task 2. Render six multi-select chips above the quick toolbar, preselect the approved two defaults, and prevent an empty selection by restoring defaults.

For Product Restoration quick params:

```ts
[
  { key: 'model', type: 'select', options: eligibleImageModels },
  { key: 'quality', type: 'select', options: productRestoreResolutionOptions },
]
```

Do not render `ratio`, `sizeMode`, `width`, or `height`. Normalize model changes so an unsupported 4K choice falls back to 2K.

- [ ] **Step 8: Gate submission with public rollout state**

Always show the Product Restoration tab. When active, combine `systemConfig.featureRollouts.productRestore` with the current user's role. If creation is disallowed, pass a generation-disabled reason:

- `off`: `产品还原暂未开放，历史项目仍可查看。`
- unauthorized `admin`: `产品还原当前仅对管理员开放，历史项目仍可查看。`

Keep upload previews and historical project cards readable.

- [ ] **Step 9: Count billable image tasks correctly**

For Product Restoration, pass the number of restore targets to existing image billing estimation. Analysis cost is not presented as another image count. Keep the final project credit total equal to analysis plus settled image jobs.

- [ ] **Step 10: Update project documentation**

Document `图片升级 / 产品还原`, the two material roles, analysis-first lifecycle, limits, output behavior, rollout environment value, and local-only status in the three active project/handoff documents. Do not claim cloud availability.

- [ ] **Step 11: Verify GREEN and commit**

Run:

```bash
node --test src/components/uiArchitecture.test.mjs src/shell/modules/Retouch/productRestoreUi.test.mjs
npx tsc -b
npm run lint
git diff --check
```

Expected: tests and typecheck pass; lint remains within the repository's warning budget.

Commit: `feat: add image upgrade product restoration workspace`

---

### Task 7: Analysis visibility, before/after detail, and single-image retry

**Files:**
- Create: `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.tsx`
- Create: `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs`
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/adapters/shellProductRestoreWorkflow.ts`
- Modify: `src/adapters/shellProductRestoreWorkflow.test.mjs`

**Interfaces:**
- Displays persisted analysis and shared prompt.
- Reuses `runShellProductRestoreItem` for retry.
- Adds a deliberate project-level `重新分析并继续` action only after terminal analysis failure.

- [ ] **Step 1: Write RED detail and retry tests**

Test that a Product Restoration project card:

- shows analysis model, selected focus labels, analysis summary, and shared prompt;
- shows analysis credits, settled image credits, and their non-invented total when values exist;
- can copy the shared prompt;
- keeps generic source/result comparison for each image;
- shows per-item backend status and error;
- presents retry only for the selected item;
- retry calls `runShellProductRestoreItem` with the stored analysis, target id, original ordered references, model, and resolution;
- retry performs zero analysis calls and one image call;
- a terminal analysis failure with no image results exposes `重新分析并继续`;
- the manual reanalysis action creates one new analysis attempt, persists its identity, and starts image jobs only after its valid result is persisted;
- a pending or `provider_submission_unknown` analysis never auto-creates a replacement job;
- a missing/corrupt persisted analysis blocks paid retry and asks the user to recreate the batch;
- retry replaces the same result row and does not increment `taskCount`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --experimental-strip-types --test src/adapters/shellProductRestoreWorkflow.test.mjs
node --test src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs
```

Expected: FAIL because the panel and special retry branch do not exist.

- [ ] **Step 3: Implement the focused analysis panel**

Render only when `subFeature === 'product_restore'` and a persisted context exists. Keep the panel read-only:

```tsx
<ProductRestoreAnalysisPanel
  context={project.generationContext.productRestore}
  onCopyPrompt={() => copyToClipboard(
    project.generationContext?.productRestore?.sharedRestorationPrompt || '',
  )}
/>
```

Show bounded lists for invariant features and detected target issues, analysis/image/total credits when the ledger supplied values, and place the full shared prompt in a collapsible block so large prompts do not dominate the project card.

- [ ] **Step 4: Preserve generic before/after comparison**

Continue using each result's `sourceUrl` as the original and `url` as the restored output. Ensure Product Restoration results store `targetMaterialId` and source URL, so multiple aspect ratios and partial settlements do not cross-wire comparisons.

- [ ] **Step 5: Add Product Restoration retry before generic retouch regeneration**

In `handleRegenerateResult`:

1. detect `module === RETOUCH` plus `subFeature === 'product_restore'`;
2. require valid `generationContext.productRestore`;
3. locate the exact target snapshot by `targetMaterialId`, with `sourceUrl` fallback only for old local drafts;
4. restore reference order from `productReferenceMaterialIds`;
5. call `runShellProductRestoreItem` with the stored context;
6. write the returned backend identity and final state into the same result slot.

An optional per-result revision instruction may be appended as a bounded supplemental note, but it cannot remove or replace the shared invariant rules.

- [ ] **Step 6: Protect retry from context loss**

If the stored analysis, target, or every product reference is missing, fail locally before `createJob` and show:

```text
该历史任务缺少完整的产品还原分析或参考素材，无法安全单张重试，请重新创建产品还原任务。
```

- [ ] **Step 7: Add deliberate manual reanalysis after terminal failure**

Show `重新分析并继续` only when the root project has no image results and its existing analysis job is confirmed terminal failed or its successful output is structurally invalid. The action reuses the persisted material snapshots, focus ids, model, resolution, and requirement; creates one new analysis job with a new manual-attempt submission key; replaces the root planning identity; and then follows the same persist-before-fan-out path. Keep it hidden for pending, cancelled, and `provider_submission_unknown` states. Log `product_restore_analysis_started` with a manual-retry marker, but never trigger it automatically.

- [ ] **Step 8: Log single-image retry without duplicating analysis credits**

Emit `product_restore_single_retry` with the existing analysis job id and new image job identity. Add only the new image job's actual credits to the updated result/project ledger; retain the original analysis credits exactly once.

- [ ] **Step 9: Verify GREEN and commit**

Run:

```bash
node --experimental-strip-types --test src/adapters/shellProductRestoreWorkflow.test.mjs
node --test src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs
npx tsc -b
git diff --check
```

Expected: all pass.

Commit: `feat: add product restoration details and retry`

---

### Task 8: Full local verification and browser acceptance

**Files:**
- Modify this plan's checkboxes and execution-evidence notes only after commands actually pass.
- Do not change cloud deployment files or production environment state.

- [ ] **Step 1: Run changed-file policy checks**

Run:

```bash
npm run check:changed-files
npm run check:module-headers
npm run check:module-boundaries
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run focused Product Restoration suites**

Run:

```bash
node --test \
  src/utils/productRestoreRollout.test.mjs \
  src/modules/Retouch/productRestoreContract.test.mjs \
  src/services/arkService.test.mjs \
  src/adapters/shellControlJobLifecycle.test.mjs \
  src/adapters/shellDataAdapter.test.mjs \
  src/components/uiArchitecture.test.mjs \
  src/shell/modules/Retouch/productRestoreUi.test.mjs \
  src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs
node --experimental-strip-types --test src/adapters/shellProductRestoreWorkflow.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run repository verification**

Run:

```bash
npx tsc -b
npm run lint
npm run build
npm run verify
```

Expected: all commands exit zero. If the aggregate test process retains the repository's known Vite/esbuild handle after assertions finish, rerun the exact test set with the documented force-exit workaround and record both outputs rather than hiding the first behavior.

- [ ] **Step 4: Start the local app with rollout enabled**

Use the repository's documented local startup path with `MEIAO_PRODUCT_RESTORE_ROLLOUT=all` for the local server process. Confirm `http://127.0.0.1:3000/api/health` identifies the current workspace and the public config returns `productRestore: 'all'`.

Do not edit tracked production environment files merely to enable local QA.

- [ ] **Step 5: Run browser acceptance without a paid provider submission**

Using the in-app browser at `http://127.0.0.1:3000/`, verify:

1. navigation and page title read `图片升级`;
2. `产品还原` tab is visible and selectable;
3. hover guidance appears for both upload roles;
4. 11 target files are rejected as one selection;
5. 6 reference files are rejected as one selection;
6. valid uploads show count/limit and reorder controls;
7. defaults select `形态与结构` and `材质与纹理`;
8. model/resolution choices never show 1K;
9. ratio and custom dimensions are absent;
10. generation label is `开始产品还原`;
11. a historical/mock project shows the analysis panel and before/after layout.

Stop before clicking the final paid generation action unless the environment is explicitly configured for a non-billable mock.

- [ ] **Step 6: Inspect the final diff and history**

Review all changes for:

- exactly one application-level analysis job;
- no product-restore route through EverythingReplace;
- strict target-first/reference-after ordering;
- no 1K path;
- caps reject rather than truncate;
- persisted analysis before image jobs;
- pending-analysis recovery without a replacement chat job;
- refresh-safe per-target submission keys;
- partial-failure preservation;
- retry without analysis;
- deliberate reanalysis only after confirmed terminal failure;
- aggregate cancellation/deletion identities;
- bounded lifecycle logs and non-duplicated analysis credits;
- rollout affecting creation only;
- old Product Retouch modes and historical projects remaining compatible;
- no secrets, provider URLs, or unrelated files added.

- [ ] **Step 7: Report local delivery evidence**

Report:

- commits created;
- focused/full test results;
- build/lint/typecheck results;
- local health and public rollout response;
- browser acceptance checks;
- any residual risk, especially that visual restoration quality still needs one separately approved real-provider acceptance batch;
- explicit confirmation that nothing was pushed or deployed.
