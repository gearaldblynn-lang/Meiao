# Cloud Asset Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-backed persistent asset storage for all modules with 3-day cleanup, while preserving existing business behavior and task semantics.

**Architecture:** Introduce a server-local asset store plus MySQL metadata table, make internal upload APIs persist files locally and return stable internal URLs, and persist provider result files before writing `resultUrl` back into user state. Keep module data shapes and business flows unchanged.

**Tech Stack:** Node.js, existing HTTP server, MySQL, local filesystem storage, Vite frontend, current internal API layer

---

### Task 1: Add persistent asset schema and storage helpers

**Files:**
- Create: `server/assetStore.mjs`
- Modify: `server/index.mjs`
- Test: `server/assetStore.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetPublicUrl, sanitizeAssetName } from './assetStore.mjs';

test('sanitizeAssetName keeps extension and removes unsafe chars', () => {
  assert.equal(sanitizeAssetName('海报 图(1).png'), '____1_.png');
});

test('buildAssetPublicUrl returns internal asset route', () => {
  assert.equal(buildAssetPublicUrl('asset_123'), '/api/assets/file/asset_123');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/assetStore.test.mjs`
Expected: FAIL with module not found or missing exports

- [ ] **Step 3: Write minimal implementation**

```js
export const sanitizeAssetName = (value) => { /* implementation */ };
export const buildAssetPublicUrl = (assetId) => `/api/assets/file/${assetId}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/assetStore.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/assetStore.mjs server/assetStore.test.mjs server/index.mjs
git commit -m "feat: add persistent asset store helpers"
```

### Task 2: Persist uploaded source assets through internal upload APIs

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`
- Modify: `services/tencentCosService.ts`
- Test: `services/tencentCosService.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('uploadToCos returns internal stable URL from stream upload', async () => {
  // mock uploadInternalAssetStream to return { fileUrl: '/api/assets/file/a1' }
  // assert returned url is internal stable url
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test services/tencentCosService.test.mjs`
Expected: FAIL for missing internal stable url expectation

- [ ] **Step 3: Write minimal implementation**

```ts
// internal upload endpoints write file to local persistent storage
// and return { fileUrl, assetId }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test services/tencentCosService.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs services/internalApi.ts services/tencentCosService.ts services/tencentCosService.test.mjs
git commit -m "feat: persist uploaded source assets"
```

### Task 3: Persist provider result assets before writing back module result URLs

**Files:**
- Modify: `server/providerGateway.mjs`
- Modify: `server/jobManager.mjs`
- Modify: `server/localJobStore.mjs`
- Modify: `server/index.mjs`
- Test: `server/jobManager.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('completed job keeps provider task id and writes internal persisted result url', async () => {
  // simulate provider result url being persisted to internal asset url
  // expect stored result.imageUrl to be /api/assets/file/<id>
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/jobManager.test.mjs`
Expected: FAIL because completed jobs still hold provider transient URLs

- [ ] **Step 3: Write minimal implementation**

```js
// after provider success, download remote result file
// persist to local asset store
// replace public-facing result url with internal stable url
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/jobManager.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/providerGateway.mjs server/jobManager.mjs server/localJobStore.mjs server/index.mjs server/jobManager.test.mjs
git commit -m "feat: persist provider result assets"
```

### Task 4: Restore persisted assets from app state across all modules

**Files:**
- Modify: `server/index.mjs`
- Modify: `utils/appState.ts`
- Modify: `types.ts`
- Test: `modules/Translation/translationProcessingUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('persisted internal asset urls survive state reload without File objects', async () => {
  // state reload keeps source/result urls available
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: FAIL because restored state loses stable asset semantics

- [ ] **Step 3: Write minimal implementation**

```ts
// keep internal urls in persisted state
// preserve source dimensions and asset metadata needed after refresh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/Translation/translationProcessingUtils.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs utils/appState.ts types.ts modules/Translation/translationProcessingUtils.test.mjs
git commit -m "feat: restore persisted assets across state reloads"
```

### Task 5: Add 3-day cleanup and safe reference checks

**Files:**
- Modify: `server/index.mjs`
- Create: `server/assetCleanup.test.mjs`
- Modify: `server/assetStore.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('cleanup deletes expired unreferenced assets and keeps referenced assets', async () => {
  // create expired assets, mark one referenced, one unreferenced
  // expect only unreferenced asset removed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/assetCleanup.test.mjs`
Expected: FAIL because cleanup flow does not exist

- [ ] **Step 3: Write minimal implementation**

```js
// scheduled cleanup loop:
// 1. list expired assets
// 2. skip referenced assets
// 3. remove file
// 4. mark deleted
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/assetCleanup.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.mjs server/assetStore.mjs server/assetCleanup.test.mjs
git commit -m "feat: clean expired persisted assets"
```

### Task 6: Verify all core flows and document deployment/runtime needs

**Files:**
- Modify: `README.md`
- Modify: `docs/tencent-cloud-deploy.md`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test server/assetStore.test.mjs
node --test server/assetCleanup.test.mjs
node --test server/jobManager.test.mjs
node --test services/tencentCosService.test.mjs
node --test modules/Translation/translationProcessingUtils.test.mjs
```

Expected: PASS

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Update docs**

```md
- add server asset storage location
- add retention behavior
- add cleanup expectations
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/tencent-cloud-deploy.md
git commit -m "docs: document persistent asset storage runtime"
```
