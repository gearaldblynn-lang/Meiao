# Help Guide, Release Notes, And GPT Image 2 Capability Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract app help-guide copy into shared config, correct GPT Image 2 image-to-image aspect-ratio support, refresh release notes, and deploy the verified build to Tencent Cloud.

**Architecture:** Move help-copy data out of `HelpGuideModal.tsx` into `config/helpGuide.ts`, keep release-note data in `config/releaseNotes.ts`, and update the image-model capability/provider routing layer so GPT Image 2 image-to-image requests send structured `aspect_ratio` while still blocking unsupported quality and output-format fields. Verify locally, then deploy with the existing Tencent script and confirm the release modal and help guide on the server.

**Tech Stack:** TypeScript, React, Node.js ESM, `node:test`, Vite, existing KIE provider gateway, existing Tencent deploy script.

---

### Task 1: Add failing tests for GPT Image 2 ratio behavior and help-guide extraction hooks

**Files:**
- Modify: `server/providerGateway.test.mjs`
- Modify: `components/uiArchitecture.test.mjs`
- Test: `server/providerGateway.test.mjs`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing provider ratio test**

```js
test('executeProviderJob sends structured aspect_ratio for gpt-image-2 image-to-image requests', async () => {
  const createTaskBody = await runCreateTask({
    model: 'gpt-image-2',
    prompt: 'make poster',
    imageUrls: ['https://example.com/source.png'],
    aspectRatio: '3:4',
  });

  assert.equal(createTaskBody.model, 'gpt-image-2-image-to-image');
  assert.equal(createTaskBody.input.aspect_ratio, '3:4');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/providerGateway.test.mjs`
Expected: FAIL because the GPT Image 2 image-to-image payload does not yet include structured `aspect_ratio`.

- [ ] **Step 3: Write the failing help-guide source test**

```js
test('help guide modal reads content from shared config instead of inline HELP_CONTENT', () => {
  const modal = read('../components/HelpGuideModal.tsx');
  const guideConfig = read('../config/helpGuide.ts');

  assert.match(modal, /from '\.\.\/config\/helpGuide'/);
  assert.match(guideConfig, /AppModule\.AGENT_CENTER/);
  assert.match(guideConfig, /AppModule\.SETTINGS/);
  assert.match(guideConfig, /AppModule\.ACCOUNT/);
  assert.match(guideConfig, /AppModule\.XHS_COVER/);
  assert.doesNotMatch(modal, /const HELP_CONTENT:/);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: FAIL because the help-guide content is still inline and the shared config file does not yet exist.

- [ ] **Step 5: Commit**

```bash
git add server/providerGateway.test.mjs components/uiArchitecture.test.mjs
git commit -m "test: cover help-guide config extraction and gpt-image-2 ratio payload"
```

### Task 2: Implement shared help-guide configuration

**Files:**
- Create: `config/helpGuide.ts`
- Modify: `components/HelpGuideModal.tsx`
- Modify: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write minimal shared config**

```ts
import { AppModule } from '../types';

export interface GuideEntry {
  summary: string;
  steps: string[];
  tips: string[];
}

export const GUIDE_MODULES = [
  AppModule.AGENT_CENTER,
  AppModule.ONE_CLICK,
  AppModule.TRANSLATION,
  AppModule.BUYER_SHOW,
  AppModule.RETOUCH,
  AppModule.PHOTOGRAPHY,
  AppModule.VIDEO,
  AppModule.XHS_COVER,
  AppModule.SETTINGS,
  AppModule.ACCOUNT,
];

export const HELP_CONTENT: Record<string, GuideEntry> = { /* concrete content */ };
```

- [ ] **Step 2: Replace inline modal content with imports**

```tsx
import { GUIDE_MODULES, HELP_CONTENT } from '../config/helpGuide';
```

- [ ] **Step 3: Run the relevant UI source test**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: PASS for the new help-guide assertions.

- [ ] **Step 4: Sanity-check the modal content for all modules**

Run: `rg -n "AppModule\\.(AGENT_CENTER|ONE_CLICK|TRANSLATION|BUYER_SHOW|RETOUCH|PHOTOGRAPHY|VIDEO|XHS_COVER|SETTINGS|ACCOUNT)" config/helpGuide.ts`
Expected: Every listed top-level module appears in the guide config.

- [ ] **Step 5: Commit**

```bash
git add config/helpGuide.ts components/HelpGuideModal.tsx components/uiArchitecture.test.mjs
git commit -m "feat: extract and complete app help guide content"
```

### Task 3: Correct GPT Image 2 image-to-image capability handling

**Files:**
- Modify: `utils/modelCapabilities.mjs`
- Modify: `server/providerGateway.mjs`
- Modify: `server/providerGateway.test.mjs`

- [ ] **Step 1: Update the capability model**

```js
return {
  supportsStructuredAspectRatio: true,
  gptImage2ImageAspectRatios: ['auto', '1:1', '5:4', '9:16', '21:9', '16:9', '4:3', '3:2', '4:5', '3:4', '2:3'],
  supportsStructuredResolution: false,
  supportsOutputFormat: false,
  maxInputImages: 16,
};
```

- [ ] **Step 2: Route structured ratio only for image-to-image**

```js
input: {
  prompt,
  input_urls: imageUrls,
  ...(supportedRatio ? { aspect_ratio: payload.aspectRatio || 'auto' } : {}),
}
```

- [ ] **Step 3: Keep text-to-image conservative**

```js
input: {
  prompt,
}
```

- [ ] **Step 4: Run provider tests**

Run: `node --test server/providerGateway.test.mjs`
Expected: PASS with GPT Image 2 image-to-image now sending structured `aspect_ratio`, while text-to-image still avoids unsupported fields.

- [ ] **Step 5: Commit**

```bash
git add utils/modelCapabilities.mjs server/providerGateway.mjs server/providerGateway.test.mjs
git commit -m "feat: support structured aspect ratio for gpt-image-2 image edits"
```

### Task 4: Refresh release notes and version tag

**Files:**
- Modify: `config/releaseNotes.ts`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: Update release version and notes**

```ts
export const APP_RELEASE_VERSION = 'V260423A';
export const CURRENT_RELEASE_NOTES = [
  {
    title: '生图模型',
    items: [
      'GPT Image 2 替代 Nano Banana Pro 成为高级可选模型，Nano Banana 2 继续作为默认模型。',
      'GPT Image 2 图生图现已支持结构化画面比例参数，质量和输出格式仍按兼容策略处理。',
      '选择 GPT Image 2 时会提示 300-500 秒长耗时，并延长等待窗口。',
    ],
  },
];
```

- [ ] **Step 2: Run release-note source tests**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: PASS with existing release-note wiring and updated release version.

- [ ] **Step 3: Commit**

```bash
git add config/releaseNotes.ts components/uiArchitecture.test.mjs
git commit -m "feat: update release notes for gpt-image-2 and help guide refresh"
```

### Task 5: Verify locally and deploy to Tencent Cloud

**Files:**
- Modify: any touched files above if verification reveals issues
- Deploy: `scripts/deploy_tencent.sh`

- [ ] **Step 1: Run the full local verification set**

Run: `node --test utils/modelCapabilities.test.mjs server/providerGateway.test.mjs server/jobRuntime.test.mjs components/uiArchitecture.test.mjs modules/Translation/translationConfigUtils.test.mjs`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Deploy to Tencent Cloud**

Run: `./scripts/deploy_tencent.sh`
Expected: Deployment completes and prints the server access URLs.

- [ ] **Step 4: Verify the deployed server health**

Run: `curl -s http://111.229.66.247/api/health`
Expected: JSON health response indicating the service is up.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: refresh help guide, release notes, and gpt-image-2 ratio support"
```
