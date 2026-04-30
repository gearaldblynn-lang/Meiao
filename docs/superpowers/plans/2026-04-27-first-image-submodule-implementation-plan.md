# First Image Submodule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent “首图” submodule under 一键主详 that initially mirrors 主图 behavior but defaults to generating 1 image.

**Architecture:** Add `firstImage` as a sibling of `mainImage` in `OneClickPersistentState`, then mount a cloned `FirstImageSubModule` from `OneClickModule`. Keep the first implementation intentionally parallel to 主图 so later first-image-specific fission features can diverge without changing 主图 behavior.

**Tech Stack:** React, TypeScript, Vite, Node `node:test` source-level tests, existing OneClick services and workspace primitives.

---

## File Structure

- Modify `types.ts`: add `OneClickSubMode.FIRST_IMAGE` and `OneClickPersistentState.firstImage`.
- Modify `utils/appState.ts`: create default first-image state and normalize restored first-image state.
- Create `modules/OneClick/FirstImageSubModule.tsx`: clone current main-image behavior with first-image labels, metadata, and default scene enum.
- Modify `modules/OneClick/OneClickModule.tsx`: add first-image state updater, clear handler, and active mount branch.
- Modify `modules/OneClick/ConfigSidebar.tsx`: add “首图” tab and first-image title/subtitle handling.
- Modify `modules/OneClick/SkuSidebar.tsx`: add “首图” tab to the SKU sidebar switcher.
- Modify `modules/OneClick/oneClickBehavior.test.mjs`: add source tests for first-image wiring and cloned behavior.
- Modify `utils/appState.test.mjs`: add default and migration tests for `firstImage`.

## Task 1: State And Sidebar Tests

**Files:**
- Modify: `modules/OneClick/oneClickBehavior.test.mjs`
- Modify: `utils/appState.test.mjs`

- [ ] **Step 1: Write failing source tests**

Add these tests to `modules/OneClick/oneClickBehavior.test.mjs` after the existing source constants:

```js
const firstImageSource = readFileSync(new URL('./FirstImageSubModule.tsx', import.meta.url), 'utf8');
const configSidebarSource = readFileSync(new URL('./ConfigSidebar.tsx', import.meta.url), 'utf8');
const skuSidebarSource = readFileSync(new URL('./SkuSidebar.tsx', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../../types.ts', import.meta.url), 'utf8');
```

Add these tests near the existing one-click workspace tests:

```js
test('one click exposes first image as an independent submodule tab', () => {
  assert.match(typesSource, /FIRST_IMAGE = 'first_image'/);
  assert.match(oneClickModuleSource, /subMode === OneClickSubMode\.FIRST_IMAGE \? \(/);
  assert.match(oneClickModuleSource, /state=\{persistentState\.firstImage\}/);
  assert.match(configSidebarSource, /value: OneClickSubMode\.FIRST_IMAGE, label: '首图'/);
  assert.match(skuSidebarSource, /value: OneClickSubMode\.FIRST_IMAGE, label: '首图'/);
});

test('first image module keeps main image behavior while using first image labels', () => {
  assert.match(firstImageSource, /subMode: 'first_image'/);
  assert.match(firstImageSource, /OneClickSubMode\.FIRST_IMAGE/);
  assert.match(firstImageSource, /generateMarketingSchemes\(/);
  assert.match(firstImageSource, /handleBatchDownload/);
  assert.match(firstImageSource, /handleRedoSingle/);
  assert.match(firstImageSource, /handleCancelAnalysis/);
  assert.match(firstImageSource, /首图/);
  assert.match(firstImageSource, /first_image_\$\{i \+ 1\}\.png/);
});
```

Update the existing `utils/appState.test.mjs` app-state import:

```js
import { createDefaultOneClickState, createDefaultVideoState, normalizeLoadedPersistedAppState } from './appState.ts';
```

Add these tests to `utils/appState.test.mjs`:

```js
test('default one click state includes independent first image state with one default output', () => {
  const state = createDefaultOneClickState();

  assert.ok(state.firstImage);
  assert.equal(state.firstImage.config.count, 1);
  assert.notEqual(state.firstImage, state.mainImage);
  assert.deepEqual(state.firstImage.productImages, []);
  assert.deepEqual(state.firstImage.schemes, []);
});

test('normalizeLoadedPersistedAppState backfills missing first image state', () => {
  const state = createDefaultOneClickState();
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      mainImage: state.mainImage,
      detailPage: state.detailPage,
      sku: state.sku,
    },
  });

  assert.ok(normalized.oneClickMemory.firstImage);
  assert.equal(normalized.oneClickMemory.firstImage.config.count, 1);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- modules/OneClick/oneClickBehavior.test.mjs utils/appState.test.mjs
```

Expected: FAIL because `FirstImageSubModule.tsx`, `OneClickSubMode.FIRST_IMAGE`, and `firstImage` do not exist yet.

## Task 2: Add First Image State

**Files:**
- Modify: `types.ts`
- Modify: `utils/appState.ts`

- [ ] **Step 1: Implement enum and persisted state shape**

In `types.ts`, update `OneClickSubMode`:

```ts
export enum OneClickSubMode {
  FIRST_IMAGE = 'first_image',
  MAIN_IMAGE = 'main_image',
  DETAIL_PAGE = 'detail_page',
  SKU = 'sku',
}
```

In `OneClickPersistentState`, add `firstImage` before `mainImage` with the same structure:

```ts
firstImage: OneClickReferenceState & {
  productImages: File[];
  logoImage: File | null;
  uploadedLogoUrl: string | null;
  styleImage: File | null;
  schemes: MainImageScheme[];
  config: OneClickConfig;
  lastStyleUrl: string | null;
  uploadedProductUrls: string[];
  directions: string[];
};
```

- [ ] **Step 2: Implement default first-image state**

In `utils/appState.ts`, add `firstImage` to `createDefaultOneClickState()` before `mainImage`:

```ts
firstImage: {
  productImages: [],
  logoImage: null,
  uploadedLogoUrl: null,
  styleImage: null,
  designReferences: [],
  uploadedDesignReferenceUrls: [],
  referenceDimensions: ['visual_style', 'color_palette', 'layout'],
  referenceAnalysis: {
    status: 'idle',
    summary: '',
    analyzedAt: null,
  },
  schemes: [],
  config: {
    description: '',
    platformType: 'domestic',
    platform: '淘宝',
    language: '中文',
    count: 1,
    aspectRatio: ASPECT_RATIO_SQUARE,
    quality: '1k',
    model: 'nano-banana-2',
    styleStrength: 'medium',
    resolutionMode: 'custom',
    targetWidth: 800,
    targetHeight: 800,
    maxFileSize: 2.0,
  },
  lastStyleUrl: null,
  uploadedProductUrls: [],
  directions: [],
},
```

- [ ] **Step 3: Normalize restored first-image state**

In `normalizePersistedState`, add a `firstImage` branch before `mainImage`. Use `saved.oneClickMemory.firstImage || createDefaultOneClickState().firstImage` as the source and normalize the same fields as `mainImage`. Preserve `config.count` from saved data only if it exists through `normalizeModelField`; otherwise the default remains `1`.

- [ ] **Step 4: Run state tests**

Run:

```bash
npm test -- utils/appState.test.mjs
```

Expected: PASS for the first-image default and migration tests.

## Task 3: Add First Image Module And Mounting

**Files:**
- Create: `modules/OneClick/FirstImageSubModule.tsx`
- Modify: `modules/OneClick/OneClickModule.tsx`

- [ ] **Step 1: Create first-image module**

Copy `modules/OneClick/MainImageSubModule.tsx` to `modules/OneClick/FirstImageSubModule.tsx`, then make these substitutions:

```text
MainImageSubModule -> FirstImageSubModule
OneClickPersistentState['mainImage'] -> OneClickPersistentState['firstImage']
OneClickSubMode.MAIN_IMAGE -> OneClickSubMode.FIRST_IMAGE
subMode: 'main_image' -> subMode: 'first_image'
主图 -> 首图
main_image_ -> first_image_
mayo_main_batch_ -> mayo_first_image_batch_
download_main_batch -> download_first_image_batch
redo_main_scheme -> redo_first_image_scheme
interrupt_main_scheme -> interrupt_first_image_scheme
plan_main_start -> plan_first_image_start
generate_main -> generate_first_image
generate_main_batch -> generate_first_image_batch
recover_main -> recover_first_image
select_all_main -> select_all_first_image
deselect_all_main -> deselect_all_first_image
select_single_main -> select_single_first_image
deselect_single_main -> deselect_single_first_image
```

- [ ] **Step 2: Mount first-image module**

In `OneClickModule.tsx`, import the new component:

```ts
import FirstImageSubModule from './FirstImageSubModule';
```

Initialize the active submode with first image:

```ts
const [subMode, setSubMode] = useState<OneClickSubMode>(OneClickSubMode.FIRST_IMAGE);
```

Add `updateFirstImageState`:

```ts
const updateFirstImageState = (updates: Partial<OneClickPersistentState['firstImage']> | ((prev: OneClickPersistentState['firstImage']) => OneClickPersistentState['firstImage'])) => {
  onStateChange(prev => {
    const current = prev.firstImage;
    const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
    return {
      ...prev,
      firstImage: { ...current, ...finalUpdates }
    };
  });
};
```

Add `handleClearFirstImageConfig` before `handleClearMainConfig`:

```ts
const handleClearFirstImageConfig = () => {
  setConfirmState({
    title: '确认清空首图',
    message: '确定要清空首图的所有配置和方案吗？此操作不可撤销。',
    confirmLabel: '确认清空首图',
    onConfirm: () => {
      setConfirmState(null);
      releaseObjectURLs([
        ...persistentState.firstImage.productImages,
        persistentState.firstImage.logoImage,
        persistentState.firstImage.styleImage,
        ...persistentState.firstImage.designReferences.map((item) => item.file),
      ]);
      onStateChange(prev => ({
        ...prev,
        firstImage: {
          ...defaultOneClickState.firstImage,
          schemes: [],
        }
      }));
      void logActionSuccess({
        module: 'one_click',
        action: 'clear_first_image_config',
        message: '清空首图配置信息',
        meta: {
          target: 'first_image',
        },
      });
      addToast('已清空首图配置信息', 'success');
    },
  });
};
```

Add the first-image mount branch before the main-image branch:

```tsx
{subMode === OneClickSubMode.FIRST_IMAGE ? (
  <FirstImageSubModule
    apiConfig={apiConfig}
    state={persistentState.firstImage}
    onUpdate={updateFirstImageState}
    onClearConfig={handleClearFirstImageConfig}
    onProcessingChange={setIsProcessing}
    currentSubMode={subMode}
    onSubModeChange={setSubMode}
  />
) : null}
```

- [ ] **Step 3: Run one-click source test**

Run:

```bash
npm test -- modules/OneClick/oneClickBehavior.test.mjs
```

Expected: tests still fail until sidebar tabs are updated.

## Task 4: Add Sidebar Tab And Labels

**Files:**
- Modify: `modules/OneClick/ConfigSidebar.tsx`
- Modify: `modules/OneClick/SkuSidebar.tsx`

- [ ] **Step 1: Update ConfigSidebar labels**

In `ConfigSidebar.tsx`, add:

```ts
const isFirstImage = subMode === OneClickSubMode.FIRST_IMAGE;
```

Use first-image-aware labels:

```tsx
title={isFirstImage ? '首图设置' : isDetail ? '详情设置' : '主图设置'}
subtitle={isFirstImage ? '首图模式' : isDetail ? '详情模式' : '主图模式'}
```

Add the tab item before 主图:

```ts
{ value: OneClickSubMode.FIRST_IMAGE, label: '首图', icon: 'fa-star' },
```

- [ ] **Step 2: Update SkuSidebar tabs**

In `SkuSidebar.tsx`, add the same first tab item before 主图:

```ts
{ value: OneClickSubMode.FIRST_IMAGE, label: '首图', icon: 'fa-star' },
```

- [ ] **Step 3: Run behavior tests**

Run:

```bash
npm test -- modules/OneClick/oneClickBehavior.test.mjs utils/appState.test.mjs
```

Expected: PASS.

## Task 5: Full Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- modules/OneClick/oneClickBehavior.test.mjs modules/OneClick/oneClickRecoveryBehavior.test.mjs utils/appState.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run type/build check**

Run:

```bash
npm run build
```

Expected: PASS with Vite producing a production build.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git diff -- types.ts utils/appState.ts modules/OneClick/FirstImageSubModule.tsx modules/OneClick/OneClickModule.tsx modules/OneClick/ConfigSidebar.tsx modules/OneClick/SkuSidebar.tsx modules/OneClick/oneClickBehavior.test.mjs utils/appState.test.mjs
```

Expected: Diff only contains first-image feature changes.
