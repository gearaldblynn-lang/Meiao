# Provider Gateway and Source-Shape Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the first two architecture efforts: deepen the Provider 网关 and migrate high-risk source-shape tests to behavior tests.

**Architecture:** Keep `server/providerGateway.mjs` as the public dispatcher. Move cohesive KIE image orchestration into `server/providerKieImage.mjs`, move asset-transfer behavior into `server/providerAssetTransfer.mjs`, then create a narrow chat route harness before removing high-risk `server/index.mjs` source-shape assertions.

**Tech Stack:** Node native test runner, ESM `.mjs` server modules, TypeScript-stripping Node tests for frontend service tests, Hermes harness.

---

## File Structure

- Create: `server/providerKieImage.mjs`
  - Own KIE image createTask body construction, task id notification, polling delegation, and provider task id preservation.
- Create: `server/providerKieImage.test.mjs`
  - Behavior tests for payload shape, image URL resolution, prompt URL rewriting, task id notification, and poll failure task id attachment.
- Create: `server/providerAssetTransfer.mjs`
  - Own managed asset download/upload, remote media download validation, data URL conversion, and KIE upload fallback.
- Create: `server/providerAssetTransfer.test.mjs`
  - Behavior tests for public managed URL preference, forced upload, SSRF guard, byte limits, data URL upload, and stream-to-base64 fallback.
- Modify: `server/providerGateway.mjs`
  - Import the new modules, remove moved implementation details, keep `executeProviderJob` behavior unchanged.
- Modify: `server/providerGateway.test.mjs`
  - Keep end-to-end provider routing tests; do not duplicate detailed module tests.
- Create or modify: `server/agentChatRouteHarness.mjs`
  - Provide a small seam for chat route behavior tests without rewriting all of `server/index.mjs`.
- Modify: `server/agentConversationReliability.test.mjs`
  - Migrate high-risk route behavior assertions from source grep to harness-driven behavior tests.

---

### Task 0: Baseline Verification For Current Working Tree

**Files:**
- No file changes.

- [ ] **Step 1: Run focused server tests for the current provider/source-shape slice**

Run:

```bash
node --test server/providerKieTask.test.mjs server/providerBodyRead.test.mjs server/providerGateway.test.mjs server/chatReasoningDefaultsSource.test.mjs server/chatSessionListIsolation.test.mjs server/agentCenterSource.test.mjs server/agentConversationReliability.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs
```

Expected: all tests pass. If this fails, stop and fix the existing slice before starting Task 1.

- [ ] **Step 2: Run focused frontend/service tests**

Run:

```bash
node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/OneClick/oneClickGenerationRun.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/services/kieAiService.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Run Hermes harness on current changed files**

Run:

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/providerGateway.mjs --changed server/providerBodyRead.mjs --changed server/providerKieTask.mjs --changed server/index.mjs --changed server/chatSessionRules.mjs --changed src/services/internalApi.test.mjs --changed server/chatReasoningDefaultsSource.test.mjs --changed server/chatSessionListIsolation.test.mjs
```

Expected: Hermes status OK. Record any suggested verification and run it before moving on.

---

### Task 1: KIE Image Module Red Tests

**Files:**
- Create: `server/providerKieImage.test.mjs`
- Create later: `server/providerKieImage.mjs`

- [ ] **Step 1: Write the failing KIE image behavior tests**

Create `server/providerKieImage.test.mjs` with this structure:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKieImageTaskRequestBody,
  runKieImageJob,
} from './providerKieImage.mjs';

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const createDeps = (overrides = {}) => ({
  kieApiKey: 'test-key',
  createTaskUrl: 'https://api.kie.ai/api/v1/jobs/createTask',
  fetchWithTimeout: async () => createJsonResponse({ code: 200, data: { taskId: 'kie-task-1' } }),
  pollKieTask: async (taskId) => ({
    providerTaskId: taskId,
    providerStage: 'completed',
    providerStatus: 'success',
    result: {
      taskId,
      providerTaskId: taskId,
      imageUrl: 'https://cdn.test/result.png',
      status: 'success',
    },
  }),
  wait: async () => {},
  resolveGenerationMediaUrl: async (url) => `resolved:${url}`,
  ...overrides,
});

test('buildKieImageTaskRequestBody preserves GPT Image 2 image edit payload shape', () => {
  const requestBody = buildKieImageTaskRequestBody({
    payload: {
      model: 'gpt-image-2',
      prompt: 'replace background',
      imageUrls: ['https://cdn.test/source.png'],
      aspectRatio: '1:1',
      resolution: '2K',
    },
    imageUrls: ['https://cdn.test/source.png'],
    prompt: 'replace background',
  });

  assert.equal(requestBody.model, 'gpt-image-2-image-to-image');
  assert.deepEqual(requestBody.input.input_urls, ['https://cdn.test/source.png']);
  assert.equal(requestBody.input.prompt, 'replace background');
  assert.equal(requestBody.input.aspect_ratio, '1:1');
  assert.equal(requestBody.input.resolution, '2K');
  assert.equal('image_input' in requestBody.input, false);
});

test('runKieImageJob resolves duplicate input and prompt media URLs once', async () => {
  const resolved = [];
  let createTaskBody = null;
  await runKieImageJob({
    payload: {
      model: 'gpt-image-2',
      prompt: 'use /api/assets/file/a.png and /api/assets/file/a.png',
      imageUrls: ['/api/assets/file/a.png', '/api/assets/file/a.png'],
      aspectRatio: 'auto',
    },
    signal: new AbortController().signal,
    options: {},
    deps: createDeps({
      resolveGenerationMediaUrl: async (url) => {
        resolved.push(url);
        return `https://public.test${url}`;
      },
      fetchWithTimeout: async (_url, init) => {
        createTaskBody = JSON.parse(init.body);
        return createJsonResponse({ code: 200, data: { taskId: 'kie-task-1' } });
      },
    }),
  });

  assert.deepEqual(resolved, ['/api/assets/file/a.png']);
  assert.deepEqual(createTaskBody.input.input_urls, ['https://public.test/api/assets/file/a.png', 'https://public.test/api/assets/file/a.png']);
  assert.match(createTaskBody.input.prompt, /https:\/\/public\.test\/api\/assets\/file\/a\.png/);
});

test('runKieImageJob notifies provider task id before polling completes', async () => {
  const events = [];
  await runKieImageJob({
    payload: { model: 'nano-banana-2', prompt: 'test', imageUrls: [] },
    signal: new AbortController().signal,
    options: {
      onProviderTaskId: async (taskId) => events.push(`notify:${taskId}`),
    },
    deps: createDeps({
      pollKieTask: async (taskId) => {
        events.push(`poll:${taskId}`);
        return {
          providerTaskId: taskId,
          providerStage: 'completed',
          providerStatus: 'success',
          result: { imageUrl: 'https://cdn.test/result.png' },
        };
      },
    }),
  });

  assert.deepEqual(events, ['notify:kie-task-1', 'poll:kie-task-1']);
});

test('runKieImageJob attaches provider task id when polling fails', async () => {
  await assert.rejects(
    () => runKieImageJob({
      payload: { model: 'nano-banana-2', prompt: 'test', imageUrls: [] },
      signal: new AbortController().signal,
      options: {},
      deps: createDeps({
        pollKieTask: async () => {
          const error = new Error('bad input');
          error.code = 'provider_bad_request';
          throw error;
        },
      }),
    }),
    (error) => error?.code === 'provider_bad_request'
      && error?.providerTaskId === 'kie-task-1'
      && /bad input/.test(error.message)
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test server/providerKieImage.test.mjs
```

Expected: fail because `server/providerKieImage.mjs` does not exist.

---

### Task 2: Implement KIE Image Module

**Files:**
- Create: `server/providerKieImage.mjs`
- Modify: `server/providerGateway.mjs`

- [ ] **Step 1: Create the minimal module**

Create `server/providerKieImage.mjs` with these exports:

```js
import { GPT_IMAGE_2_DEFAULT_RESOLUTION, normalizeGptImage2Resolution } from '../src/utils/gptImage2.mjs';
import { allowConcurrentAbortListeners } from './providerBodyRead.mjs';
import { attachProviderTaskId, pollKieTask as defaultPollKieTask } from './providerKieTask.mjs';

export const KIE_IMAGE_MODEL_ALIASES = {
  'gpt-image-2': {
    text: 'gpt-image-2-text-to-image',
    image: 'gpt-image-2-image-to-image',
    maxInputImages: 16,
    pollRetries: 150,
    supportedAspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
  },
};

export const extractKieImageTextMediaUrls = (text = '') => {
  const source = String(text || '');
  const urls = new Set();
  (source.match(/https?:\/\/[^\s"'<>，。；、）)\]】]+/gi) || []).forEach((url) => {
    const normalized = String(url || '').trim();
    if (normalized) urls.add(normalized);
  });
  for (const match of source.matchAll(/(^|[\s"'(<（[【：])((?:\/api\/assets\/file\/[^\s"'<>，。；、）)\]】]+))/gi)) {
    const normalized = String(match?.[2] || '').trim();
    if (normalized) urls.add(normalized);
  }
  return Array.from(urls);
};

export const rewriteKieImageTextMediaUrls = async (text, resolveMediaUrl) => {
  const source = String(text || '');
  let rewritten = source;
  for (const rawUrl of extractKieImageTextMediaUrls(source)) {
    const resolvedUrl = await resolveMediaUrl(rawUrl);
    if (!resolvedUrl || resolvedUrl === rawUrl) continue;
    rewritten = rewritten.replace(new RegExp(String(rawUrl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), resolvedUrl);
  }
  return rewritten;
};

export const buildKieImageTaskRequestBody = ({ payload, imageUrls, prompt }) => {
  const gptImageAlias = KIE_IMAGE_MODEL_ALIASES[payload.model];
  const limitedImageUrls = gptImageAlias ? imageUrls.slice(0, gptImageAlias.maxInputImages) : imageUrls;
  const normalizedAspectRatio = String(payload.aspectRatio || 'auto').trim() || 'auto';
  const normalizedResolution = gptImageAlias
    ? normalizeGptImage2Resolution(normalizedAspectRatio, payload.resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION)
    : String(payload.resolution || '1K').trim().toUpperCase();

  if (!gptImageAlias) {
    return {
      model: payload.model || 'gpt-image-2',
      input: {
        prompt,
        image_input: limitedImageUrls,
        aspect_ratio: payload.aspectRatio || 'auto',
        resolution: payload.resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION,
        output_format: 'png',
      },
    };
  }

  return {
    model: limitedImageUrls.length > 0 ? gptImageAlias.image : gptImageAlias.text,
    input: {
      prompt,
      ...(limitedImageUrls.length > 0 ? { input_urls: limitedImageUrls } : {}),
      ...((gptImageAlias.supportedAspectRatios || []).includes(String(payload.aspectRatio || 'auto'))
        ? { aspect_ratio: normalizedAspectRatio }
        : {}),
      resolution: normalizedResolution,
    },
  };
};

export const runKieImageJob = async ({ payload, signal, options = {}, deps }) => {
  const {
    kieApiKey,
    createTaskUrl,
    fetchWithTimeout,
    resolveGenerationMediaUrl,
    pollKieTask = defaultPollKieTask,
    wait,
  } = deps;
  const rawImageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls : [];
  const textMediaUrls = extractKieImageTextMediaUrls(payload.prompt || '');
  allowConcurrentAbortListeners(signal, rawImageUrls.length + textMediaUrls.length);

  const resolvedGenerationUrlByRawUrl = new Map();
  const resolveGenerationUrl = async (url) => {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return '';
    if (!resolvedGenerationUrlByRawUrl.has(rawUrl)) {
      resolvedGenerationUrlByRawUrl.set(rawUrl, resolveGenerationMediaUrl(rawUrl));
    }
    return resolvedGenerationUrlByRawUrl.get(rawUrl);
  };

  const imageUrls = await Promise.all(rawImageUrls.map((item) => resolveGenerationUrl(item)));
  const prompt = await rewriteKieImageTextMediaUrls(payload.prompt || '', resolveGenerationUrl);
  const requestBody = buildKieImageTaskRequestBody({ payload, imageUrls, prompt });
  const response = await fetchWithTimeout(createTaskUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  }, 'Kie 图像任务创建超时');
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    const error = new Error(result?.msg || 'Kie 图像任务创建失败');
    error.code = response.status === 401 || response.status === 403 ? 'provider_auth_invalid' : 'provider_bad_request';
    throw error;
  }
  const taskId = result.data.taskId;
  if (typeof options?.onProviderTaskId === 'function') {
    await options.onProviderTaskId(taskId);
  }

  try {
    const imageResult = await pollKieTask(taskId, {
      kieApiKey,
      signal,
      model: payload.model,
      fetchWithTimeout,
      wait,
      pollRetries: KIE_IMAGE_MODEL_ALIASES[payload.model]?.pollRetries,
    });
    return {
      ...imageResult,
      providerTaskId: imageResult.providerTaskId || taskId,
      providerStage: imageResult.providerStage || 'completed',
      providerStatus: imageResult.providerStatus || 'success',
    };
  } catch (error) {
    throw attachProviderTaskId(error, taskId);
  }
};
```

- [ ] **Step 2: Verify KIE image module tests pass**

Run:

```bash
node --test server/providerKieImage.test.mjs
```

Expected: pass.

- [ ] **Step 3: Wire `server/providerGateway.mjs` to the new module**

Modify `server/providerGateway.mjs`:

```js
import { runKieImageJob as runKieImageJobModule } from './providerKieImage.mjs';
```

Replace the old local `runKieImageJob` body with a wrapper:

```js
const runKieImageJob = async (payload, env, signal, options = {}) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  assertSupportedGenerationImageReferences([
    ...(Array.isArray(payload.imageUrls) ? payload.imageUrls : []),
    ...Array.from(extractTextMediaUrls(payload.prompt || '')),
  ]);
  return runKieImageJobModule({
    payload,
    signal,
    options,
    deps: {
      kieApiKey,
      createTaskUrl: KIE_CREATE_TASK_URL,
      fetchWithTimeout: fetchKieWithTimeout,
      resolveGenerationMediaUrl: (url) => resolveProviderGenerationMediaUrl(url, env, signal),
      pollKieTask,
      wait,
    },
  });
};
```

- [ ] **Step 4: Verify gateway behavior still passes**

Run:

```bash
node --test server/providerKieImage.test.mjs server/providerGateway.test.mjs
```

Expected: pass.

---

### Task 3: Provider Asset Transfer Red Tests

**Files:**
- Create: `server/providerAssetTransfer.test.mjs`
- Create later: `server/providerAssetTransfer.mjs`

- [ ] **Step 1: Write failing asset-transfer behavior tests**

Create `server/providerAssetTransfer.test.mjs` with this structure:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRemoteProviderMediaUrlAllowed,
  convertInlineDataUrlToKieFileUrl,
  convertManagedAssetUrlToKieFileUrl,
  readRemoteMediaBufferWithLimit,
  uploadAssetViaKieWithFallback,
} from './providerAssetTransfer.mjs';

const createResponse = (body, headers = {}) => new Response(body, { status: 200, headers });

test('convertManagedAssetUrlToKieFileUrl prefers externally reachable managed asset URLs', async () => {
  const url = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/user/a.png', {
    env: { MEIAO_PUBLIC_BASE_URL: 'https://public.test' },
    signal: new AbortController().signal,
    deps: {
      fetchWithTimeout: async () => { throw new Error('should not download'); },
      uploadAssetViaKieWithFallback: async () => { throw new Error('should not upload'); },
    },
  });

  assert.equal(url, 'https://public.test/api/assets/file/user/a.png');
});

test('convertManagedAssetUrlToKieFileUrl force uploads managed assets', async () => {
  const uploaded = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/user/a.png', {
    env: {},
    signal: new AbortController().signal,
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async (payload) => ({
        result: {
          fileUrl: `https://kie.test/${payload.fileName}`,
        },
      }),
    },
  });

  assert.equal(uploaded, 'https://kie.test/a.png');
});

test('assertRemoteProviderMediaUrlAllowed rejects local and private URLs', () => {
  for (const value of ['http://localhost/a.png', 'http://127.0.0.1/a.png', 'http://192.168.1.5/a.png', 'file:///tmp/a.png']) {
    assert.throws(() => assertRemoteProviderMediaUrlAllowed(value), /远程素材/);
  }
});

test('readRemoteMediaBufferWithLimit rejects oversized content length and post-read body', async () => {
  await assert.rejects(
    () => readRemoteMediaBufferWithLimit({
      headers: { get: () => String(3) },
      arrayBuffer: async () => new ArrayBuffer(0),
    }, '远程素材', { maxBytes: 2 }),
    /远程素材过大/
  );

  await assert.rejects(
    () => readRemoteMediaBufferWithLimit(createResponse('abc'), '远程素材', { maxBytes: 2 }),
    /远程素材过大/
  );
});

test('convertInlineDataUrlToKieFileUrl uploads with inferred extension', async () => {
  const url = await convertInlineDataUrlToKieFileUrl('data:image/png;base64,aGVsbG8=', {
    env: {},
    deps: {
      uploadAssetViaKieWithFallback: async (payload) => {
        assert.equal(payload.fileName, 'inline-upload.png');
        assert.equal(payload.mimeType, 'image/png');
        return { result: { fileUrl: 'https://kie.test/inline-upload.png' } };
      },
    },
  });

  assert.equal(url, 'https://kie.test/inline-upload.png');
});

test('uploadAssetViaKieWithFallback falls back only for transient upload errors', async () => {
  const calls = [];
  const result = await uploadAssetViaKieWithFallback({
    fileBuffer: Buffer.from('hello'),
    mimeType: 'text/plain',
    fileName: 'a.txt',
  }, {
    env: {},
    deps: {
      uploadAssetViaKieStream: async () => {
        calls.push('stream');
        const error = new Error('timeout');
        error.code = 'provider_timeout';
        throw error;
      },
      uploadAssetViaKieBase64: async (payload) => {
        calls.push(`base64:${payload.base64Data}`);
        return { result: { fileUrl: 'https://kie.test/a.txt' } };
      },
    },
  });

  assert.deepEqual(calls, ['stream', 'base64:aGVsbG8=']);
  assert.equal(result.result.fileUrl, 'https://kie.test/a.txt');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test server/providerAssetTransfer.test.mjs
```

Expected: fail because `server/providerAssetTransfer.mjs` does not exist.

---

### Task 4: Implement Provider Asset Transfer Module

**Files:**
- Create: `server/providerAssetTransfer.mjs`
- Modify: `server/providerGateway.mjs`

- [ ] **Step 1: Move asset-transfer helpers into a tested module**

Create `server/providerAssetTransfer.mjs` by moving these existing behaviors from `server/providerGateway.mjs`:

```js
isManagedAssetUrl
getManagedAssetPath
resolveExternallyReachableManagedAssetUrl
normalizeManagedAssetDownloadUrl
extractFileNameFromUrl
inferMimeTypeFromName
inferExtensionFromMimeType
detectMimeTypeFromBuffer
ensureProviderFileNameWithExtension
parseDataUrlPayload
uploadAssetViaKieWithFallback
convertInlineDataUrlToKieFileUrl
downloadManagedAsset
convertManagedAssetUrlToKieFileUrl
assertRemoteProviderMediaUrlAllowed
readRemoteMediaBufferWithLimit
downloadRemoteMediaUrl
downloadRemoteProviderMediaUrl
convertGeminiMediaToStableKieUrl
convertGeminiVideoToOpenRouterChatUrl
resolveProviderChatMediaUrl
resolveProviderGenerationMediaUrl
resolveProviderMediaUrl
```

The module must accept injected dependencies for testable IO:

```js
const deps = {
  fetchWithTimeout,
  readResponseBodyWithTimeout,
  uploadAssetViaKieStream,
  uploadAssetViaKieBase64,
};
```

- [ ] **Step 2: Wire gateway imports**

Modify `server/providerGateway.mjs` to import the moved helpers:

```js
import {
  assertRemoteProviderMediaUrlAllowed,
  convertGeminiMediaToStableKieUrl,
  convertGeminiVideoToOpenRouterChatUrl,
  convertInlineDataUrlToKieFileUrl,
  convertManagedAssetUrlToKieFileUrl,
  downloadRemoteMediaUrl,
  downloadRemoteProviderMediaUrl,
  inferExtensionFromMimeType,
  isManagedAssetUrl,
  normalizeManagedAssetDownloadUrl,
  readRemoteMediaBufferWithLimit,
  resolveProviderChatMediaUrl,
  resolveProviderGenerationMediaUrl,
  resolveProviderMediaUrl,
  uploadAssetViaKieWithFallback,
} from './providerAssetTransfer.mjs';
```

Keep `uploadAssetViaKie` and `uploadAssetViaKieStream` public behavior in `providerGateway.mjs` initially if moving them would broaden the diff. Pass them into asset-transfer functions as dependencies.

- [ ] **Step 3: Verify asset-transfer tests pass**

Run:

```bash
node --test server/providerAssetTransfer.test.mjs
```

Expected: pass.

- [ ] **Step 4: Verify provider gateway still passes**

Run:

```bash
node --test server/providerAssetTransfer.test.mjs server/providerKieImage.test.mjs server/providerGateway.test.mjs
```

Expected: pass.

---

### Task 5: Chat Route Harness Design Spike

**Files:**
- Create: `server/agentChatRouteHarness.mjs`
- Modify: `server/agentConversationReliability.test.mjs`

- [ ] **Step 1: Add the first failing harness test for local duplicate client requests**

Add a behavior test that describes the wished-for harness API:

```js
import {
  createLocalChatRouteHarness,
} from './agentChatRouteHarness.mjs';

test('local chat route returns the existing exchange for duplicate clientRequestId', async () => {
  const harness = createLocalChatRouteHarness({
    now: () => 1700000000000,
    runConversation: async () => ({ content: 'new reply', metadata: {} }),
  });

  harness.seedMessages([
    { id: 'u1', sessionId: 's1', role: 'user', clientRequestId: 'req-1', content: 'hello' },
    { id: 'a1', sessionId: 's1', role: 'assistant', clientRequestId: 'req-1', content: 'old reply', status: 'completed' },
  ]);

  const response = await harness.postMessage({
    sessionId: 's1',
    clientRequestId: 'req-1',
    content: 'hello again',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.assistantMessage.content, 'old reply');
  assert.equal(harness.messages().length, 2);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test server/agentConversationReliability.test.mjs --test-name-pattern "duplicate clientRequestId"
```

Expected: fail because `agentChatRouteHarness.mjs` does not exist.

- [ ] **Step 3: Implement only the local duplicate behavior**

Create `server/agentChatRouteHarness.mjs` with the smallest implementation needed:

```js
export const createLocalChatRouteHarness = ({ now = Date.now, runConversation }) => {
  const store = { chatMessages: [] };
  return {
    seedMessages(messages) {
      store.chatMessages = messages.map((item) => ({ ...item }));
    },
    messages() {
      return store.chatMessages.map((item) => ({ ...item }));
    },
    async postMessage(payload) {
      const existingUserMessage = store.chatMessages.find((item) =>
        item.sessionId === payload.sessionId
        && item.role === 'user'
        && item.clientRequestId === payload.clientRequestId
      );
      const existingAssistantMessage = store.chatMessages.find((item) =>
        item.sessionId === payload.sessionId
        && item.role === 'assistant'
        && item.clientRequestId === payload.clientRequestId
      );
      if (existingUserMessage && existingAssistantMessage) {
        return {
          status: 200,
          body: {
            userMessage: existingUserMessage,
            assistantMessage: existingAssistantMessage,
          },
        };
      }
      const userMessage = {
        id: `u-${now()}`,
        sessionId: payload.sessionId,
        role: 'user',
        clientRequestId: payload.clientRequestId,
        content: payload.content,
      };
      const assistantResult = await runConversation(payload);
      const assistantMessage = {
        id: `a-${now()}`,
        sessionId: payload.sessionId,
        role: 'assistant',
        clientRequestId: payload.clientRequestId,
        content: assistantResult.content,
        status: 'completed',
        metadata: assistantResult.metadata || {},
      };
      store.chatMessages.push(userMessage, assistantMessage);
      return { status: 200, body: { userMessage, assistantMessage } };
    },
  };
};
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test server/agentConversationReliability.test.mjs --test-name-pattern "duplicate clientRequestId"
```

Expected: pass.

---

### Task 6: Expand Route Harness To High-Risk Source-Shape Behaviors

**Files:**
- Modify: `server/agentChatRouteHarness.mjs`
- Modify: `server/agentConversationReliability.test.mjs`

- [ ] **Step 1: Add pending-run conflict behavior tests**

Add tests for local and DB-style harnesses:

```js
test('local chat route rejects a new message while a run is pending in the same session', async () => {
  const harness = createLocalChatRouteHarness({ runConversation: async () => ({ content: 'unused' }) });
  harness.seedMessages([
    {
      id: 'a-pending',
      sessionId: 's1',
      role: 'assistant',
      status: 'pending',
      metadata: { progressStage: 'thinking' },
    },
  ]);

  const response = await harness.postMessage({
    sessionId: 's1',
    clientRequestId: 'req-2',
    content: 'next',
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'agent_chat_run_active');
});
```

- [ ] **Step 2: Add checkpoint behavior tests**

Add behavior tests that call harness checkpoint helpers directly:

```js
test('local chat checkpoint records submitted provider task id before image result exists', async () => {
  const harness = createLocalChatRouteHarness({ runConversation: async () => ({ content: 'unused' }) });
  harness.seedMessages([
    { id: 'a1', sessionId: 's1', role: 'assistant', status: 'pending', clientRequestId: 'req-1', metadata: {} },
  ]);

  await harness.markImageTaskSubmitted({
    assistantMessageId: 'a1',
    providerTaskId: 'kie-task-1',
    imagePlan: { prompt: 'generate image' },
  });

  const message = harness.messages().find((item) => item.id === 'a1');
  assert.equal(message.status, 'pending');
  assert.equal(message.metadata.providerTaskId, 'kie-task-1');
  assert.equal(message.metadata.progressStage, 'image_task_submitted');
});
```

- [ ] **Step 3: Implement the harness behavior**

Extend `server/agentChatRouteHarness.mjs` with:

```js
const isPendingAgentRun = (message) =>
  message?.role === 'assistant'
  && ['pending', 'thinking', 'analyzing'].includes(String(message?.status || ''))
  && String(message?.metadata?.progressStage || '') !== 'image_result_ready';
```

Add methods:

```js
markImageTaskSubmitted({ assistantMessageId, providerTaskId, imagePlan }) {
  const message = store.chatMessages.find((item) => item.id === assistantMessageId);
  if (!message) return false;
  message.status = 'pending';
  message.metadata = {
    ...(message.metadata || {}),
    providerTaskId,
    imagePlan,
    progressStage: 'image_task_submitted',
  };
  return true;
}

markImageResultReady({ assistantMessageId, imageResultUrls, providerTaskId }) {
  const message = store.chatMessages.find((item) => item.id === assistantMessageId);
  if (!message) return false;
  message.status = 'completed';
  message.metadata = {
    ...(message.metadata || {}),
    providerTaskId,
    imageResultUrls,
    progressStage: 'image_result_ready',
  };
  message.attachments = imageResultUrls.map((url) => ({ type: 'image', url }));
  return true;
}
```

- [ ] **Step 4: Remove migrated source-grep assertions**

In `server/agentConversationReliability.test.mjs`, remove only the source-shape assertions now covered by harness tests:

- duplicate `clientRequestId`
- active pending run conflict
- `image_task_submitted`
- `image_result_ready`

Keep source scans for behavior that does not yet have an executable seam.

- [ ] **Step 5: Verify route harness tests**

Run:

```bash
node --test server/agentConversationReliability.test.mjs
```

Expected: pass.

---

### Task 7: Focused Regression And Hermes

**Files:**
- No new file changes unless failures require fixes.

- [ ] **Step 1: Run provider regression**

Run:

```bash
node --test server/providerKieImage.test.mjs server/providerAssetTransfer.test.mjs server/providerKieTask.test.mjs server/providerBodyRead.test.mjs server/providerGateway.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run chat and job regression**

Run:

```bash
node --test server/agentConversationReliability.test.mjs server/agentToolConversation.test.mjs server/agentImagePlan.test.mjs server/jobRuntime.test.mjs server/jobManager.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run frontend/service regression**

Run:

```bash
node --experimental-strip-types --test src/services/internalApi.test.mjs src/modules/OneClick/oneClickGenerationRun.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/services/kieAiService.test.mjs
```

Expected: all pass.

- [ ] **Step 4: Run Hermes harness for changed high-risk files**

Run:

```bash
node /Users/feiyanglin/程序开发/hermes-harness/scripts/hermes-harness.mjs --changed server/providerGateway.mjs --changed server/providerKieImage.mjs --changed server/providerAssetTransfer.mjs --changed server/agentChatRouteHarness.mjs --changed server/agentConversationReliability.test.mjs --changed server/providerGateway.test.mjs
```

Expected: status OK. Run any suggested verification from Hermes.

- [ ] **Step 5: Run final static checks**

Run:

```bash
npm run lint
npm run build
git diff --check
```

Expected: lint exits 0, build exits 0, and diff check is clean. Existing lint warnings are acceptable only if the exit code is 0 and no new lint errors appear.

---

### Task 8: Commit Strategy

**Files:**
- All files changed by the completed implementation.

- [ ] **Step 1: Review the final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- server/providerGateway.mjs server/providerKieImage.mjs server/providerAssetTransfer.mjs server/agentChatRouteHarness.mjs server/agentConversationReliability.test.mjs | sed -n '1,260p'
```

Expected: diff contains only the Provider 网关 deepening, source-shape migration, and planned tests.

- [ ] **Step 2: Commit only after verification**

Run:

```bash
git add server/providerGateway.mjs server/providerGateway.test.mjs server/providerKieImage.mjs server/providerKieImage.test.mjs server/providerAssetTransfer.mjs server/providerAssetTransfer.test.mjs server/agentChatRouteHarness.mjs server/agentConversationReliability.test.mjs
git commit -m "refactor: deepen provider gateway seams"
```

Expected: commit succeeds. Do not include unrelated local changes unless they are part of the verified baseline slice.
