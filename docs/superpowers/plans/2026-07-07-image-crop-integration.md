# Image Crop Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the image crop package as a production shell module with long-image slicing and proportional resize.

**Architecture:** Add `image_crop` as a normal shell module, but keep all processing local in the browser canvas. Generated files are uploaded through the existing internal asset API and persisted as shell projects, using numeric timestamps and the current deletion/persistence contracts.

**Tech Stack:** React, TypeScript, Vite, browser Canvas API, existing internal asset upload/delete APIs, existing shell project persistence.

---

### Task 1: Tests First

**Files:**
- Create: `src/modules/ImageCrop/imageSliceUtils.test.mjs`
- Create: `src/modules/ImageCrop/imageResizeUtils.test.mjs`
- Create: `src/shell/modules/ImageCrop/imageCropFlowGuards.test.mjs`
- Modify: `src/components/uiArchitecture.test.mjs`

- [x] **Step 1: Write failing tests**

Add tests that import the image crop utility modules, assert the shell module registration, assert image crop projects use numeric `Date.now()` timestamps, assert generated projects are inserted into the runtime list before persistence, and assert project cards use a compact image-crop rendering branch.

- [x] **Step 2: Run red tests**

Run:

```bash
node --experimental-strip-types --test src/modules/ImageCrop/imageSliceUtils.test.mjs src/modules/ImageCrop/imageResizeUtils.test.mjs src/shell/modules/ImageCrop/imageCropFlowGuards.test.mjs
node --experimental-strip-types --test --test-name-pattern "image crop" src/components/uiArchitecture.test.mjs
```

Expected: FAIL because the image crop files and registration do not exist yet.

### Task 2: Add Image Crop Core

**Files:**
- Create: `src/modules/ImageCrop/imageSliceUtils.ts`
- Create: `src/modules/ImageCrop/imageResizeUtils.ts`
- Create: `src/shell/modules/ImageCrop/ImageCropModule.tsx`

- [x] **Step 1: Copy the package implementation**

Copy the three standalone files from `/Users/feiyanglin/Downloads/图片裁切功能集成包/src/` into the same paths in the app.

- [x] **Step 2: Adapt timestamps and module constants**

Replace `todayLabel()` project/result timestamps with a single numeric `Date.now()` value per generation. Use `AppModuleObj.IMAGE_CROP` instead of string-cast module literals. Add `createdAtPrecise: true` to completed projects.

- [x] **Step 3: Verify utility tests pass**

Run:

```bash
node --experimental-strip-types --test src/modules/ImageCrop/imageSliceUtils.test.mjs src/modules/ImageCrop/imageResizeUtils.test.mjs src/shell/modules/ImageCrop/imageCropFlowGuards.test.mjs
```

Expected: PASS.

### Task 3: Register Shell Module

**Files:**
- Modify: `src/types.ts`
- Modify: `src/shell/types.ts`
- Modify: `src/shell/components/layout/SidebarNavigation.tsx`
- Modify: `src/config/helpGuide.ts`
- Modify: `src/ShellMigratedApp.tsx`

- [x] **Step 1: Register `IMAGE_CROP`**

Add `IMAGE_CROP = 'image_crop'` and `AppModuleObj.IMAGE_CROP`. Add module name `图片裁切` and subfeatures `long_slice` / `resize`.

- [x] **Step 2: Wire shell rendering**

Lazy-load `ImageCropModule`; add upload, persist, and asset deletion callbacks; add the `AppModuleObj.IMAGE_CROP` switch branch.

- [x] **Step 3: Verify registration tests pass**

Run:

```bash
node --experimental-strip-types --test --test-name-pattern "image crop" src/components/uiArchitecture.test.mjs
```

Expected: PASS.

### Task 4: Project Card Integration

**Files:**
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/components/uiArchitecture.test.mjs`

- [x] **Step 1: Add compact image-crop card branch**

Add `image_crop` labels and a compact result card that shows only the image preview and download action, without prompt/model/regenerate/edit/recover controls.

- [x] **Step 2: Verify project-card tests pass**

Run:

```bash
node --experimental-strip-types --test --test-name-pattern "image crop" src/components/uiArchitecture.test.mjs
```

Expected: PASS.

### Task 5: Final Verification

**Files:**
- All files touched above.

- [x] **Step 1: Run guardrail check**

Run:

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed src/ShellMigratedApp.tsx --changed src/shell/components/ProjectCard.tsx --changed src/types.ts --changed src/shell/types.ts --changed src/shell/components/layout/SidebarNavigation.tsx --changed src/config/helpGuide.ts
```

- [x] **Step 2: Run focused tests and build**

Run:

```bash
node --experimental-strip-types --test src/modules/ImageCrop/imageSliceUtils.test.mjs src/modules/ImageCrop/imageResizeUtils.test.mjs src/shell/modules/ImageCrop/imageCropFlowGuards.test.mjs src/components/uiArchitecture.test.mjs src/utils/imageUtils.test.mjs
npm run build
```

Expected: all tests and build pass.
