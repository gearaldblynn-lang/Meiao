# KIE Managed Asset Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route managed assets through the Meiao HTTPS origin first, fall back to a throttled and cached KIE upload only for safe pre-task media-read failures, and preserve the no-duplicate-submit invariant.

**Architecture:** `providerAssetTransfer` owns route selection and successful KIE URL caching, a focused semaphore module caps process-wide uploads, and `providerGateway` retries the same provider model with forced KIE media only when a direct media failure has no provider task id. Existing per-task image resolution limits and job-level retry remain in place as independent protection layers.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing provider gateway and KIE adapters, environment-driven production configuration.

---

## File Map

- Create `server/providerAssetUploadLimiter.mjs`: cancellable process-wide semaphore for KIE file uploads.
- Create `server/providerAssetUploadLimiter.test.mjs`: concurrency and queued-cancellation tests.
- Modify `server/providerAssetTransfer.mjs`: HTTPS route mode, canonical public URL, process cache, route-aware resolvers.
- Modify `server/providerAssetTransfer.test.mjs`: route and cache regression tests.
- Modify `server/providerGateway.mjs`: upload retry policy, direct media failure classifier, same-model KIE fallback, task-id safety.
- Modify `server/providerGateway.test.mjs`: end-to-end image/chat fallback and no-double-submit tests.
- Modify `.env.server.example`, `docs/project-overview.md`, and `docs/tencent-cloud-deploy.md`: environment contract and rollback instructions.
- Modify `docs/agents/repeated-issues.md` and `CLAUDE.md`: recurring production root cause and prevention rule.

### Task 1: Managed asset route mode and successful upload cache

**Files:**
- Modify: `server/providerAssetTransfer.test.mjs`
- Modify: `server/providerAssetTransfer.mjs`

- [ ] **Step 1: Write failing route tests**

Add tests that import `resolveProviderGenerationMediaUrl`, `resolveProviderChatMediaUrl`, and `__testOnly_clearManagedAssetUploadCache`. The first test supplies an old HTTP managed URL plus `MEIAO_PUBLIC_BASE_URL=https://meiaoyuntai.com` and expects the canonical HTTPS URL without download/upload. The second sets `MEIAO_KIE_MANAGED_ASSET_MODE=kie-only` and expects one upload. The third starts two forced uploads for the same managed path and expects the upload dependency to run once and both calls to receive the same URL.

```js
test('generation and chat use the canonical HTTPS origin in direct-first mode', async () => {
  const env = {
    MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
    MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
  };
  const deps = {
    fetchWithTimeout: async () => { throw new Error('must not download'); },
    uploadAssetViaKieWithFallback: async () => { throw new Error('must not upload'); },
  };
  assert.equal(
    await resolveProviderGenerationMediaUrl('http://111.229.66.247/api/assets/file/a/source.png', { env, deps }),
    'https://meiaoyuntai.com/api/assets/file/a/source.png'
  );
  assert.equal(
    await resolveProviderChatMediaUrl('/api/assets/file/a/source.png', { env, deps }),
    'https://meiaoyuntai.com/api/assets/file/a/source.png'
  );
});
```

- [ ] **Step 2: Run the route tests and verify RED**

Run: `node --test server/providerAssetTransfer.test.mjs`

Expected: the direct-first resolver test fails because generation/chat still force upload, and the cache test reports two uploads.

- [ ] **Step 3: Implement route selection and cache**

Add exports with these contracts:

```js
export const resolveKieManagedAssetMode = (env = {}) => 'direct-first' | 'kie-only';
export const shouldUseDirectManagedAssetUrls = (env = {}) => boolean;
export const __testOnly_clearManagedAssetUploadCache = () => void;
```

`auto` and `direct-first` return `direct-first` only when the configured public base is external HTTPS. `resolveExternallyReachableManagedAssetUrl` prefers the configured HTTPS base for any managed asset path. Generation/chat resolvers compute `forceUpload` as `options.forceUpload || !shouldUseDirectManagedAssetUrls(env)`.

Wrap only forced managed uploads in a process cache keyed by `getManagedAssetPath(assetUrl)`. Store the in-flight Promise immediately, delete it on rejection or empty URL, expire after `MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS` (default `1_800_000`), and evict oldest entries over `MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES` (default `2_000`).

- [ ] **Step 4: Run the route tests and verify GREEN**

Run: `node --test server/providerAssetTransfer.test.mjs`

Expected: all provider asset transfer tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/providerAssetTransfer.mjs server/providerAssetTransfer.test.mjs
git commit -m "fix(provider): route managed assets through HTTPS first"
```

### Task 2: Process-wide KIE upload limiter and transfer-safe response retries

**Files:**
- Create: `server/providerAssetUploadLimiter.mjs`
- Create: `server/providerAssetUploadLimiter.test.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/providerGateway.mjs`

- [ ] **Step 1: Write failing limiter and upload retry tests**

The limiter test runs four deferred operations with limit 2 and asserts `maxActive === 2`. A second test aborts a queued operation and expects `request_cancelled`. In `providerGateway.test.mjs`, add a stream-upload test where responses are 503, 503, then 200 and assert three fetches. Keep the existing createTask POST 502 test asserting one fetch.

```js
test('process-wide upload limiter caps concurrent transfers', async () => {
  let active = 0;
  let maxActive = 0;
  await Promise.all(Array.from({ length: 4 }, () => withKieAssetUploadSlot(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  }, { limit: 2 })));
  assert.equal(maxActive, 2);
});
```

- [ ] **Step 2: Run the limiter and upload tests and verify RED**

Run: `node --test server/providerAssetUploadLimiter.test.mjs server/providerGateway.test.mjs --test-name-pattern "upload limiter|stream upload retries|提交类 POST"`

Expected: module-not-found for the new limiter or missing export, and the upload 503 test observes only one request.

- [ ] **Step 3: Implement the cancellable semaphore**

Export:

```js
export const withKieAssetUploadSlot = async (operation, { limit = 3, signal } = {}) => unknown;
export const __testOnly_resetKieAssetUploadLimiters = () => void;
```

Maintain one semaphore per normalized limit. Queue waiters FIFO, remove and reject an aborted waiter with an error carrying `code='request_cancelled'`, and release the slot in `finally`.

- [ ] **Step 4: Implement upload-specific retry options**

Extend `fetchKieWithTimeout` with a final request options object:

```js
{
  idempotent: true,
  maxRetries: getKieAssetUploadRetries(env),
  retryBaseMs: getKieAssetUploadRetryBaseMs(env),
  retryableResponseStatuses: new Set([429, 500, 502, 503, 504]),
}
```

`uploadAssetViaKieStream(payload, env, signal)` enters `withKieAssetUploadSlot`, then performs the upload with these options. Defaults are concurrency 3, retries 2, and retry base 1000 ms. Do not change the default createTask/chat POST idempotency rule.

- [ ] **Step 5: Run the limiter and gateway retry tests and verify GREEN**

Run: `node --test server/providerAssetUploadLimiter.test.mjs server/providerGateway.test.mjs --test-name-pattern "upload limiter|stream upload retries|提交类 POST"`

Expected: all selected tests pass; upload 503 recovers in three attempts while createTask POST 502 remains one attempt.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/providerAssetUploadLimiter.mjs server/providerAssetUploadLimiter.test.mjs server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "fix(provider): throttle and retry KIE asset uploads"
```

### Task 3: Safe direct-media fallback for image and chat providers

**Files:**
- Modify: `server/providerGateway.test.mjs`
- Modify: `server/providerGateway.mjs`

- [ ] **Step 1: Write failing image fallback tests**

Create a `kie_image` test with one managed image. The first createTask response returns `code:400,msg:'Failed to get the file information'`; the second succeeds. Assert the first body uses `https://meiaoyuntai.com/...`, exactly one file upload occurs, the second body uses the KIE URL, and both attempts use the same model. Add a second test where createTask succeeds but polling throws the same text with `providerTaskId`; assert no upload and only one createTask.

- [ ] **Step 2: Write failing chat fallback tests**

Create a `kie_chat` test whose first same-model response says `Failed to get the file information`, then upload succeeds, then the same endpoint succeeds using the KIE URL. Add an HTTP 502 variant for Responses. Add a response containing both file-read text and a real provider task id, and assert it does not upload or resubmit.

- [ ] **Step 3: Run the fallback tests and verify RED**

Run: `node --test server/providerGateway.test.mjs --test-name-pattern "direct managed asset|direct media|task id prevents media fallback"`

Expected: direct URLs are currently pre-uploaded, and no same-model media fallback exists.

- [ ] **Step 4: Implement route-aware media preparation**

Pass `forceManagedAssetUpload` and `mediaUrlCache` through Responses, Claude, Gemini Flash, Gemini 3.5, and chat-completions preparation. Key the per-job cache as `${forceManagedAssetUpload ? 'kie' : 'direct'}:${rawUrl}` so the forced second attempt cannot reuse the first direct URL.

- [ ] **Step 5: Implement the safe fallback classifier and wrapper**

Add a classifier equivalent to:

```js
const shouldRetryWithKieManagedAsset = ({ payload, env, error, options, taskType }) => {
  if (!shouldUseDirectManagedAssetUrls(env)) return false;
  if (options.forceManagedAssetUpload || options.directMediaFallbackAttempted) return false;
  if (!payloadContainsManagedAsset(payload)) return false;
  if (String(error?.providerTaskId || '').trim()) return false;
  if (DIRECT_MEDIA_READ_ERROR_PATTERN.test(String(error?.providerMessage || error?.message || ''))) return true;
  return taskType === 'kie_chat'
    && error?.code === 'provider_internal_error'
    && Number(error?.providerHttpStatus) === 502;
};
```

On match, retry the same payload/model with `forceManagedAssetUpload:true` and `directMediaFallbackAttempted:true`. For chat, perform this recovery before existing model fallback. Attach any extracted task id to provider error text before throwing, and add `providerHttpStatus` in `mapHttpError` and task-creation errors.

- [ ] **Step 6: Run the fallback tests and verify GREEN**

Run: `node --test server/providerGateway.test.mjs --test-name-pattern "direct managed asset|direct media|task id prevents media fallback"`

Expected: same-model fallback works before task creation, and all task-id safety tests pass without extra upload/create requests.

- [ ] **Step 7: Commit Task 3**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "fix(provider): fall back to KIE only on safe media read failures"
```

### Task 4: Configuration, root-cause record, and full verification

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify: `docs/agents/repeated-issues.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document environment and rollback**

Add these conservative defaults and explain that only managed `/api/assets/file/` URLs use direct-first routing:

```dotenv
MEIAO_KIE_MANAGED_ASSET_MODE=auto
MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY=3
MEIAO_KIE_ASSET_UPLOAD_RETRIES=2
MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS=1000
MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS=1800000
MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES=2000
```

Document `kie-only` as the no-code rollback.

- [ ] **Step 2: Record the recurring root cause**

Add a dated entry describing: cross-task forced KIE staging remained a single point of failure; direct HTTPS plus task-id-safe fallback fixes it; future provider retries must distinguish file transfer from billable task submission.

- [ ] **Step 3: Run focused provider and job tests**

Run:

```bash
node --test \
  server/providerAssetUploadLimiter.test.mjs \
  server/providerAssetTransfer.test.mjs \
  server/providerKieImage.test.mjs \
  server/providerGateway.test.mjs \
  server/jobRuntime.test.mjs \
  server/jobManager.test.mjs \
  server/temporalWorker.test.mjs
```

Expected: zero failed tests.

- [ ] **Step 4: Run repository gates**

Run:

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed \
  server/providerAssetUploadLimiter.mjs \
  server/providerAssetTransfer.mjs \
  server/providerGateway.mjs
npm run lint
npm run build
```

Expected: harness completes, lint exits 0, and build exits 0.

- [ ] **Step 5: Commit documentation**

```bash
git add .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md docs/agents/repeated-issues.md CLAUDE.md
git commit -m "docs: record resilient managed asset routing"
```

- [ ] **Step 6: Review the complete diff**

Review `git diff HEAD~4..HEAD` for data isolation, public URL construction, cache scope, task-id safety, provider logging fields, permissions, and unchanged billable POST retry behavior. Fix every Critical or Important issue and rerun the relevant tests.

### Task 5: Production release and evidence

**Files:**
- External config: `/www/wwwroot/meiao-internal/.env.server`
- External dashboard: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板`

- [ ] **Step 1: Record the committed fix in the diagnostics dashboard**

Run `npm run record-fix -- --help`, then invoke the documented command with the production fingerprint, root cause, changed files, commit SHA, tests, and rollback mode. Verify the dashboard contains the new entry.

- [ ] **Step 2: Configure production routing**

Back up `.env.server`, retain `MEIAO_PUBLIC_BASE_URL=https://meiaoyuntai.com`, and set:

```dotenv
MEIAO_KIE_MANAGED_ASSET_MODE=direct-first
MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY=3
MEIAO_KIE_ASSET_UPLOAD_RETRIES=2
MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS=1000
MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS=1800000
MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES=2000
```

- [ ] **Step 3: Deploy after the code-review gate**

Run: `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`

Expected: install, audit, build, PM2 restart, and deployment script complete successfully.

- [ ] **Step 4: Verify production**

Verify:

```bash
curl -fsS https://meiaoyuntai.com/api/health
curl -fsSI https://meiaoyuntai.com/api/assets/file/9d69825762e0fd22bfcdb5e9/1-1.png
```

Then submit one real managed-asset smoke job. Confirm health remains `ok:true` and `worker.healthy:true`, the job receives a provider task id and succeeds, and logs show no `asset_upload` for the normal direct route. Pull the current day's logs and verify no new regression cluster.

---

## Plan Self-Review

- Spec coverage: direct route, KIE fallback, no duplicate task, limiter, retry, cache, rollback, docs, dashboard, and production verification are all assigned to tasks.
- Placeholder scan: every implementation and verification step names an exact function, setting, command, or existing production asset.
- Type consistency: all new flags use `forceManagedAssetUpload` and `directMediaFallbackAttempted`; all upload settings use the `MEIAO_KIE_ASSET_UPLOAD_*` prefix.
