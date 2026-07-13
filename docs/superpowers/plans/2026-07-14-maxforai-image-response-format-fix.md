# MaxForAI Image-2 Response Format Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent successful Image-2 requests from being marked failed when MaxForAI returns `b64_json`, while continuing to prefer URL responses and preserving all paid-request retry protections.

**Architecture:** Add `response_format: "url"` to the shared Images API request body, normalize either `data[0].url` or `data[0].b64_json` to an internal `imageUrl`, and persist inline image data through the existing asset store before any job result is recorded. Keep only the managed URL and a non-sensitive `providerResponseFormat` marker in durable state.

**Tech Stack:** Node.js ESM, Node test runner, MaxForAI standard Images API, existing managed asset store, Temporal/local job workers.

## Global Constraints

- Both `/images/generations` and `/images/edits` requests include `response_format: "url"`.
- Success parsing accepts `data[0].url` first and valid `data[0].b64_json` second.
- Raw base64 never reaches job storage, Temporal history, logs, frontend state, source control, or build artifacts.
- Durable results include `providerResponseFormat: "url" | "b64_json"` and a normal managed `imageUrl`.
- Missing or invalid URL/base64 remains `provider_bad_response`; diagnostics expose field names only, never values.
- Existing zero credits, HTTP zero retries, Agent zero retries, Temporal `maximumAttempts: 1`, and `provider_submission_unknown` behavior remain unchanged.
- Perform only one new paid smoke after all automated checks. Do not retry it if it fails or is ambiguous.
- Push and deploy only after that smoke returns a valid persisted image.

---

### Task 1: Correct the Images API request and response contract

**Files:**
- Modify: `server/providerMaxForAiImage.test.mjs`
- Modify: `server/providerMaxForAiImage.mjs`

**Interfaces:**
- Consumes: `buildMaxForAiImageRequestBody({ payload, imageUrls, prompt })` and the upstream JSON response.
- Produces: request JSON containing `response_format: "url"`; job output with `result.imageUrl` and `result.providerResponseFormat`.

- [ ] **Step 1: Write failing provider tests**

Add assertions equivalent to:

```js
assert.deepEqual(buildMaxForAiImageRequestBody({
  payload: { model: 'maxforai-image-2-relay', prompt: '海报', aspectRatio: '1:1', resolution: '1K' },
  imageUrls: [],
}), {
  model: 'gpt-image-2',
  prompt: '海报',
  size: '1024x1024',
  n: 1,
  response_format: 'url',
});

assert.equal(b64Result.result.imageUrl, 'data:image/png;base64,aGVsbG8=');
assert.equal(b64Result.result.providerResponseFormat, 'b64_json');
assert.equal(urlResult.result.providerResponseFormat, 'url');
```

Add one missing-field test asserting `provider_bad_response` and confirming the error text contains only response field names.

- [ ] **Step 2: Run provider tests and verify RED**

Run:

```bash
node --test server/providerMaxForAiImage.test.mjs
```

Expected: FAIL because `response_format` and `b64_json` support do not exist.

- [ ] **Step 3: Implement minimal dual-format parsing**

Update the request body with:

```js
response_format: 'url',
```

Add an exported response normalizer with this contract:

```js
export const extractMaxForAiImageResult = (body = {}) => ({
  imageUrl: 'https://...' || 'data:image/png;base64,...',
  providerResponseFormat: 'url' || 'b64_json',
});
```

Use `parseDataUrlPayload` to validate raw or already-prefixed `b64_json`. On missing output, throw `provider_bad_response` with top-level and first-entry key names only.

- [ ] **Step 4: Run provider tests and verify GREEN**

Run the Step 2 command. Expected: all provider tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/providerMaxForAiImage.mjs server/providerMaxForAiImage.test.mjs
git commit -m "fix: accept Image-2 base64 responses"
```

### Task 2: Persist base64 results before durable job storage

**Files:**
- Modify: `server/assetStore.mjs`
- Modify: `server/assetStore.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/maxforaiIntegration.test.mjs`

**Interfaces:**
- Consumes: a provider result whose `imageUrl` may be an `image/*` data URL.
- Produces: `persistInlineImageResult({ result, persistAsset, persistOptions })`, returning a copy with managed `imageUrl` and `imageUrlAssetId`.

- [ ] **Step 1: Write failing asset persistence and wiring tests**

In `assetStore.test.mjs`, import the asset store as a namespace and assert the wished-for function exists, then call it with a stub `persistAsset`:

```js
const result = await assetStore.persistInlineImageResult({
  result: { imageUrl: 'data:image/png;base64,aGVsbG8=', providerResponseFormat: 'b64_json' },
  persistAsset: async ({ fileBuffer, mimeType }) => {
    assert.equal(fileBuffer.toString('utf8'), 'hello');
    assert.equal(mimeType, 'image/png');
    return { id: 'asset-1', publicUrl: '/api/assets/file/asset-1/result.png' };
  },
});
assert.equal(result.imageUrl, '/api/assets/file/asset-1/result.png');
assert.equal(result.imageUrlAssetId, 'asset-1');
assert.doesNotMatch(JSON.stringify(result), /aGVsbG8=/);
```

Add an HTTP URL test proving the persistence callback is not called. In `maxforaiIntegration.test.mjs`, assert `server/index.mjs` imports and invokes `persistInlineImageResult` inside `persistJobOutputAssetsIfEnabled`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test server/assetStore.test.mjs server/maxforaiIntegration.test.mjs
```

Expected: FAIL because `persistInlineImageResult` is not exported or wired.

- [ ] **Step 3: Implement inline persistence**

Add `persistInlineImageResult` after `persistAssetBuffer`. It must parse only `data:image/*;base64,...`, reject invalid/empty decoded data with `provider_bad_response`, call `persistAsset` with the decoded buffer, and replace the data URL without retaining it in any result field.

In `persistJobOutputAssetsIfEnabled`, process the inline result before the existing HTTP remote-field persistence:

```js
result = await persistInlineImageResult({
  result,
  persistOptions: {
    pool,
    publicBaseUrl,
    userId: job.userId,
    module: job.module,
    assetType: 'result',
    originalName: `${job.taskType || 'result'}.png`,
    provider: job.provider,
    jobId: job.id,
  },
});
```

If an inline result exists but `publicBaseUrl` or `job.userId` is unavailable, throw a sanitized `provider_bad_response` rather than returning the data URL.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/assetStore.mjs server/assetStore.test.mjs server/index.mjs server/maxforaiIntegration.test.mjs
git commit -m "fix: persist inline Image-2 results"
```

### Task 3: Correct documentation, verify, and gate release

**Files:**
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/agents/repeated-issues.md`
- Verify: all files changed since `4402129`.

**Interfaces:**
- Consumes: the corrected request/response and persistence behavior from Tasks 1-2.
- Produces: accurate operator documentation, regression evidence, one paid smoke result, and—only on success—a guarded cloud release.

- [ ] **Step 1: Update documentation**

Document that `response_format: "url"` is requested but the parser accepts both `url` and `b64_json`; base64 is immediately persisted and never stored raw. Add a repeated-issue entry containing symptom, root cause, fix, and prevention. Do not document `$0.07` or `$0.1` as billing remains disabled.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
node --test \
  server/providerMaxForAiImage.test.mjs \
  server/assetStore.test.mjs \
  server/maxforaiIntegration.test.mjs \
  server/agentMaxForAiRetry.test.mjs \
  server/temporalWorker.test.mjs \
  server/maxforaiEnvDocs.test.mjs
npm run verify
```

Expected: zero failures, ESLint within budget, and production build success.

- [ ] **Step 3: Run release review gates**

Run Hermes changed-file review, `git diff --check`, complete diff review, exact local-key scans against tracked files and `dist`, and searches proving no raw base64 fixture or key leaked into durable/build output.

- [ ] **Step 4: Restart local services and run doctor**

Restart `com.meiao.current.server` and `com.meiao.current.vite`, wait on actual health conditions, then run `npm run doctor`. Expected: ports 3000/3100 ready and Temporal worker healthy.

- [ ] **Step 5: Submit exactly one new paid local smoke**

Create one `maxforai-image-2-relay`, 1:1, 1K job with `maxRetries: 0`; poll only its job ID. Verify status `succeeded`, Temporal activity attempt `[1]`, unchanged credits, `providerResponseFormat` equal to `url` or `b64_json`, managed result URL, HTTP 200 image MIME, nonzero bytes, and readable dimensions.

- [ ] **Step 6: Stop if the smoke fails or is ambiguous**

Do not retry, push, change cloud secrets, or deploy. Report sanitized job evidence.

- [ ] **Step 7: Commit docs and push only after successful smoke**

```bash
git add docs/project-overview.md docs/tencent-cloud-deploy.md docs/agents/repeated-issues.md
git commit -m "docs: correct Image-2 response contract"
git push origin feat/stability-phase2
```

- [ ] **Step 8: Update cloud env and deploy**

Back up remote `.env.server`, atomically copy only local `MAXFORAI_*` assignments without printing values, then run:

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

- [ ] **Step 9: Verify cloud health and active assets**

Verify `http://meiaoyuntai.com/api/health`, PM2, log tail, active asset chain, `image-2中转` presence, retired-label absence, and no secret/base64 leakage. Update the external diagnostic record only after deployment succeeds.
