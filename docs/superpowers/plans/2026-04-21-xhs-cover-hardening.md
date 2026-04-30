# Xhs Cover Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `XhsCover` module production-safe by preserving results across refresh, recovering cloud jobs, limiting concurrency, persisting cloud assets, and removing prompt conflicts.

**Architecture:** Add a focused `xhsCoverUtils.mjs` helper for pure logic: task normalization, prompt sanitization, and concurrency-limited execution. Keep UI state in `XhsCoverModule.tsx`, but make it follow the same internal-job and persisted-asset semantics already used by `Retouch` and `OneClick`. Persist completed tasks in app state, auto-recover recoverable jobs on mount, and keep image preview URLs under existing URL lifecycle helpers.

**Tech Stack:** React 19, TypeScript, Node built-in test runner, existing `kieAiService`, existing persisted asset client, existing URL utils.

---

## File Structure

- Create: `modules/XhsCover/xhsCoverUtils.mjs`
  Responsibility: Pure helper logic for task restoration, prompt sanitization, and concurrency-limited batch execution.
- Create: `modules/XhsCover/xhsCoverUtils.test.mjs`
  Responsibility: Regression tests for restored task state, prompt rules, and concurrency limits.
- Modify: `modules/XhsCover/XhsCoverModule.tsx`
  Responsibility: Integrate recovery flow, persisted asset handling, task state updates, cancellation, and bounded batch execution.
- Modify: `modules/XhsCover/XhsCoverSidebar.tsx`
  Responsibility: Replace render-time object URL creation with managed preview URLs and add minimal UX support for persisted state.
- Modify: `modules/XhsCover/xhsCoverStyles.ts`
  Responsibility: Remove or downgrade style prompt clauses that contradict the global “user title is the only main copy” rule.
- Modify: `utils/appState.ts`
  Responsibility: Preserve `xhsCoverMemory.tasks` on load while resetting only runtime flags.
- Modify: `types.ts`
  Responsibility: Add any missing XHS cover task status needed by recovery flow, if required by implementation.

### Task 1: Add XHS Cover Pure Logic and Tests

**Files:**
- Create: `modules/XhsCover/xhsCoverUtils.mjs`
- Test: `modules/XhsCover/xhsCoverUtils.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXhsCoverPrompt,
  createXhsCoverBatchRunner,
  normalizeRestoredXhsCoverTasks,
} from './xhsCoverUtils.mjs';

test('normalizeRestoredXhsCoverTasks preserves completed tasks and resets runtime flags', () => {
  const restored = normalizeRestoredXhsCoverTasks([
    { id: 'done', status: 'completed', resultUrl: 'https://asset.example/done.png', taskId: 'job_done' },
    { id: 'run', status: 'generating', taskId: 'job_running' },
    { id: 'err', status: 'error', taskId: 'job_retry', error: 'network timeout' },
    { id: 'pending', status: 'pending' },
  ]);

  assert.equal(restored[0].status, 'completed');
  assert.equal(restored[0].resultUrl, 'https://asset.example/done.png');
  assert.equal(restored[1].status, 'generating');
  assert.equal(restored[2].status, 'error');
  assert.equal(restored[3].status, 'pending');
});

test('buildXhsCoverPrompt keeps user title as the only main title and strips conflicting english headline rules', () => {
  const prompt = buildXhsCoverPrompt({
    stylePrompt: [
      '顶部大字英文标题',
      '副标题包含拼音注释',
      '右上角添加期数标签如"#01"',
      '保持原始人像完全不变，只添加文字和装饰，不要修改人脸',
    ].join('\\n'),
    title: '真正主标题',
    subtitle: '辅助副标题',
    fontLabel: '综艺体/粗黑体',
    decoration: '星星',
    extraRequirement: '更像小红书爆款',
  });

  assert.match(prompt, /真正主标题/);
  assert.doesNotMatch(prompt, /顶部大字英文标题/);
  assert.doesNotMatch(prompt, /拼音注释/);
  assert.match(prompt, /期数标签可作为小型装饰/);
});

test('createXhsCoverBatchRunner never exceeds configured concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const order = [];
  const runner = createXhsCoverBatchRunner(2);

  await runner(
    ['a', 'b', 'c', 'd'],
    async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start:${item}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${item}`);
      active -= 1;
    }
  );

  assert.equal(maxActive, 2);
  assert.equal(order.filter((step) => step.startsWith('start:')).length, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: FAIL with `Cannot find module './xhsCoverUtils.mjs'` or missing export errors for `normalizeRestoredXhsCoverTasks`, `buildXhsCoverPrompt`, and `createXhsCoverBatchRunner`.

- [ ] **Step 3: Write minimal implementation**

```js
const normalizeConcurrentLimit = (limit) => {
  const value = Number(limit);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1;
};

export const normalizeRestoredXhsCoverTasks = (tasks) => {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((task) => task && typeof task === 'object' && typeof task.id === 'string')
    .map((task) => ({
      ...task,
      status: typeof task.status === 'string' ? task.status : 'pending',
      resultUrl: typeof task.resultUrl === 'string' ? task.resultUrl : undefined,
      taskId: typeof task.taskId === 'string' ? task.taskId : undefined,
      error: typeof task.error === 'string' ? task.error : undefined,
    }));
};

const sanitizeStylePrompt = (stylePrompt) => {
  return String(stylePrompt || '')
    .replace(/.*英文标题.*(\n|$)/g, '')
    .replace(/.*拼音注释.*(\n|$)/g, '')
    .replace(/右上角添加期数标签如.*(\n|$)/g, '期数标签可作为小型装饰，不能替代主标题。\\n');
};

export const buildXhsCoverPrompt = ({
  stylePrompt,
  title,
  subtitle,
  fontLabel,
  decoration,
  extraRequirement,
}) => {
  const safeStylePrompt = sanitizeStylePrompt(stylePrompt);
  const textPart = [
    `- 大标题文字（必须作为画面最醒目的主标题展示）：「${title}」`,
    subtitle ? `- 副标题文字（较小展示）：「${subtitle}」` : '',
  ].filter(Boolean).join('\\n');

  return [
    safeStylePrompt.trim(),
    '【全局禁止事项】',
    '- 严格只使用用户提供的标题和副标题作为画面主标题，不得增减文字',
    '- 主标题必须使用用户提供的文字原样展示，不得翻译成英文或其他语言',
    '- 不得修改人物面部',
    '【文字内容 - 严格使用以下文字，不得替换或翻译】',
    textPart,
    `【字体要求】使用${fontLabel}风格`,
    decoration ? `【装饰贴纸】添加以下装饰元素：${decoration}` : '',
    extraRequirement ? `【额外要求】${extraRequirement}` : '',
  ].filter(Boolean).join('\\n\\n');
};

export const createXhsCoverBatchRunner = (limit) => {
  const concurrency = normalizeConcurrentLimit(limit);
  return async (items, worker) => {
    const queue = Array.isArray(items) ? [...items] : [];
    const workers = Array.from({ length: Math.min(concurrency, queue.length || concurrency) }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (typeof next === 'undefined') return;
        await worker(next);
      }
    });
    await Promise.all(workers);
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: PASS with 3 passing tests and 0 failures.

- [ ] **Step 5: Commit**

```bash
git add modules/XhsCover/xhsCoverUtils.mjs modules/XhsCover/xhsCoverUtils.test.mjs
git commit -m "test: cover xhs cover utility behavior"
```

### Task 2: Preserve XHS Cover Tasks Across Refresh

**Files:**
- Modify: `utils/appState.ts`
- Test: `modules/XhsCover/xhsCoverUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { normalizeRestoredXhsCoverTasks } from './xhsCoverUtils.mjs';

test('normalizeRestoredXhsCoverTasks keeps completed task results available after refresh', () => {
  const restored = normalizeRestoredXhsCoverTasks([
    { id: 'task_1', status: 'completed', resultUrl: 'https://asset.example/result.png', styleName: '职场大字' },
  ]);

  assert.equal(restored.length, 1);
  assert.equal(restored[0].status, 'completed');
  assert.equal(restored[0].resultUrl, 'https://asset.example/result.png');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: FAIL if the current utility normalization logic does not preserve the completed task shape needed by app state restoration.

- [ ] **Step 3: Write minimal implementation**

```ts
import { normalizeRestoredXhsCoverTasks } from '../modules/XhsCover/xhsCoverUtils.mjs';

// inside normalizeLoadedPersistedAppState(...)
xhsCoverMemory: saved.xhsCoverMemory
  ? {
      ...saved.xhsCoverMemory,
      productImages: normalizeFileArray(saved.xhsCoverMemory.productImages),
      uploadedProductUrls: normalizeStringArray(saved.xhsCoverMemory.uploadedProductUrls),
      tasks: normalizeRestoredXhsCoverTasks(saved.xhsCoverMemory.tasks),
      isGenerating: false,
    }
  : undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: PASS with the completed task preserved.

- [ ] **Step 5: Commit**

```bash
git add utils/appState.ts modules/XhsCover/xhsCoverUtils.mjs modules/XhsCover/xhsCoverUtils.test.mjs
git commit -m "fix: preserve xhs cover tasks on refresh"
```

### Task 3: Align XHS Cover Runtime with Cloud Job Recovery and Persisted Assets

**Files:**
- Modify: `modules/XhsCover/XhsCoverModule.tsx`
- Modify: `types.ts`
- Modify: `modules/XhsCover/xhsCoverUtils.mjs`
- Test: `modules/XhsCover/xhsCoverUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('normalizeRestoredXhsCoverTasks keeps recoverable task ids for later resume', () => {
  const restored = normalizeRestoredXhsCoverTasks([
    { id: 'retry_1', status: 'error', taskId: 'kie_job_123', error: 'network timeout' },
  ]);

  assert.equal(restored[0].taskId, 'kie_job_123');
  assert.equal(restored[0].status, 'error');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: FAIL if task IDs or recoverable task state are not preserved in normalized XHS cover tasks.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { isRecoverableKieTaskResult, processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { persistGeneratedAsset } from '../../services/persistedAssetClient';
import { normalizeFetchedImageBlob } from '../../utils/imageBlobUtils.mjs';
import { createXhsCoverBatchRunner, buildXhsCoverPrompt } from './xhsCoverUtils.mjs';

useEffect(() => {
  const recoverableTasks = persistentState.tasks.filter((task) =>
    task.taskId &&
    (task.status === 'generating' || (task.status === 'error' && isRecoverableKieTaskResult(task.taskId, task.error)))
  );

  recoverableTasks.forEach((task) => {
    if (!inflightIdsRef.current.has(task.id)) {
      void recoverSingleTask(task);
    }
  });
}, []);

const persistXhsResult = async (resultUrl, styleName, signal) => {
  const response = await fetch(resultUrl, { signal });
  const blob = await normalizeFetchedImageBlob(await response.blob(), resultUrl);
  return persistGeneratedAsset(blob, 'xhs_cover', `${styleName}.png`);
};

const recoverSingleTask = async (task) => {
  const controller = new AbortController();
  abortControllersRef.current.add(controller);
  inflightIdsRef.current.add(task.id);
  updateTask(task.id, { status: 'generating', error: undefined });
  try {
    const recovered = await recoverKieAiTask(task.taskId, apiConfig, controller.signal);
    if (recovered.status !== 'success' || !recovered.imageUrl) {
      throw new Error(recovered.message || '任务恢复失败');
    }
    const persistedUrl = await persistXhsResult(recovered.imageUrl, task.styleName, controller.signal);
    updateTask(task.id, { status: 'completed', resultUrl: persistedUrl, taskId: recovered.taskId, error: undefined });
  } catch (error) {
    updateTask(task.id, { status: 'error', error: error.message });
  } finally {
    abortControllersRef.current.delete(controller);
    inflightIdsRef.current.delete(task.id);
  }
};

const runner = createXhsCoverBatchRunner(apiConfig.concurrency);
await runner(initialTasks, async (task) => {
  const prompt = buildXhsCoverPrompt({ ... });
  const result = await processWithKieAi(...);
  if (result.status !== 'success' || !result.imageUrl) throw new Error(result.message || '任务执行失败');
  const persistedUrl = await persistXhsResult(result.imageUrl, task.styleName, controller.signal);
  updateTask(task.id, { status: 'completed', resultUrl: persistedUrl, taskId: result.taskId, error: undefined });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: PASS with the recoverable task test passing and no regressions in utility behavior.

- [ ] **Step 5: Commit**

```bash
git add modules/XhsCover/XhsCoverModule.tsx modules/XhsCover/xhsCoverUtils.mjs modules/XhsCover/xhsCoverUtils.test.mjs types.ts
git commit -m "fix: align xhs cover with cloud recovery flow"
```

### Task 4: Clean Up XHS Cover Sidebar Preview URLs and Style Prompt Conflicts

**Files:**
- Modify: `modules/XhsCover/XhsCoverSidebar.tsx`
- Modify: `modules/XhsCover/xhsCoverStyles.ts`
- Modify: `modules/XhsCover/XhsCoverModule.tsx`
- Test: `modules/XhsCover/xhsCoverUtils.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
test('buildXhsCoverPrompt keeps optional style decorations without replacing the user title', () => {
  const prompt = buildXhsCoverPrompt({
    stylePrompt: '右上角添加期数标签如"#01"\\n不要修改人脸',
    title: '用户标题',
    subtitle: '',
    fontLabel: '宋体/衬线体',
    decoration: '',
    extraRequirement: '',
  });

  assert.match(prompt, /用户标题/);
  assert.match(prompt, /期数标签可作为小型装饰/);
  assert.doesNotMatch(prompt, /英文主标题/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs`
Expected: FAIL if prompt sanitization still leaves conflicting headline instructions or drops the optional decoration downgrade.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { releaseObjectURLs, safeCreateObjectURL } from '../../utils/urlUtils';

const [localPreviewUrls, setLocalPreviewUrls] = useState<string[]>([]);

useEffect(() => {
  const nextUrls = state.productImages.map((file) => safeCreateObjectURL(file));
  setLocalPreviewUrls(nextUrls);
  return () => {
    releaseObjectURLs(nextUrls);
  };
}, [state.productImages]);

// render
{localPreviewUrls.map((url, index) => (
  <div key={url || index} className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
    <img src={url} className="w-full h-full object-cover" alt="" />
  </div>
))}
```

```ts
// xhsCoverStyles.ts
prompt: '小红书封面设计。\\n\\n【布局要求】...\\n【装饰元素】右上角可添加小型期数标签，不能替代主标题...'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test modules/XhsCover/xhsCoverUtils.test.mjs && npm run lint`
Expected: PASS for utility tests and `tsc --noEmit` finishes with no type errors.

- [ ] **Step 5: Commit**

```bash
git add modules/XhsCover/XhsCoverSidebar.tsx modules/XhsCover/xhsCoverStyles.ts modules/XhsCover/XhsCoverModule.tsx modules/XhsCover/xhsCoverUtils.test.mjs
git commit -m "fix: stabilize xhs cover prompts and previews"
```

### Spec coverage

- Preserve completed results after refresh: Covered by Task 1 and Task 2.
- Reuse cloud internal job semantics and persisted assets: Covered by Task 3.
- Limit generation concurrency using configured concurrency: Covered by Task 1 and Task 3.
- Add automatic recovery and manual fallback path: Covered by Task 3.
- Remove prompt conflicts with user title rules: Covered by Task 1 and Task 4.
- Stop object URL leaks in sidebar previews: Covered by Task 4.

