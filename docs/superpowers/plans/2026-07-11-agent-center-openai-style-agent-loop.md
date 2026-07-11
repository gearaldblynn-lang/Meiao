# Agent Center OpenAI-Style Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Agent Center to an OpenAI-style manager-agent loop that understands natural-language multi-image intent, emits a strict `generate_images` plan, validates it before spending credits, and reuses the existing job/provider/checkpoint infrastructure.

**Architecture:** Add stable conversation image identities, a pure V2 image-plan contract/validator, a dynamic tool registry, and a cross-turn approval token for unusually large batches. Keep the current `generate_image` path behind a compatibility adapter and feature flag; both MySQL and local JSON chat handlers pass the same run context into `runAgentConversationV2`.

**Tech Stack:** Node.js ESM, Node test runner, OpenAI-compatible Responses API, MySQL/local JSON dual handlers, existing KIE image provider, existing credit/checkpoint/logging services.

## Global Constraints

- Scope is Agent Center only; do not change `modules/OneClick` or other business-module generation behavior.
- Do not replace the existing KIE/provider execution layer or require OpenAI image generation.
- Do not expose or persist private chain-of-thought; persist only structured plans, tool calls, progress, and results.
- Do not add regex or business-keyword branches to infer image intent.
- The model must return `imageId` values, never arbitrary business URLs, in the V2 tool contract.
- Keep MySQL `createDbChatReply` and the local JSON chat handler behaviorally identical.
- Keep existing job checkpoints, provider task IDs, managed-asset routing, credit isolation, and partial-result recovery.
- All new or rewritten prompts must use RTCFE and preserve existing product-consistency constraints.
- Use environment-backed limits with conservative defaults; never hard-code production thresholds in the execution path.
- Before editing high-risk files, run the exact Hermes changed-file command listed in the owning task.
- Do not deploy until diff review, user isolation review, public asset URL review, logging/statistics review, permission review, core task-chain review, queue drain, and local verification all pass.
- Design source of truth: `docs/superpowers/specs/2026-07-11-agent-center-openai-style-agent-loop-design.md`.

---

## File Structure

**Create**

- `server/imageExecutionPlan.mjs`: V2 `generate_images` schema, normalization, deterministic validation, legacy-call adapter, and provider-output expansion.
- `server/imageExecutionPlan.test.mjs`: all five topologies, identity/role validation, limits, exact-duplicate rejection, and legacy compatibility.
- `server/agentToolRegistry.mjs`: feature-flag resolution and dynamic model-visible/local tool registrations.
- `server/agentToolRegistry.test.mjs`: V1/V2 selection, allowlist, strict schemas, and capability gating.
- `server/agentImagePlanApproval.mjs`: cross-turn approval token creation and exact-plan verification.
- `server/agentImagePlanApproval.test.mjs`: same-turn rejection, later-turn acceptance, expiry, and plan-tampering rejection.

**Modify**

- `server/conversationImageCatalog.mjs`: add stable `imageId`, ID lookup/resolution, and URL-free V2 prompt formatting while retaining V1 URL helpers.
- `server/conversationImageCatalog.test.mjs`: identity stability, authorization resolution, current/history IDs, and URL-free prompt tests.
- `server/imageToolDefinition.mjs`: retain V1 exports only; add a deprecation comment pointing to the V2 contract.
- `server/openaiResponsesProvider.mjs`: preserve `strict: true` while flattening function tools.
- `server/openaiResponsesProvider.test.mjs`: assert strict-schema forwarding.
- `server/agentToolConversation.mjs`: RTCFE manager guidance, registry integration, V2 validation/repair, batch execution, partial results, approval flow, and V1 compatibility branch.
- `server/agentToolConversation.test.mjs`: V2 orchestration, no-keyword dependency, mixed tools, partial results, approval, idempotency context, and V1 regression.
- `server/agentChatCheckpointMetadata.mjs`: preserve V2 plan/output details in submitted and ready checkpoints.
- `server/agentChatCheckpointMetadata.test.mjs`: V2 checkpoint shape and partial-output recovery.
- `server/index.mjs`: pass agent/session/message/run identity, feature config, prior approval, output metadata, and V2 checkpoint context in both handlers.
- `server/agentCenterSource.test.mjs`: source guards proving MySQL/local parity and V2 metadata persistence.
- `server/accountCreditsSource.test.mjs`: verify every expanded output still reserves/settles/releases credits before provider execution.
- `.env.server.example`: document V2 kill switch, agent allowlist, hard output limit, automatic execution threshold, and approval TTL.
- `docs/project-overview.md`: document the V2 agent contract and environment variables.
- `docs/tencent-cloud-deploy.md`: document canary enablement, rollback, and acceptance evidence.

---

### Task 1: Stable Conversation Image Identities

**Files:**
- Modify: `server/conversationImageCatalog.mjs:1-112`
- Test: `server/conversationImageCatalog.test.mjs:1-79`

**Interfaces:**
- Consumes: attachments with `assetId`, prior messages with stable `id`, and existing `metadata.imagePlan`/`imageResultUrls`.
- Produces: `buildSessionImageCatalog({ attachments, priorMessages, sessionId, currentMessageId })`, `isImageIdInCatalog(catalog, imageId)`, and `resolveCatalogImageIds(catalog, imageIds)`.

- [ ] **Step 1: Write failing identity and authorization tests**

Add tests that assert stable IDs do not depend on display ordering and that V2 prompts do not expose URLs:

```js
test('imageId uses stable message/asset identity instead of display index', () => {
  const first = buildSessionImageCatalog({
    sessionId: 'session-1',
    currentMessageId: 'message-current',
    attachments: [{ kind: 'image', assetId: 'asset-1', url: 'https://a/new.jpg', name: '新图' }],
    priorMessages,
  });
  const second = buildSessionImageCatalog({
    sessionId: 'session-1',
    currentMessageId: 'message-current',
    attachments: [{ kind: 'image', assetId: 'asset-2', url: 'https://a/other.jpg', name: '另一张' }, { kind: 'image', assetId: 'asset-1', url: 'https://a/new.jpg', name: '新图' }],
    priorMessages,
  });
  assert.equal(first.find((item) => item.url.endsWith('/new.jpg')).imageId, second.find((item) => item.url.endsWith('/new.jpg')).imageId);
});

test('V2 catalog prompt exposes imageId and label but not business URL', () => {
  const catalog = buildSessionImageCatalog({ sessionId: 's1', currentMessageId: 'm1', attachments: [{ kind: 'image', assetId: 'a1', url: 'https://private.example/a.png', name: '商品' }] });
  const prompt = formatCatalogForPrompt(catalog, { includeUrls: false });
  assert.match(prompt, /imageId=/);
  assert.match(prompt, /图1/);
  assert.doesNotMatch(prompt, /private\.example/);
});

test('resolveCatalogImageIds rejects an unknown or unauthorized imageId', () => {
  const catalog = buildSessionImageCatalog({ sessionId: 's1', currentMessageId: 'm1', attachments: [{ kind: 'image', assetId: 'a1', url: 'https://a/1.png' }] });
  assert.deepEqual(resolveCatalogImageIds(catalog, [catalog[0].imageId]), [catalog[0]]);
  assert.throws(() => resolveCatalogImageIds(catalog, ['img_unknown']), (error) => error?.code === 'image_id_not_in_catalog');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test server/conversationImageCatalog.test.mjs
```

Expected: FAIL because `imageId`, `includeUrls`, and `resolveCatalogImageIds` do not exist.

- [ ] **Step 3: Implement deterministic opaque image IDs**

Add `node:crypto` hashing and use a stable source key. Message ID plus attachment/result slot is preferred; `assetId` is preferred for current uploads; URL is only a final compatibility fallback:

```js
import { createHash } from 'node:crypto';

const buildOpaqueImageId = ({ sessionId = '', messageId = '', slot = '', assetId = '', url = '' } = {}) => {
  const identity = assetId
    ? `asset:${assetId}`
    : messageId
      ? `message:${sessionId}:${messageId}:${slot}`
      : `legacy:${sessionId}:${url}`;
  return `img_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
};

export const isImageIdInCatalog = (catalog = [], imageId = '') => (
  (Array.isArray(catalog) ? catalog : []).some((item) => item.imageId === String(imageId || '').trim())
);

export const resolveCatalogImageIds = (catalog = [], imageIds = []) => (
  (Array.isArray(imageIds) ? imageIds : []).map((rawId) => {
    const imageId = String(rawId || '').trim();
    const item = (Array.isArray(catalog) ? catalog : []).find((candidate) => candidate.imageId === imageId);
    if (!item) {
      const error = new Error(`图片不在当前会话目录中: ${imageId}`);
      error.code = 'image_id_not_in_catalog';
      error.imageId = imageId;
      throw error;
    }
    return item;
  })
);
```

Update `pushItem` to accept `imageId`, preserve it on URL deduplication, and call `buildOpaqueImageId` from current attachments, prior attachments, `metadata.imageUrl`, and each `metadata.imageResultUrls[index]`. Add `imageId` to the returned item shape.

Change `formatCatalogForPrompt(catalog, { includeUrls = true } = {})` so V1 keeps the current URL text, while V2 emits:

```text
图1: imageId=img_0123456789abcdef [用户上传] 商品（当前默认编辑图）
```

- [ ] **Step 4: Run focused tests and current catalog regressions**

Run:

```bash
node --test server/conversationImageCatalog.test.mjs server/agentToolConversation.test.mjs
```

Expected: PASS; existing URL-based V1 tests remain green because `includeUrls` defaults to `true`.

- [ ] **Step 5: Commit Task 1**

```bash
git add server/conversationImageCatalog.mjs server/conversationImageCatalog.test.mjs
git commit -m "feat: add stable Agent Center image identities"
```

---

### Task 2: Strict V2 Image Execution Plan

**Files:**
- Create: `server/imageExecutionPlan.mjs`
- Create: `server/imageExecutionPlan.test.mjs`
- Modify: `server/imageToolDefinition.mjs:1-52`

**Interfaces:**
- Consumes: a catalog from Task 1 and legacy `generate_image` calls.
- Produces: `GENERATE_IMAGES_TOOL`, `normalizeImageExecutionPlan(rawArgs)`, `validateImageExecutionPlan({ plan, catalog, maxOutputs })`, `expandImageExecutionPlan({ plan, catalog })`, and `adaptLegacyImageCalls({ toolCalls, catalog })`.

- [ ] **Step 1: Write failing schema and topology tests**

Create tests with these exact assertions:

```js
const catalog = [
  { imageId: 'img_a', url: 'https://a/a.png' },
  { imageId: 'img_b', url: 'https://a/b.png' },
  { imageId: 'img_ref', url: 'https://a/ref.png' },
];

const makePlan = (overrides = {}) => normalizeImageExecutionPlan({
  plan_version: 2,
  topology: 'single_input_single_output',
  expected_output_count: 1,
  approval_id: null,
  outputs: [{ output_id: 'o1', target_image_ids: ['img_a'], reference_image_ids: [], instruction: '处理A', aspect_ratio: '1:1' }],
  ...overrides,
});

test('generate_images is strict and all properties are required', () => {
  const fn = GENERATE_IMAGES_TOOL.function;
  assert.equal(fn.name, 'generate_images');
  assert.equal(fn.strict, true);
  assert.equal(fn.parameters.additionalProperties, false);
  assert.deepEqual(fn.parameters.required, ['plan_version', 'topology', 'expected_output_count', 'approval_id', 'outputs']);
  assert.deepEqual(fn.parameters.properties.outputs.items.required, ['output_id', 'target_image_ids', 'reference_image_ids', 'instruction', 'aspect_ratio']);
});

test('multi_input_multi_output expands targets and shared reference in order', () => {
  const plan = normalizeImageExecutionPlan({
    plan_version: 2,
    topology: 'multi_input_multi_output',
    expected_output_count: 2,
    approval_id: null,
    outputs: [
      { output_id: 'o1', target_image_ids: ['img_a'], reference_image_ids: ['img_ref'], instruction: '处理A', aspect_ratio: '1:1' },
      { output_id: 'o2', target_image_ids: ['img_b'], reference_image_ids: ['img_ref'], instruction: '处理B', aspect_ratio: '1:1' },
    ],
  });
  validateImageExecutionPlan({ plan, catalog, maxOutputs: 5 });
  const expanded = expandImageExecutionPlan({ plan, catalog });
  assert.deepEqual(expanded[0].inputImageUrls, ['https://a/a.png', 'https://a/ref.png']);
  assert.deepEqual(expanded[1].inputImageUrls, ['https://a/b.png', 'https://a/ref.png']);
});

test('validator rejects count mismatch, role overlap, unknown ids, bad topology and exact duplicate outputs', () => {
  const countMismatch = makePlan({ expected_output_count: 2 });
  const roleOverlap = makePlan({ outputs: [{ output_id: 'o1', target_image_ids: ['img_a'], reference_image_ids: ['img_a'], instruction: '处理A', aspect_ratio: '1:1' }] });
  const unknownImage = makePlan({ outputs: [{ output_id: 'o1', target_image_ids: ['img_unknown'], reference_image_ids: [], instruction: '处理A', aspect_ratio: '1:1' }] });
  const invalidTopologyShape = makePlan({ topology: 'text_to_single_image' });
  const exactDuplicates = makePlan({
    topology: 'multi_input_multi_output',
    expected_output_count: 2,
    outputs: [
      { output_id: 'o1', target_image_ids: ['img_a'], reference_image_ids: ['img_ref'], instruction: '处理A', aspect_ratio: '1:1' },
      { output_id: 'o2', target_image_ids: ['img_a'], reference_image_ids: ['img_ref'], instruction: '处理A', aspect_ratio: '1:1' },
    ],
  });
  assert.throws(() => validateImageExecutionPlan({ plan: countMismatch, catalog, maxOutputs: 5 }), (error) => error.code === 'image_plan_count_mismatch');
  assert.throws(() => validateImageExecutionPlan({ plan: roleOverlap, catalog, maxOutputs: 5 }), (error) => error.code === 'image_plan_role_overlap');
  assert.throws(() => validateImageExecutionPlan({ plan: unknownImage, catalog, maxOutputs: 5 }), (error) => error.code === 'image_id_not_in_catalog');
  assert.throws(() => validateImageExecutionPlan({ plan: invalidTopologyShape, catalog, maxOutputs: 5 }), (error) => error.code === 'image_plan_topology_mismatch');
  assert.throws(() => validateImageExecutionPlan({ plan: exactDuplicates, catalog, maxOutputs: 5 }), (error) => error.code === 'image_plan_duplicate_output');
});

test('all five topology fixtures validate', () => {
  const cases = [
    makePlan({ topology: 'text_to_single_image', outputs: [{ output_id: 'o1', target_image_ids: [], reference_image_ids: [], instruction: '创建A', aspect_ratio: '1:1' }] }),
    makePlan({ topology: 'text_to_multi_image', expected_output_count: 2, outputs: [{ output_id: 'o1', target_image_ids: [], reference_image_ids: [], instruction: '创建A', aspect_ratio: '1:1' }, { output_id: 'o2', target_image_ids: [], reference_image_ids: [], instruction: '创建B', aspect_ratio: '1:1' }] }),
    makePlan(),
    makePlan({ topology: 'multi_input_single_output', outputs: [{ output_id: 'o1', target_image_ids: ['img_a', 'img_b'], reference_image_ids: ['img_ref'], instruction: '合成', aspect_ratio: '1:1' }] }),
    makePlan({ topology: 'multi_input_multi_output', expected_output_count: 2, outputs: [{ output_id: 'o1', target_image_ids: ['img_a'], reference_image_ids: ['img_ref'], instruction: '处理A', aspect_ratio: '1:1' }, { output_id: 'o2', target_image_ids: ['img_b'], reference_image_ids: ['img_ref'], instruction: '处理B', aspect_ratio: '1:1' }] }),
  ];
  for (const plan of cases) assert.doesNotThrow(() => validateImageExecutionPlan({ plan, catalog, maxOutputs: 5 }));
});

test('legacy adapter maps only catalog URLs to image IDs', () => {
  const adapted = adaptLegacyImageCalls({ toolCalls: [{ name: 'generate_image', args: { prompt: '处理A', task_type: 'edit_image', input_image_urls: ['https://a/a.png'], aspect_ratio: '1:1' } }], catalog });
  assert.deepEqual(adapted.outputs[0].targetImageIds, ['img_a']);
  assert.throws(() => adaptLegacyImageCalls({ toolCalls: [{ name: 'generate_image', args: { prompt: 'x', input_image_urls: ['https://unknown/x.png'] } }], catalog }), (error) => error.code === 'image_id_not_in_catalog');
});
```

- [ ] **Step 2: Run the new test and confirm RED**

```bash
node --test server/imageExecutionPlan.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the strict tool schema and normalized plan**

Create constants and the exported tool:

```js
export const IMAGE_PLAN_TOPOLOGIES = Object.freeze([
  'text_to_single_image',
  'text_to_multi_image',
  'single_input_single_output',
  'multi_input_single_output',
  'multi_input_multi_output',
]);

export const GENERATE_IMAGES_TOOL = {
  type: 'function',
  function: {
    name: 'generate_images',
    description: '按用户完整语义生成或编辑一张或多张图片。先区分目标图与参考图，再明确每个输出。',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        plan_version: { type: 'integer', enum: [2] },
        topology: { type: 'string', enum: IMAGE_PLAN_TOPOLOGIES },
        expected_output_count: { type: 'integer', minimum: 1 },
        approval_id: { type: ['string', 'null'] },
        outputs: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              output_id: { type: 'string', minLength: 1 },
              target_image_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
              reference_image_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
              instruction: { type: 'string', minLength: 1 },
              aspect_ratio: { type: 'string', enum: ['auto', '1:1', '4:3', '3:4', '16:9', '9:16'] },
            },
            required: ['output_id', 'target_image_ids', 'reference_image_ids', 'instruction', 'aspect_ratio'],
          },
        },
      },
      required: ['plan_version', 'topology', 'expected_output_count', 'approval_id', 'outputs'],
    },
  },
};
```

Normalize whitespace, deduplicate IDs without reordering, and preserve `approvalId` separately from semantic plan fields.

- [ ] **Step 4: Implement deterministic validation and provider expansion**

Validation must enforce:

```js
const TOPOLOGY_RULES = {
  text_to_single_image: ({ outputs }) => outputs.length === 1 && outputs.every((output) => output.targetImageIds.length === 0),
  text_to_multi_image: ({ outputs }) => outputs.length > 1 && outputs.every((output) => output.targetImageIds.length === 0),
  single_input_single_output: ({ outputs }) => outputs.length === 1 && outputs[0].targetImageIds.length === 1,
  multi_input_single_output: ({ outputs }) => outputs.length === 1 && outputs[0].targetImageIds.length >= 1 && new Set([...outputs[0].targetImageIds, ...outputs[0].referenceImageIds]).size >= 2,
  multi_input_multi_output: ({ outputs }) => outputs.length > 1 && outputs.every((output) => output.targetImageIds.length >= 1),
};
```

Reject an exact duplicate key built from target IDs, reference IDs, trimmed instruction, and ratio. Allow the same target in multiple outputs only when the instruction or ratio differs, which supports intentional variations without accepting accidental duplicate calls.

Expand each output to:

```js
{
  outputId,
  taskType: targetImageIds.length > 0 ? 'edit_image' : 'new_image',
  targetImageIds,
  referenceImageIds,
  targetImageUrls,
  referenceImageUrls,
  inputImageUrls: [...targetImageUrls, ...referenceImageUrls],
  prompt: instruction,
  aspectRatio,
}
```

The legacy adapter may read V1 URLs only to map them back to known catalog items. It must throw `image_id_not_in_catalog` for an unknown URL instead of silently dropping it.

- [ ] **Step 5: Run V2 contract and V1 definition tests**

```bash
node --test server/imageExecutionPlan.test.mjs server/imageToolDefinition.test.mjs server/conversationImageCatalog.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add server/imageExecutionPlan.mjs server/imageExecutionPlan.test.mjs server/imageToolDefinition.mjs
git commit -m "feat: define strict Agent Center image plans"
```

---

### Task 3: Dynamic Tool Registry and Responses Strictness

**Files:**
- Create: `server/agentToolRegistry.mjs`
- Create: `server/agentToolRegistry.test.mjs`
- Modify: `server/openaiResponsesProvider.mjs:19-29`
- Test: `server/openaiResponsesProvider.test.mjs:17-28`

**Interfaces:**
- Consumes: V1/V2 image tools, knowledge tool, feature flags, agent ID, and enabled capabilities.
- Produces: `resolveAgentImagePlanV2Config({ env, agentId })` and `buildAgentToolRegistry(options)` returning `{ modelTools, get(name) }`.

- [ ] **Step 1: Write failing feature-flag and registry tests**

```js
test('V2 requires global switch and optional agent allowlist match', () => {
  assert.equal(resolveAgentImagePlanV2Config({ env: {}, agentId: 'a1' }).enabled, false);
  assert.equal(resolveAgentImagePlanV2Config({ env: { AGENT_IMAGE_PLAN_V2_ENABLED: '1', AGENT_IMAGE_PLAN_V2_AGENT_IDS: 'a2,a3' }, agentId: 'a1' }).enabled, false);
  assert.equal(resolveAgentImagePlanV2Config({ env: { AGENT_IMAGE_PLAN_V2_ENABLED: '1', AGENT_IMAGE_PLAN_V2_AGENT_IDS: 'a1,a2' }, agentId: 'a1' }).enabled, true);
  assert.equal(resolveAgentImagePlanV2Config({ env: { AGENT_IMAGE_PLAN_V2_ENABLED: '1' }, agentId: 'a1' }).enabled, true);
});

test('registry exposes generate_images for V2 and generate_image for V1, never both', () => {
  const v2 = buildAgentToolRegistry({ imageGenerationEnabled: true, imagePlanV2Enabled: true, hasKnowledgeBase: true, webSearchEnabled: true });
  assert.deepEqual(v2.modelTools.map((tool) => tool.function?.name || tool.type), ['generate_images', 'search_knowledge', 'web_search']);
  const v1 = buildAgentToolRegistry({ imageGenerationEnabled: true, imagePlanV2Enabled: false, hasKnowledgeBase: false, webSearchEnabled: false });
  assert.deepEqual(v1.modelTools.map((tool) => tool.function?.name || tool.type), ['generate_image']);
});
```

Add tests for conservative defaults: `maxOutputs=8`, `autoExecuteMax=4`, and `approvalTtlMs=1800000`; clamp invalid environment values so `1 <= autoExecuteMax <= maxOutputs <= 20`.

- [ ] **Step 2: Run registry tests and confirm RED**

```bash
node --test server/agentToolRegistry.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement flag resolution and registrations**

Use exact environment names:

```js
AGENT_IMAGE_PLAN_V2_ENABLED
AGENT_IMAGE_PLAN_V2_AGENT_IDS
AGENT_IMAGE_OUTPUT_MAX
AGENT_IMAGE_AUTO_EXECUTE_MAX
AGENT_IMAGE_APPROVAL_TTL_MS
```

Each local function registration exposes `{ name, riskLevel, modelTool }`; `get(name)` returns the registration or `null`. `web_search` remains a hosted model tool and has no local executor registration.

- [ ] **Step 4: Preserve strict mode in Responses tool flattening**

Change `toResponsesTool` to retain the strict marker:

```js
export const toResponsesTool = (tool) => {
  if (tool?.type === 'function' && tool.function) {
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      ...(tool.function.strict === true ? { strict: true } : {}),
    };
  }
  return tool;
};
```

Add:

```js
test('toResponsesTool preserves strict function contracts', () => {
  const tool = toResponsesTool({ type: 'function', function: { name: 'generate_images', description: 'd', strict: true, parameters: { type: 'object', additionalProperties: false } } });
  assert.equal(tool.strict, true);
});
```

- [ ] **Step 5: Run registry/provider tests**

```bash
node --test server/agentToolRegistry.test.mjs server/openaiResponsesProvider.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/agentToolRegistry.mjs server/agentToolRegistry.test.mjs server/openaiResponsesProvider.mjs server/openaiResponsesProvider.test.mjs
git commit -m "feat: register strict Agent Center tools"
```

---

### Task 4: V2 Manager-Agent Loop and Batch Execution

**Files:**
- Modify: `server/agentToolConversation.mjs:1-746`
- Test: `server/agentToolConversation.test.mjs:1-1250`

**Interfaces:**
- Consumes: Tasks 1-3 exports and `runContext = { agentId, sessionId, userMessageId, runId }`.
- Produces: V2 `imagePlan` metadata with `planVersion`, `topology`, `expectedOutputCount`, per-output status, provider task IDs, result URLs, and target/reference IDs.

- [ ] **Step 1: Add failing V2 orchestration tests**

Add these fixture helpers so tool calls use catalog IDs rather than model-facing URLs:

```js
const runContext = { agentId: 'agent-v2', sessionId: 'session-v2', userMessageId: 'user-v2', runId: 'run-v2' };
const attachments = [
  { kind: 'image', assetId: 'asset-a', url: 'https://upload/a.png', name: 'A' },
  { kind: 'image', assetId: 'asset-b', url: 'https://upload/b.png', name: 'B' },
  { kind: 'image', assetId: 'asset-c', url: 'https://upload/c.png', name: 'C' },
  { kind: 'image', assetId: 'asset-ref', url: 'https://upload/ref.png', name: '参考' },
];
const fixtureCatalog = buildSessionImageCatalog({ attachments, priorMessages: [], sessionId: runContext.sessionId, currentMessageId: runContext.userMessageId });
const imageIdByAssetId = Object.fromEntries(attachments.map((attachment) => [attachment.assetId, fixtureCatalog.find((item) => item.url === attachment.url).imageId]));
const output = (outputId, assetId, instruction) => ({ output_id: outputId, target_image_ids: [imageIdByAssetId[assetId]], reference_image_ids: [imageIdByAssetId['asset-ref']], instruction, aspect_ratio: '1:1' });
const composePlan = { plan_version: 2, topology: 'multi_input_single_output', expected_output_count: 1, approval_id: null, outputs: [{ output_id: 'compose', target_image_ids: ['asset-a', 'asset-b', 'asset-c'].map((id) => imageIdByAssetId[id]), reference_image_ids: [imageIdByAssetId['asset-ref']], instruction: '合成一张海报', aspect_ratio: '1:1' }] };
const batchPlan = { plan_version: 2, topology: 'multi_input_multi_output', expected_output_count: 3, approval_id: null, outputs: [output('o1', 'asset-a', '处理A'), output('o2', 'asset-b', '处理B'), output('o3', 'asset-c', '处理C')] };
const validPlan = { plan_version: 2, topology: 'single_input_single_output', expected_output_count: 1, approval_id: null, outputs: [output('o1', 'asset-a', '处理A')] };
const invalidUnknownIdPlan = { ...validPlan, outputs: [{ ...validPlan.outputs[0], target_image_ids: ['img_unknown'] }] };
const generateImagesCall = (plan, id = 'call-images') => ({ id, name: 'generate_images', args: plan });
const toolResponse = (call) => ({ content: '', toolCalls: [call], finishReason: 'tool_calls', modelUsed: 'gpt-test' });
const finalTextResponse = { content: '已完成', toolCalls: [], finishReason: 'stop', modelUsed: 'gpt-test' };
const v2Conversation = ({ responses, currentMessage = '完成这些图片', generateImage } = {}) => {
  const queue = [...responses];
  return {
    systemPrompt: '你是测试智能体',
    currentMessage,
    attachments,
    priorMessages: [],
    imageGenerationEnabled: true,
    imageMode: true,
    selectedImageModel: 'image-test',
    imagePlanV2Config: { enabled: true, maxOutputs: 8, autoExecuteMax: 4, approvalTtlMs: 1800000 },
    runContext,
    callModel: async () => queue.shift() || finalTextResponse,
    generateImage: generateImage || (async (payload) => ({ imageUrl: `https://result/${payload.outputId}.png`, providerTaskId: `task-${payload.outputId}`, creditsConsumed: 1 })),
  };
};

test('V2 multi_input_single_output executes one provider job with targets and references', async () => {
  const payloads = [];
  const out = await runAgentConversationV2(v2Conversation({
    responses: [toolResponse(generateImagesCall(composePlan)), finalTextResponse],
    generateImage: async (payload) => { payloads.push(payload); return { imageUrl: 'https://result/compose.png', providerTaskId: 'task-compose' }; },
  }));
  assert.equal(payloads.length, 1);
  assert.equal(out.imagePlan.planVersion, 2);
  assert.equal(out.imagePlan.topology, 'multi_input_single_output');
  assert.equal(out.imagePlan.expectedOutputCount, 1);
});

test('V2 multi_input_multi_output executes every output with controlled concurrency and preserves order', async () => {
  const out = await runAgentConversationV2(v2Conversation({ responses: [toolResponse(generateImagesCall(batchPlan)), finalTextResponse] }));
  assert.deepEqual(out.imagePlan.outputs.map((item) => item.outputId), ['o1', 'o2', 'o3']);
  assert.deepEqual(out.imageResultUrls, ['https://result/o1.png', 'https://result/o2.png', 'https://result/o3.png']);
});

test('V2 invalid plan returns structured tool error and repairs without provider execution', async () => {
  let generated = 0;
  const responses = [toolResponse(generateImagesCall(invalidUnknownIdPlan, 'bad')), toolResponse(generateImagesCall(validPlan, 'fixed')), finalTextResponse];
  const out = await runAgentConversationV2(v2Conversation({ responses, generateImage: async (payload) => { generated += 1; return { imageUrl: `https://result/${payload.outputId}.png`, providerTaskId: `task-${payload.outputId}` }; } }));
  assert.equal(generated, 1);
  assert.equal(out.imagePlan.planVersion, 2);
});

test('V2 behavior does not depend on hasIndependentBatchIntent keyword heuristics', async () => {
  const out = await runAgentConversationV2(v2Conversation({ currentMessage: '按你理解完成这些素材', responses: [toolResponse(generateImagesCall(batchPlan)), finalTextResponse] }));
  assert.equal(out.imagePlan.expectedOutputCount, 3);
});
```

Add these focused edge tests:

```js
test('V2 search_knowledge can precede generate_images', async () => {
  let searches = 0;
  let generations = 0;
  const searchCall = { id: 'search-1', name: 'search_knowledge', args: { query: '商品规则' } };
  const out = await runAgentConversationV2({
    ...v2Conversation({ responses: [toolResponse(searchCall), toolResponse(generateImagesCall(validPlan)), finalTextResponse] }),
    hasKnowledgeBase: true,
    searchKnowledge: async () => { searches += 1; return [{ content: '规则内容', documentTitle: '规则' }]; },
    generateImage: async (payload) => { generations += 1; return { imageUrl: `https://result/${payload.outputId}.png`, providerTaskId: `task-${payload.outputId}` }; },
  });
  assert.equal(searches, 1);
  assert.equal(generations, 1);
  assert.equal(out.imagePlan.planVersion, 2);
});

test('V2 exact duplicate outputs spend zero image credits', async () => {
  let generated = 0;
  const duplicatePlan = { ...batchPlan, expected_output_count: 2, outputs: [batchPlan.outputs[0], { ...batchPlan.outputs[0], output_id: 'duplicate' }] };
  const capturedToolOutputs = [];
  const options = v2Conversation({ responses: [toolResponse(generateImagesCall(duplicatePlan)), finalTextResponse], generateImage: async () => { generated += 1; return {}; } });
  const originalCallModel = options.callModel;
  options.callModel = async (args) => {
    capturedToolOutputs.push(...args.messages.filter((item) => item.type === 'function_call_output'));
    return originalCallModel(args);
  };
  await runAgentConversationV2(options);
  assert.equal(generated, 0);
  assert.match(capturedToolOutputs.map((item) => item.output).join('\n'), /image_plan_duplicate_output/);
});

test('V2 partial provider failure retains successful outputs', async () => {
  const out = await runAgentConversationV2(v2Conversation({
    responses: [toolResponse(generateImagesCall(batchPlan)), finalTextResponse],
    generateImage: async (payload) => {
      if (payload.outputId === 'o2') { const error = new Error('上游失败'); error.code = 'provider_bad_response'; throw error; }
      return { imageUrl: `https://result/${payload.outputId}.png`, providerTaskId: `task-${payload.outputId}` };
    },
  }));
  assert.deepEqual(out.imageResultUrls, ['https://result/o1.png', 'https://result/o3.png']);
  assert.equal(out.imagePlan.status, 'partial');
});

test('V2 final summary failure preserves generated images', async () => {
  const options = v2Conversation({ responses: [toolResponse(generateImagesCall(batchPlan))] });
  let modelCalls = 0;
  const initialCallModel = options.callModel;
  options.callModel = async (args) => {
    modelCalls += 1;
    if (modelCalls > 1) throw new Error('总结失败');
    return initialCallModel(args);
  };
  const out = await runAgentConversationV2(options);
  assert.equal(out.finishReason, 'image_ready_final_reply_failed');
  assert.equal(out.imageResultUrls.length, 3);
});

test('V1 remains unchanged while V2 is disabled', async () => {
  const options = v2Conversation({ responses: [toolResponse({ id: 'legacy', name: 'generate_image', args: { prompt: '处理A', task_type: 'edit_image', input_image_urls: ['https://upload/a.png'], aspect_ratio: '1:1' } }), finalTextResponse] });
  options.imagePlanV2Config = { enabled: false, maxOutputs: 8, autoExecuteMax: 4, approvalTtlMs: 1800000 };
  const out = await runAgentConversationV2(options);
  assert.equal(out.imagePlan.planVersion, undefined);
  assert.equal(out.imagePlan.taskType, 'edit_image');
});
```

- [ ] **Step 2: Run the focused orchestration tests and confirm RED**

```bash
node --test server/agentToolConversation.test.mjs
```

Expected: new V2 cases FAIL while existing V1 cases remain green.

- [ ] **Step 3: Add RTCFE manager guidance and V2 catalog mode**

Introduce a V2 guidance constant with explicit RTCFE headings. Its Format section must require one `generate_images` call for one coherent image request and use the five topology values. Its Example section includes single edit, composition, independent batch, and shared reference. Do not add any regex-based interpretation helper.

Build the catalog with run identity:

```js
const catalog = buildSessionImageCatalog({
  attachments: modelAttachments,
  priorMessages: modelPriorMessages,
  sessionId: runContext.sessionId,
  currentMessageId: runContext.userMessageId,
});
const imagePlanV2Enabled = Boolean(imagePlanV2Config?.enabled);
const catalogText = formatCatalogForPrompt(catalog, { includeUrls: !imagePlanV2Enabled });
```

The old `IMAGE_MODE_GUIDANCE`, URL instructions, `hasIndependentBatchIntent`, and under-planning audit remain reachable only in the V1 branch. V2 must not call them.

- [ ] **Step 4: Build tools through the registry**

Replace manual tool-array construction with:

```js
const registry = buildAgentToolRegistry({
  imageGenerationEnabled,
  imagePlanV2Enabled: Boolean(imagePlanV2Config?.enabled),
  hasKnowledgeBase,
  webSearchEnabled,
});
const tools = registry.modelTools;
```

Filter model calls through `registry.get(call.name)`; unsupported calls receive a structured tool result rather than silently executing `response.toolCalls[0]`.

- [ ] **Step 5: Validate and expand one V2 call before provider submission**

For `generate_images`:

```js
const plan = normalizeImageExecutionPlan(call.args);
validateImageExecutionPlan({ plan, catalog, maxOutputs: imagePlanV2Config.maxOutputs });
const expandedOutputs = expandImageExecutionPlan({ plan, catalog });
```

On validation error, append a JSON tool result:

```js
JSON.stringify({
  status: 'invalid_plan',
  error: {
    code: error.code || 'invalid_tool_args',
    message: error.message,
    output_id: error.outputId || null,
    image_id: error.imageId || null,
  },
})
```

Count invalid V2 plans against `AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS`. When exhausted, throw `image_plan_invalid` before any provider call.

- [ ] **Step 6: Execute expanded outputs with ordered checkpoints and partial results**

Pass each expanded output to the existing `generateImage` callback:

```js
{
  ...expandedOutput,
  model: selectedImageModel,
  idempotencyKey: [runContext.sessionId, runContext.userMessageId, callId, expandedOutput.outputId].join(':'),
  planVersion: 2,
  topology: plan.topology,
  expectedOutputCount: plan.expectedOutputCount,
}
```

Use `runWithConcurrency` with `AGENT_IMAGE_TOOL_CONCURRENCY`, store results by original output index, and call `onImageResultReady` after each successful output. Catch non-credit provider failures per output and return `{status:'failed', errorCode, errorMessage}` for that output; rethrow `account_credit_insufficient`. The aggregate must preserve successful images and mark the batch `partial` when successes are fewer than expected.

- [ ] **Step 7: Run V2 and V1 conversation tests**

```bash
node --test server/agentToolConversation.test.mjs server/imageExecutionPlan.test.mjs server/conversationImageCatalog.test.mjs
```

Expected: PASS, including all existing V1 tests.

- [ ] **Step 8: Run Hermes changed-file gate**

```bash
cd /Users/feiyanglin/程序开发/hermes-harness
node scripts/hermes-harness.mjs --changed server/agentToolConversation.mjs server/imageExecutionPlan.mjs server/agentToolRegistry.mjs server/conversationImageCatalog.mjs
```

Expected: no unresolved high-risk guardrail finding.

- [ ] **Step 9: Commit Task 4**

```bash
git add server/agentToolConversation.mjs server/agentToolConversation.test.mjs
git commit -m "feat: execute validated Agent Center image plans"
```

---

### Task 5: Cross-Turn Approval for Large Image Batches

**Files:**
- Create: `server/agentImagePlanApproval.mjs`
- Create: `server/agentImagePlanApproval.test.mjs`
- Modify: `server/agentToolConversation.mjs`
- Test: `server/agentToolConversation.test.mjs`

**Interfaces:**
- Consumes: normalized plan, current run identity, prior assistant `pendingImagePlanApproval`, auto-execute limit, and TTL.
- Produces: `createPendingImagePlanApproval`, `verifyPendingImagePlanApproval`, and assistant metadata safe to persist across one later user turn.

- [ ] **Step 1: Write failing approval integrity tests**

```js
test('large plan requires a later user turn and exact matching plan hash', () => {
  const plan = {
    planVersion: 2,
    topology: 'text_to_multi_image',
    expectedOutputCount: 5,
    approvalId: null,
    outputs: Array.from({ length: 5 }, (_, index) => ({ outputId: `o${index + 1}`, targetImageIds: [], referenceImageIds: [], instruction: `方案${index + 1}`, aspectRatio: '1:1' })),
  };
  const changedPlan = { ...plan, outputs: plan.outputs.map((output, index) => index === 0 ? { ...output, instruction: '被篡改的方案' } : output) };
  const pending = createPendingImagePlanApproval({ plan, sessionId: 's1', sourceUserMessageId: 'u1', now: 1000, ttlMs: 30000, createId: () => 'approval-1' });
  assert.equal(verifyPendingImagePlanApproval({ plan: { ...plan, approvalId: 'approval-1' }, pending, sessionId: 's1', currentUserMessageId: 'u1', now: 1001 }).approved, false);
  assert.equal(verifyPendingImagePlanApproval({ plan: { ...plan, approvalId: 'approval-1' }, pending, sessionId: 's1', currentUserMessageId: 'u2', now: 1001 }).approved, true);
  assert.equal(verifyPendingImagePlanApproval({ plan: { ...changedPlan, approvalId: 'approval-1' }, pending, sessionId: 's1', currentUserMessageId: 'u2', now: 1001 }).approved, false);
  assert.equal(verifyPendingImagePlanApproval({ plan: { ...plan, approvalId: 'approval-1' }, pending, sessionId: 's1', currentUserMessageId: 'u2', now: 40001 }).approved, false);
});
```

- [ ] **Step 2: Run approval tests and confirm RED**

```bash
node --test server/agentImagePlanApproval.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement canonical hashing and approval verification**

Hash only semantic plan fields, excluding `approvalId`, with recursively stable object keys. Persist:

```js
{
  approvalId,
  sessionId,
  sourceUserMessageId,
  planHash,
  topology,
  expectedOutputCount,
  expiresAt,
}
```

Approval is valid only when ID, session, unexpired hash, and a different `currentUserMessageId` all match.

- [ ] **Step 4: Integrate approval into the V2 tool result loop**

If `expectedOutputCount > autoExecuteMax` and no valid prior approval exists, do not call `generateImage`. Create pending metadata and return:

```js
JSON.stringify({
  status: 'confirmation_required',
  approval_id: pending.approvalId,
  topology: pending.topology,
  expected_output_count: pending.expectedOutputCount,
  message: `该计划将生成 ${pending.expectedOutputCount} 张图片，需要用户在下一条消息确认。`,
})
```

The generated ID cannot authorize another call in the same user turn. Return `pendingImagePlanApproval` from `runAgentConversationV2`; clear it after a matching approved plan executes. Add V2 guidance telling the model to use an approval ID only after the next user message clearly confirms the same plan.

- [ ] **Step 5: Add conversation tests for no-spend confirmation behavior**

```js
test('large V2 batch spends nothing until a later confirmed turn', async () => {
  let generated = 0;
  const firstOptions = v2Conversation({
    responses: [toolResponse(generateImagesCall(batchPlan)), finalTextResponse],
    generateImage: async () => { generated += 1; return {}; },
  });
  firstOptions.imagePlanV2Config = { enabled: true, maxOutputs: 8, autoExecuteMax: 2, approvalTtlMs: 1800000 };
  const first = await runAgentConversationV2(firstOptions);
  assert.equal(generated, 0);
  assert.equal(first.pendingImagePlanApproval.expectedOutputCount, 3);

  const approvedPlan = { ...batchPlan, approval_id: first.pendingImagePlanApproval.approvalId };
  const secondOptions = v2Conversation({
    responses: [toolResponse(generateImagesCall(approvedPlan)), finalTextResponse],
    generateImage: async (payload) => { generated += 1; return { imageUrl: `https://result/${payload.outputId}.png`, providerTaskId: `task-${payload.outputId}` }; },
  });
  secondOptions.imagePlanV2Config = firstOptions.imagePlanV2Config;
  secondOptions.pendingImagePlanApproval = first.pendingImagePlanApproval;
  secondOptions.runContext = { ...runContext, userMessageId: 'user-v2-confirmation', runId: 'run-v2-confirmation' };
  const second = await runAgentConversationV2(secondOptions);
  assert.equal(generated, 3);
  assert.equal(second.pendingImagePlanApproval, null);
});
```

The unit test in Step 1 is the required coverage for changed-plan and expired-token rejection; add orchestration assertions that those rejection codes are returned to the model and `generateImage` remains uncalled.

- [ ] **Step 6: Run approval and conversation tests**

```bash
node --test server/agentImagePlanApproval.test.mjs server/agentToolConversation.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add server/agentImagePlanApproval.mjs server/agentImagePlanApproval.test.mjs server/agentToolConversation.mjs server/agentToolConversation.test.mjs
git commit -m "feat: guard large Agent Center image batches"
```

---

### Task 6: Dual-Handler Persistence, Credits, Checkpoints, and Tracing

**Files:**
- Modify: `server/index.mjs:1620-1665,6553-7050,13323-13689`
- Modify: `server/agentChatCheckpointMetadata.mjs:24-139`
- Test: `server/agentChatCheckpointMetadata.test.mjs`
- Test: `server/agentCenterSource.test.mjs`
- Test: `server/accountCreditsSource.test.mjs`

**Interfaces:**
- Consumes: V2 feature config, run context, prior pending approval, expanded output details, and partial-result checkpoints.
- Produces: identical local/MySQL metadata and runtime log fields.

- [ ] **Step 1: Write failing checkpoint and source parity tests**

Add a checkpoint fixture with:

```js
const v2Plan = {
  planVersion: 2,
  topology: 'multi_input_multi_output',
  expectedOutputCount: 2,
  outputCount: 1,
  status: 'partial',
  outputs: [
    { outputId: 'o1', targetImageIds: ['img_a'], referenceImageIds: ['img_ref'], providerTaskId: 'task-1', imageResultUrl: 'https://result/1.png', status: 'succeeded' },
    { outputId: 'o2', targetImageIds: ['img_b'], referenceImageIds: ['img_ref'], providerTaskId: '', imageResultUrl: '', status: 'pending' },
  ],
};
```

Assert `buildSubmittedImageTaskCheckpoint` and `buildReadyImageCheckpoint` preserve this object without collapsing it to the first output.

Add source assertions proving both handler calls include:

```text
runContext: { agentId: agent.id, sessionId, userMessageId, runId }
imagePlanV2Config
pendingImagePlanApproval
```

and both assistant metadata objects persist `pendingImagePlanApproval` and V2 `imagePlan`.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
node --test server/agentChatCheckpointMetadata.test.mjs server/agentCenterSource.test.mjs server/accountCreditsSource.test.mjs
```

Expected: new V2 assertions FAIL.

- [ ] **Step 3: Resolve feature config and prior approval identically in both handlers**

Immediately after history is loaded:

```js
const imagePlanV2Config = resolveAgentImagePlanV2Config({ env: process.env, agentId: agent.id });
const pendingImagePlanApproval = [...history]
  .reverse()
  .find((message) => message.role === 'assistant' && message.metadata?.pendingImagePlanApproval)
  ?.metadata?.pendingImagePlanApproval || null;
```

Pass the same values and run context into both `runAgentConversationV2` calls.

- [ ] **Step 4: Preserve V2 output identity through provider callbacks**

Extend both `generateImage` callback signatures to accept `outputId`, `targetImageIds`, `referenceImageIds`, `idempotencyKey`, `planVersion`, `topology`, and `expectedOutputCount`. Include them in `imagePlan` passed to the provider-task checkpoint. Continue reserving credits before each provider call and settling/releasing that output's reservation afterward.

Do not move provider submission before credit reservation. Do not combine multiple output reservations into one shared reservation because a failed output must release only its own hold.

- [ ] **Step 5: Persist pending approval and structured trace fields**

Add to MySQL and local assistant metadata:

```js
pendingImagePlanApproval: result.pendingImagePlanApproval || null,
```

Extend `buildAgentRuntimeLogMeta` with non-sensitive fields:

```js
planVersion: Number(result?.imagePlan?.planVersion || 1),
topology: String(result?.imagePlan?.topology || ''),
expectedOutputCount: Number(result?.imagePlan?.expectedOutputCount || result?.imagePlan?.outputCount || 0),
actualOutputCount: Array.isArray(result?.imageResultUrls) ? result.imageResultUrls.length : 0,
outputIds: Array.isArray(result?.imagePlan?.outputs) ? result.imagePlan.outputs.map((item) => item.outputId).filter(Boolean) : [],
```

Keep URLs and private prompts out of ordinary log message text; existing admin metadata may retain authorized result URLs.

- [ ] **Step 6: Run dual-handler, credit, checkpoint, and conversation regressions**

```bash
node --test server/agentChatCheckpointMetadata.test.mjs server/agentCenterSource.test.mjs server/accountCreditsSource.test.mjs server/agentToolConversation.test.mjs server/agentConversationReliability.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run Hermes high-risk gate**

```bash
cd /Users/feiyanglin/程序开发/hermes-harness
node scripts/hermes-harness.mjs --changed server/index.mjs server/agentToolConversation.mjs server/agentChatCheckpointMetadata.mjs
```

Expected: no unresolved dual-handler, prompt, credit, or checkpoint warning.

- [ ] **Step 8: Commit Task 6**

```bash
git add server/index.mjs server/agentChatCheckpointMetadata.mjs server/agentChatCheckpointMetadata.test.mjs server/agentCenterSource.test.mjs server/accountCreditsSource.test.mjs
git commit -m "feat: persist Agent Center image plan traces"
```

---

### Task 7: Configuration, Documentation, and Complete Local Verification

**Files:**
- Modify: `.env.server.example`
- Modify: `docs/project-overview.md`
- Modify: `docs/tencent-cloud-deploy.md`
- Modify only if a new reusable root cause is confirmed during implementation: `docs/agents/repeated-issues.md` and `CLAUDE.md`

**Interfaces:**
- Consumes: Tasks 1-6 complete implementation.
- Produces: deployable configuration and fresh local evidence.

- [ ] **Step 1: Document exact environment defaults**

Add:

```bash
# OpenAI-style Agent Center image plan V2 global kill switch. Default false.
AGENT_IMAGE_PLAN_V2_ENABLED=false
# Optional comma-separated Agent Center agent IDs for canary. Empty means all agents when enabled.
AGENT_IMAGE_PLAN_V2_AGENT_IDS=
# Hard per-tool-call output cap. Default 8, code clamp 1..20.
AGENT_IMAGE_OUTPUT_MAX=8
# Outputs above this count require a later user confirmation. Default 4.
AGENT_IMAGE_AUTO_EXECUTE_MAX=4
# Pending confirmation lifetime in milliseconds. Default 1800000 (30 minutes).
AGENT_IMAGE_APPROVAL_TTL_MS=1800000
```

Document that disabling V2 restores the V1 model-visible contract without deleting V2 metadata or completed assets.

- [ ] **Step 2: Run all focused server tests**

```bash
node --test \
  server/conversationImageCatalog.test.mjs \
  server/imageToolDefinition.test.mjs \
  server/imageExecutionPlan.test.mjs \
  server/agentToolRegistry.test.mjs \
  server/agentImagePlanApproval.test.mjs \
  server/openaiResponsesProvider.test.mjs \
  server/agentToolConversation.test.mjs \
  server/agentChatCheckpointMetadata.test.mjs \
  server/agentCenterSource.test.mjs \
  server/accountCreditsSource.test.mjs \
  server/agentConversationReliability.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run project-wide verification**

```bash
npm run lint
npm test
npm run build
```

Expected: lint/typecheck clean, full suite green, and production build succeeds.

- [ ] **Step 4: Start the current local version with V2 canary enabled**

Create or rename a dedicated local Agent Center test agent to `Agent V2 Canary`, then resolve its ID from the local store and start the current version:

```bash
LOCAL_TEST_AGENT_ID="$(node --input-type=module -e "import fs from 'node:fs'; const store=JSON.parse(fs.readFileSync('server/data/internal-store.json','utf8')); const agent=(store.agents||[]).find((item)=>item.name==='Agent V2 Canary'); if(!agent?.id) process.exit(2); process.stdout.write(String(agent.id));")"
test -n "$LOCAL_TEST_AGENT_ID"
AGENT_IMAGE_PLAN_V2_ENABLED=1 \
AGENT_IMAGE_PLAN_V2_AGENT_IDS="$LOCAL_TEST_AGENT_ID" \
npm run local
```

In a second terminal session, run:

```bash
npm run doctor
```

Expected: frontend at `http://localhost:3000`; backend health at `http://127.0.0.1:3100/api/health`; doctor reports backend and worker healthy.

- [ ] **Step 5: Execute the seven-case live semantic acceptance matrix**

Use an authenticated local Agent Center session and record `agentRunId`, tool plan, provider task IDs, result count, and credit records for:

1. One uploaded target edited into one output.
2. Three uploaded images composed into one poster.
3. Three uploaded targets independently producing three outputs.
4. Three targets sharing one style reference, producing exactly three outputs.
5. A vague “处理这些图” request asking a clarification and spending zero image credits.
6. Five outputs triggering confirmation, then executing only after the next user confirmation.
7. A knowledge-base lookup followed by image generation in the same conversation.

Expected: plans use image IDs, no model-returned URL is trusted, provider jobs match outputs, partial/checkpoint state survives refresh, and final-summary failure cannot hide completed images.

- [ ] **Step 6: Review the complete implementation diff**

```bash
git diff 267e01a...HEAD --check
git diff 267e01a...HEAD --stat
git status --short
```

Review explicitly: Agent Center-only scope, user isolation, managed/public asset URL handling, credits, logs/statistics, permissions, MySQL/local parity, checkpoint recovery, prompt RTCFE, and rollback flag.

- [ ] **Step 7: Record any confirmed reusable root cause**

If implementation or live acceptance reveals a reproducible bug, add root cause, fix, and prevention rule to `docs/agents/repeated-issues.md`; add it to `CLAUDE.md` only when it is architecture-level. Do not create an entry when no new issue was found.

- [ ] **Step 8: Commit Task 7**

```bash
git add .env.server.example docs/project-overview.md docs/tencent-cloud-deploy.md
git commit -m "docs: document Agent Center image plan rollout"
```

When Task 7 authored a new root-cause entry, stage that exact file in the bug fix's owning commit after reviewing `git diff -- docs/agents/repeated-issues.md CLAUDE.md`; never stage a pre-existing unrelated change.

---

### Task 8: Code Review, Cloud Canary, and Production Acceptance

**Files:**
- No planned source edits. Any review fix restarts at its owning TDD task and gets a separate commit.
- External bug-fix record location when a real bug was fixed: `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板`.

**Interfaces:**
- Consumes: reviewed, locally verified Tasks 1-7.
- Produces: cloud canary evidence, rollback readiness, and a production release decision.

- [ ] **Step 1: Run a fresh high-risk code review before deployment**

Review `git diff 267e01a...HEAD` for behavioral regressions, data isolation, URL handling, log/statistic retention, permission boundaries, credit settlement, checkpoint ordering, and both chat handlers. Resolve every blocking finding through a failing test and focused fix before continuing.

- [ ] **Step 2: Confirm cloud queue drain without override**

Run the normal deployment script only after review; its first and second readiness gates must both report `runningCount: 0`. Do not set `MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS=1` for this release.

- [ ] **Step 3: Deploy code with V2 initially disabled**

```bash
MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh
```

Expected: remote install, security audit, build, atomic dist swap, PM2 restart, and `pm2 save` succeed.

- [ ] **Step 4: Verify baseline cloud health before enabling the canary**

```bash
curl -fsS http://meiaoyuntai.com/api/health
```

Expected: healthy API and worker, current build ID, and no PM2 restart loop. Verify one ordinary Agent Center text conversation and one V1 image conversation still work while V2 is disabled.

- [ ] **Step 5: Enable V2 for one test agent**

Create or rename a dedicated cloud Agent Center test agent to `Agent V2 Canary`. Resolve its ID from the cloud database without printing credentials:

```bash
CLOUD_TEST_AGENT_ID="$(ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 "cd /www/wwwroot/meiao-internal && set -a && source .env.server && set +a && node --input-type=module -e \"import mysql from 'mysql2/promise'; const c=await mysql.createConnection({host:process.env.MEIAO_DB_HOST,port:Number(process.env.MEIAO_DB_PORT||3306),user:process.env.MEIAO_DB_USER,password:process.env.MEIAO_DB_PASSWORD,database:process.env.MEIAO_DB_NAME}); const [rows]=await c.query('SELECT id FROM agents WHERE name = ? ORDER BY updated_at DESC LIMIT 1',['Agent V2 Canary']); await c.end(); if(!rows[0]?.id) process.exit(2); process.stdout.write(String(rows[0].id));\"")"
test -n "$CLOUD_TEST_AGENT_ID"
```

Update the server `.env.server` using that exact ID, then restart with updated environment:

```bash
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 "cd /www/wwwroot/meiao-internal && sed -i.bak -e '/^AGENT_IMAGE_PLAN_V2_ENABLED=/d' -e '/^AGENT_IMAGE_PLAN_V2_AGENT_IDS=/d' -e '/^AGENT_IMAGE_OUTPUT_MAX=/d' -e '/^AGENT_IMAGE_AUTO_EXECUTE_MAX=/d' -e '/^AGENT_IMAGE_APPROVAL_TTL_MS=/d' .env.server && printf '%s\n' 'AGENT_IMAGE_PLAN_V2_ENABLED=1' 'AGENT_IMAGE_PLAN_V2_AGENT_IDS=$CLOUD_TEST_AGENT_ID' 'AGENT_IMAGE_OUTPUT_MAX=8' 'AGENT_IMAGE_AUTO_EXECUTE_MAX=4' 'AGENT_IMAGE_APPROVAL_TTL_MS=1800000' >> .env.server && pm2 restart meiao-internal --update-env && pm2 save"
```

Do not enable all agents during canary.

- [ ] **Step 6: Run cloud semantic and recovery acceptance**

Repeat cases 1-7 from Task 7 against the canary agent. For each image output, verify the chain contains a validated V2 plan, credit reservation, provider task ID checkpoint, managed HTTPS result, completion/partial event, and final assistant metadata. Refresh during one running batch and verify recovery without duplicate provider submission.

- [ ] **Step 7: Verify non-canary isolation and rollback**

Confirm another Agent Center agent still receives `generate_image`, not `generate_images`. Test rollback and then re-enable the same canary:

```bash
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 "cd /www/wwwroot/meiao-internal && sed -i.bak 's/^AGENT_IMAGE_PLAN_V2_ENABLED=.*/AGENT_IMAGE_PLAN_V2_ENABLED=0/' .env.server && pm2 restart meiao-internal --update-env && pm2 save"
curl -fsS http://meiaoyuntai.com/api/health
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 "cd /www/wwwroot/meiao-internal && sed -i.bak 's/^AGENT_IMAGE_PLAN_V2_ENABLED=.*/AGENT_IMAGE_PLAN_V2_ENABLED=1/' .env.server && pm2 restart meiao-internal --update-env && pm2 save"
curl -fsS http://meiaoyuntai.com/api/health
```

Expected: disabled state uses V1, re-enabled state limits V2 to `Agent V2 Canary`, and neither transition loses V2 history or assets.

- [ ] **Step 8: Record bug fixes in the external diagnostics dashboard**

For every real committed bug fix created during implementation, review, or cloud acceptance, run the diagnostics dashboard's `npm run record-fix` entry from `/Users/feiyanglin/程序开发/电商视觉一键化/云上日志诊断看板` with the actual request, stable fingerprint, title, modules, categories, root cause, fix, lesson, diagnostic evidence, prevention, tests, files, business commit, and `deployed_to_cloud` status. The exact argument contract is in `docs/bug-fix-tracking-rules.md`; no record is created when no bug exists. Verify the resulting fingerprint with `rg` in `dashboard/index.html` and `data/*.json`, then run dashboard `npm test` and `npm run doctor`.

- [ ] **Step 9: Make the production decision**

Keep the agent allowlist when evidence is incomplete. Only after the seven semantic cases, non-canary isolation, credits, checkpoints, logs, health, and rollback all pass, enable all agents by setting the allowlist empty:

```bash
ssh -o IdentitiesOnly=yes -i "$HOME/.ssh/MEIAO.pem" root@111.229.66.247 "cd /www/wwwroot/meiao-internal && sed -i.bak 's/^AGENT_IMAGE_PLAN_V2_AGENT_IDS=.*/AGENT_IMAGE_PLAN_V2_AGENT_IDS=/' .env.server && pm2 restart meiao-internal --update-env && pm2 save"
curl -fsS http://meiaoyuntai.com/api/health
```

Report build ID, source commit, feature-flag state, tested agent ID, real provider task IDs, and residual risk.

---

## Plan Self-Review Checklist

- [x] Every design requirement maps to Tasks 1-8.
- [x] No task changes OneClick or replaces the provider layer.
- [x] V2 never accepts model-returned arbitrary URLs.
- [x] V1 remains available behind the kill switch.
- [x] MySQL/local parity, credits, checkpoints, partial results, approval, logs, and rollback have explicit tests.
- [x] Prompt work is RTCFE and does not introduce business-keyword inference.
- [x] Cloud deployment is gated by review, queue drain, baseline health, canary isolation, and rollback proof.
