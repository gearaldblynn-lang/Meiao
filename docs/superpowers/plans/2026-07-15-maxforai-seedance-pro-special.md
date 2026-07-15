# MaxForAI Seedance 2.0 Pro 特价 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在短视频“全能参考”中默认提供 `Seedance 2.0 Pro 特价`，以 `0.5元/秒` 展示价格，并通过 MaxForAI `sora-v9-pro` 完成安全的异步视频创建、恢复、托管和腾讯云发布。

**Architecture:** 共享模型合同负责前后端一致的 ID、能力和展示价格；直接视频工作流创建独立 `maxforai_video / maxforai` job；服务端独立 adapter 负责素材转链、零重提创建、task ID checkpoint、GET 轮询和恢复。现有 KIE Seedance 与即梦 CLI 保持原样，成功结果继续通过现有 `persistJobOutputAssetsIfEnabled` 落为梅奥托管视频。

**Tech Stack:** React 19, TypeScript, Node.js ESM, Node built-in test runner, Vite, internal job/runtime/provider gateway, Temporal, Bash/SSH 腾讯云发布链。

## Global Constraints

- 规格单一真相：`docs/superpowers/specs/2026-07-15-maxforai-seedance-pro-special-design.md`。
- 前台名称精确为 `Seedance 2.0 Pro 特价`；站内 ID 为 `maxforai-sora-v9-pro`；上游模型固定为 `sora-v9-pro`。
- 新模型只出现在“全能参考”，默认选中并显示“推荐”和 `0.5元/秒`；首尾帧和智能多帧继续走现有通道。
- 时长只允许 4–15 秒整数，默认 4 秒；比例只允许 `16:9 / 9:16 / 1:1`；输出固定 720p。
- 图片最多 9 张；视频最多 3 个且合计不超过 15 秒；音频最多 3 个且合计不超过 15 秒。
- `0.5元/秒` 只是展示价格；不预留、不扣除、不结算站内积分，不把人民币金额写进 `creditsConsumed`。
- 付费 `POST /videos` 永不自动重提；网络状态不明进入 `provider_submission_unknown`。素材上传发生在付费创建前，可有限重试。
- 真实令牌只写未跟踪 `.env.server` 和云上 `.env.server`，不得进入源码、测试、Git diff、日志、公开配置或前端构建。
- 容量、超时、并发全部使用 env + 保守默认；本次新增 7 个 `MAXFORAI_VIDEO_*` 配置并同步示例和部署文档。
- 生产代码按 RED → GREEN 实施；发布前做完整 diff 审查，等待任务排空，不使用 active-job override。
- 腾讯云只做一次 4 秒、16:9、无参考素材的真实 canary；创建状态不明时不得提交第二次。

---

## File Structure

- Create `src/utils/maxforaiVideoModels.mjs`: 唯一的视频模型、能力、价格和参数归一合同。
- Create `src/utils/maxforaiVideoModels.test.mjs`: 合同与纯函数行为测试。
- Modify `src/shell/components/layout/BottomInputBar.tsx`: 默认/推荐模型、动态模式能力、价格与预计金额。
- Modify `src/shell/components/layout/BottomInputBar.test.mjs`: 可见文案和选择行为源码门禁。
- Modify `src/adapters/shellWorkflow.ts`: 选择独立 task type/provider，并允许 MaxForAI 文生视频。
- Modify `src/components/uiArchitecture.test.mjs`: 视频工作流路由与零重提源码合同。
- Create `server/providerMaxForAiVideo.mjs`: 素材转链、创建、轮询、恢复和错误映射。
- Create `server/providerMaxForAiVideo.test.mjs`: adapter 行为合同。
- Modify `server/providerGateway.mjs`, `server/providerGateway.test.mjs`: 新任务路由、恢复和配置状态。
- Modify `server/jobSubmissionPolicy.mjs`, `server/jobSubmissionPolicy.test.mjs`: provider 白名单、视频权限、去重和恢复合同。
- Modify `server/accountCredits.test.mjs`: MaxForAI 视频零积分门禁。
- Modify `server/jobRuntime.mjs`, `server/jobRuntime.test.mjs`: 公开 configured 状态。
- Modify `server/index.mjs`, `server/jobLoggingBehavior.test.mjs`: 视频完成统计 task type。
- Modify `server/jobRecoveryService.test.mjs`, `server/temporalWorker.test.mjs`: provider task ID 恢复与单次 activity 合同。
- Modify `src/types.ts`, `src/shell/types.ts`: 公开 provider 配置和视频 provider 类型。
- Modify `.env.server.example`, `docs/tencent-cloud-deploy.md`, `docs/project-overview.md`。
- Modify `server/maxforaiEnvDocs.test.mjs`: 配置与文档无密钥门禁。

### Task 1: Shared MaxForAI video model contract

**Files:**
- Create: `src/utils/maxforaiVideoModels.mjs`
- Create: `src/utils/maxforaiVideoModels.test.mjs`

**Interfaces:**
- Produces: `MAXFORAI_VIDEO_MODEL`, `MAXFORAI_VIDEO_MODEL_ID`, `isMaxForAiVideoModel(value)`, `normalizeMaxForAiVideoSeconds(value)`, `normalizeMaxForAiVideoAspectRatio(value)`, `formatMaxForAiVideoPrice(seconds)`, `assertMaxForAiVideoMediaContract(input)`.
- Consumed by: `BottomInputBar.tsx`, `shellWorkflow.ts`, `providerMaxForAiVideo.mjs`.

- [ ] **Step 1: Write the failing contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAXFORAI_VIDEO_MODEL,
  MAXFORAI_VIDEO_MODEL_ID,
  assertMaxForAiVideoMediaContract,
  formatMaxForAiVideoPrice,
  isMaxForAiVideoModel,
  normalizeMaxForAiVideoAspectRatio,
  normalizeMaxForAiVideoSeconds,
} from './maxforaiVideoModels.mjs';

test('defines the MaxForAI video model without exposing upstream identity as display copy', () => {
  assert.equal(MAXFORAI_VIDEO_MODEL_ID, 'maxforai-sora-v9-pro');
  assert.deepEqual(MAXFORAI_VIDEO_MODEL, {
    id: 'maxforai-sora-v9-pro',
    label: 'Seedance 2.0 Pro 特价',
    upstreamModel: 'sora-v9-pro',
    provider: 'maxforai',
    taskType: 'maxforai_video',
    displayPriceCnyPerSecond: 0.5,
    supportedModes: ['multimodal2video'],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    minSeconds: 4,
    maxSeconds: 15,
    defaultSeconds: 4,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    maxVideoDurationSeconds: 15,
    maxAudioDurationSeconds: 15,
    resolution: '720p',
  });
  assert.equal(isMaxForAiVideoModel('maxforai-sora-v9-pro'), true);
  assert.equal(isMaxForAiVideoModel('sora-v9-pro'), false);
});

test('normalizes seconds, ratios and display totals conservatively', () => {
  assert.equal(normalizeMaxForAiVideoSeconds('4秒'), 4);
  assert.equal(normalizeMaxForAiVideoSeconds('15'), 15);
  assert.equal(normalizeMaxForAiVideoSeconds('16秒'), 4);
  assert.equal(normalizeMaxForAiVideoAspectRatio('9:16'), '9:16');
  assert.equal(normalizeMaxForAiVideoAspectRatio('4:3'), '16:9');
  assert.equal(formatMaxForAiVideoPrice(4), '2.00');
  assert.equal(formatMaxForAiVideoPrice(15), '7.50');
});

test('rejects media counts and known duration totals before paid submission', () => {
  assert.doesNotThrow(() => assertMaxForAiVideoMediaContract({
    imageUrls: Array(9).fill('https://cdn.test/image.png'),
    videoUrls: Array(3).fill('https://cdn.test/video.mp4'),
    audioUrls: Array(3).fill('https://cdn.test/audio.wav'),
    videoDurations: [5, 5, 5],
    audioDurations: [4, 5, 6],
  }));
  assert.throws(() => assertMaxForAiVideoMediaContract({ imageUrls: Array(10).fill('x') }), /图片最多 9 张/);
  assert.throws(() => assertMaxForAiVideoMediaContract({ videoUrls: Array(4).fill('x') }), /视频最多 3 个/);
  assert.throws(() => assertMaxForAiVideoMediaContract({ audioUrls: Array(4).fill('x') }), /音频最多 3 个/);
  assert.throws(() => assertMaxForAiVideoMediaContract({ videoUrls: ['a', 'b'], videoDurations: [8, 8] }), /视频合计时长不能超过 15 秒/);
  assert.throws(() => assertMaxForAiVideoMediaContract({ audioUrls: ['a', 'b'], audioDurations: [9, 7] }), /音频合计时长不能超过 15 秒/);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node --test src/utils/maxforaiVideoModels.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `maxforaiVideoModels.mjs`.

- [ ] **Step 3: Implement the shared contract**

```js
export const MAXFORAI_VIDEO_MODEL = Object.freeze({
  id: 'maxforai-sora-v9-pro',
  label: 'Seedance 2.0 Pro 特价',
  upstreamModel: 'sora-v9-pro',
  provider: 'maxforai',
  taskType: 'maxforai_video',
  displayPriceCnyPerSecond: 0.5,
  supportedModes: Object.freeze(['multimodal2video']),
  supportedAspectRatios: Object.freeze(['16:9', '9:16', '1:1']),
  minSeconds: 4,
  maxSeconds: 15,
  defaultSeconds: 4,
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxVideoDurationSeconds: 15,
  maxAudioDurationSeconds: 15,
  resolution: '720p',
});

export const MAXFORAI_VIDEO_MODEL_ID = MAXFORAI_VIDEO_MODEL.id;
export const isMaxForAiVideoModel = (value = '') => String(value || '').trim() === MAXFORAI_VIDEO_MODEL_ID;

export const normalizeMaxForAiVideoSeconds = (value) => {
  const parsed = Number.parseInt(String(value ?? '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(parsed)
    && parsed >= MAXFORAI_VIDEO_MODEL.minSeconds
    && parsed <= MAXFORAI_VIDEO_MODEL.maxSeconds
    ? parsed
    : MAXFORAI_VIDEO_MODEL.defaultSeconds;
};

export const normalizeMaxForAiVideoAspectRatio = (value) => {
  const ratio = String(value || '').trim();
  return MAXFORAI_VIDEO_MODEL.supportedAspectRatios.includes(ratio) ? ratio : '16:9';
};

export const formatMaxForAiVideoPrice = (seconds) => (
  normalizeMaxForAiVideoSeconds(seconds) * MAXFORAI_VIDEO_MODEL.displayPriceCnyPerSecond
).toFixed(2);

const sumKnownDurations = (items = []) => items.reduce((sum, value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? sum + parsed : sum;
}, 0);

export const assertMaxForAiVideoMediaContract = ({
  imageUrls = [], videoUrls = [], audioUrls = [], videoDurations = [], audioDurations = [],
} = {}) => {
  if (imageUrls.length > MAXFORAI_VIDEO_MODEL.maxImages) throw new Error('Seedance 2.0 Pro 特价参考图片最多 9 张。');
  if (videoUrls.length > MAXFORAI_VIDEO_MODEL.maxVideos) throw new Error('Seedance 2.0 Pro 特价参考视频最多 3 个。');
  if (audioUrls.length > MAXFORAI_VIDEO_MODEL.maxAudios) throw new Error('Seedance 2.0 Pro 特价参考音频最多 3 个。');
  if (sumKnownDurations(videoDurations) > MAXFORAI_VIDEO_MODEL.maxVideoDurationSeconds) throw new Error('Seedance 2.0 Pro 特价参考视频合计时长不能超过 15 秒。');
  if (sumKnownDurations(audioDurations) > MAXFORAI_VIDEO_MODEL.maxAudioDurationSeconds) throw new Error('Seedance 2.0 Pro 特价参考音频合计时长不能超过 15 秒。');
};
```

- [ ] **Step 4: Run the contract tests and verify GREEN**

Run: `node --test src/utils/maxforaiVideoModels.test.mjs`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit the shared contract**

```bash
git add src/utils/maxforaiVideoModels.mjs src/utils/maxforaiVideoModels.test.mjs
git commit -m "feat: define MaxForAI video model contract"
```

### Task 2: Default, recommended and priced video UI

**Files:**
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/shell/components/layout/BottomInputBar.test.mjs`

**Interfaces:**
- Consumes: Task 1 model contract and price formatter.
- Produces: model selection helpers preserve `maxforai-sora-v9-pro`; MaxForAI is the fresh full-reference default and exposes a non-credit CNY hint.

- [ ] **Step 1: Extend the source contract test and verify the new copy/behavior is absent**

Add these assertions to the existing video generation test:

```js
assert.match(bottomInputBar, /MAXFORAI_VIDEO_MODEL_ID/);
assert.match(bottomInputBar, /Seedance 2\.0 Pro 特价/);
assert.match(bottomInputBar, /0\.5元\/秒/);
assert.match(bottomInputBar, /formatMaxForAiVideoPrice/);
assert.match(bottomInputBar, /recommendedValue: MAXFORAI_VIDEO_MODEL_ID/);
assert.match(bottomInputBar, /defaultValue: MAXFORAI_VIDEO_MODEL_ID/);
assert.match(bottomInputBar, /预计\$\{formatMaxForAiVideoPrice\(seconds\)\}元/);
assert.match(bottomInputBar, /mode === 'multimodal2video'/);
assert.match(bottomInputBar, /MAXFORAI_VIDEO_MODEL_ID, label: MAXFORAI_VIDEO_MODEL\.label/);
```

Run: `node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs --test-name-pattern "video generation exposes"`
Expected: FAIL because the MaxForAI model and price are absent.

- [ ] **Step 2: Import the shared model and make model selection mode-aware**

```ts
import {
  MAXFORAI_VIDEO_MODEL,
  MAXFORAI_VIDEO_MODEL_ID,
  formatMaxForAiVideoPrice,
  isMaxForAiVideoModel,
  normalizeMaxForAiVideoSeconds,
} from '../../../utils/maxforaiVideoModels.mjs';

const MAXFORAI_VIDEO_OPTION = {
  value: MAXFORAI_VIDEO_MODEL_ID,
  label: MAXFORAI_VIDEO_MODEL.label,
};

const SEEDANCE_VIDEO_MODEL_OPTIONS = [
  MAXFORAI_VIDEO_OPTION,
  { value: SEEDANCE_API_MODEL_VALUE, label: 'Seedance 2.0 Fast · API' },
  { value: DREAMINA_CLI_MODEL_VALUE, label: 'Seedance 2.0 Fast VIP · CLI' },
];

const getSeedanceVideoModelValue = (mode: string, value?: string) => {
  if (mode === 'multiframe2video') return DREAMINA_CLI_MODEL_VALUE;
  const selected = String(value || '').trim();
  if (mode === 'multimodal2video' && isMaxForAiVideoModel(selected)) return MAXFORAI_VIDEO_MODEL_ID;
  if (selected === DREAMINA_CLI_MODEL_VALUE) return DREAMINA_CLI_MODEL_VALUE;
  return mode === 'multimodal2video' && !selected ? MAXFORAI_VIDEO_MODEL_ID : SEEDANCE_API_MODEL_VALUE;
};

const getSeedanceVideoAccessMode = (mode: string, value?: string) => {
  const selected = getSeedanceVideoModelValue(mode, value);
  if (selected === DREAMINA_CLI_MODEL_VALUE) return 'cli';
  if (selected === MAXFORAI_VIDEO_MODEL_ID) return 'maxforai';
  return 'api';
};
```

- [ ] **Step 3: Make quick parameters reflect the selected provider**

For `multimodal2video`, use all 3 model options; for `frames2video`, remove MaxForAI; for `multiframe2video`, keep CLI only. When MaxForAI is selected, use 4–15 second options, hide the resolution selector and expose only the 3 supported ratios.

```ts
const isMaxForAiMode = selectedModel === MAXFORAI_VIDEO_MODEL_ID;
const durationOptions = isMaxForAiMode
  ? Array.from({ length: 12 }, (_, index) => `${index + 4}秒`)
  : mode === 'multiframe2video' ? DREAMINA_MULTIFRAME_DURATION_OPTIONS : DREAMINA_DURATION_OPTIONS;
const videoModelOptions = mode === 'multiframe2video'
  ? DREAMINA_CLI_MODEL_OPTIONS
  : mode === 'frames2video'
    ? SEEDANCE_VIDEO_MODEL_OPTIONS.filter((item) => item.value !== MAXFORAI_VIDEO_MODEL_ID)
    : SEEDANCE_VIDEO_MODEL_OPTIONS;

const modelParam: ParamItem = {
  key: 'modelVersion',
  label: isMaxForAiMode ? MAXFORAI_VIDEO_MODEL.label : isApiMode ? 'Seedance 2.0 Fast · API' : 'Seedance 2.0 Fast VIP · CLI',
  title: 'AI 模型',
  icon: <Monitor size={12} />,
  options: videoModelOptions,
  defaultValue: mode === 'multimodal2video' ? MAXFORAI_VIDEO_MODEL_ID : mode === 'multiframe2video' ? DREAMINA_CLI_MODEL_VALUE : SEEDANCE_API_MODEL_VALUE,
  recommendedValue: mode === 'multimodal2video' ? MAXFORAI_VIDEO_MODEL_ID : mode === 'multiframe2video' ? DREAMINA_CLI_MODEL_VALUE : SEEDANCE_API_MODEL_VALUE,
  recommendedLabel: mode === 'multiframe2video' ? '仅支持' : '推荐',
};
```

Pass `getOptionMeta={(value) => value === MAXFORAI_VIDEO_MODEL_ID ? '0.5元/秒' : undefined}` only to the video model selector. Reuse the existing `CompactSelect` option metadata rendering rather than adding a second popover.

- [ ] **Step 4: Add the CNY hint without making it a credit estimate**

```ts
const getDreaminaCreditHint = (params: Record<string, string>) => {
  const mode = normalizeDreaminaUiMode(params.dreaminaMode);
  const seconds = parseDreaminaSeconds(params.duration, 4);
  const accessMode = getSeedanceVideoAccessMode(mode, params.modelVersion);
  if (accessMode === 'maxforai') {
    return `${MAXFORAI_VIDEO_MODEL.label} · 0.5元/秒 · ${normalizeMaxForAiVideoSeconds(seconds)}秒 · 预计${formatMaxForAiVideoPrice(seconds)}元`;
  }
  const resolution = params.videoResolution === '480p' ? '480p' : '720p';
  if (accessMode === 'api') return `Seedance 2.0 Fast · ${seconds} 秒 · ${resolution}，提交前显示预计积分，完成后按 KIE 真实扣费记录。`;
  if (mode === 'multiframe2video') return `单段 ${seconds} 秒，Seedance 2.0 Fast VIP，积分以即梦实际扣费为准。`;
  return `Seedance 2.0 Fast VIP · ${seconds} 秒，积分以即梦实际扣费为准。`;
};
```

Ensure `estimateSeedanceFastBilling` receives `accessMode` and returns `{ billable: false, estimatedCredits: 0 }` for both `cli` and `maxforai`.

- [ ] **Step 5: Run focused UI tests and typecheck**

Run: `node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs --test-name-pattern "video generation exposes" && npx tsc --noEmit -p tsconfig.app.json`
Expected: focused test PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the UI behavior**

```bash
git add src/shell/components/layout/BottomInputBar.tsx src/shell/components/layout/BottomInputBar.test.mjs
git commit -m "feat: recommend priced MaxForAI video model"
```

### Task 3: Direct-video workflow routing and policy

**Files:**
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/components/uiArchitecture.test.mjs`
- Modify: `server/jobSubmissionPolicy.mjs`
- Modify: `server/jobSubmissionPolicy.test.mjs`
- Modify: `server/accountCredits.test.mjs`

**Interfaces:**
- Consumes: Task 1 model ID and normalizers.
- Produces: `runShellVideoGeneration` creates `{ taskType:'maxforai_video', provider:'maxforai', maxRetries:0 }`; policy treats it as a video job and recoverable by its own task ID.

- [ ] **Step 1: Write failing workflow and policy tests**

Extend the shell video source test:

```js
assert.match(videoBody, /isMaxForAiVideoModel/);
assert.match(videoBody, /taskType: isMaxForAiAccess \? 'maxforai_video'/);
assert.match(videoBody, /provider: isMaxForAiAccess \? 'maxforai'/);
assert.match(videoBody, /model: MAXFORAI_VIDEO_MODEL_ID/);
assert.match(videoBody, /upstreamModel: MAXFORAI_VIDEO_MODEL\.upstreamModel/);
assert.match(videoBody, /maxRetries: 0/);
```

Add policy assertions:

```js
const policy = resolveJobSubmissionPolicy({
  module: 'video',
  taskType: 'maxforai_video',
  provider: 'maxforai',
  hasVideoPermission: true,
});
assert.equal(policy.requiresVideoPermission, true);
assert.equal(policy.maxCreateRetries, 0);
assert.equal(policy.dedupeWindowMs, 60 * 60 * 1000);
assert.equal(canRecoverProviderTaskById({ taskType: 'maxforai_video', providerTaskId: 'video_123' }), true);
assert.throws(() => resolveJobSubmissionPolicy({
  taskType: 'maxforai_video', provider: 'kie', hasVideoPermission: true,
}), /不允许使用 provider=kie/);
```

Add the credit assertion:

```js
assert.equal(estimateCreditReservation({
  taskType: 'maxforai_video',
  provider: 'maxforai',
  payload: { model: 'maxforai-sora-v9-pro', seconds: 15 },
}), 0);
```

Run: `node --test src/components/uiArchitecture.test.mjs server/jobSubmissionPolicy.test.mjs server/accountCredits.test.mjs --test-name-pattern "video|MaxForAI"`
Expected: FAIL because the new task type and route are absent.

- [ ] **Step 2: Route MaxForAI in `runShellVideoGeneration`**

Import the Task 1 contract. Compute exact model/access booleans before validation:

```ts
const selectedModel = firstParam(input.params, ['modelVersion', 'videoAccessMode'], MAXFORAI_VIDEO_MODEL_ID);
const isMaxForAiAccess = mode === 'multimodal2video' && isMaxForAiVideoModel(selectedModel);
const accessMode = isMaxForAiAccess ? 'maxforai' : normalizeDreaminaAccessMode(mode, selectedModel);
```

Keep KIE's existing material requirement; allow MaxForAI text-only:

```ts
if (!isMaxForAiAccess && mode === 'multimodal2video' && imageUrls.length + referenceVideoUrls.length < 1) {
  throw new Error('全能参考请至少上传 1 个图片或视频素材。');
}
```

Create the job with a three-way task/provider selection. The MaxForAI payload is:

```ts
{
  mode: 'multimodal2video',
  prompt: input.prompt.trim(),
  imageUrls,
  videoUrls: referenceVideoUrls,
  audioUrls,
  referenceVideoDurations,
  referenceAudioDurations,
  seconds: normalizeMaxForAiVideoSeconds(firstParam(input.params, ['duration'], '4秒')),
  aspectRatio: normalizeMaxForAiVideoAspectRatio(firstParam(input.params, ['ratio', 'aspectRatio'], '16:9')),
  resolution: MAXFORAI_VIDEO_MODEL.resolution,
  model: MAXFORAI_VIDEO_MODEL_ID,
  upstreamModel: MAXFORAI_VIDEO_MODEL.upstreamModel,
  subFeature: input.subFeature,
  ...(input.taskMetadata || {}),
}
```

Use `taskType: isMaxForAiAccess ? 'maxforai_video' : isApiAccess ? 'kie_seedance_video' : 'dreamina_video'` and the equivalent provider selection. Preserve `maxRetries: 0` for every video provider.

- [ ] **Step 3: Extend job submission policy**

```js
export const VIDEO_JOB_TASK_TYPES = new Set([
  'dreamina_video', 'kie_seedance_video', 'kie_veo', 'kie_video', 'maxforai_video',
]);

export const RECOVERABLE_PROVIDER_TASK_TYPES = new Set([
  'dreamina_video', 'kie_image', 'kie_seedance_video', 'kie_veo', 'kie_video', 'maxforai_video',
]);

const TASK_PROVIDER_POLICIES = new Map([
  ['dreamina_video', new Set(['dreamina'])],
  ['maxforai_video', new Set(['maxforai'])],
  ['openai_responses', new Set(['openai_compatible'])],
  ['openai_tool_calling', new Set(['openai_compatible'])],
  ['upload_asset', new Set(['kie'])],
]);
```

Do not add `maxforai_video` to `KIE_RECOVERY_SOURCE_TASK_TYPES`; its name does not start with `kie_`, so the existing KIE-only recovery endpoint remains isolated.

- [ ] **Step 4: Run workflow/policy/credit tests and verify GREEN**

Run: `node --test src/components/uiArchitecture.test.mjs server/jobSubmissionPolicy.test.mjs server/accountCredits.test.mjs --test-name-pattern "video|MaxForAI"`
Expected: targeted tests PASS.

- [ ] **Step 5: Commit workflow and policy**

```bash
git add src/adapters/shellWorkflow.ts src/components/uiArchitecture.test.mjs server/jobSubmissionPolicy.mjs server/jobSubmissionPolicy.test.mjs server/accountCredits.test.mjs
git commit -m "feat: route MaxForAI video jobs"
```

### Task 4: MaxForAI asset, create, polling and recovery adapter

**Files:**
- Create: `server/providerMaxForAiVideo.mjs`
- Create: `server/providerMaxForAiVideo.test.mjs`

**Interfaces:**
- Produces: `buildMaxForAiVideoRequest(payload, preparedMedia)`, `extractMaxForAiVideoTaskId(body)`, `extractMaxForAiVideoResult(body)`, `runMaxForAiVideoJob({ payload, env, signal, providerTaskId, deps })`.
- Consumed by: Task 5 `providerGateway.mjs`.

- [ ] **Step 1: Write failing adapter tests**

Tests must use injected `fetchWithTimeout`, `wait`, and `prepareAsset` dependencies. Cover these exact cases:

```js
test('builds the exact sora-v9-pro create body', () => {
  assert.deepEqual(buildMaxForAiVideoRequest({
    payload: { model: 'maxforai-sora-v9-pro', prompt: '海边日落', seconds: '4', aspectRatio: '16:9' },
    preparedMedia: {
      images: ['https://temp.test/i'], videos: ['https://temp.test/v'], audios: ['https://temp.test/a'],
    },
  }), {
    model: 'sora-v9-pro',
    prompt: '海边日落',
    seconds: 4,
    aspect_ratio: '16:9',
    images: ['https://temp.test/i'],
    videos: ['https://temp.test/v'],
    audios: ['https://temp.test/a'],
  });
});

test('checkpoints a new task before polling and returns result_url', async () => {
  const events = [];
  const responses = [
    jsonResponse({ task_id: 'video_123' }),
    jsonResponse({ status: 'queued' }),
    jsonResponse({ status: 'processing' }),
    jsonResponse({ status: 'succeeded', result_url: 'https://cdn.test/final.mp4' }),
  ];
  const output = await runMaxForAiVideoJob({
    payload: { model: 'maxforai-sora-v9-pro', prompt: '海边日落', seconds: 4, aspectRatio: '16:9' },
    env: { MAXFORAI_VIDEO_API_KEY: 'test-key', MAXFORAI_VIDEO_BASE_URL: 'https://max.test/v1' },
    deps: {
      prepareAsset: async () => '',
      fetchWithTimeout: async (url, init) => {
        events.push(`${init.method}:${url}`);
        return responses.shift();
      },
      onProviderTaskId: async (id) => events.push(`checkpoint:${id}`),
      wait: async () => {},
    },
  });
  assert.deepEqual(events, [
    'POST:https://max.test/v1/videos',
    'checkpoint:video_123',
    'GET:https://max.test/v1/videos/video_123',
    'GET:https://max.test/v1/videos/video_123',
    'GET:https://max.test/v1/videos/video_123',
  ]);
  assert.equal(output.providerTaskId, 'video_123');
  assert.equal(output.result.videoUrl, 'https://cdn.test/final.mp4');
});

test('recovery with providerTaskId never creates a second paid task', async () => {
  const calls = [];
  const output = await runMaxForAiVideoJob({
    payload: { model: 'maxforai-sora-v9-pro', prompt: '恢复任务', seconds: 4, aspectRatio: '16:9' },
    providerTaskId: 'video_existing',
    env: { MAXFORAI_VIDEO_API_KEY: 'test-key', MAXFORAI_VIDEO_BASE_URL: 'https://max.test/v1' },
    deps: {
      fetchWithTimeout: async (url, init) => {
        calls.push([url, init.method]);
        return jsonResponse({ status: 'succeeded', result_url: 'https://cdn.test/recovered.mp4' });
      },
      wait: async () => {},
    },
  });
  assert.deepEqual(calls, [['https://max.test/v1/videos/video_existing', 'GET']]);
  assert.equal(output.result.videoUrl, 'https://cdn.test/recovered.mp4');
});
```

Also add tests for: text-only omits media arrays; local/data material calls `/assets` multipart; remote HTTPS calls `/assets/url`; asset failure causes zero `/videos` calls; 401/403/429/4xx/5xx mapping; create network error becomes `provider_submission_unknown`; success without task ID is `provider_bad_response`; failed status preserves task ID; success without `result_url` is `provider_bad_response`; cancellation during polling includes task ID; poll timeout includes task ID; no Authorization value is included in error messages.

Run: `node --test server/providerMaxForAiVideo.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `providerMaxForAiVideo.mjs`.

- [ ] **Step 2: Implement config and error boundaries**

Use these defaults and a local `createProviderError` matching the existing provider contract:

```js
const DEFAULTS = Object.freeze({
  baseUrl: 'https://maxforai.top/v1',
  createTimeoutMs: 60_000,
  assetTimeoutMs: 120_000,
  assetConcurrency: 2,
  pollIntervalMs: 5_000,
  pollTimeoutMs: 1_500_000,
});

const getPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getConfig = (env = {}) => ({
  apiKey: String(env.MAXFORAI_VIDEO_API_KEY || '').trim(),
  baseUrl: String(env.MAXFORAI_VIDEO_BASE_URL || DEFAULTS.baseUrl).trim().replace(/\/+$/, ''),
  createTimeoutMs: getPositiveInt(env.MAXFORAI_VIDEO_CREATE_TIMEOUT_MS, DEFAULTS.createTimeoutMs),
  assetTimeoutMs: getPositiveInt(env.MAXFORAI_VIDEO_ASSET_TIMEOUT_MS, DEFAULTS.assetTimeoutMs),
  assetConcurrency: getPositiveInt(env.MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY, DEFAULTS.assetConcurrency),
  pollIntervalMs: getPositiveInt(env.MAXFORAI_VIDEO_POLL_INTERVAL_MS, DEFAULTS.pollIntervalMs),
  pollTimeoutMs: getPositiveInt(env.MAXFORAI_VIDEO_POLL_TIMEOUT_MS, DEFAULTS.pollTimeoutMs),
});
```

Create POST errors with `providerStage:'provider_submission'`. Convert network/timeout/cancel errors after the POST starts to `provider_submission_unknown` with `submissionUnknown:true`; never call the create function a second time. Asset errors use `providerStage:'asset_upload'` and must never be marked submission unknown.

- [ ] **Step 3: Implement asset preparation and request building**

Use `downloadRemoteProviderMediaUrl`, `parseDataUrlPayload`, MIME inference helpers and the injected fetch boundary. Deduplicate each media kind before limiting counts. For managed/data/non-HTTPS content, upload multipart `file` to `${baseUrl}/assets`; for remote HTTPS, POST `{ url }` to `${baseUrl}/assets/url`. Both parse only a nonempty `body.url` (or `body.data.url` for runtime compatibility).

```js
export const buildMaxForAiVideoRequest = ({ payload = {}, preparedMedia = {} } = {}) => {
  if (!isMaxForAiVideoModel(payload.model)) throw createProviderError('provider_bad_request', '不支持的 MaxForAI 视频模型。');
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) throw createProviderError('provider_bad_request', '视频生成提示词不能为空。');
  const images = unique(preparedMedia.images || []);
  const videos = unique(preparedMedia.videos || []);
  const audios = unique(preparedMedia.audios || []);
  assertMaxForAiVideoMediaContract({ imageUrls: images, videoUrls: videos, audioUrls: audios });
  return {
    model: MAXFORAI_VIDEO_MODEL.upstreamModel,
    prompt,
    seconds: normalizeMaxForAiVideoSeconds(payload.seconds ?? payload.duration),
    aspect_ratio: normalizeMaxForAiVideoAspectRatio(payload.aspectRatio ?? payload.ratio),
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
    ...(audios.length ? { audios } : {}),
  };
};
```

Prepare all three media kinds through one concurrency limiter capped by `assetConcurrency`, preserving original order inside each kind.

- [ ] **Step 4: Implement create, checkpoint, polling and recovery**

```js
export const extractMaxForAiVideoTaskId = (body = {}) => String(
  body.task_id || body.id || body.data?.task_id || body.data?.id || '',
).trim();

export const extractMaxForAiVideoResult = (body = {}) => ({
  status: String(body.status || body.data?.status || '').trim().toLowerCase(),
  resultUrl: String(body.result_url || body.data?.result_url || '').trim(),
  errorMessage: String(body.error?.message || body.message || body.data?.error?.message || body.data?.message || '').trim(),
});
```

`runMaxForAiVideoJob` must:

1. Require only `MAXFORAI_VIDEO_API_KEY`.
2. If `providerTaskId` is empty, prepare assets, POST once to `${baseUrl}/videos` with `{ idempotent:false, maxRetries:0 }`, parse the ID, then await `deps.onProviderTaskId(id)` before any GET.
3. If `providerTaskId` is present, skip all asset preparation and POST work.
4. Poll `${baseUrl}/videos/${encodeURIComponent(taskId)}` until terminal or `pollTimeoutMs`.
5. Return:

```js
{
  providerTaskId: taskId,
  providerStage: 'completed',
  providerStatus: 'success',
  result: {
    videoUrl: resultUrl,
    provider: 'maxforai',
    providerModel: 'sora-v9-pro',
    providerTaskId: taskId,
  },
}
```

- [ ] **Step 5: Run adapter tests and verify GREEN**

Run: `node --test server/providerMaxForAiVideo.test.mjs`
Expected: all adapter tests PASS and no test performs a real network request.

- [ ] **Step 6: Commit the adapter**

```bash
git add server/providerMaxForAiVideo.mjs server/providerMaxForAiVideo.test.mjs
git commit -m "feat: add MaxForAI video provider adapter"
```

### Task 5: Gateway, recovery, runtime visibility and documentation

**Files:**
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/jobRuntime.mjs`
- Modify: `server/jobRuntime.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/jobLoggingBehavior.test.mjs`
- Modify: `server/jobRecoveryService.test.mjs`
- Modify: `server/temporalWorker.test.mjs`
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Modify: `.env.server.example`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/project-overview.md`
- Modify: `server/maxforaiEnvDocs.test.mjs`

**Interfaces:**
- Consumes: Task 4 `runMaxForAiVideoJob`.
- Produces: `executeProviderJob` route/recovery, `providers.maxforaiVideo.configured`, usage logging coverage, env/runbook contract.

- [ ] **Step 1: Write failing integration and documentation tests**

Add gateway assertions that a new job passes payload, env, signal, current `providerTaskId`, `onProviderTaskId`, `assetTransferDeps` and shared fetch boundary to the adapter. Add a recovery assertion that a job with `providerTaskId:'video_existing'` results in zero create POSTs.

Extend runtime config tests:

```js
const config = buildPublicSystemConfig({ MAXFORAI_VIDEO_API_KEY: 'secret' });
assert.deepEqual(config.providers.maxforaiVideo, { configured: true });
assert.equal(JSON.stringify(config).includes('secret'), false);
```

Extend env documentation expectations with exact lines:

```js
const videoExpectedLines = [
  'MAXFORAI_VIDEO_API_KEY=',
  'MAXFORAI_VIDEO_BASE_URL=https://maxforai.top/v1',
  'MAXFORAI_VIDEO_CREATE_TIMEOUT_MS=60000',
  'MAXFORAI_VIDEO_ASSET_TIMEOUT_MS=120000',
  'MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY=2',
  'MAXFORAI_VIDEO_POLL_INTERVAL_MS=5000',
  'MAXFORAI_VIDEO_POLL_TIMEOUT_MS=1500000',
];
for (const line of videoExpectedLines) {
  assert.match(envExample, new RegExp(`^${line}$`, 'm'));
  assert.match(deployDoc, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.doesNotMatch(envExample, /MAXFORAI_VIDEO_API_KEY=sk-/);
assert.doesNotMatch(deployDoc, /MAXFORAI_VIDEO_API_KEY=sk-/);
```

Run: `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/jobLoggingBehavior.test.mjs server/jobRecoveryService.test.mjs server/temporalWorker.test.mjs server/maxforaiEnvDocs.test.mjs --test-name-pattern "MaxForAI|maxforai_video|configured|task type"`
Expected: FAIL because route/config/task type/docs are absent.

- [ ] **Step 2: Wire the gateway and durable recovery**

Import `runMaxForAiVideoJob`. Add this switch branch before KIE video cases:

```js
case 'maxforai_video':
  return runMaxForAiVideoJob({
    payload: job.payload,
    env,
    signal,
    providerTaskId: job.providerTaskId,
    deps: {
      fetchWithTimeout: fetchKieWithTimeout,
      onProviderTaskId: options.onProviderTaskId,
      assetTransferDeps: options.assetTransferDeps,
    },
  });
```

Expose `maxforaiVideo:Boolean(env.MAXFORAI_VIDEO_API_KEY)` in `getProviderConfigStatus`. In `buildPublicSystemConfig`, expose only `{ configured:Boolean(env.MAXFORAI_VIDEO_API_KEY) }`. Extend TypeScript provider config types and video model provider union with `maxforai` without adding this model to Agent Center/Smart Factory catalogs.

- [ ] **Step 3: Include the task type in operational accounting**

Add `maxforai_video` to `USAGE_JOB_COMPLETED_TASK_TYPES` and its SQL mirror in `server/index.mjs`. Update the exact source assertions in `server/jobLoggingBehavior.test.mjs`.

Update recovery tests so `maxforai_video` with an ID is recoverable, remains excluded from KIE image/video recovery source matching, and continues to use Temporal's existing `provider === 'maxforai'` single-attempt activities.

- [ ] **Step 4: Document env and runtime behavior**

Append the 7 exact env lines to `.env.server.example` near the existing MaxForAI block. Document:

- video key is separate and does not fall back to Image-2 key;
- model/endpoint/asset endpoints;
- 4–15 seconds, ratios, media limits, fixed 720p;
- zero create retry, task ID checkpoint, GET-only recovery;
- display-only `0.5元/秒`, zero site credits;
- the 7 default values and secret handling.

Do not add the actual token or its prefix/suffix anywhere tracked.

- [ ] **Step 5: Run integration/documentation tests and verify GREEN**

Run: `node --test server/providerGateway.test.mjs server/jobRuntime.test.mjs server/jobLoggingBehavior.test.mjs server/jobRecoveryService.test.mjs server/temporalWorker.test.mjs server/maxforaiEnvDocs.test.mjs`
Expected: all named test files PASS.

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: exits 0.

- [ ] **Step 6: Commit integration and documentation**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs server/jobRuntime.mjs server/jobRuntime.test.mjs server/index.mjs server/jobLoggingBehavior.test.mjs server/jobRecoveryService.test.mjs server/temporalWorker.test.mjs src/types.ts src/shell/types.ts .env.server.example docs/tencent-cloud-deploy.md docs/project-overview.md server/maxforaiEnvDocs.test.mjs
git commit -m "feat: integrate MaxForAI video runtime"
```

### Task 6: Secret configuration, full verification, review, cloud release and canary

**Files:**
- Modify without tracking: `.env.server`
- Modify on Tencent Cloud without tracking: `/www/wwwroot/meiao-internal/.env.server`
- Verify: all files changed by Tasks 1–5

**Interfaces:**
- Consumes: complete implementation and the user-supplied token from the conversation.
- Produces: locally verified build, reviewed diff, cloud deployment and one paid canary evidence chain.

- [ ] **Step 1: Configure the local secret without printing it**

Back up `.env.server`, set mode 600, and atomically upsert only `MAXFORAI_VIDEO_API_KEY` plus the 6 non-secret defaults. Validation output must be exactly booleans/counts, for example:

```text
MAXFORAI_VIDEO configured=true
MAXFORAI_VIDEO settings=7
```

Run `git status --short` and `git diff -- .env.server`; expected: `.env.server` remains ignored and no secret appears.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
node --test src/utils/maxforaiVideoModels.test.mjs
node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs
node --test src/components/uiArchitecture.test.mjs
node --test server/providerMaxForAiVideo.test.mjs server/providerGateway.test.mjs
node --test server/jobSubmissionPolicy.test.mjs server/accountCredits.test.mjs
node --test server/jobRuntime.test.mjs server/jobLoggingBehavior.test.mjs
node --test server/jobRecoveryService.test.mjs server/temporalWorker.test.mjs
node --test server/maxforaiEnvDocs.test.mjs
npm run lint
npm run build
npm run doctor
```

Expected: all tests PASS; lint/build exit 0; doctor reports `worker.healthy:true`.

Run the repository-wide verification command from `package.json` (`npm run verify`) if it is not a strict superset already executed. Expected: exit 0.

- [ ] **Step 3: Perform the mandatory code review**

Run Hermes against the exact changed paths, inspect `git diff --check`, `git diff --stat`, and the full diff. The review checklist is:

- no token/Base URL leaks to frontend or logs;
- no create POST retry path at HTTP, job, or Temporal layers;
- provider task ID checkpoint occurs before first GET;
- recovery with ID skips asset upload and POST;
- cancellation during unknown submission is not reported as upstream cancelled;
- price is display-only and credits remain zero;
- KIE/CLI routing and historical models remain unchanged;
- all new env knobs appear in example and both runbooks.

Fix any issue with a RED test first, then rerun the affected suite. Commit review fixes separately if needed.

- [ ] **Step 4: Configure the cloud secret safely**

Before deployment, acquire the same deployment mutex/readiness discipline used by `deploy_tencent.sh`. Back up cloud `.env.server` with a timestamp and mode 600, then atomically upsert the 7 video keys. Transport the token through stdin/environment, never a command-line argument, shell trace or terminal echo. Remote validation prints only:

```text
MAXFORAI_VIDEO configured=true
MAXFORAI_VIDEO settings=7
```

Do not change the existing `MAXFORAI_API_KEY` Image-2 credential.

- [ ] **Step 5: Deploy after the queue drains**

Run readiness until `runningCount=0`, `providerlessCount=0`, and `submittedCount=0`. Do not set `MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1`.

Run:

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

Expected: deployment completes, drain marker is removed, PM2 and worker are healthy, `/api/health` succeeds, `version.json` matches the deployed commit, and the new frontend asset chain returns HTTP 200.

- [ ] **Step 6: Verify the browser contract before spending**

Open the cloud app and confirm:

- Short Video → Video Generation → Full Reference defaults to `Seedance 2.0 Pro 特价`.
- The option shows “推荐” and `0.5元/秒`.
- 4 seconds shows `预计2.00元`.
- only 16:9, 9:16, 1:1 are available and no resolution selector is shown.
- switching to first/last frame selects the existing KIE path; smart multi-frame selects CLI.

- [ ] **Step 7: Run exactly one 4-second paid canary**

Submit one cloud job through the normal application job API/UI with:

```json
{
  "model": "maxforai-sora-v9-pro",
  "prompt": "海边日落，镜头缓慢推进，电影感光影",
  "seconds": 4,
  "aspectRatio": "16:9",
  "imageUrls": [],
  "videoUrls": [],
  "audioUrls": []
}
```

Expected evidence:

- one internal job and one nonempty MaxForAI provider task ID;
- no second `POST /videos` for the same semantic key;
- terminal `succeeded` with one managed `videoUrl`;
- managed video returns HTTP 200, video MIME and nonzero bytes, supports browser playback;
- account `creditBalance`, `creditReserved`, and `creditConsumed` are unchanged;
- provider logs show `provider=maxforai`, `taskType=maxforai_video`, `providerModel=sora-v9-pro`, 4 seconds and 16:9 without secrets or full temporary URLs.

If creation ends in `provider_submission_unknown`, stop and inspect the upstream channel. Do not submit another canary.

- [ ] **Step 8: Final cloud verification and handoff**

Recheck `/api/health`, PM2, worker, version, frontend assets, task queue readiness and `git status`. Report local tests, build, doctor, review, deployed commit, cloud health, canary job ID/provider task ID, managed video check, credit before/after and the exact number of paid submissions.
