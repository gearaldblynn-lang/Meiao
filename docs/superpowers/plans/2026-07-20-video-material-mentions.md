# Video Material Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable `@图片N/@视频N/@音频N` references to the current-task materials in short-video multimodal generation.

**Architecture:** Keep the existing textarea and provider payloads. A focused pure utility owns candidate numbering, safe binding JSON, insertion, and submit-time compilation from stable `materialId` bindings to the actual modality-local provider ordinals; the input bar owns interaction, while `runShellVideoGeneration` owns one immutable snapshot pairing each resolved URL with its material ID and provider ordinal.

**Tech Stack:** React 19, TypeScript/TSX, ESM utilities, Node `node:test`, existing shell workflow and internal job API.

## Global Constraints

- The feature is visible only for `VIDEO` generation in `multimodal2video` mode.
- Candidate materials come only from `product`, `scene`, `referenceVideo`, and `audio` in the current task.
- Existing KIE, MaxForAI, and Dreamina CLI provider fields, retries, billing, and managed-asset behavior remain unchanged.
- A missing bound material or unreadable bound asset must fail before the paid provider create call.
- Historical prompts without binding metadata retain official ordinal semantics.
- Do not add a rich-text editor or a historical asset search.

---

### Task 1: Pure mention contract

**Files:**
- Create: `src/utils/videoMaterialMentions.mjs`
- Create: `src/utils/videoMaterialMentions.test.mjs`

**Interfaces:**
- Consumes: `materials: Record<string, Array<{ id, type, url, remoteUrl?, fileName }>>`, an exact submit-time reference snapshot, and serialized `videoMaterialMentionBindings`.
- Produces: `parseVideoMaterialMentionBindings`, `buildVideoMaterialMentionCandidates`, `findVideoMaterialMentionQuery`, `insertVideoMaterialMention`, `upsertVideoMaterialMentionBinding`, and `compileVideoMaterialMentions`.

- [ ] **Step 1: Write failing contract tests**

```js
test('compiles a stable image binding after product material order changes', () => {
  const bindings = [{ label: '@图片2', materialId: 'scene-1', kind: 'image', sourceType: 'scene' }];
  const result = compileVideoMaterialMentions({
    prompt: '参考 @图片2 的场景',
    references: [
      { materialId: 'new-product', kind: 'image', sourceType: 'product', providerOrdinal: 1 },
      { materialId: 'scene-1', kind: 'image', sourceType: 'scene', providerOrdinal: 2 },
    ],
    bindings,
  });
  assert.equal(result.compiledPrompt, '参考 @图片2 的场景');
  assert.equal(result.manifest[0].materialId, 'scene-1');
});

test('renumbers a bound material to the actual provider ordinal', () => {
  const result = compileVideoMaterialMentions({
    prompt: '参考 @图片3',
    references: [{ materialId: 'scene-1', kind: 'image', sourceType: 'scene', providerOrdinal: 1 }],
    bindings: [{ label: '@图片3', materialId: 'scene-1', kind: 'image', sourceType: 'scene' }],
  });
  assert.equal(result.compiledPrompt, '参考 @图片1');
});

test('rejects a prompt that still uses a deleted bound material', () => {
  assert.throws(() => compileVideoMaterialMentions({
    prompt: '@视频1 的运镜',
    references: [],
    bindings: [{ label: '@视频1', materialId: 'gone', kind: 'video', sourceType: 'referenceVideo' }],
  }), /@视频1 对应素材已移除/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test src/utils/videoMaterialMentions.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `videoMaterialMentions.mjs`.

- [ ] **Step 3: Implement the pure contract**

```js
export const VIDEO_MATERIAL_MENTION_PARAM = 'videoMaterialMentionBindings';

export const compileVideoMaterialMentions = ({ prompt, references, bindings }) => {
  const byId = new Map(references.map((item) => [item.materialId, item]));
  let compiledPrompt = String(prompt || '');
  const manifest = [];
  for (const binding of parseVideoMaterialMentionBindings(bindings)) {
    if (!compiledPrompt.includes(binding.label)) continue;
    const reference = byId.get(binding.materialId);
    if (!reference || reference.kind !== binding.kind) {
      throw new Error(`${binding.label} 对应素材已移除，请删除该引用或重新选择素材。`);
    }
    const providerLabel = `@${KIND_LABEL[reference.kind]}${reference.providerOrdinal}`;
    compiledPrompt = replaceMentionLabel(compiledPrompt, binding.label, providerLabel);
    manifest.push({ ...binding, providerOrdinal: reference.providerOrdinal, providerLabel });
  }
  return { compiledPrompt, manifest };
};
```

The same file must implement: bounded JSON parsing (maximum 32 bindings, maximum 160 characters per string field), modality-local numbering, unique labels per modality, a single-pass exact mention replacement that cannot corrupt swaps such as `@图片1` ↔ `@图片2`, query extraction at the caret, and insertion that returns `{ prompt, caret, binding }`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test src/utils/videoMaterialMentions.test.mjs`
Expected: all mention utility tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/videoMaterialMentions.mjs src/utils/videoMaterialMentions.test.mjs
git commit -m "feat(video): add stable material mention contract"
```

### Task 2: Input-bar interaction

**Files:**
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/shell/components/layout/BottomInputBar.test.mjs`

**Interfaces:**
- Consumes: pure candidate/query/insertion/binding functions from Task 1, `promptText`, `currentParams`, current `materials`, `onPromptChange`, and `onParamChange`.
- Produces: an accessible current-task mention popover and serialized stable bindings in `currentParams.videoMaterialMentionBindings`.

- [ ] **Step 1: Add failing source-contract tests**

```js
test('short video multimodal input exposes current-material mentions only', () => {
  const bottomInputBar = source();
  assert.match(bottomInputBar, /videoMaterialMentionBindings/);
  assert.match(bottomInputBar, /buildVideoMaterialMentionCandidates/);
  assert.match(bottomInputBar, /@素材/);
  assert.match(bottomInputBar, /aria-label="引用当前素材"/);
  assert.match(bottomInputBar, /isDreaminaVideoGeneration && dreaminaMode === 'multimodal2video'/);
});
```

- [ ] **Step 2: Run the focused UI contract test and verify RED**

Run: `node --test src/shell/components/layout/BottomInputBar.test.mjs`
Expected: the new `@素材` assertions FAIL.

- [ ] **Step 3: Implement interaction state and handlers**

```tsx
const [materialMentionOpen, setMaterialMentionOpen] = useState(false);
const [materialMentionIndex, setMaterialMentionIndex] = useState(0);
const [materialMentionQuery, setMaterialMentionQuery] = useState('');
const mentionBindings = useMemo(
  () => parseVideoMaterialMentionBindings(currentParams.videoMaterialMentionBindings),
  [currentParams.videoMaterialMentionBindings],
);
const materialMentionCandidates = useMemo(
  () => buildVideoMaterialMentionCandidates(materials, mentionBindings),
  [materials, mentionBindings],
);
```

Add `openMaterialMentionMenu`, `handlePromptTextChange`, `insertSelectedMaterialMention`, and textarea keyboard handling. Persist bindings with:

```tsx
onParamChange(
  VIDEO_MATERIAL_MENTION_PARAM,
  JSON.stringify(upsertVideoMaterialMentionBinding(mentionBindings, candidate)),
);
```

Render the popover above the textarea and an `AtSign` toolbar button only when:

```tsx
const canUseVideoMaterialMentions = isDreaminaVideoGeneration && dreaminaMode === 'multimodal2video';
```

The menu must show grouped image/video/audio candidates, thumbnails or modality icons, filename, visible label, empty-state copy, and `role="listbox"` / `role="option"` semantics.

- [ ] **Step 4: Run UI contract and TypeScript checks**

Run: `node --test src/shell/components/layout/BottomInputBar.test.mjs && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/layout/BottomInputBar.tsx src/shell/components/layout/BottomInputBar.test.mjs
git commit -m "feat(video): add material mention picker"
```

### Task 3: Submit-time compilation and provider snapshot

**Files:**
- Modify: `src/adapters/shellWorkflow.ts`
- Modify: `src/components/uiArchitecture.test.mjs`
- Modify: `src/utils/videoMaterialMentions.test.mjs`

**Interfaces:**
- Consumes: `compileVideoMaterialMentions({ prompt, references, bindings })` and paired ordered entries that carry both the material and its resolved URL.
- Produces: `compiledPrompt` in all three video job payload variants and `videoReferenceManifest` in the internal task payload.

- [ ] **Step 1: Add failing workflow-contract tests**

```js
test('video workflow compiles bound mentions before every provider route', () => {
  const videoBody = workflow.match(/export const runShellVideoGeneration = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(videoBody, /compileVideoMaterialMentions/);
  assert.match(videoBody, /prompt: compiledPrompt/);
  assert.match(videoBody, /videoReferenceManifest/);
  assert.doesNotMatch(videoBody, /prompt: input\.prompt\.trim\(\)/);
});
```

Extend the pure test to assert image order is `product + scene`, modality ordinals are independent, duplicate labels are de-duplicated in the manifest, and manual unbound `@图片N` text remains unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test src/utils/videoMaterialMentions.test.mjs src/components/uiArchitecture.test.mjs`
Expected: the workflow compilation assertions FAIL.

- [ ] **Step 3: Compile exactly once before job creation**

```ts
const { compiledPrompt, manifest: videoReferenceManifest } = compileVideoMaterialMentions({
  prompt: input.prompt.trim(),
  references: videoReferenceSnapshot,
  bindings: input.params[VIDEO_MATERIAL_MENTION_PARAM],
});
```

Build `videoReferenceSnapshot` from the same paired entries that produce `imageUrls`, `referenceVideoUrls`, and `audioUrls`; this prevents a filtered or unreadable URL from shifting provider ordinals. Use `compiledPrompt` in MaxForAI, KIE, and CLI payload branches and in the returned result prompt. Add `videoReferenceManifest` to each internal job payload, but do not forward bindings or manifest from provider adapters.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test src/utils/videoMaterialMentions.test.mjs src/components/uiArchitecture.test.mjs server/providerMaxForAiVideo.test.mjs server/seedanceReferenceMediaContract.test.mjs server/dreaminaCli.test.mjs`
Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/shellWorkflow.ts src/components/uiArchitecture.test.mjs src/utils/videoMaterialMentions.test.mjs
git commit -m "feat(video): compile stable material mentions"
```

### Task 4: Regression verification and documentation

**Files:**
- Modify only if verification reveals a concrete issue: `src/utils/videoMaterialMentions.mjs`
- Modify only if verification reveals a concrete issue: `src/utils/videoMaterialMentions.test.mjs`
- Modify only if verification reveals a concrete issue: `src/shell/components/layout/BottomInputBar.tsx`
- Modify only if verification reveals a concrete issue: `src/shell/components/layout/BottomInputBar.test.mjs`
- Modify only if verification reveals a concrete issue: `src/adapters/shellWorkflow.ts`
- Modify only if verification reveals a concrete issue: `src/components/uiArchitecture.test.mjs`
- Verify: `docs/superpowers/specs/2026-07-20-video-material-mentions-design.md`

**Interfaces:**
- Consumes: completed feature and project verification scripts.
- Produces: a clean, reviewable local branch with fresh evidence.

- [ ] **Step 1: Run formatting and targeted checks**

Run: `git diff --check && node --test src/utils/videoMaterialMentions.test.mjs src/shell/components/layout/BottomInputBar.test.mjs src/components/uiArchitecture.test.mjs server/providerMaxForAiVideo.test.mjs server/seedanceReferenceMediaContract.test.mjs server/dreaminaCli.test.mjs`
Expected: no whitespace errors and all focused tests PASS.

- [ ] **Step 2: Run the full project gate**

Run: `npm run verify`
Expected: TypeScript/ESLint, all test suites, and production build PASS.

- [ ] **Step 3: Run local health checks**

Run: `npm run doctor`
Expected: frontend health, API health, and worker health all report healthy.

- [ ] **Step 4: Browser-check the real interaction**

Open the local app, enter short-video `全能参考`, upload at least one image plus one video or audio, and verify: typing `@`, button opening, filtering, keyboard insertion, stable recompile after a preceding material changes, invalid-reference error, default viewport, and an `820px` viewport. Do not create a paid provider task merely to inspect the popover.

- [ ] **Step 5: Review and commit any verification-only correction**

```bash
git status --short
git diff --check
git add src/utils/videoMaterialMentions.mjs src/utils/videoMaterialMentions.test.mjs src/shell/components/layout/BottomInputBar.tsx src/shell/components/layout/BottomInputBar.test.mjs src/adapters/shellWorkflow.ts src/components/uiArchitecture.test.mjs
git commit -m "fix(video): harden material mention interaction"
```

If no correction was needed, do not create an empty commit.
