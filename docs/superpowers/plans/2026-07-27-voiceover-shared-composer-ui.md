# 口播翻译共享 Composer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将口播翻译从独立配置页面改为与现有视频生成一致的 896px 底部 Composer，并把目标语言、翻译方式、音色和去文案收进底部胶囊参数栏。

**Architecture:** 从 `BottomInputBar` 提取无业务状态的 Composer 外壳、工具栏、胶囊选择器和提交按钮，标准生成与口播翻译共用同一实现。`VoiceoverTranslationWorkspace` 保留现有媒体准备、草稿校验、付费确认和提交状态，只替换展示层；项目列表仍由 `VideoModule` 负责。

**Tech Stack:** React 18、TypeScript、Tailwind utility classes、Node test runner、Vite

## Global Constraints

- 页面主体不得再出现目标语言、翻译方式、口播音色或去文案的大块配置卡。
- 大输入区不包含自由文本 textarea，只处理一个 MP4/MOV 的点击上传、拖拽上传、准备进度、预览、替换和清除。
- Composer 宽度固定复用 `max-w-[896px]`，参数顺序为目标语言、翻译方式、口播音色、去文案，提交按钮位于右侧。
- 去文案默认关闭；开启后使用 `DEFAULT_SUBTITLE_REGION`，并从同一胶囊打开 `SubtitleRegionEditor`。
- 不修改 `VoiceoverTranslationDraft`、媒体转码 profile、确认弹窗或后端任务合同。
- 默认视口与 820px 宽度都必须自然换行且不得横向裁切。
- 本轮不新增依赖、不创建代码提交、不推送、不部署腾讯云。

---

### Task 1: 提取共享 Composer 视觉原语

**Files:**
- Create: `src/shell/components/layout/ComposerPrimitives.tsx`
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Test: `src/shell/components/layout/BottomInputBar.test.mjs`

**Interfaces:**
- Produces: `ComposerSurface`, `ComposerToolbar`, `ComposerCapsuleButton`, `ComposerSelect`, `ComposerSubmitButton`
- `ComposerSelect` consumes `{ value, options, onChange, icon, title, disabled, recommendedValue, recommendedLabel, secondaryRecommendedValue, secondaryRecommendedLabel, getOptionMeta }`
- `ComposerSurface` consumes `{ children, highlighted?, invalid?, className? }`
- `ComposerToolbar` consumes `{ children, spacious? }`
- `ComposerSubmitButton` consumes native button props plus `{ busy?, icon, label }`

- [ ] **Step 1: Write the failing architecture test**

Add a test proving `BottomInputBar` imports and uses the shared primitives and no longer declares its own `CompactSelect`:

```js
test('bottom input uses shared composer visual primitives', () => {
  const bottomInputBar = source();
  const primitives = read('./ComposerPrimitives.tsx');

  assert.match(bottomInputBar, /from '.\/ComposerPrimitives'/);
  assert.match(bottomInputBar, /<ComposerSurface/);
  assert.match(bottomInputBar, /<ComposerToolbar/);
  assert.match(bottomInputBar, /<ComposerSelect/);
  assert.match(bottomInputBar, /<ComposerSubmitButton/);
  assert.doesNotMatch(bottomInputBar, /const CompactSelect:/);
  assert.match(primitives, /max-w-\[896px\]/);
  assert.match(primitives, /rounded-3xl border/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/shell/components/layout/BottomInputBar.test.mjs
```

Expected: the new test fails because `ComposerPrimitives.tsx` and its imports do not exist.

- [ ] **Step 3: Add the shared primitives**

Create `ComposerPrimitives.tsx` with exported typed components. `ComposerSurface` must own the shared outer class:

```tsx
className={`relative mx-auto w-full max-w-[896px] rounded-3xl border transition-all ${className}`}
```

`ComposerToolbar` must use wrapping layout:

```tsx
className={`flex flex-wrap items-end justify-between gap-3 px-3 ${spacious ? 'py-5' : 'pb-3'}`}
```

`ComposerCapsuleButton` must own the pill class:

```tsx
className="flex items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-45"
```

Move the current `CompactSelect` behavior into exported `ComposerSelect`, retaining click-outside close, current selection display, recommendation badges, option metadata and disabled handling. Add `ComposerSubmitButton` with the existing accent background, `rounded-3xl`, loading spinner and disabled opacity.

- [ ] **Step 4: Migrate `BottomInputBar` without changing its business behavior**

Import:

```tsx
import {
  ComposerSelect,
  ComposerSubmitButton,
  ComposerSurface,
  ComposerToolbar,
} from './ComposerPrimitives';
```

Delete the local `CompactSelect` declaration, replace all `CompactSelect` usages with `ComposerSelect`, wrap the current input contents with `ComposerSurface`, replace the toolbar wrapper with `ComposerToolbar`, and replace the generate button with `ComposerSubmitButton`. Preserve all current quick parameters, popovers, billing labels, disabled reasons and event handlers.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test src/shell/components/layout/BottomInputBar.test.mjs src/components/uiArchitecture.test.mjs
```

Expected: both files report zero failures.

### Task 2: Rebuild voiceover creation UI inside the shared Composer

**Files:**
- Modify: `src/shell/components/VoiceoverTranslationWorkspace.tsx`
- Test: `src/shell/components/VoiceoverTranslationWorkspace.test.mjs`

**Interfaces:**
- Consumes: shared primitives from Task 1
- Preserves: `VoiceoverTranslationWorkspaceProps`, `PreparedSource`, `buildDraft()`, `handleSubmit()`, media session lifecycle and both `ConfirmDialog` contracts
- Produces: one portal-rendered Composer with upload surface, four controls and right-side submit

- [ ] **Step 1: Write failing layout regression tests**

Add tests with these assertions:

```js
test('voiceover creation reuses the shared composer and removes page-level configuration cards', () => {
  assert.match(source, /from '.\/layout\/ComposerPrimitives'/);
  assert.match(source, /<ComposerSurface/);
  assert.match(source, /<ComposerToolbar/);
  assert.match(source, /<ComposerSelect/);
  assert.match(source, /<ComposerSubmitButton/);
  assert.doesNotMatch(source, /max-w-\[1180px\]/);
  assert.doesNotMatch(source, /grid gap-5 lg:grid-cols-2/);
  assert.doesNotMatch(source, /<textarea/);
});

test('voiceover composer owns upload progress preview drag-drop and four ordered controls', () => {
  assert.match(source, /onDragOver=/);
  assert.match(source, /onDrop=/);
  assert.match(source, /正在准备视频/);
  assert.match(source, /<video/);
  assert.match(source, /替换视频/);
  assert.match(source, /清除视频/);

  const language = source.indexOf('title="目标语言"');
  const mode = source.indexOf('title="翻译方式"');
  const voice = source.indexOf('title="口播音色"');
  const removeText = source.indexOf('aria-label="去文案设置"');
  assert.ok(language >= 0 && language < mode && mode < voice && voice < removeText);
});

test('remove-text editor opens from the composer capsule and keeps the normalized default', () => {
  assert.match(source, /ComposerCapsuleButton/);
  assert.match(source, /aria-label="去文案设置"/);
  assert.match(source, /<SubtitleRegionEditor/);
  assert.match(source, /DEFAULT_SUBTITLE_REGION/);
  assert.match(source, /setSubtitleRegion\(\{ \.\.\.DEFAULT_SUBTITLE_REGION \}\)/);
});
```

- [ ] **Step 2: Run the voiceover test and verify RED**

Run:

```bash
node --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs
```

Expected: new layout assertions fail against the current page-level cards.

- [ ] **Step 3: Keep the media and submission state, replace only the presentation**

Remove `showMoreLanguages` and add a `removeTextPopoverOpen` state plus a popover ref with click-outside close. Build options directly from the server-owned catalogs:

```tsx
const languageOptions = useMemo(
  () => [...commonLanguages, ...moreLanguages].map((language) => ({
    value: language.code,
    label: language.chineseName,
  })),
  [commonLanguages, moreLanguages],
);

const voiceOptions = useMemo(
  () => [
    { value: '__auto__', label: '自动匹配' },
    ...voices.map((voice) => ({
      value: voice.name,
      label: `${voice.name} · ${voice.trait}`,
    })),
  ],
  [voices],
);
```

Map `voiceOptions` changes so `__auto__` sets `voiceMode='auto'`; any server voice name sets `voiceMode='preset'` and `voiceName`.

- [ ] **Step 4: Render one portal-only Composer**

The component body must no longer render its own 1180px section or page cards. Inside `voiceover-translation-composer-slot`, render:

```tsx
<div className="px-6 pb-5 pt-4">
  <ComposerSurface invalid={Boolean(errorMessage)}>
    {/* upload/progress/prepared preview area */}
    <ComposerToolbar spacious>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {/* target language, translation mode, voice and remove-text capsules */}
      </div>
      <ComposerSubmitButton
        busy={submitting}
        icon={<Mic2 size={14} />}
        label="开始口播翻译"
        disabled={!canOpenConfirmation}
        onClick={() => setConfirmOpen(true)}
      />
    </ComposerToolbar>
  </ComposerSurface>
</div>
```

Empty state must be a click/drag target; preparation must show `uploadProgress`; prepared state must show the managed video preview, filename, duration, resolution, replace and clear actions. `creationBlockMessage` and `errorMessage` must be rendered inside `ComposerSurface`.

- [ ] **Step 5: Implement the remove-text capsule popover**

Use `ComposerCapsuleButton` as the only trigger. The popover must offer关闭/开启; selecting开启 must set the default region when switching from关闭. When enabled with a prepared source, render `SubtitleRegionEditor` in an absolutely positioned panel above the capsule. Keep `subtitleRegionToPixels()` in `buildDraft()` as the final validation.

- [ ] **Step 6: Preserve replacement and paid confirmation behavior**

Keep the hidden file input and both dialogs. The replace action must continue setting `pendingReplacementFile`; confirmation must continue preserving the language, mode, voice and remove-text settings. Submission must continue passing the unchanged `VoiceoverTranslationDraft` to `onSubmit`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
node --test src/shell/components/VoiceoverTranslationWorkspace.test.mjs src/shell/components/layout/BottomInputBar.test.mjs src/components/uiArchitecture.test.mjs
```

Expected: zero failures.

### Task 3: Build and local browser acceptance

**Files:**
- Verify: `src/shell/components/layout/ComposerPrimitives.tsx`
- Verify: `src/shell/components/layout/BottomInputBar.tsx`
- Verify: `src/shell/components/VoiceoverTranslationWorkspace.tsx`

**Interfaces:**
- Consumes: the UI behavior completed in Tasks 1–2
- Produces: fresh type/build evidence and screenshots/DOM evidence at default width and 820px

- [ ] **Step 1: Run full frontend safety checks**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 2: Verify the local server points at this worktree**

Run:

```bash
npm run doctor
```

Expected: port 3000 health checks succeed and the reported application path is the current `voiceover-release-integration` worktree. If the app process serves stale source, restart only the local development process using the repository’s documented local command.

- [ ] **Step 3: Accept the default viewport**

Open `http://127.0.0.1:3000/?module=video`, switch to「口播翻译」if needed, and verify:

- history/project content remains in the normal page flow;
- no independent language, voice or remove-text cards appear;
- one 896px-style Composer appears at the bottom;
- the upper Composer area is an upload target with no prompt textarea;
- all four capsules appear below it in the required order;
- the right button reads「开始口播翻译」and is disabled before a video is ready.

- [ ] **Step 4: Accept the 820px viewport**

Resize to 820px and verify the parameter controls wrap inside the Composer without horizontal page overflow or clipped popovers.

- [ ] **Step 5: Review the final diff and scope**

Run:

```bash
git diff --check
git status --short
git diff -- src/shell/components/layout/ComposerPrimitives.tsx src/shell/components/layout/BottomInputBar.tsx src/shell/components/VoiceoverTranslationWorkspace.tsx src/shell/components/layout/BottomInputBar.test.mjs src/shell/components/VoiceoverTranslationWorkspace.test.mjs
```

Expected: no whitespace errors; only the plan, shared primitives, the two intended components and their focused tests are changed by this implementation. Do not commit, push or deploy.
