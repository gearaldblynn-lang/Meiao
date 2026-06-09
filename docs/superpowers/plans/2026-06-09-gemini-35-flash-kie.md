# Gemini 3.5 Flash KIE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add KIE-backed `Gemini 3.5 Flash` as a new selectable chat/planning model without replacing existing Gemini models.

**Architecture:** Expose the model through the existing public system config catalog, then route `gemini-3-5-flash` through a dedicated Gemini-native adapter in `server/providerGateway.mjs`. The adapter reuses KIE key resolution but sends the key with `X-Goog-Api-Key`, converts internal messages to Gemini `contents`, and supports JSON plus SSE response parsing.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Provider gateway helpers.

---

## File Structure

- Modify `server/jobRuntime.mjs`: add the public model catalog entry.
- Modify `server/jobRuntime.test.mjs`: assert model catalog exposure and unchanged default video analysis behavior.
- Modify `server/providerGateway.mjs`: add Gemini 3.5 endpoint constant, request builder, JSON/SSE parser integration, and chat routing branch.
- Modify `server/providerGateway.test.mjs`: add a contract test for the Gemini-native request and JSON response extraction.

## Task 1: Public Model Catalog

**Files:**
- Modify: `server/jobRuntime.mjs`
- Test: `server/jobRuntime.test.mjs`

- [ ] **Step 1: Write the failing catalog test**

Update the first `buildPublicSystemConfig only exposes non-sensitive provider readiness` test so `agentModels.chat.map((item) => item.id)` includes:

```js
[
  'gpt-5-4-openai-resp',
  'claude-sonnet-4-6',
  'gemini-3.1-pro-openai',
  'gemini-3-flash-openai',
  'gemini-3-5-flash',
]
```

Add assertions for the new item:

```js
const gemini35 = config.agentModels.chat.find((item) => item.id === 'gemini-3-5-flash');
assert.equal(gemini35?.provider, 'kie');
assert.equal(gemini35?.supportsFileInput, true);
assert.equal(gemini35?.supportsImageInput, true);
assert.equal(gemini35?.supportsWebSearch, true);
assert.equal(gemini35?.supportsReasoningLevel, true);
assert.deepEqual(gemini35?.reasoningLevels, ['low', 'high']);
assert.equal(config.systemSettings.effectiveVideoAnalysisModel, 'gemini-3-flash-openai');
```

Update the video analysis model list assertion to:

```js
assert.deepEqual(config.videoAnalysisModels.map((item) => item.id), [
  'gemini-3.1-pro-openai',
  'gemini-3-flash-openai',
  'gemini-3-5-flash',
]);
```

- [ ] **Step 2: Run the catalog test and verify it fails**

Run:

```bash
node --test server/jobRuntime.test.mjs
```

Expected: FAIL because `gemini-3-5-flash` is not in `AGENT_MODEL_CATALOG.chat`.

- [ ] **Step 3: Add the catalog entry**

In `AGENT_MODEL_CATALOG.chat`, after `gemini-3-flash-openai`, add:

```js
{
  id: 'gemini-3-5-flash',
  label: 'Gemini 3.5 Flash',
  provider: 'kie',
  mediaTransport: 'public_url',
  supportsImageInput: true,
  supportsFileInput: true,
  supportsWebSearch: true,
  supportsReasoningLevel: true,
  reasoningLevels: ['low', 'high'],
},
```

- [ ] **Step 4: Run the catalog test and verify it passes**

Run:

```bash
node --test server/jobRuntime.test.mjs
```

Expected: PASS.

## Task 2: Gemini-native Provider Adapter

**Files:**
- Modify: `server/providerGateway.mjs`
- Test: `server/providerGateway.test.mjs`

- [ ] **Step 1: Write the failing Provider contract test**

Add a test that stubs `global.fetch`, executes `executeProviderJob` with:

```js
{
  taskType: 'kie_chat',
  provider: 'kie',
  payload: {
    model: 'gemini-3-5-flash',
    reasoningLevel: 'high',
    webSearchEnabled: true,
    messages: [
      { role: 'system', content: '只输出中文。' },
      { role: 'user', content: '写一个商品卖点。' },
    ],
  },
}
```

Return this response:

```js
createJsonResponse({
  candidates: [{ content: { role: 'model', parts: [{ text: '商品卖点文案' }] }, finishReason: 'STOP' }],
  modelVersion: 'gemini-3-5-flash',
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  credits_consumed: 0.01,
  responseId: 'gemini35-response-1',
})
```

Assert:

```js
assert.equal(requests[0].url, 'https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent');
assert.equal(requests[0].init.headers['X-Goog-Api-Key'], 'test-key');
assert.equal(requests[0].init.headers.Authorization, undefined);
const body = JSON.parse(requests[0].init.body);
assert.equal(body.stream, true);
assert.equal(body.contents[0].role, 'user');
assert.match(body.contents[0].parts[0].text, /只输出中文。/);
assert.match(body.contents[0].parts[0].text, /写一个商品卖点。/);
assert.deepEqual(body.tools, [{ googleSearch: {} }]);
assert.deepEqual(body.generationConfig, {
  thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' },
});
assert.equal(result.providerTaskId, 'gemini35-response-1');
assert.equal(result.result.content, '商品卖点文案');
assert.equal(result.result.modelUsed, 'gemini-3-5-flash');
assert.equal(result.result.creditsConsumed, 0.01);
assert.deepEqual(result.result.usage, { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
```

- [ ] **Step 2: Run the Provider test and verify it fails**

Run:

```bash
node --test server/providerGateway.test.mjs
```

Expected: FAIL because the new model currently routes through the generic chat completions path.

- [ ] **Step 3: Add the Gemini 3.5 adapter**

Implement these pieces in `server/providerGateway.mjs`:

```js
const KIE_GEMINI_35_FLASH_URL = 'https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent';
const isKieGemini35FlashModel = (model) => String(model || '').trim() === 'gemini-3-5-flash';
```

Add helpers that convert messages to:

```js
{
  role: 'user',
  parts: [{ text: '...' }]
}
```

and run the request with:

```js
headers: {
  'X-Goog-Api-Key': kieApiKey,
  'Content-Type': 'application/json',
}
```

The result object must match the existing `kie_chat` return shape: top-level optional `providerTaskId` and `creditsConsumed`, plus `result.content`, `result.modelUsed`, `result.providerTaskId`, `result.creditsConsumed`, and `result.usage`.

- [ ] **Step 4: Run the Provider test and verify it passes**

Run:

```bash
node --test server/providerGateway.test.mjs
```

Expected: PASS.

## Task 3: Focused Regression Verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test server/jobRuntime.test.mjs server/providerGateway.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript build check**

Run:

```bash
npm run lint
```

Expected: PASS.
