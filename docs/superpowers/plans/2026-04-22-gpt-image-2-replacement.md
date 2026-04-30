# GPT Image 2 Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `nano-banana-pro` with `gpt-image-2` across image-generation features while keeping `nano-banana-2` as the default model and preventing unsupported GPT Image 2 payload fields from being sent to KIE.

**Architecture:** Add a shared image-model capability layer, route the app-facing `gpt-image-2` model to the correct KIE GPT Image 2 endpoint inside the provider gateway, and make UI/state behavior capability-driven instead of hardcoding Nano Banana assumptions. Migrate persisted `nano-banana-pro` values to `gpt-image-2`, convert unsupported structured aspect-ratio requests into prompt guidance, and validate the provider payload at the boundary.

**Tech Stack:** TypeScript, React, Node.js ESM, existing `node:test`-style `.test.mjs` suites, Vite, shared app utilities under `utils/`, KIE provider code under `server/`.

---

### Task 1: Add model-type and capability coverage tests

**Files:**
- Modify: `types.ts`
- Modify: `utils/modelQuality.ts`
- Create or Modify: `utils/modelCapabilities.ts`
- Test: `utils/appState.test.mjs`
- Test: `server/providerGateway.test.mjs`

- [ ] **Step 1: Write the failing persisted-state migration test**

```js
it('migrates nano-banana-pro model selections to gpt-image-2 during restore', () => {
  const restored = restoreAppState({
    moduleConfig: { model: 'nano-banana-pro' },
    retouchMemory: { model: 'nano-banana-pro' },
  });

  assert.equal(restored.moduleConfig.model, 'gpt-image-2');
  assert.equal(restored.retouchMemory.model, 'gpt-image-2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test utils/appState.test.mjs`
Expected: FAIL because `nano-banana-pro` is preserved or `gpt-image-2` is not a valid model.

- [ ] **Step 3: Write the failing provider routing test**

```js
it('routes gpt-image-2 image jobs with source images to the GPT Image 2 image-to-image payload', async () => {
  const result = await executeProviderJob({
    taskType: 'kie_image',
    payload: {
      model: 'gpt-image-2',
      prompt: 'make a clean studio shot',
      imageUrls: ['https://example.com/input-1.png'],
      aspectRatio: '3:4',
      resolution: '2K',
    },
  }, env, signal);

  assert.equal(result.result.images.length, 1);
  const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
  assert.equal(createTaskBody.model, 'gpt-image-2-image-to-image');
  assert.deepEqual(createTaskBody.input.input_urls, ['https://example.com/input-1.png']);
  assert.equal(createTaskBody.input.aspect_ratio, undefined);
  assert.equal(createTaskBody.input.resolution, undefined);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test server/providerGateway.test.mjs`
Expected: FAIL because the provider still sends Nano Banana payload fields or does not recognize `gpt-image-2`.

- [ ] **Step 5: Commit**

```bash
git add utils/appState.test.mjs server/providerGateway.test.mjs
git commit -m "test: cover gpt-image-2 migration and provider routing"
```

### Task 2: Introduce the shared image model capability layer

**Files:**
- Modify: `types.ts`
- Create: `utils/modelCapabilities.ts`
- Modify: `utils/modelQuality.ts`
- Modify: `utils/modelAspectRatio.ts`

- [ ] **Step 1: Write the failing capability helper test**

```js
it('reports GPT Image 2 as prompt-ratio driven without quality controls', () => {
  const capabilities = getImageModelCapabilities('gpt-image-2');
  assert.equal(capabilities.supportsStructuredAspectRatio, false);
  assert.equal(capabilities.supportsQualitySelection, false);
  assert.equal(capabilities.maxInputImages, 16);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test utils/modelCapabilities.test.mjs`
Expected: FAIL because the helper or model type does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type KieAiModel = 'nano-banana-2' | 'gpt-image-2';

export const getImageModelCapabilities = (model: KieAiModel) => {
  if (model === 'gpt-image-2') {
    return {
      supportsStructuredAspectRatio: false,
      supportsQualitySelection: false,
      supportsStructuredResolution: false,
      supportsOutputFormat: false,
      maxInputImages: 16,
    };
  }
  return {
    supportsStructuredAspectRatio: true,
    supportsQualitySelection: true,
    supportsStructuredResolution: true,
    supportsOutputFormat: true,
    maxInputImages: 16,
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test utils/modelCapabilities.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add types.ts utils/modelCapabilities.ts utils/modelQuality.ts utils/modelAspectRatio.ts utils/modelCapabilities.test.mjs
git commit -m "feat: add image model capability helpers"
```

### Task 3: Route GPT Image 2 requests through the provider gateway

**Files:**
- Modify: `server/providerGateway.mjs`
- Test: `server/providerGateway.test.mjs`

- [ ] **Step 1: Write the failing prompt-aspect-ratio test**

```js
it('adds aspect ratio guidance to GPT Image 2 prompts instead of sending aspect_ratio', async () => {
  await executeProviderJob({
    taskType: 'kie_image',
    payload: {
      model: 'gpt-image-2',
      prompt: 'generate a product poster',
      imageUrls: [],
      aspectRatio: '16:9',
    },
  }, env, signal);

  const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
  assert.match(createTaskBody.input.prompt, /16:9/);
  assert.equal(createTaskBody.input.aspect_ratio, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/providerGateway.test.mjs`
Expected: FAIL because `aspect_ratio` is still sent structurally or prompt is unmodified.

- [ ] **Step 3: Write minimal implementation**

```js
const resolveKieImageTaskRequest = (payload) => {
  if (payload.model !== 'gpt-image-2') {
    return buildNanoBananaRequest(payload);
  }

  const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.filter(Boolean) : [];
  if (imageUrls.length > 16) {
    throw createProviderError('provider_bad_request', 'GPT Image 2 最多支持 16 张输入图');
  }

  return imageUrls.length > 0
    ? {
        model: 'gpt-image-2-image-to-image',
        input: { prompt: augmentPromptWithAspectRatio(payload.prompt, payload.aspectRatio), input_urls: imageUrls },
      }
    : {
        model: 'gpt-image-2-text-to-image',
        input: { prompt: augmentPromptWithAspectRatio(payload.prompt, payload.aspectRatio) },
      };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/providerGateway.test.mjs`
Expected: PASS for GPT Image 2 routing cases and existing Nano Banana cases remain green.

- [ ] **Step 5: Commit**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "feat: route gpt-image-2 requests through KIE image endpoints"
```

### Task 4: Migrate defaults, restored state, and shared UI options

**Files:**
- Modify: `utils/appState.ts`
- Modify: `utils/appState.test.mjs`
- Modify: `modules/Translation/translationConfigUtils.mjs`
- Modify: `modules/Translation/translationConfigUtils.test.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Write the failing legacy-model migration test**

```js
it('converts legacy nano-banana-pro storyboard and translation configs to gpt-image-2', () => {
  const restored = restoreAppState(legacyState);
  assert.equal(restored.videoMemory.storyboard.config.model, 'gpt-image-2');
  assert.equal(restored.translationConfigs.detail.model, 'gpt-image-2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test utils/appState.test.mjs modules/Translation/translationConfigUtils.test.mjs`
Expected: FAIL because legacy `nano-banana-pro` values are still preserved.

- [ ] **Step 3: Write minimal implementation**

```ts
const migrateImageModel = (model: unknown): KieAiModel =>
  model === 'nano-banana-pro' ? 'gpt-image-2' : 'nano-banana-2';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test utils/appState.test.mjs modules/Translation/translationConfigUtils.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/appState.ts utils/appState.test.mjs modules/Translation/translationConfigUtils.mjs modules/Translation/translationConfigUtils.test.mjs server/index.mjs
git commit -m "feat: migrate legacy nano-banana-pro state to gpt-image-2"
```

### Task 5: Update image-generation UI to be capability-driven

**Files:**
- Modify: `utils/modelQuality.ts`
- Modify: `components/FileProcessor.tsx`
- Modify: `modules/Retouch/RetouchSidebar.tsx`
- Modify: `modules/BuyerShow/BuyerShowSidebar.tsx`
- Modify: `modules/OneClick/ConfigSidebar.tsx`
- Modify: `components/SettingsSidebar.tsx`
- Test: existing component or source tests covering rendered controls

- [ ] **Step 1: Write the failing UI behavior test**

```js
it('hides quality selection when the selected model is gpt-image-2', () => {
  const html = renderSidebar({ model: 'gpt-image-2' });
  assert.doesNotMatch(html, /1K 快速/);
  assert.doesNotMatch(html, /2K 推荐/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: FAIL because quality controls still render for GPT Image 2.

- [ ] **Step 3: Write minimal implementation**

```ts
const capabilities = getImageModelCapabilities(model);
const showQualityControls = capabilities.supportsQualitySelection;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/modelQuality.ts components/FileProcessor.tsx modules/Retouch/RetouchSidebar.tsx modules/BuyerShow/BuyerShowSidebar.tsx modules/OneClick/ConfigSidebar.tsx components/SettingsSidebar.tsx components/uiArchitecture.test.mjs
git commit -m "feat: hide unsupported gpt-image-2 controls in image UIs"
```

### Task 6: Verify the integrated behavior

**Files:**
- Modify: any touched files above as needed

- [ ] **Step 1: Run targeted tests**

Run: `node --test utils/appState.test.mjs modules/Translation/translationConfigUtils.test.mjs server/providerGateway.test.mjs components/uiArchitecture.test.mjs`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Run quick source scan for removed model**

Run: `rg -n "nano-banana-pro" .`
Expected: Remaining matches only in docs, historical references, or intentional migration tests.

- [ ] **Step 4: Fix any final issues and re-run failing verification**

```bash
node --test utils/appState.test.mjs modules/Translation/translationConfigUtils.test.mjs server/providerGateway.test.mjs components/uiArchitecture.test.mjs
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: replace nano-banana-pro with gpt-image-2"
```
