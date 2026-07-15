# 产品还原逐图提示词 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This task is a single strongly coupled workflow and must be executed inline; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared product-restoration prompt with one persisted, target-specific prompt per restore image, safely parse the real `final_answer` provider envelope, and prove the workflow with the current local assets.

**Architecture:** Keep one analysis-first batch call, but change its result to a strict V2 contract containing `targetPrompts[1...N]`. Map those positional outputs to stable `targetMaterialId` values before canonical persistence, then build each paid image request from only that target's prompt plus a deterministic RTCFE protection wrapper. Retain an explicit V1 branch only for historical read/retry compatibility.

**Tech Stack:** TypeScript, React, Node ESM (`.mjs`), Node test runner, Vite, existing KIE/Responses analysis and GPT Image 2 provider path.

## Global Constraints

- Local development only; do not deploy Tencent Cloud.
- Continue using one configured analysis model call for the whole batch; do not expose an analysis-model selector.
- Every new/reanalyzed task uses protocol version `2`; never create a new shared dynamic restoration prompt.
- The number of target prompts must equal the number of restore targets, with unique contiguous indexes `1...N`.
- Fail before any image provider submission when the V2 contract or target mapping is incomplete.
- Preserve existing upload limits, focus choices, user-selectable image model, 2K/4K rules, original aspect ratio, cancellation, credit ledger, and authoritative state-write behavior.
- Existing V1 project contexts remain readable and retryable through an explicit `version === 1` branch.
- All prompt changes retain RTCFE structure and parser anchors required by `docs/prompt-rtcfe-migration-map.md`.
- Real acceptance is capped at one new analysis task and one new image task with the currently persisted one-target/three-reference asset set.
- Preserve unrelated dirty-worktree changes; stage and commit only files owned by this plan.

---

## File Structure

- `src/modules/Retouch/productRestoreContract.mjs`: V1/V2 parsing, strict provider-envelope extraction, V2 analysis prompt, and deterministic per-target generation wrapper.
- `src/modules/Retouch/productRestoreContract.test.mjs`: parser, prompt, target-count, and fail-closed contract tests.
- `src/types.ts`: V1/V2 analysis and project-context discriminated unions.
- `src/services/arkService.ts`: pass expected target count into V2 parsing and return V2 analysis data without a shared prompt.
- `src/services/arkService.test.mjs`: analysis and recovery service contract tests.
- `src/adapters/shellProductRestoreWorkflow.ts`: map target indexes to material IDs, persist V2 context, select the exact target prompt, preserve V1 retry, and use V2 idempotency keys.
- `src/adapters/shellProductRestoreWorkflow.test.mjs`: end-to-end adapter tests for two distinct prompts, mapping failures, canonical persistence, V1 retry, and no-provider fail closed.
- `src/ShellMigratedApp.tsx`: clone/persist V2 context and recover analysis with the expected target count.
- `src/adapters/shellDataAdapter.ts`: clone/hydrate the V1/V2 discriminated context without dropping target prompts.
- `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.tsx`: show V2 identity, invariants, per-target issues, and the corresponding prompt; preserve V1 history rendering.
- Associated tests: `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs`, `src/adapters/shellDataAdapter.test.mjs`, `src/adapters/shellPersistence.test.mjs`, `src/adapters/shellProductRestoreCancellation.test.mjs`, and `server/appStateMerge.test.mjs` where fixtures assert the stored shape.
- `docs/agents/repeated-issues.md` and `CLAUDE.md`: record the provider-envelope/parser root cause and the rule that analysis-to-fanout contracts must be target-addressable.

---

### Task 1: Lock the V2 analysis and envelope contract

**Files:**
- Modify: `src/modules/Retouch/productRestoreContract.test.mjs`
- Modify: `src/modules/Retouch/productRestoreContract.mjs`

**Interfaces:**
- Produces: `parseProductRestoreAnalysis(rawContent, { expectedTargetCount })`
- Produces: `parseLegacyProductRestoreAnalysis(rawContent)`
- Produces: `buildProductRestoreAnalysisPrompt(input)`
- Produces: `buildProductRestoreGenerationPrompt({ productIdentitySummary, invariantFeatures, targetPrompt, focusIds, userRequirement })`

- [ ] **Step 1: Write failing V2 parser tests**

Add a fixture shaped like:

```js
const V2_ANALYSIS = {
  version: 2,
  productIdentitySummary: '绿色单片沙发盖布，连续人字纹与同色流苏是核心身份。',
  invariantFeatures: ['橄榄绿色', '连续人字形织纹', '厚软垂坠', '同色流苏'],
  targetPrompts: [
    {
      targetIndex: 1,
      targetIssueSummary: ['纹理偏平，纱线起伏不足'],
      restorationPrompt: '只修复当前沙发盖布：恢复连续人字纹、厚软绒感和同色流苏；保持三步版式、日文文字、背景、人物、视角和裁切不变。',
    },
  ],
};
```

Assert that `JSON.stringify(V2_ANALYSIS) + '\nfinal_answer'` parses successfully for one target, while unknown tail text, leading explanation, a second JSON object, missing/duplicate/out-of-range indexes, count mismatch, and blank `restorationPrompt` fail with the correct error code.

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```bash
node --test src/modules/Retouch/productRestoreContract.test.mjs
```

Expected: FAIL because the current parser only accepts the V1 field set and direct whole-string JSON.

- [ ] **Step 3: Implement strict envelope extraction and V2 normalization**

Implement a scanner that requires the first non-whitespace character to be `{`, tracks string escaping and object depth, and permits only whitespace or the exact independent tail marker `final_answer` after the closing object. Keep single surrounding Markdown-fence support. Normalize V2 using exact target count and contiguous unique indexes. Preserve the old object parser behind the explicit `parseLegacyProductRestoreAnalysis` export.

Core shape:

```js
export const parseProductRestoreAnalysis = (rawContent, { expectedTargetCount } = {}) => {
  const jsonText = extractProductRestoreJson(rawContent);
  if (!jsonText) return { ...PRODUCT_RESTORE_ANALYSIS_INVALID };
  try {
    const parsed = JSON.parse(jsonText);
    const value = normalizeV2AnalysisObject(parsed, expectedTargetCount);
    return value
      ? { ok: true, value }
      : { ...PRODUCT_RESTORE_TARGET_PROMPTS_INVALID };
  } catch {
    return { ...PRODUCT_RESTORE_ANALYSIS_INVALID };
  }
};
```

- [ ] **Step 4: Replace the analysis prompt schema with V2 RTCFE output**

The task section must tell the analysis model to establish one product truth and compare each target independently. The format section must require `version`, `productIdentitySummary`, `invariantFeatures`, and exactly N `targetPrompts`; every `restorationPrompt` must be self-contained and protect the current target's non-product content.

- [ ] **Step 5: Replace shared generation synthesis with a target wrapper**

Use the model-produced target prompt only as dynamic task data and surround it with deterministic RTCFE protection:

```js
buildProductRestoreGenerationPrompt({
  productIdentitySummary,
  invariantFeatures,
  targetPrompt,
  focusIds,
  userRequirement,
})
```

The wrapper must state that Image 1 is the current target, later images are references for the same SKU, only the product body may change, original aspect ratio is preserved, and non-product pixels/text/layout must not be redesigned.

- [ ] **Step 6: Run contract tests and verify GREEN**

Run the command from Step 2. Expected: all product-restore contract tests PASS.

---

### Task 2: Change service types and analysis result handling

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/arkService.test.mjs`
- Modify: `src/services/arkService.ts`

**Interfaces:**
- Produces: `ProductRestoreNormalizedAnalysisV1`
- Produces: `ProductRestoreNormalizedAnalysisV2`
- Produces: `ProductRestoreTargetPromptAnalysis`
- Produces: `ProductRestoreProjectContextV1 | ProductRestoreProjectContextV2`
- Consumes: V2 parser from Task 1.

- [ ] **Step 1: Write failing service tests**

Update valid analysis fixtures to V2. Assert that `analyzeProductRestoreBatch` calls the parser with `targetUrls.length`, returns `normalizedAnalysis.version === 2`, and no longer returns `sharedRestorationPrompt`. Add recovery coverage that passes `expectedTargetCount` and rejects a succeeded job whose target prompts do not cover that count.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
node --experimental-strip-types --test src/services/arkService.test.mjs
```

Expected: FAIL on the old shared prompt result and missing expected target count.

- [ ] **Step 3: Add discriminated types**

Define explicit interfaces rather than an optional-field bag:

```ts
export interface ProductRestoreTargetPromptAnalysis {
  targetIndex: number;
  targetIssueSummary: string[];
  restorationPrompt: string;
}

export interface ProductRestoreNormalizedAnalysisV2 {
  version: 2;
  productIdentitySummary: string;
  invariantFeatures: string[];
  targetPrompts: ProductRestoreTargetPromptAnalysis[];
}

export type ProductRestoreProjectContext =
  | ProductRestoreProjectContextV1
  | ProductRestoreProjectContextV2;
```

Add `expectedTargetCount: number` to recovery input. Keep the old normalized-analysis shape only inside the V1 interface.

- [ ] **Step 4: Update analysis/recovery result construction**

`buildProductRestoreAnalysisResult` must call:

```ts
parseProductRestoreAnalysis(content, { expectedTargetCount })
```

and return the normalized V2 object only. Initial analysis passes `targetUrls.length`; recovery uses `input.expectedTargetCount`. Preserve job/provider IDs, credits, and pending/error behavior.

- [ ] **Step 5: Run service tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

---

### Task 3: Persist and fan out target-addressable prompts

**Files:**
- Modify: `src/adapters/shellProductRestoreWorkflow.test.mjs`
- Modify: `src/adapters/shellProductRestoreWorkflow.ts`

**Interfaces:**
- Consumes: `ProductRestoreProjectContextV1 | ProductRestoreProjectContextV2`.
- Produces: V2 context with stable `targetMaterialId` prompt mappings.
- Produces: `resolveProductRestoreEffectivePrompt(context, targetMaterialId, focusIds, userRequirement)` or an equivalent private helper.

- [ ] **Step 1: Write the two-target RED test**

Create two targets and two analysis target prompts with visibly different marker phrases. Assert:

```js
assert.equal(generateCalls.length, 2);
assert.match(generateCalls[0].prompt, /TARGET_A_ONLY/);
assert.doesNotMatch(generateCalls[0].prompt, /TARGET_B_ONLY/);
assert.match(generateCalls[1].prompt, /TARGET_B_ONLY/);
assert.doesNotMatch(generateCalls[1].prompt, /TARGET_A_ONLY/);
```

Also assert the persisted context maps index 1/2 to the two stable material IDs, and image input arrays remain `[currentTarget, ...allReferences]`.

- [ ] **Step 2: Add RED tests for safety boundaries**

Cover missing target mapping, duplicated target IDs, V2 context persistence failure, refresh/reuse, single retry by `targetMaterialId`, V2 analysis/generation idempotency keys ending in `v2`, and explicit V1 retry using its historical shared prompt.

- [ ] **Step 3: Run workflow tests and verify RED**

Run:

```bash
node --experimental-strip-types --test src/adapters/shellProductRestoreWorkflow.test.mjs
```

Expected: FAIL because current code stores and submits one shared prompt.

- [ ] **Step 4: Build and validate V2 context**

After successful analysis, sort prompts by `targetIndex`, map each item to `targets[targetIndex - 1].id`, and persist:

```ts
targetPrompts: analysis.normalizedAnalysis.targetPrompts.map((item) => ({
  targetMaterialId: targets[item.targetIndex - 1].id,
  targetIndex: item.targetIndex,
  targetIssueSummary: [...item.targetIssueSummary],
  restorationPrompt: item.restorationPrompt,
}))
```

Use analysis key `[projectId, 'product_restore', 'analysis', 'v2']`. Do not start fanout until `onAnalysisCompleted` confirms the canonical V2 context is persisted through the existing callback contract.

- [ ] **Step 5: Resolve the per-target effective prompt**

For V2, find exactly one mapping by `targetMaterialId` and pass it to `buildProductRestoreGenerationPrompt`. For V1, return the historical `sharedRestorationPrompt`. Missing or duplicate V2 mapping throws `product_restore_target_prompt_missing` before calling `generateImage`.

Use generation key:

```ts
[projectId, 'product_restore', context.analysisJobId, target.id, context.version === 2 ? 'v2' : 'v1'].join(':')
```

Store the final effective prompt in the result base and provider payload.

- [ ] **Step 6: Run workflow tests and verify GREEN**

Run the command from Step 3. Expected: PASS, including V1 compatibility.

---

### Task 4: Preserve V2 context through UI state and hydration

**Files:**
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/adapters/shellDataAdapter.ts`
- Modify: `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs`
- Modify: `src/shell/modules/Retouch/ProductRestoreAnalysisPanel.tsx`
- Modify as required by fixtures: `src/adapters/shellDataAdapter.test.mjs`, `src/adapters/shellPersistence.test.mjs`, `src/adapters/shellProductRestoreCancellation.test.mjs`, `src/adapters/shellControlJobLifecycle.test.mjs`, `src/shell/components/ProjectCard.productRestoreCredits.test.mjs`, `server/appStateMerge.test.mjs`

**Interfaces:**
- Consumes/produces: discriminated V1/V2 `ProductRestoreProjectContext`.
- Preserves: `targetPrompts[].targetMaterialId`, index, issues, and prompt across clone/hydrate/persist.

- [ ] **Step 1: Write failing clone/hydration and panel tests**

Add a V2 context fixture with one target prompt. Assert clone/hydration returns a deep copy, prompt arrays are not aliased, and the analysis panel shows target number, issues, and prompt. Keep a V1 rendering test.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --experimental-strip-types --test \
  src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs \
  src/adapters/shellDataAdapter.test.mjs \
  src/adapters/shellPersistence.test.mjs
```

Expected: FAIL because current clone/render paths assume V1 fields.

- [ ] **Step 3: Implement discriminated cloning and recovery input**

In both clone sites, branch only on `version`:

```ts
if (context.version === 2) {
  return {
    ...context,
    invariantFeatures: [...context.invariantFeatures],
    targetPrompts: context.targetPrompts.map((item) => ({
      ...item,
      targetIssueSummary: [...item.targetIssueSummary],
    })),
    focusIds: [...context.focusIds],
    targetMaterialIds: [...context.targetMaterialIds],
    productReferenceMaterialIds: [...context.productReferenceMaterialIds],
  };
}
```

Keep existing V1 cloning in the other branch. When recovering an analysis job, pass the current persisted target count as `expectedTargetCount`.

- [ ] **Step 4: Render V2 analysis without dense shared-field lists**

For V2, show product identity, invariants, then one bounded target section per prompt with its issue summary and restoration prompt. For V1, preserve the historical panel. Do not render raw JSON.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2, then the additional product-restore fixture tests listed in Files. Expected: PASS.

---

### Task 5: Cross-layer regression and root-cause documentation

**Files:**
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md`
- Test: product-restore and state/persistence suites.

- [ ] **Step 1: Run TypeScript and the complete targeted regression set**

Run:

```bash
npx tsc -b --pretty false
node --test src/modules/Retouch/productRestoreContract.test.mjs
node --experimental-strip-types --test \
  src/services/arkService.test.mjs \
  src/adapters/shellProductRestoreWorkflow.test.mjs \
  src/adapters/shellProductRestoreCancellation.test.mjs \
  src/adapters/shellControlJobLifecycle.test.mjs \
  src/adapters/shellDataAdapter.test.mjs \
  src/adapters/shellPersistence.test.mjs \
  src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs \
  src/shell/components/ProjectCard.productRestoreCredits.test.mjs
node --test server/appStateMerge.test.mjs
```

Expected: all PASS with no TypeScript errors.

- [ ] **Step 2: Run project gates**

Run:

```bash
npm run lint
npm run build
npm run doctor
```

Expected: lint has zero errors, Vite build succeeds, and doctor reports healthy frontend/backend/worker plus ready local managed image upload.

- [ ] **Step 3: Record the project-specific root cause**

Add a concise entry containing:

- Root cause: strict whole-string JSON parsing rejected a provider-owned `final_answer` tail; separately, the analysis/fanout contract had no target-addressable prompt identity.
- Fix: strict known-envelope extraction plus V2 target-index validation and stable material-ID mapping.
- Avoid next time: replay raw provider responses at the parser boundary and require one-to-one target coverage before paid fanout.

- [ ] **Step 4: Commit the implementation only after all automated gates pass**

Stage only files changed by this plan and commit with:

```bash
git commit -m "fix(retouch): generate product restore prompts per target"
```

Do not stage unrelated existing changes.

---

### Task 6: Real local one-target acceptance

**Files:**
- No production source changes unless a new failing test is first added for an observed code defect.
- Evidence: local job store, browser-rendered project, managed result asset, and image dimensions.

- [ ] **Step 1: Restart only stale local services after checking active jobs**

Confirm there are no running local jobs and compare process start time with the implementation commit/file mtimes. Restart the managed Vite/server services only if they are older than the code. Run `npm run doctor` afterward.

- [ ] **Step 2: Reuse the current persisted materials in the browser**

Open product restoration with the existing one target and three references. Confirm focus `材质与纹理`, requirement `主要还原沙发布的纹理以及质感`, GPT Image 2, and 2K. Do not upload replacements unless the persisted URLs are unreadable.

- [ ] **Step 3: Submit exactly one V2 batch**

Create one new product-restoration project. Capture the analysis job ID and assert the stored raw result parses as V2 with one target prompt mapped to the current target material ID. Assert no second analysis job exists.

- [ ] **Step 4: Verify exactly one image task**

Inspect the generated job payload and confirm one current target plus all three references, V2 idempotency key, and the target-specific prompt. Wait for a terminal result; do not automatically retry or create another paid image task.

- [ ] **Step 5: Verify durable media and dimensions**

Read the final managed asset, verify it is non-empty, inspect width/height, confirm at least the selected 2K tier, and compare the output aspect ratio with the source within normal provider rounding tolerance.

- [ ] **Step 6: Compare source, references, and result**

Visually inspect side by side for restored continuous herringbone texture, thicker soft pile, natural drape, olive-green color, and same-color fringe. Check that the three-step layout, Japanese text, number badges, background, furniture, people, camera view, crop, and composition were not intentionally redesigned and no reference-scene props were imported.

- [ ] **Step 7: Refresh and prove recovery without resubmission**

Refresh the local page. Confirm the completed project, V2 prompt mapping, and result remain visible and that analysis/image job counts do not increase.

- [ ] **Step 8: Report chain and quality separately**

Deliver IDs, statuses, prompt mapping, asset URL/path, dimensions, refresh evidence, and visual comparison. If technical flow succeeds but image quality misses a criterion, call that out explicitly and stop without a second paid attempt.

---

## Plan Self-Review

- Spec coverage: V2 schema, known-envelope parsing, target mapping, V1 compatibility, canonical persistence, retry, credits, tests, and one paid local acceptance are each assigned to a task.
- Type consistency: `ProductRestoreTargetPromptAnalysis` is the analysis-model shape; `ProductRestoreTargetPrompt` is the persisted shape with `targetMaterialId`; V1/V2 contexts are discriminated only by `version`.
- Safety: every invalid/missing mapping is rejected before provider submission; V1 fallback is limited to explicit historical contexts.
- Scope: no upload-limit, model-selection, resolution, ratio, cloud-deploy, or unrelated UI changes are included.
