# KIE Error Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single, reusable KIE error-governance layer that distinguishes balance failures from generic bad requests and preserves recoverable task semantics across all KIE-powered features.

**Architecture:** Keep the existing internal job system intact and centralize behavior in three places: server-side provider error normalization, client-side KIE result interpretation, and admin-log failure reason mapping. Do not add per-module patches in OneClick, Video, BuyerShow, or other feature modules.

**Tech Stack:** Node.js, Vite, TypeScript, plain `.mjs` tests with `node:test`, existing internal job APIs.

---

### Task 1: Lock failing provider behavior with tests

**Files:**
- Modify: `server/providerGateway.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('executeProviderJob maps KIE createTask code 402 to provider_credit_insufficient', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => createJsonResponse({
    code: 402,
    msg: 'Credits insufficient : Your current balance isn’t enough to run this request. Please top up to continue.',
    data: null,
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'test',
            imageUrls: ['https://example.com/source.png'],
            model: 'nano-banana-2',
            aspectRatio: '1:1',
            resolution: '1K',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_credit_insufficient'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob maps KIE createTask code 433 to provider_request_limit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => createJsonResponse({
    code: 433,
    msg: 'Sub-key Usage Exceeds Limit',
    data: null,
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'test',
            imageUrls: ['https://example.com/source.png'],
            model: 'nano-banana-2',
            aspectRatio: '1:1',
            resolution: '1K',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_request_limit'
    );
  } finally {
    global.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/providerGateway.test.mjs`
Expected: FAIL because the current implementation still throws `provider_bad_request`.

- [ ] **Step 3: Write minimal implementation**

```js
const normalizeKieTaskCreationError = (responseStatus, result = {}, defaultMessage) => {
  const code = Number(result?.code || 0);
  const message = String(result?.msg || defaultMessage || '').trim();

  if (responseStatus === 401 || responseStatus === 403 || code === 401 || code === 403) {
    return createProviderError('provider_auth_invalid', message || 'Kie 图像任务鉴权失败', { providerStage: 'create_task', providerStatus: 'auth_invalid' });
  }
  if (responseStatus === 429 || code === 429) {
    return createProviderError('provider_rate_limited', message || 'Kie 图像任务请求过于频繁', { providerStage: 'create_task', providerStatus: 'rate_limited' });
  }
  if (code === 402 || /credits insufficient/i.test(message)) {
    return createProviderError('provider_credit_insufficient', message || 'Kie 余额不足', { providerStage: 'create_task', providerStatus: 'credit_insufficient' });
  }
  if (code === 433 || /sub-?key|exceeds limit|request limit/i.test(message)) {
    return createProviderError('provider_request_limit', message || 'Kie 额度受限', { providerStage: 'create_task', providerStatus: 'request_limit' });
  }
  if (responseStatus >= 500 || code >= 500) {
    return createProviderError('provider_internal_error', message || 'Kie 图像任务服务异常', { providerStage: 'create_task', providerStatus: 'server_error' });
  }
  return createProviderError('provider_bad_request', message || 'Kie 图像任务创建失败', { providerStage: 'create_task', providerStatus: 'bad_request' });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/providerGateway.test.mjs`
Expected: PASS for the new `402` and `433` tests.

- [ ] **Step 5: Commit**

```bash
git add server/providerGateway.test.mjs server/providerGateway.mjs
git commit -m "test: lock kie provider error normalization"
```

### Task 2: Preserve recoverable KIE semantics without per-module patches

**Files:**
- Modify: `services/kieAiService.ts`
- Test: `services/kieAiService.test.mjs` or existing closest KIE test file if already present

- [ ] **Step 1: Write the failing tests**

```js
test('isRecoverableKieTaskResult requires providerTaskId for timeout-like failures', () => {
  assert.equal(isRecoverableKieTaskResult('', '任务执行超时', 'provider_timeout'), false);
  assert.equal(isRecoverableKieTaskResult('task-1', '任务执行超时', 'provider_timeout'), true);
});

test('credit-insufficient KIE failures are not treated as recoverable', () => {
  assert.equal(
    isRecoverableKieTaskResult('task-1', 'Credits insufficient', 'provider_credit_insufficient'),
    false
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test services/kieAiService.test.mjs`
Expected: FAIL because current logic treats some error text too broadly and has no explicit balance error exclusion.

- [ ] **Step 3: Write minimal implementation**

```ts
const KIE_NON_RECOVERABLE_ERROR_CODES = new Set([
  'provider_credit_insufficient',
  'provider_request_limit',
  'provider_auth_invalid',
  'provider_bad_request',
  'task_not_found',
]);

export const isRecoverableKieTaskResult = (taskId?: string, errorMessage?: string, errorCode?: string) => {
  if (!String(taskId || '').trim()) return false;
  if (errorCode && KIE_NON_RECOVERABLE_ERROR_CODES.has(String(errorCode))) return false;
  if (errorCode && KIE_AUTO_RECOVER_ERROR_CODES.has(String(errorCode))) return true;
  return KIE_RECOVERABLE_MESSAGE_PATTERN.test(String(errorMessage || ''));
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test services/kieAiService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/kieAiService.ts services/kieAiService.test.mjs
git commit -m "fix: tighten recoverable kie task semantics"
```

### Task 3: Centralize user-facing KIE error messaging

**Files:**
- Modify: `services/kieAiService.ts`
- Modify: `services/internalApi.ts`
- Test: `services/kieAiService.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('getUserFacingKieErrorMessage returns a recharge prompt for provider_credit_insufficient', () => {
  assert.equal(
    getUserFacingKieErrorMessage({
      status: 'error',
      taskId: '',
      message: 'Credits insufficient',
      errorCode: 'provider_credit_insufficient',
    }),
    '当前 KIE 账户余额不足，相关生图功能暂不可用，请充值后重试。'
  );
});

test('getUserFacingKieErrorMessage returns a recover hint for recoverable failures', () => {
  assert.equal(
    getUserFacingKieErrorMessage({
      status: 'error',
      taskId: 'task-1',
      message: '任务执行超时',
      errorCode: 'provider_timeout',
    }),
    '任务可能仍在云端继续处理，可稍后点击同步或找回结果。'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test services/kieAiService.test.mjs`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const getUserFacingKieErrorMessage = (result: Partial<KieAiResult> & { errorCode?: string }) => {
  const errorCode = String(result.errorCode || '').trim();

  if (errorCode === 'provider_credit_insufficient') {
    return '当前 KIE 账户余额不足，相关生图功能暂不可用，请充值后重试。';
  }
  if (errorCode === 'provider_request_limit') {
    return '当前 KIE 子额度或请求额度已达上限，请稍后重试或检查账号配置。';
  }
  if (isRecoverableKieTaskResult(result.taskId, result.message, errorCode)) {
    return '任务可能仍在云端继续处理，可稍后点击同步或找回结果。';
  }
  return String(result.message || '任务执行失败').trim() || '任务执行失败';
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test services/kieAiService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/kieAiService.ts services/kieAiService.test.mjs
git commit -m "feat: add shared user-facing kie error messaging"
```

### Task 4: Surface new error codes through job results

**Files:**
- Modify: `services/kieAiService.ts`
- Modify: `types.ts`

- [ ] **Step 1: Write the failing test**

```js
test('waitForJobResult returns errorCode for failed jobs', async () => {
  // Arrange fetchInternalJob / waitForInternalJob stub to return:
  // { status: 'failed', errorCode: 'provider_credit_insufficient', errorMessage: 'Credits insufficient' }
  // Assert result.errorCode === 'provider_credit_insufficient'
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test services/kieAiService.test.mjs`
Expected: FAIL because `KieAiResult` and `waitForJobResult` do not expose `errorCode`.

- [ ] **Step 3: Write minimal implementation**

```ts
return {
  imageUrl: '',
  taskId: getUserVisibleTaskId(finalJob),
  status: 'error',
  message: finalJob.errorMessage || '任务执行失败',
  errorCode: String(finalJob.errorCode || '').trim(),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test services/kieAiService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/kieAiService.ts types.ts services/kieAiService.test.mjs
git commit -m "feat: expose normalized kie error codes to clients"
```

### Task 5: Fix admin failure-reason mapping

**Files:**
- Modify: `modules/Account/accountManagementUtils.mjs`
- Modify: `modules/Account/accountManagementUtils.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
test('deriveLogFailureReason returns 余额不足 for provider_credit_insufficient', () => {
  assert.equal(
    deriveLogFailureReason({
      status: 'failed',
      detail: '',
      meta: { errorCode: 'provider_credit_insufficient', providerMessage: 'Credits insufficient' },
    }),
    '余额不足'
  );
});

test('deriveLogFailureReason returns 额度受限 for provider_request_limit', () => {
  assert.equal(
    deriveLogFailureReason({
      status: 'failed',
      detail: '',
      meta: { errorCode: 'provider_request_limit', providerMessage: 'Sub-key Usage Exceeds Limit' },
    }),
    '额度受限'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/Account/accountManagementUtils.test.mjs`
Expected: FAIL because current mapping falls through to `参数不合法` or generic failure.

- [ ] **Step 3: Write minimal implementation**

```js
if (providerStatus === 'credit_insufficient' || errorCode === 'provider_credit_insufficient') return '余额不足';
if (providerStatus === 'request_limit' || errorCode === 'provider_request_limit') return '额度受限';
if (providerStatus === 'recoverable_pending_result') return '结果待同步';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/Account/accountManagementUtils.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add modules/Account/accountManagementUtils.mjs modules/Account/accountManagementUtils.test.mjs
git commit -m "fix: classify kie balance and limit failures in admin logs"
```

### Task 6: Use shared KIE messaging in the core image/video service

**Files:**
- Modify: `services/kieAiService.ts`

- [ ] **Step 1: Write the failing test**

```js
test('waitForJobResult uses shared KIE error messaging for failed jobs', async () => {
  // Stub final job with provider_credit_insufficient and verify returned message
  // is the shared recharge prompt instead of raw provider text.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test services/kieAiService.test.mjs`
Expected: FAIL because `waitForJobResult` currently returns raw `errorMessage`.

- [ ] **Step 3: Write minimal implementation**

```ts
const userFacingMessage = getUserFacingKieErrorMessage({
  status: 'error',
  taskId: getUserVisibleTaskId(finalJob),
  message: finalJob.errorMessage || '任务执行失败',
  errorCode: String(finalJob.errorCode || '').trim(),
});

return {
  imageUrl: '',
  taskId: getUserVisibleTaskId(finalJob),
  status: 'error',
  message: userFacingMessage,
  errorCode: String(finalJob.errorCode || '').trim(),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test services/kieAiService.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/kieAiService.ts services/kieAiService.test.mjs
git commit -m "fix: use shared kie error prompts across modules"
```

### Task 7: Run focused regression and deploy verification

**Files:**
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`
- Modify: `services/kieAiService.ts`
- Modify: `services/kieAiService.test.mjs`
- Modify: `modules/Account/accountManagementUtils.mjs`
- Modify: `modules/Account/accountManagementUtils.test.mjs`
- Modify: `types.ts`

- [ ] **Step 1: Run focused automated tests**

Run:

```bash
node --test server/providerGateway.test.mjs services/kieAiService.test.mjs modules/Account/accountManagementUtils.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run broader regression**

Run:

```bash
node --test server/jobManager.test.mjs server/jobRuntime.test.mjs server/providerGateway.test.mjs
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Deploy to cloud**

Run:

```bash
./scripts/deploy_tencent.sh
```

Expected: Build succeeds, PM2 restarts `meiao-internal`, deploy script prints live URLs.

- [ ] **Step 4: Verify cloud behavior**

Run:

```bash
curl -sS http://111.229.66.247:3100/api/health
curl -sS -H "Authorization: Bearer <smoke-token>" "http://127.0.0.1:3100/api/jobs?limit=5"
```

Expected:

- Health endpoint returns `{"ok":true,...}`
- When KIE is funded, a real createTask succeeds
- When KIE returns balance errors in the future, the app now exposes `provider_credit_insufficient` and user-facing recharge messaging cleanly

- [ ] **Step 5: Commit**

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs services/kieAiService.ts services/kieAiService.test.mjs modules/Account/accountManagementUtils.mjs modules/Account/accountManagementUtils.test.mjs types.ts docs/superpowers/specs/2026-04-24-kie-error-governance-design.md docs/superpowers/plans/2026-04-24-kie-error-governance.md
git commit -m "feat: normalize kie balance and recoverable task errors"
```
