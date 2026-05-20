# Dreamina 视频生成接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将短视频工作台接入 Dreamina CLI 的真实视频能力，支持 `image2video`、`multiframe2video`、`multimodal2video` 三种模式，共用一个输入区，一次提交只生成一个项目卡，并能在本地与云上稳定运行。

**Architecture:** 后端新增一个 Dreamina 视频适配层，负责把前端提交的公网素材 URL 转成 CLI 命令、提交任务、轮询结果并写回现有内部任务表。前端继续沿用当前项目卡壳子，只把短视频输入区改成单入口模式切换，提交后依旧走现有任务队列和结果卡展示，不引入新页面。

**Tech Stack:** React + TypeScript, existing internal job API, Dreamina CLI, Node.js ESM, existing project card and task queue components.

---

### Task 1: Add Dreamina video CLI adapter on the server

**Files:**
- Modify: `server/dreaminaCli.mjs`
- Modify: `server/dreaminaCli.test.mjs`
- Create: `server/dreaminaVideoCli.mjs`

- [ ] **Step 1: Write the failing tests**

```ts
test('dreamina video adapter maps image2video arguments and parses submit output', async () => {
  const args = buildDreaminaVideoCommand('image2video', {
    image: '/tmp/a.png',
    prompt: 'camera push in',
    modelVersion: 'seedance2.0fast',
    duration: 5,
    videoResolution: '720p',
  });

  assert.deepEqual(args, [
    'image2video',
    '--image=/tmp/a.png',
    '--prompt=camera push in',
    '--model_version=seedance2.0fast',
    '--duration=5',
    '--video_resolution=720p',
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/dreaminaCli.test.mjs`
Expected: fail because `buildDreaminaVideoCommand` and the Dreamina video parser do not exist yet.

- [ ] **Step 3: Implement the adapter**

Add a new adapter file that:
- builds command args for `image2video`, `multiframe2video`, and `multimodal2video`
- preserves the real `HOME` so macOS keychain stays available
- routes CLI output through a parser that extracts `submit_id`, `gen_status`, `fail_reason`, and any returned video URL
- keeps raw output for debugging, but presents normalized status to callers

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
node --test server/dreaminaCli.test.mjs
node --check server/dreaminaCli.mjs
node --check server/dreaminaVideoCli.mjs
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/dreaminaCli.mjs server/dreaminaCli.test.mjs server/dreaminaVideoCli.mjs
git commit -m "feat: add dreamina video cli adapter"
```

### Task 2: Wire Dreamina video into the internal job pipeline

**Files:**
- Modify: `server/providerGateway.mjs`
- Modify: `server/index.mjs`
- Modify: `server/jobRuntime.mjs` if provider routing needs a new status flag
- Modify: `server/jobManager.mjs` only if job shape needs one extra field for Dreamina metadata
- Modify: `server/providerGateway.test.mjs`

- [ ] **Step 1: Write the failing tests**

```ts
test('executeProviderJob routes dreamina image2video jobs through the dreamina cli', async () => {
  const result = await executeProviderJob({
    taskType: 'dreamina_video',
    provider: 'dreamina',
    payload: {
      mode: 'image2video',
      imageUrl: 'https://example.com/a.png',
      prompt: 'camera push in',
    },
  }, env, signal);

  assert.equal(result.result.mediaType, 'video');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/providerGateway.test.mjs`
Expected: fail because the Dreamina video task type is not wired yet.

- [ ] **Step 3: Implement the job flow**

Add a new provider branch that:
- accepts one internal job per submission
- converts public asset URLs to local files only when the CLI actually needs local paths
- submits the correct Dreamina command for the selected mode
- stores `providerTaskId`, `result.videoUrl`, `status`, and `errorMessage`
- supports recovery by `query_result --submit_id=...`

Also add `/api/dreamina/video/*` or extend the existing `/api/jobs` route so the frontend can create and poll video jobs without a separate code path.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
node --test server/providerGateway.test.mjs
node --check server/providerGateway.mjs
node --check server/index.mjs
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add server/providerGateway.mjs server/index.mjs server/jobRuntime.mjs server/jobManager.mjs server/providerGateway.test.mjs
git commit -m "feat: wire dreamina video jobs into internal pipeline"
```

### Task 3: Replace the short-video input area with a single mode-switching composer

**Files:**
- Modify: `src/shell/components/layout/BottomInputBar.tsx`
- Modify: `src/shell/modules/Video/VideoModule.tsx`
- Modify: `src/types.ts`
- Modify: `src/services/internalApi.ts`
- Modify: `src/components/uiArchitecture.test.mjs`

- [ ] **Step 1: Write the failing tests**

```ts
test('video composer exposes image2video multiframe2video and multimodal2video in one input area', () => {
  const source = read('../shell/components/layout/BottomInputBar.tsx');
  assert.match(source, /image2video/);
  assert.match(source, /multiframe2video/);
  assert.match(source, /multimodal2video/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/components/uiArchitecture.test.mjs`
Expected: fail until the input area and types are updated.

- [ ] **Step 3: Implement the composer**

Change the short-video input area so it:
- keeps one shared composer for all three modes
- switches mode with a single compact selector
- keeps the current product style, not the exact Dreamina visual skin
- accepts the right inputs per mode:
  - `image2video`: one main image + prompt
  - `multiframe2video`: multiple images + transition prompt(s)
  - `multimodal2video`: image / video / audio mix + prompt
- preserves the existing “one submission = one project card” rule

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm run build
node --test src/components/uiArchitecture.test.mjs
```
Expected: build passes and the UI architecture test sees the new mode wiring.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/layout/BottomInputBar.tsx src/shell/modules/Video/VideoModule.tsx src/types.ts src/services/internalApi.ts src/components/uiArchitecture.test.mjs
git commit -m "feat: add dreamina video mode composer"
```

### Task 4: Make result cards, retry, download, and refresh behavior feel productized

**Files:**
- Modify: `src/shell/components/ProjectCard.tsx`
- Modify: `src/shell/components/ActiveTasksPanel.tsx`
- Modify: `src/adapters/shellPersistence.ts`
- Modify: `src/utils/persistedDeletion.ts`
- Modify: `src/modules/Video/videoStoryboardService.ts` only if storyboard state needs to align with the new video card behavior
- Modify: `src/services/internalApi.ts` if the new job payload needs a dedicated helper

- [ ] **Step 1: Write the failing tests**

```ts
test('video project cards keep one project per submission and expose retry download and status labels', () => {
  const source = read('../shell/components/ProjectCard.tsx');
  assert.match(source, /onRegenerate/);
  assert.match(source, /onDeleteProject/);
  assert.match(source, /getDownloadName/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/components/uiArchitecture.test.mjs`
Expected: fail until the video project card uses the Dreamina job output format.

- [ ] **Step 3: Implement the result flow**

Update the card and queue behavior so that:
- each submission becomes exactly one project card
- successful tasks show the returned video URL and download button
- failed tasks show a retry button that reuses the same project card
- refresh restores the in-flight task state from the backend, not from ephemeral UI state
- card titles, progress, and status text stay consistent with the rest of the shell UI

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm run build
node --test src/components/uiArchitecture.test.mjs
```
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/ProjectCard.tsx src/shell/components/ActiveTasksPanel.tsx src/adapters/shellPersistence.ts src/utils/persistedDeletion.ts src/modules/Video/videoStoryboardService.ts src/services/internalApi.ts
git commit -m "feat: productize dreamina video result flow"
```
