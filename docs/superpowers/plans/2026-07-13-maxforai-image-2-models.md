# MaxForAI Image-2 Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不替换现有生图模型的前提下，让所有生图入口可选 `Image-2标准 / Image-2高 / Image-2超高`，通过 MaxForAI 服务端生成或编辑图片，本期不参与积分计费。

**Architecture:** 新增共享的 MaxForAI 模型/尺寸合同和独立服务端 adapter，内部仍复用 `kie_image` job 链，但 job provider 记为 `maxforai`。前端仅接触站内模型 ID，服务端转成上游模型名、准备素材、选择 Images API 端点并解析 `data[].url`。付费生成 POST 不做任何自动重提。

**Tech Stack:** React 19, TypeScript, Node.js ESM, Node built-in test runner, Vite, 现有 internal job/runtime/provider gateway, Bash/SSH 腾讯云发布链。

## Global Constraints

- 现有 `gpt-image-2`、`gpt-image-2-secondary` 和 `nano-banana-2` 的站内 ID、provider、积分、恢复和历史数据不变。
- 新前台名称精确为 `Image-2标准`、`Image-2高`、`Image-2超高`。
- 新站内 ID 精确为 `maxforai-image-2-standard`、`maxforai-image-2-pro`、`maxforai-image-2-max`。
- 上游模型精确为 `gpt-image-2`、`gpt-image-2-pro`、`gpt-image-2-max`。
- 新三档不展示、不预留、不扣除、不结算积分；不用积分字段临时存美元金额。
- 文生图使用 `POST /images/generations`，一张或多张参考图使用 `POST /images/edits`，每个 job 固定 `n: 1`。
- 不传 `background`、`input_fidelity` 或额外 `quality`。
- MaxForAI 付费生成 POST 以及智能体 `generate_image` 对新三档的调用都不自动重提。
- `MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS` 默认 `600000`，`MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS` 默认 `120000`，`MAXFORAI_ASSET_UPLOAD_CONCURRENCY` 默认 `3`。
- 真实密钥只存在未跟踪的 `.env.server` 和云上 `.env.server`，不出现在源码、构建产物、Git diff、日志或公开配置。
- 每个生产代码改动都要经历对应测试的 RED -> GREEN；完成前运行完整 `npm run verify`。
- 云发布前必须先完成 diff 审查，发布使用 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`。

---

## File Structure

- Create `src/utils/maxforaiImageModels.mjs`: 安全的共享模型定义、显示名、上游 ID 和 21 组 size 映射。
- Create `src/utils/maxforaiImageModels.test.mjs`: 模型与尺寸纯函数合同测试。
- Modify `src/types.ts`, `src/shell/types.ts`: 扩展 `KieAiModel` 联合类型。
- Modify `src/utils/modelQuality.ts`, `src/utils/modelCapabilities.mjs`: 三档选项、显示名、能力和比例；现有 `modelAspectRatio.ts` 自动消费 capability 结果，无需增加第二份比例列表。
- Modify `src/ShellMigratedApp.tsx`, `src/adapters/shellWorkflow.ts`, `src/modules/Retouch/retouchSizingUtils.mjs`, `src/modules/Translation/translationProcessingUtils.mjs`: 站内 ID/显示名归一和历史状态兼容。
- Modify `src/shell/components/layout/BottomInputBar.tsx`, `src/components/SettingsSidebar.tsx`, `src/modules/OneClick/ConfigSidebar.tsx`, `src/modules/OneClick/SkuSidebar.tsx`, `src/modules/Retouch/RetouchSidebar.tsx`, `src/modules/BuyerShow/BuyerShowSidebar.tsx`, `src/modules/AgentCenter/AgentCenterManager.tsx`: 所有可见生图选择器使用同一模型列表，六个选项可读换行。
- Create `src/utils/imageModelAvailability.test.mjs`: 每个生图入口都消费共享模型列表的源码合同。
- Modify `src/utils/imageBilling.mjs`, `src/utils/imageBilling.test.mjs`, `server/accountCredits.mjs`, `server/accountCredits.test.mjs`, `server/index.mjs`: 新三档前后端双层零积分。
- Create `server/providerMaxForAiImage.mjs`: MaxForAI 素材转链、生成/编辑请求、返回解析与错误映射。
- Create `server/providerMaxForAiImage.test.mjs`: provider adapter 行为测试。
- Modify `server/providerGateway.mjs`, `server/providerGateway.test.mjs`, `server/jobRuntime.mjs`, `server/jobRuntime.test.mjs`: provider 路由、就绪状态和智能体模型目录。
- Modify `src/services/kieAiService.ts`, `src/services/kieAiService.test.mjs`, `server/agentToolConversation.mjs`, `server/agentToolConversation.test.mjs`, `server/index.mjs`, `server/accountCreditsSource.test.mjs`: 通用 job 和智能体路由、无自动重提。
- Modify `.env.server.example`, `docs/project-overview.md`, `docs/tencent-cloud-deploy.md`, `server/envDocumentationSource.test.mjs`: 密钥占位和三个运行参数说明。

---

### Task 1: Shared model and size contract

**Files:**
- Create: `src/utils/maxforaiImageModels.mjs`
- Create: `src/utils/maxforaiImageModels.test.mjs`
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Modify: `src/utils/modelQuality.ts`
- Modify: `src/utils/modelCapabilities.mjs`

**Interfaces:**
- Produces: `MAXFORAI_IMAGE_MODEL_IDS`, `MAXFORAI_IMAGE_MODELS`, `isMaxForAiImageModel(value)`, `getMaxForAiImageModel(value)`, `resolveMaxForAiImageModelId(value)`, `resolveMaxForAiImageSize(aspectRatio, resolution)`.
- Consumed by: frontend selectors, billing, job routing and `server/providerMaxForAiImage.mjs`.

- [ ] **Step 1: Write the failing shared-contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAXFORAI_IMAGE_MODEL_IDS,
  getMaxForAiImageModel,
  resolveMaxForAiImageModelId,
  resolveMaxForAiImageSize,
} from './maxforaiImageModels.mjs';

test('MaxForAI exposes three collision-free site models', () => {
  assert.deepEqual(MAXFORAI_IMAGE_MODEL_IDS, [
    'maxforai-image-2-standard',
    'maxforai-image-2-pro',
    'maxforai-image-2-max',
  ]);
  assert.deepEqual(getMaxForAiImageModel('maxforai-image-2-pro'), {
    id: 'maxforai-image-2-pro', label: 'Image-2高', upstreamModel: 'gpt-image-2-pro',
  });
  assert.equal(resolveMaxForAiImageModelId('Image-2超高'), 'maxforai-image-2-max');
  assert.equal(resolveMaxForAiImageModelId('gpt-image-2'), '');
});

test('MaxForAI maps every documented ratio and resolution to an exact size', () => {
  const expected = {
    '1:1': ['1024x1024', '2048x2048', '2880x2880'],
    '16:9': ['1536x864', '2048x1152', '3840x2160'],
    '9:16': ['864x1536', '1152x2048', '2160x3840'],
    '4:3': ['1344x1008', '2048x1536', '3264x2448'],
    '3:4': ['1008x1344', '1536x2048', '2448x3264'],
    '3:2': ['1536x1024', '2016x1344', '3504x2336'],
    '2:3': ['1024x1536', '1344x2016', '2336x3504'],
  };
  for (const [ratio, sizes] of Object.entries(expected)) {
    ['1K', '2K', '4K'].forEach((resolution, index) => {
      assert.equal(resolveMaxForAiImageSize(ratio, resolution), sizes[index]);
    });
  }
  assert.equal(resolveMaxForAiImageSize('auto', '4K'), 'auto');
  assert.throws(() => resolveMaxForAiImageSize('4:5', '1K'), /MaxForAI 不支持的图片比例/);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test src/utils/maxforaiImageModels.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `maxforaiImageModels.mjs`.

- [ ] **Step 3: Implement the shared contract**

```js
export const MAXFORAI_IMAGE_MODELS = Object.freeze([
  { id: 'maxforai-image-2-standard', label: 'Image-2标准', upstreamModel: 'gpt-image-2' },
  { id: 'maxforai-image-2-pro', label: 'Image-2高', upstreamModel: 'gpt-image-2-pro' },
  { id: 'maxforai-image-2-max', label: 'Image-2超高', upstreamModel: 'gpt-image-2-max' },
]);

export const MAXFORAI_IMAGE_MODEL_IDS = Object.freeze(MAXFORAI_IMAGE_MODELS.map((item) => item.id));

const SIZE_TABLE = Object.freeze({
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
  '16:9': { '1K': '1536x864', '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '864x1536', '2K': '1152x2048', '4K': '2160x3840' },
  '4:3': { '1K': '1344x1008', '2K': '2048x1536', '4K': '3264x2448' },
  '3:4': { '1K': '1008x1344', '2K': '1536x2048', '4K': '2448x3264' },
  '3:2': { '1K': '1536x1024', '2K': '2016x1344', '4K': '3504x2336' },
  '2:3': { '1K': '1024x1536', '2K': '1344x2016', '4K': '2336x3504' },
});

export const isMaxForAiImageModel = (value = '') => MAXFORAI_IMAGE_MODEL_IDS.includes(String(value || '').trim());
export const getMaxForAiImageModel = (value = '') => MAXFORAI_IMAGE_MODELS.find((item) => item.id === String(value || '').trim()) || null;
export const resolveMaxForAiImageModelId = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  return MAXFORAI_IMAGE_MODELS.find((item) => item.id.toLowerCase() === normalized || item.label.toLowerCase() === normalized)?.id || '';
};
export const resolveMaxForAiImageSize = (aspectRatio = 'auto', resolution = '1K') => {
  const ratio = String(aspectRatio || 'auto').trim() || 'auto';
  if (ratio === 'auto') return 'auto';
  const size = SIZE_TABLE[ratio]?.[String(resolution || '1K').trim().toUpperCase()];
  if (!size) throw new Error(`MaxForAI 不支持的图片比例或分辨率: ${ratio}/${resolution}`);
  return size;
};
```

Extend both `KieAiModel` unions with the three IDs. Extend `SystemPublicConfig.providers` with optional `maxforai?: { configured: boolean }`. Append the IDs to `MODEL_OPTIONS`, delegate their labels to `getMaxForAiImageModel`, and add a MaxForAI capability branch with `maxInputImages: 16`, `supportsTransparentBackground: false`, `supportedAspectRatios: ['auto','1:1','16:9','9:16','4:3','3:4','3:2','2:3']`, and 10-minute polling text.

- [ ] **Step 4: Run contract and type tests and verify GREEN**

Run: `node --test src/utils/maxforaiImageModels.test.mjs && npx tsc --noEmit -p tsconfig.app.json`

Expected: all MaxForAI contract tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the contract**

```bash
git add src/utils/maxforaiImageModels.mjs src/utils/maxforaiImageModels.test.mjs src/types.ts src/shell/types.ts src/utils/modelQuality.ts src/utils/modelCapabilities.mjs
git commit -m "feat: define MaxForAI Image-2 model contract"
```

### Task 2: Every image selector and billing boundary

**Files:**
- Create: `src/utils/imageModelAvailability.test.mjs`
- Modify: `src/ShellMigratedApp.tsx`
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/modules/Retouch/retouchSizingUtils.mjs`
- Modify: `src/modules/Translation/translationProcessingUtils.mjs`
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/components/SettingsSidebar.tsx`
- Modify: `src/modules/OneClick/ConfigSidebar.tsx`
- Modify: `src/modules/OneClick/SkuSidebar.tsx`
- Modify: `src/modules/Retouch/RetouchSidebar.tsx`
- Modify: `src/modules/BuyerShow/BuyerShowSidebar.tsx`
- Modify: `src/modules/AgentCenter/AgentCenterManager.tsx`
- Modify: `src/utils/imageBilling.mjs`
- Modify: `src/utils/imageBilling.test.mjs`

**Interfaces:**
- Consumes: Task 1 model IDs, labels, `resolveMaxForAiImageModelId`, `isMaxForAiImageModel` and capabilities.
- Produces: all visible model selectors can persist the three site IDs; `estimateImageBilling` returns zero/unbilled for them.

- [ ] **Step 1: Write failing availability and frontend billing tests**

```js
test('all image model entry points consume the shared model list', () => {
  for (const file of [
    '../components/SettingsSidebar.tsx',
    '../modules/OneClick/ConfigSidebar.tsx',
    '../modules/OneClick/SkuSidebar.tsx',
    '../modules/Retouch/RetouchSidebar.tsx',
    '../modules/BuyerShow/BuyerShowSidebar.tsx',
  ]) {
    assert.match(read(file), /MODEL_OPTIONS\.map/);
  }
  assert.match(read('../shell/components/layout/BottomInputBar.tsx'), /IMAGE_MODEL_LABEL_OPTIONS/);
  assert.match(read('../modules/AgentCenter/AgentCenterManager.tsx'), /MAXFORAI_IMAGE_MODELS/);
});

test('MaxForAI image models are not billed as credits', () => {
  for (const model of ['maxforai-image-2-standard', 'maxforai-image-2-pro', 'maxforai-image-2-max']) {
    const estimate = estimateImageBilling({ module: 'one_click', params: { model, quality: '4K', count: '5' } });
    assert.equal(estimate.billable, false);
    assert.equal(estimate.unitCredits, 0);
    assert.equal(estimate.estimatedCredits, 0);
  }
});
```

Also assert `normalizeShellImageModel('Image-2高')` and shell workflow `toModel('Image-2超高')` preserve the exact site IDs instead of falling through to `gpt-image-2`.

- [ ] **Step 2: Run availability and billing tests and verify RED**

Run: `node --test src/utils/imageModelAvailability.test.mjs src/utils/imageBilling.test.mjs`

Expected: FAIL because the new labels are absent from shell/agent selectors and billing falls back to GPT Image 2 credits.

- [ ] **Step 3: Wire every selector to the shared list**

In `BottomInputBar.tsx` add:

```ts
import { MODEL_OPTIONS, getModelDisplayName } from '../../../utils/modelQuality';
const IMAGE_MODEL_LABEL_OPTIONS = MODEL_OPTIONS.map(getModelDisplayName);
```

Replace every repeated `['GPT Image 2', 'GPT Image 2（副）', 'Nano Banana 2']` option array with `IMAGE_MODEL_LABEL_OPTIONS`. Extend `fallbackImageModels` in Agent Center using `...MAXFORAI_IMAGE_MODELS.map(({ id, label }) => ({ id, label }))`.

In normalizers, resolve a MaxForAI ID/label first:

```ts
const maxForAiModel = resolveMaxForAiImageModelId(value);
if (maxForAiModel) return maxForAiModel;
```

Then retain the existing Nano/APIports/KIE branches unchanged. Replace Retouch's bespoke two-model ratio split with `getImageModelCapabilities(normalizedModel).supportedAspectRatios` so new model ratios remain exact. Add new IDs to translation's `SUPPORTED_RATIOS` through the shared capability list.

Change every button container that currently forces all models into one row to the exact class set `grid grid-cols-2 gap-2 xl:grid-cols-3`. Remove `flex-1` from the child model buttons while retaining their selected/recommended styling and the existing default model.

- [ ] **Step 4: Make frontend billing explicitly unbilled**

```js
const selectedModel = String(params.model || 'GPT Image 2').trim();
const unbilledProviderModel = Boolean(resolveMaxForAiImageModelId(selectedModel));
const billable = isImageBillingModule(module, subFeature) && !unbilledProviderModel;
```

Return the MaxForAI site ID as `model`, `unitCredits: 0`, and `estimatedCredits: 0`. Do not add zero-cost rows to the legacy credit table.

- [ ] **Step 5: Run focused UI/billing tests and verify GREEN**

Run: `node --test src/utils/imageModelAvailability.test.mjs src/utils/imageBilling.test.mjs src/shell/components/layout/BottomInputBar.test.mjs src/modules/Retouch/retouchSizingUtils.test.mjs && npx tsc --noEmit -p tsconfig.app.json`

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit selector and frontend billing coverage**

```bash
git add src/ShellMigratedApp.tsx src/adapters/shellWorkflow.ts src/modules/Retouch/retouchSizingUtils.mjs src/modules/Translation/translationProcessingUtils.mjs src/shell/components/layout/BottomInputBar.tsx src/components/SettingsSidebar.tsx src/modules/OneClick/ConfigSidebar.tsx src/modules/OneClick/SkuSidebar.tsx src/modules/Retouch/RetouchSidebar.tsx src/modules/BuyerShow/BuyerShowSidebar.tsx src/modules/AgentCenter/AgentCenterManager.tsx src/utils/imageBilling.mjs src/utils/imageBilling.test.mjs src/utils/imageModelAvailability.test.mjs
git commit -m "feat: expose Image-2 tiers across generation tools"
```

### Task 3: MaxForAI provider adapter

**Files:**
- Create: `server/providerMaxForAiImage.mjs`
- Create: `server/providerMaxForAiImage.test.mjs`

**Interfaces:**
- Consumes: Task 1 model and size helpers; dependency-injected `fetchWithTimeout`, `downloadRemoteProviderMediaUrl` and prompt URL rewriting.
- Produces: `runMaxForAiImageJob({ payload, env, signal, deps })` and `buildMaxForAiImageRequest({ payload, imageUrls, prompt })`.

- [ ] **Step 1: Write failing adapter request tests**

Test exact behaviors:

```js
test('builds generations for text-only and edits for references', () => {
  const generation = buildMaxForAiImageRequest({
    payload: { model: 'maxforai-image-2-standard', prompt: 'poster', aspectRatio: '1:1', resolution: '4K' },
    imageUrls: [], prompt: 'poster',
  });
  assert.equal(generation.path, '/images/generations');
  assert.deepEqual(generation.body, { model: 'gpt-image-2', prompt: 'poster', size: '2880x2880', n: 1 });

  const edit = buildMaxForAiImageRequest({
    payload: { model: 'maxforai-image-2-pro', prompt: 'edit', aspectRatio: '16:9', resolution: '2K' },
    imageUrls: ['https://a/image.png'], prompt: 'edit',
  });
  assert.equal(edit.path, '/images/edits');
  assert.deepEqual(edit.body.images, [{ image_url: 'https://a/image.png' }]);
  assert.equal(edit.body.model, 'gpt-image-2-pro');
  assert.equal(edit.body.size, '2048x1152');
  assert.equal(Object.hasOwn(edit.body, 'quality'), false);
});
```

Add tests that references are deduped/capped at 16, HTTPS URLs stay direct, non-HTTPS/data/managed URLs upload through `/assets` before generation, upload failure prevents the generation fetch, and `data[0].url` is the only accepted success output.

Add one-call-count assertions for 401/403, 429, 4xx, 5xx, empty 2xx, network error and timeout. Network/timeout must become `provider_submission_unknown`; complete invalid 2xx must become `provider_bad_response`; no case may submit the generation endpoint twice.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `node --test server/providerMaxForAiImage.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `providerMaxForAiImage.mjs`.

- [ ] **Step 3: Implement request building and error mapping**

The adapter must use this result shape and never synthesize a recoverable `providerTaskId`:

```js
return {
  providerStage: 'completed',
  providerStatus: 'success',
  result: {
    imageUrl,
    status: 'success',
    providerModel: definition.upstreamModel,
    provider: 'maxforai',
    requestCreatedAt: Number(data.created || 0),
  },
};
```

Resolve config using:

```js
const apiKey = String(env.MAXFORAI_API_KEY || '').trim();
const baseUrl = String(env.MAXFORAI_BASE_URL || 'https://maxforai.top/v1').trim().replace(/\/$/, '');
const requestTimeoutMs = positiveInt(env.MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS, 600_000);
const assetTimeoutMs = positiveInt(env.MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS, 120_000);
const assetConcurrency = positiveInt(env.MAXFORAI_ASSET_UPLOAD_CONCURRENCY, 3);
```

Prepare all images before the paid request. A public external HTTPS URL is direct. For data URLs, local/HTTP URLs and unavailable managed URLs, obtain `{ fileBuffer, mimeType, fileName }`, upload a `FormData` with field `file` to `${baseUrl}/assets`, and use the returned `url`. Use a bounded concurrency mapper with `assetConcurrency` and a per-request URL promise cache.

Call the paid endpoint with `maxRetries: 0` and non-idempotent semantics. Convert `provider_timeout` and pre-response network failure to `provider_submission_unknown`; preserve `request_cancelled`; map complete HTTP responses using the design error table.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run: `node --test server/providerMaxForAiImage.test.mjs`

Expected: all adapter tests PASS with one paid POST attempt per test.

- [ ] **Step 5: Commit the adapter**

```bash
git add server/providerMaxForAiImage.mjs server/providerMaxForAiImage.test.mjs
git commit -m "feat: add MaxForAI image provider adapter"
```

### Task 4: Runtime routing, zero credits and no-retry agent paths

**Files:**
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `server/accountCredits.mjs`
- Modify: `server/accountCredits.test.mjs`
- Modify: `server/accountCreditsSource.test.mjs`
- Modify: `src/services/kieAiService.ts`
- Modify: `src/services/kieAiService.test.mjs`
- Modify: `server/agentToolConversation.mjs`
- Modify: `server/agentToolConversation.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Consumes: Task 1 `isMaxForAiImageModel`, Task 3 `runMaxForAiImageJob`.
- Produces: common jobs record `provider=maxforai`, route once to the adapter, reserve zero credits, and disable agent image transient retries for these models.

- [ ] **Step 1: Write failing runtime routing tests**

Add provider gateway assertions that all three site IDs route to MaxForAI, the adapter receives the unchanged site ID, `getProviderConfigStatus({ MAXFORAI_API_KEY: 'secret' }).maxforai === true`, and existing KIE/APIports tests keep their original calls.

Add public config assertions:

```js
const config = buildPublicSystemConfig({ MAXFORAI_API_KEY: 'top-secret' }, { queued: 0, running: 0 });
assert.deepEqual(config.providers.maxforai, { configured: true });
assert.equal(JSON.stringify(config).includes('top-secret'), false);
assert.equal(config.agentModels.image.some((item) => item.id === 'maxforai-image-2-max'), true);
```

- [ ] **Step 2: Write failing server credit tests**

```js
for (const model of MAXFORAI_IMAGE_MODEL_IDS) {
  assert.equal(estimateCreditReservation({
    taskType: 'kie_image', provider: 'maxforai', payload: { model, outputCount: 10 },
  }), 0);
  assert.equal(estimateCreditReservation({
    taskType: 'agent_image', provider: 'maxforai', payload: { model, outputCount: 1 },
  }), 0);
}
assert.equal(estimateCreditReservation({
  taskType: 'kie_image', provider: 'kie', payload: { model: 'gpt-image-2', outputCount: 1 },
}), 3);
```

Update source tests to require agent credit reservation helpers to accept `model`, pass it into `payload`, and choose `provider: isMaxForAiImageModel(model) ? 'maxforai' : 'kie'`.

- [ ] **Step 3: Write failing common-job and agent no-retry tests**

Assert `processWithKieAi` derives:

```ts
const usesMaxForAi = isMaxForAiImageModel(moduleConfig.model);
provider: usesMaxForAi ? 'maxforai' : 'kie';
maxRetries: usesMaxForAi ? 0 : 2;
```

Assert its new models pass raw `1K/2K/4K` instead of KIE's `normalizeGptImage2Resolution` clamp.

Export or test `getImageGenerateRetryBudget(selectedImageModel, env)` so MaxForAI returns `0` and existing models retain `AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES`.

- [ ] **Step 4: Run the new tests and verify RED**

Run: `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/accountCredits.test.mjs server/accountCreditsSource.test.mjs src/services/kieAiService.test.mjs server/agentToolConversation.test.mjs`

Expected: FAIL on missing MaxForAI provider/readiness branches, nonzero credit estimates, `provider: 'kie'`, `maxRetries: 2`, and agent retry budget `1`.

- [ ] **Step 5: Implement provider routing and readiness**

In `providerGateway.mjs`, include MaxForAI env fields in `getProviderEnv`, route `isMaxForAiImageModel(payload.model)` before APIports/KIE, and expose `maxforai` readiness. Pass dependencies for HTTP timeout, safe remote media download and text URL rewriting into the adapter.

In `jobRuntime.mjs`, add the three models to `AGENT_MODEL_CATALOG.image` with `provider: 'maxforai'`, 16 inputs, image edit enabled, `defaultResolution: '1K'` and exact supported ratios. Public config exposes only `{ configured: Boolean(...) }`.

- [ ] **Step 6: Implement common-job routing and zero credits**

In `kieAiService.ts`, compute `usesMaxForAi` once and use it for provider, retries, resolution and timeout. Apply the existing GPT Image cleanup suffix to the new family without changing logo-replace's skip behavior.

In `accountCredits.mjs`, check the selected model before task type/provider defaults:

```js
const selectedModel = String(payload.model || payload.selectedImageModel || payload.multimodalModel || '').trim();
if (isMaxForAiImageModel(selectedModel)) return 0;
```

In `server/index.mjs`, pass `model` through both DB and local agent reservation helpers and label their provider consistently. A null reservation remains a normal no-op through settle/release.

- [ ] **Step 7: Disable agent retry for MaxForAI only**

```js
const getImageGenerateRetryBudget = (selectedImageModel, env = process.env) => (
  isMaxForAiImageModel(selectedImageModel) ? 0 : getImageGenerateTransientMaxRetries(env)
);
```

Pass this budget into every `generateImageWithTransientRetry` call. Direct agent `executeProviderJob` calls continue to route by `payload.model`; they must not attach a synthetic provider task checkpoint for a MaxForAI response.

- [ ] **Step 8: Run runtime, credit and retry tests and verify GREEN**

Run: `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/accountCredits.test.mjs server/accountCreditsSource.test.mjs src/services/kieAiService.test.mjs server/agentToolConversation.test.mjs`

Expected: all selected tests PASS, including the existing provider and credit regression cases.

- [ ] **Step 9: Commit runtime integration**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs server/jobRuntime.mjs server/jobRuntime.test.mjs server/accountCredits.mjs server/accountCredits.test.mjs server/accountCreditsSource.test.mjs src/services/kieAiService.ts src/services/kieAiService.test.mjs server/agentToolConversation.mjs server/agentToolConversation.test.mjs server/index.mjs
git commit -m "feat: route MaxForAI image jobs safely"
```

### Task 5: Environment documentation and secret boundary

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `server/envDocumentationSource.test.mjs`
- Modify locally only: `.env.server`

**Interfaces:**
- Consumes: Task 3 environment names and defaults.
- Produces: documented, deployable server configuration without tracked secrets.

- [ ] **Step 1: Write failing environment documentation test**

```js
for (const source of [envExample, projectOverview, deployDoc]) {
  assert.match(source, /MAXFORAI_API_KEY/);
  assert.match(source, /MAXFORAI_BASE_URL/);
  assert.match(source, /MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS/);
  assert.match(source, /MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS/);
  assert.match(source, /MAXFORAI_ASSET_UPLOAD_CONCURRENCY/);
}
assert.doesNotMatch(envExample, /MAXFORAI_API_KEY=sk-/);
```

- [ ] **Step 2: Run documentation test and verify RED**

Run: `node --test server/envDocumentationSource.test.mjs`

Expected: FAIL because MaxForAI variables are not documented.

- [ ] **Step 3: Add placeholders and conservative defaults**

Add exactly:

```dotenv
MAXFORAI_API_KEY=
MAXFORAI_BASE_URL=https://maxforai.top/v1
MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS=600000
MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS=120000
MAXFORAI_ASSET_UPLOAD_CONCURRENCY=3
```

Describe that generation POST is never auto-retried, the key is server-only, and cloud `.env.server` must be updated before deployment. Write the provided real token only into ignored local `.env.server`; do not print it.

- [ ] **Step 4: Run documentation and secret scans and verify GREEN**

Run: `node --test server/envDocumentationSource.test.mjs && git diff --check && ! git diff | rg 'sk-[A-Za-z0-9]{16,}'`

Expected: documentation test PASS, diff check exits 0, and tracked diff contains no key.

- [ ] **Step 5: Commit documentation**

```bash
git add .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md server/envDocumentationSource.test.mjs
git commit -m "docs: configure MaxForAI image provider"
```

### Task 6: Full verification, real paid smoke, review and cloud release

**Files:**
- Verify only: all changed files from Tasks 1-5
- Local ignored config: `.env.server`
- Remote preserved config: `/www/wwwroot/meiao-internal/.env.server`

**Interfaces:**
- Consumes: complete implementation and the user-provided token.
- Produces: fresh local evidence, one real Image-2标准 image, reviewed commits, GitHub push, cloud deployment and health/resource verification.

- [ ] **Step 1: Run Hermes changed-file gate**

Run: `node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed $(git diff --name-only 2aa0750..HEAD)`

Expected: bridge OK; every finding is either fixed or explicitly proven irrelevant before deployment.

- [ ] **Step 2: Run focused provider and availability verification**

Run:

```bash
node --test \
  src/utils/maxforaiImageModels.test.mjs \
  src/utils/imageModelAvailability.test.mjs \
  src/utils/imageBilling.test.mjs \
  server/providerMaxForAiImage.test.mjs \
  server/providerGateway.test.mjs \
  server/jobRuntime.test.mjs \
  server/accountCredits.test.mjs \
  server/accountCreditsSource.test.mjs \
  server/agentToolConversation.test.mjs \
  src/services/kieAiService.test.mjs \
  server/envDocumentationSource.test.mjs
```

Expected: 0 failures.

- [ ] **Step 3: Run full project verification**

Run: `npm run verify`

Expected: lint/typecheck, all test suites and production build exit 0.

- [ ] **Step 4: Restart the local current-version services and verify runtime identity**

Run: `npm run local` and then `npm run doctor`.

Expected: frontend 3000 and backend 3100 point at the current repository; `/api/health` reports `worker.healthy: true`; provider readiness shows MaxForAI configured without exposing the key.

- [ ] **Step 5: Perform one real paid Image-2标准 smoke through the internal job API**

Use the existing local admin credentials from `.env.server` without printing them. Login, snapshot `/api/auth/me`, create one job with:

```json
{
  "module": "one_click",
  "taskType": "kie_image",
  "provider": "maxforai",
  "payload": {
    "model": "maxforai-image-2-standard",
    "prompt": "一个简洁的蓝白色电商产品背景，无文字，干净棚拍光线",
    "aspectRatio": "1:1",
    "resolution": "1K"
  },
  "maxRetries": 0
}
```

Poll that job only. Expected: `status=succeeded`, `provider=maxforai`, exactly one nonempty persisted `imageUrl`, no provider resubmission, and the account's `creditBalance`, `creditReserved`, and `creditConsumed` snapshots are unchanged. Fetch the returned image URL and verify HTTP 200, image MIME type, and nonzero bytes. Do not call Pro or Max.

- [ ] **Step 6: Review the complete diff before release**

Run:

```bash
git status --short
git diff 2aa0750..HEAD --check
git diff 2aa0750..HEAD --stat
git diff 2aa0750..HEAD -- . ':!package-lock.json'
```

Review specifically: model IDs/display labels, all selector entry points, secret absence, zero-credit branches, provider URL construction, asset limits, no-retry paths, user isolation, logging fields, output persistence, and unchanged legacy provider behavior.

- [ ] **Step 7: Confirm tracked state and push reviewed commits**

Run: `git status --short && git log --oneline 2aa0750..HEAD && git push origin feat/stability-phase2`

Expected: clean tracked worktree, intentional commits only, push succeeds.

- [ ] **Step 8: Back up and update the remote provider environment without printing secrets**

Pipe only the five local `MAXFORAI_*` assignments over SSH. On the server, back up `.env.server` with a timestamp, replace those five keys atomically in a temporary file with mode 600, and validate that all five keys are present and `MAXFORAI_API_KEY` is nonempty. The validation output prints only `MAXFORAI configured=true/false`, never values.

```bash
awk '/^MAXFORAI_(API_KEY|BASE_URL|IMAGE_REQUEST_TIMEOUT_MS|ASSET_UPLOAD_TIMEOUT_MS|ASSET_UPLOAD_CONCURRENCY)=/' .env.server |
ssh -o IdentitiesOnly=yes -i "${MEIAO_SSH_KEY:-$HOME/.ssh/MEIAO.pem}" root@111.229.66.247 '
  set -euo pipefail
  cd /www/wwwroot/meiao-internal
  umask 077
  backup=".env.server.maxforai.$(date +%Y%m%d%H%M%S).bak"
  cp .env.server "$backup"
  incoming=$(mktemp)
  output=$(mktemp)
  trap '\''rm -f "$incoming" "$output"'\'' EXIT
  cat > "$incoming"
  awk -F= '\''
    NR == FNR { replacement[$1] = $0; next }
    ($1 in replacement) { print replacement[$1]; written[$1] = 1; next }
    { print }
    END { for (key in replacement) if (!written[key]) print replacement[key] }
  '\'' "$incoming" .env.server > "$output"
  test "$(awk -F= '\''$1 == "MAXFORAI_API_KEY" && length($2) > 0 { print "yes" }'\'' "$output")" = yes
  chmod 600 "$output"
  mv "$output" .env.server
  output=""
  echo "MAXFORAI configured=true"
'
```

- [ ] **Step 9: Deploy through the guarded Tencent script**

Run: `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`

Expected: remote mutex/readiness passes, build succeeds, PM2 restarts, drain marker clears, and the script exits 0.

- [ ] **Step 10: Verify cloud health and active resource chain**

Run fresh checks against `http://meiaoyuntai.com/api/health`, remote PM2 status/log tail, remote MaxForAI configured boolean, and `index.html -> assets/index-*.js -> ShellMigratedApp-*.js` active chunks. Verify the three labels exist in the active frontend asset, no secret appears in any served asset, and legacy health signals remain healthy.

- [ ] **Step 11: Record final evidence**

Report: implementation commit list, pushed branch, one paid smoke job ID and redacted result URL host, output byte count/MIME, unchanged credit snapshots, `npm run verify` counts, deploy exit status, cloud health/worker status, active asset chain and remaining risk that Pro/Max were contract-tested but not paid-smoked.
