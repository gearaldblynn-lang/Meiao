# One-Click Preset Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split one-click preset storage and modal with a unified card-based preset manager that supports image+text presets, migration, CRUD, and correct apply-back behavior across first image, main image, detail page, and SKU.

**Architecture:** Introduce a single `presets` collection in one-click persistent state, normalize all legacy preset shapes into that structure in `utils/appState.ts`, and move preset CRUD/apply logic into `OneClickModule.tsx` plus a focused utility module. Replace the old lightweight modal with a dedicated card-library manager and editor flow that all four submodules open through their existing sidebar entry points.

**Tech Stack:** React, TypeScript, existing one-click module state, node:test, existing workspace UI primitives.

---

### Task 1: Normalize the preset data model and migration

**Files:**
- Modify: `types.ts`
- Modify: `utils/appState.ts`
- Test: `utils/appState.test.mjs`

- [ ] **Step 1: Write the failing migration tests**

```js
test('default one click state uses the unified preset collection', () => {
  const state = createDefaultOneClickState();
  assert.deepEqual(state.referencePresets, { presets: [] });
});

test('normalizeLoadedPersistedAppState migrates legacy text and image presets into unified presets', () => {
  const normalized = normalizeLoadedPersistedAppState({
    oneClickMemory: {
      referencePresets: {
        textPresets: [{ id: 'text_1', name: '详情节奏', sourceSubMode: 'detail_page', summary: '统一浅色背景', referenceDimensions: ['layout'], createdAt: 100, updatedAt: 200 }],
        firstImageImagePresets: [{ id: 'first_1', name: '首图参考', imageUrl: 'https://example.com/first.png', createdAt: 300, updatedAt: 400 }],
        skuImagePresets: [{ id: 'sku_1', name: 'SKU参考', imageUrl: 'https://example.com/sku.png', createdAt: 500, updatedAt: 600 }],
      },
    },
  });

  assert.equal(normalized.oneClickMemory.referencePresets.presets.length, 3);
  assert.equal(normalized.oneClickMemory.referencePresets.presets[0].subMode, 'detail_page');
  assert.equal(normalized.oneClickMemory.referencePresets.presets[1].coverImageUrl, 'https://example.com/first.png');
});
```

- [ ] **Step 2: Run the preset migration test file to verify failure**

Run: `node --test utils/appState.test.mjs`
Expected: FAIL on missing `presets` collection and legacy migration assertions.

- [ ] **Step 3: Update the shared preset types and app-state normalization**

```ts
export interface OneClickReferencePreset {
  id: string;
  name: string;
  subMode: OneClickSubMode;
  coverImageUrl: string;
  referenceImageUrls: string[];
  summary: string;
  detail: string;
  referenceDimensions: OneClickReferenceDimension[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface OneClickReferencePresetLibrary {
  presets: OneClickReferencePreset[];
}
```

```ts
const normalizeReferencePresets = (source: unknown): OneClickReferencePresetLibrary => {
  const now = Date.now();
  const raw = source && typeof source === 'object' ? source as any : {};

  if (Array.isArray(raw.presets)) {
    return { presets: raw.presets.map((item: any) => normalizeUnifiedPreset(item, now)).filter(Boolean) };
  }

  return {
    presets: [
      ...normalizeLegacyTextPresets(raw.textPresets, now),
      ...normalizeLegacyImagePresets(raw.firstImageImagePresets, ONE_CLICK_SUBMODE_FIRST_IMAGE, now),
      ...normalizeLegacyImagePresets(raw.skuImagePresets, ONE_CLICK_SUBMODE_SKU, now),
    ],
  };
};
```

- [ ] **Step 4: Run the app-state tests to verify migration passes**

Run: `node --test utils/appState.test.mjs`
Expected: PASS with unified preset defaults and legacy migration coverage.

- [ ] **Step 5: Commit the model and migration change**

```bash
git add types.ts utils/appState.ts utils/appState.test.mjs
git commit -m "refactor: unify one-click preset storage"
```

### Task 2: Add preset utility helpers for CRUD, filtering, and apply mapping

**Files:**
- Create: `modules/OneClick/referencePresetUtils.mjs`
- Test: `modules/OneClick/oneClickBehavior.test.mjs`

- [ ] **Step 1: Write the failing source-level behavior checks**

```js
test('one click preset logic uses a unified preset utility module', () => {
  assert.match(oneClickModuleSource, /referencePresetUtils/);
  assert.match(oneClickModuleSource, /createReferencePresetFromState/);
  assert.match(oneClickModuleSource, /applyReferencePresetToState/);
});
```

- [ ] **Step 2: Run the one-click behavior tests to verify failure**

Run: `node --test modules/OneClick/oneClickBehavior.test.mjs`
Expected: FAIL because the utility module and helper usage do not exist yet.

- [ ] **Step 3: Create focused preset utility functions**

```js
export const createReferencePresetFromState = ({ subMode, name, state }) => ({ ... });
export const updateReferencePreset = (presets, id, updates) => presets.map((preset) => preset.id === id ? { ...preset, ...updates, updatedAt: Date.now() } : preset);
export const deleteReferencePreset = (presets, id) => presets.filter((preset) => preset.id !== id);
export const filterReferencePresets = (presets, { subMode, query, dimension }) => presets.filter(...);
export const applyReferencePresetToState = (preset, currentState) => ({ ...currentState, ...mappedFields });
```

- [ ] **Step 4: Run the behavior tests to verify the utility is wired in**

Run: `node --test modules/OneClick/oneClickBehavior.test.mjs`
Expected: PASS on unified preset utility assertions.

- [ ] **Step 5: Commit the utility layer**

```bash
git add modules/OneClick/referencePresetUtils.mjs modules/OneClick/oneClickBehavior.test.mjs
git commit -m "feat: add one-click preset utility helpers"
```

### Task 3: Replace the old modal with a card-based preset manager and editor

**Files:**
- Create: `modules/OneClick/ReferencePresetManager.tsx`
- Create: `modules/OneClick/ReferencePresetCard.tsx`
- Create: `modules/OneClick/ReferencePresetEditorModal.tsx`
- Modify: `modules/OneClick/ReferencePresetLibraryModal.tsx`
- Modify: `modules/OneClick/ConfigSidebar.tsx`
- Modify: `modules/OneClick/SkuSidebar.tsx`
- Test: `modules/OneClick/oneClickBehavior.test.mjs`

- [ ] **Step 1: Write the failing UI structure checks**

```js
test('one click preset library uses the dedicated manager and editor instead of prompt-only modal flows', () => {
  assert.match(configSidebarSource, /ReferencePresetManager/);
  assert.match(skuSidebarSource, /ReferencePresetManager/);
  assert.doesNotMatch(oneClickModuleSource, /window\.prompt\('输入预设名称'/);
});
```

- [ ] **Step 2: Run the one-click behavior tests to verify failure**

Run: `node --test modules/OneClick/oneClickBehavior.test.mjs`
Expected: FAIL because the manager/editor components are not mounted and prompt-based save flow still exists.

- [ ] **Step 3: Build the manager, cards, and editor flow**

```tsx
<ReferencePresetManager
  open={presetLibraryOpen}
  presets={filteredPresets}
  activeSubMode={effectiveSubMode}
  onCreate={handleCreatePreset}
  onEdit={handleEditPreset}
  onDelete={handleDeletePreset}
  onApply={handleApplyPreset}
/>
```

```tsx
<ReferencePresetCard
  preset={preset}
  selected={selectedPresetId === preset.id}
  onSelect={() => setSelectedPresetId(preset.id)}
  onApply={() => onApply(preset)}
  onEdit={() => onEdit(preset)}
  onDelete={() => onDelete(preset.id)}
/>
```

- [ ] **Step 4: Run the one-click behavior tests to verify the manager flow passes**

Run: `node --test modules/OneClick/oneClickBehavior.test.mjs`
Expected: PASS on manager/editor assertions and no prompt-based save flow.

- [ ] **Step 5: Commit the card manager UI**

```bash
git add modules/OneClick/ReferencePresetManager.tsx modules/OneClick/ReferencePresetCard.tsx modules/OneClick/ReferencePresetEditorModal.tsx modules/OneClick/ReferencePresetLibraryModal.tsx modules/OneClick/ConfigSidebar.tsx modules/OneClick/SkuSidebar.tsx modules/OneClick/oneClickBehavior.test.mjs
git commit -m "feat: add card-based one-click preset manager"
```

### Task 4: Wire unified preset CRUD and apply flows into OneClickModule and submodules

**Files:**
- Modify: `modules/OneClick/OneClickModule.tsx`
- Modify: `modules/OneClick/FirstImageSubModule.tsx`
- Modify: `modules/OneClick/MainImageSubModule.tsx`
- Modify: `modules/OneClick/DetailPageSubModule.tsx`
- Modify: `modules/OneClick/SkuSubModule.tsx`
- Test: `modules/OneClick/oneClickBehavior.test.mjs`

- [ ] **Step 1: Write the failing apply/save flow checks**

```js
test('main image and detail preset saves include uploaded reference images and analysis content', () => {
  assert.match(oneClickModuleSource, /uploadedDesignReferenceUrls/);
  assert.match(oneClickModuleSource, /referenceAnalysis\.summary/);
  assert.match(oneClickModuleSource, /referenceAnalysis\.status/);
});

test('all four one-click submodules receive unified preset apply callbacks', () => {
  assert.match(oneClickModuleSource, /onApplyReferencePreset/);
  assert.match(oneClickModuleSource, /persistentState\.firstImage/);
  assert.match(oneClickModuleSource, /persistentState\.mainImage/);
  assert.match(oneClickModuleSource, /persistentState\.detailPage/);
  assert.match(oneClickModuleSource, /persistentState\.sku/);
});
```

- [ ] **Step 2: Run the one-click behavior tests to verify failure**

Run: `node --test modules/OneClick/oneClickBehavior.test.mjs`
Expected: FAIL because unified save/apply callbacks are not fully wired.

- [ ] **Step 3: Replace per-type preset logic in `OneClickModule.tsx` with unified CRUD/apply handlers**

```tsx
const saveReferencePreset = ({ subMode, state, defaultName }) => {
  setPresetEditorState({
    mode: 'create',
    initialValue: createReferencePresetFromState({ subMode, name: defaultName, state }),
  });
};

const applyReferencePreset = (subMode, preset) => {
  if (subMode === OneClickSubMode.FIRST_IMAGE) updateFirstImageState(applyReferencePresetToState(preset, persistentState.firstImage));
  if (subMode === OneClickSubMode.MAIN_IMAGE) updateMainImageState(applyReferencePresetToState(preset, persistentState.mainImage));
  if (subMode === OneClickSubMode.DETAIL_PAGE) updateDetailPageState(applyReferencePresetToState(preset, persistentState.detailPage));
  if (subMode === OneClickSubMode.SKU) updateSkuState(applyReferencePresetToState(preset, persistentState.sku));
};
```

- [ ] **Step 4: Run the one-click behavior tests to verify the save/apply wiring passes**

Run: `node --test modules/OneClick/oneClickBehavior.test.mjs`
Expected: PASS on unified preset wiring assertions.

- [ ] **Step 5: Commit the unified module wiring**

```bash
git add modules/OneClick/OneClickModule.tsx modules/OneClick/FirstImageSubModule.tsx modules/OneClick/MainImageSubModule.tsx modules/OneClick/DetailPageSubModule.tsx modules/OneClick/SkuSubModule.tsx modules/OneClick/oneClickBehavior.test.mjs
git commit -m "feat: wire unified one-click preset flows"
```

### Task 5: Run targeted verification and document residual risks

**Files:**
- Modify: `docs/release-and-handoff.md`
- Test: `utils/appState.test.mjs`
- Test: `modules/OneClick/oneClickBehavior.test.mjs`

- [ ] **Step 1: Add a short handoff note for the new preset library**

```md
## One-click preset library

- Uses unified `referencePresets.presets` storage
- Migrates legacy text/image presets on load
- Applies image + summary context back to all four one-click submodules
```

- [ ] **Step 2: Run the targeted verification suite**

Run: `node --test utils/appState.test.mjs modules/OneClick/oneClickBehavior.test.mjs`
Expected: PASS with migration, manager wiring, and apply behavior coverage green.

- [ ] **Step 3: Sanity-check the changed files in git diff**

Run: `git diff -- types.ts utils/appState.ts modules/OneClick/OneClickModule.tsx modules/OneClick/ConfigSidebar.tsx modules/OneClick/SkuSidebar.tsx modules/OneClick/referencePresetUtils.mjs modules/OneClick/ReferencePresetManager.tsx`
Expected: Diff only shows unified preset library scope.

- [ ] **Step 4: Commit the verification pass**

```bash
git add docs/release-and-handoff.md
git commit -m "docs: note unified one-click preset library"
```
