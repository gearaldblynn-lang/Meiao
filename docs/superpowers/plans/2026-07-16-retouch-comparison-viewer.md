# 图片升级滑动对比查看器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为图片升级的原图精修、白底精修和产品还原结果增加可放大、可组内切换的鼠标滑动遮罩对比查看器。

**Architecture:** 新增纯函数模块负责范围、结果映射和遮罩位置计算，新增独立 React 查看器负责 Pointer Events、键盘与加载状态，`ProjectCard` 只负责选择当前结果、打开查看器和缺原图降级。保持现有 `ImageLightbox` 不变，避免影响视频和其他图片模块。

**Tech Stack:** React 19、TypeScript 5.9、Tailwind CSS、Lucide React、Node.js test runner、Vite

## Global Constraints

- 目标环境仅为本地开发环境，不部署云上。
- 支持范围严格限定为 `retouch:original`、`retouch:white_bg`、`retouch:product_restore`。
- 不修改生成、分析、计费、任务队列、API 或持久化合同。
- 原图使用 `sourcePreviewUrl || sourceUrl`，结果图使用 `imageUrl`。
- 图片必须 `object-contain`，不得拉伸或裁切。
- 桌面鼠标悬浮跟随，鼠标按住、触控和触控笔使用 Pointer Events。
- 缺原图时回退现有普通灯箱并显示提示，不得白屏。
- 当前工作区已有其他未提交修改；任何提交都只暂存本计划新增文件或本功能的独立 hunk。

---

### Task 1: 对比范围与遮罩纯逻辑

**Files:**
- Create: `src/shell/components/retouchComparison.ts`
- Test: `src/shell/components/retouchComparison.test.mjs`

**Interfaces:**
- Consumes: `GeneratedResult` 的 `id/status/imageUrl/sourcePreviewUrl/sourceUrl/fileName/originalWidth/originalHeight`。
- Produces: `RetouchComparisonItem`、`isRetouchComparisonScope()`、`buildRetouchComparisonItems()`、`getComparisonDividerPercent()`、`getLoopedComparisonIndex()`、`adjustComparisonDividerPercent()`、`hasDifferentImageAspectRatio()`。

- [ ] **Step 1: 写失败测试，锁定范围、映射、夹紧、循环索引和比例判断**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustComparisonDividerPercent,
  buildRetouchComparisonItems,
  getComparisonDividerPercent,
  getLoopedComparisonIndex,
  hasDifferentImageAspectRatio,
  isRetouchComparisonScope,
} from './retouchComparison.ts';

test('comparison scope includes only three retouch subfeatures', () => {
  for (const subFeature of ['original', 'white_bg', 'product_restore']) {
    assert.equal(isRetouchComparisonScope('retouch', subFeature), true);
  }
  assert.equal(isRetouchComparisonScope('translation', 'original'), false);
  assert.equal(isRetouchComparisonScope('retouch', 'enhance'), false);
});

test('comparison items keep completed images in order and prefer source preview', () => {
  const items = buildRetouchComparisonItems({
    module: 'retouch',
    subFeature: 'original',
    projectName: '7月16日项目',
    results: [
      { id: 'a', status: 'completed', imageUrl: '/a-result.png', sourcePreviewUrl: '/a-preview.png', sourceUrl: '/a-source.png', fileName: 'a.png' },
      { id: 'b', status: 'generating', imageUrl: '', sourceUrl: '/b.png' },
      { id: 'c', status: 'completed', imageUrl: '/c-result.png', sourceUrl: '/c-source.png' },
    ],
  });
  assert.deepEqual(items.map((item) => item.id), ['a', 'c']);
  assert.equal(items[0].originalUrl, '/a-preview.png');
  assert.equal(items[1].originalUrl, '/c-source.png');
  assert.equal(items[1].title, '7月16日项目 #2');
});

test('divider calculations clamp and keyboard helpers stay deterministic', () => {
  assert.equal(getComparisonDividerPercent(150, { left: 100, width: 200 }), 25);
  assert.equal(getComparisonDividerPercent(20, { left: 100, width: 200 }), 0);
  assert.equal(getComparisonDividerPercent(500, { left: 100, width: 200 }), 100);
  assert.equal(getLoopedComparisonIndex(0, -1, 3), 2);
  assert.equal(getLoopedComparisonIndex(2, 1, 3), 0);
  assert.equal(adjustComparisonDividerPercent(50, 'ArrowLeft'), 48);
  assert.equal(adjustComparisonDividerPercent(99, 'ArrowRight'), 100);
});

test('aspect comparison tolerates tiny measurement differences', () => {
  assert.equal(hasDifferentImageAspectRatio({ width: 1000, height: 1000 }, { width: 2000, height: 2000 }), false);
  assert.equal(hasDifferentImageAspectRatio({ width: 1000, height: 1000 }, { width: 1600, height: 900 }), true);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/shell/components/retouchComparison.test.mjs`  
Expected: FAIL，提示找不到 `retouchComparison.ts` 或导出函数。

- [ ] **Step 3: 实现最小纯逻辑**

```ts
import type { GeneratedResult } from '../../ShellMigratedApp';

const RETOUCH_COMPARISON_LABELS = {
  original: '原图精修',
  white_bg: '白底精修',
  product_restore: '产品还原',
} as const;

export interface RetouchComparisonItem {
  id: string;
  originalUrl?: string;
  resultUrl: string;
  title: string;
  subFeatureLabel: string;
  originalWidth?: number;
  originalHeight?: number;
}

export const isRetouchComparisonScope = (module?: string, subFeature?: string) => (
  module === 'retouch' && Object.hasOwn(RETOUCH_COMPARISON_LABELS, String(subFeature || ''))
);

export const buildRetouchComparisonItems = (input: {
  module?: string;
  subFeature?: string;
  projectName?: string;
  results: Array<Partial<GeneratedResult> & { id: string }>;
}): RetouchComparisonItem[] => {
  if (!isRetouchComparisonScope(input.module, input.subFeature)) return [];
  const label = RETOUCH_COMPARISON_LABELS[input.subFeature as keyof typeof RETOUCH_COMPARISON_LABELS];
  return input.results
    .filter((result) => result.status === 'completed' && Boolean(result.imageUrl))
    .map((result, index) => ({
      id: result.id,
      originalUrl: String(result.sourcePreviewUrl || result.sourceUrl || '').trim() || undefined,
      resultUrl: String(result.imageUrl || ''),
      title: String(result.fileName || '').trim() || `${input.projectName || label} #${index + 1}`,
      subFeatureLabel: label,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
    }));
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const getComparisonDividerPercent = (clientX: number, rect: { left: number; width: number }) => (
  rect.width > 0 ? clampPercent(((clientX - rect.left) / rect.width) * 100) : 50
);

export const getLoopedComparisonIndex = (index: number, delta: number, length: number) => (
  length > 0 ? (index + delta + length) % length : 0
);

export const adjustComparisonDividerPercent = (value: number, key: string, step = 2) => (
  key === 'ArrowLeft' ? clampPercent(value - step) : key === 'ArrowRight' ? clampPercent(value + step) : value
);

export const hasDifferentImageAspectRatio = (
  original?: { width: number; height: number },
  result?: { width: number; height: number },
) => {
  if (!original?.width || !original.height || !result?.width || !result.height) return false;
  return Math.abs(original.width / original.height - result.width / result.height) > 0.01;
};
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `node --test src/shell/components/retouchComparison.test.mjs`  
Expected: 4 tests PASS。

- [ ] **Step 5: 提交纯逻辑**

```bash
git add src/shell/components/retouchComparison.ts src/shell/components/retouchComparison.test.mjs
git commit -m "feat: add retouch comparison model"
```

### Task 2: 独立滑动对比查看器

**Files:**
- Create: `src/shell/components/RetouchComparisonViewer.tsx`
- Test: `src/shell/components/RetouchComparisonViewer.test.mjs`
- Modify: `src/shell/components/retouchComparison.ts`
- Modify: `src/shell/components/retouchComparison.test.mjs`

**Interfaces:**
- Consumes: `RetouchComparisonItem[]` 与 Task 1 的遮罩、循环索引、键盘微调、比例判断函数。
- Produces: `RetouchComparisonViewer`，props 与设计文档一致。

- [ ] **Step 1: 写失败测试，锁定查看器的可访问交互合同**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./RetouchComparisonViewer.tsx', import.meta.url), 'utf8');

test('viewer exposes pointer mask, slider keyboard and image labels', () => {
  assert.match(source, /onPointerMove/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /clipPath/);
  assert.match(source, /role="slider"/);
  assert.match(source, /aria-label="调整前后对比遮罩"/);
  assert.match(source, />原图</);
  assert.match(source, />升级后</);
});

test('viewer supports close, navigation, download and mismatch feedback', () => {
  assert.match(source, /Escape/);
  assert.match(source, /getLoopedComparisonIndex/);
  assert.match(source, /onDownloadCurrent/);
  assert.match(source, /前后比例不同/);
  assert.match(source, /原图加载失败/);
  assert.match(source, /结果加载失败/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/shell/components/RetouchComparisonViewer.test.mjs`  
Expected: FAIL，提示文件不存在。

- [ ] **Step 3: 实现查看器**

实现要求：

```tsx
const [dividerPercent, setDividerPercent] = useState(50);
const draggingRef = useRef(false);

const updateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
  if (event.pointerType !== 'mouse' && !draggingRef.current) return;
  setDividerPercent(getComparisonDividerPercent(event.clientX, event.currentTarget.getBoundingClientRect()));
};

<div
  data-testid="retouch-comparison-canvas"
  onPointerDown={(event) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  }}
  onPointerMove={updateFromPointer}
  onPointerUp={() => { draggingRef.current = false; }}
  onPointerCancel={() => { draggingRef.current = false; }}
>
  <img src={item.originalUrl} className="absolute inset-0 h-full w-full object-contain" />
  <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - dividerPercent}% 0 0)` }}>
    <img src={item.resultUrl} className="h-full w-full object-contain" />
  </div>
  <button
    role="slider"
    aria-label="调整前后对比遮罩"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(dividerPercent)}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      setDividerPercent((value) => adjustComparisonDividerPercent(value, event.key));
    }}
  />
</div>
```

同时实现：

- 打开时只渲染当前项；切换 `item.id` 时恢复 50% 并清空加载错误。
- 文档级键盘事件：`Escape` 关闭，普通 `ArrowLeft/ArrowRight` 循环切换。
- 顶栏标题、子功能、序号、下载和关闭按钮。
- 左右悬浮导航按钮。
- 图片 `onLoad` 记录自然尺寸并调用 `hasDifferentImageAspectRatio()`。
- 原图/结果图独立加载失败状态。
- 遮罩画布加 `touchAction: 'none'`，防止触控拖动被页面滚动接管。

- [ ] **Step 4: 运行组件合同测试和纯逻辑测试**

Run: `node --test src/shell/components/retouchComparison.test.mjs src/shell/components/RetouchComparisonViewer.test.mjs`  
Expected: 全部 PASS。

- [ ] **Step 5: 提交查看器**

```bash
git add src/shell/components/RetouchComparisonViewer.tsx src/shell/components/RetouchComparisonViewer.test.mjs src/shell/components/retouchComparison.ts src/shell/components/retouchComparison.test.mjs
git commit -m "feat: add retouch comparison viewer"
```

### Task 3: 接入项目结果卡并提供降级路径

**Files:**
- Modify: `src/shell/components/ProjectCard.tsx`
- Create: `src/shell/components/ProjectCard.retouchComparison.test.mjs`

**Interfaces:**
- Consumes: `buildRetouchComparisonItems()`、`isRetouchComparisonScope()`、`RetouchComparisonViewer`。
- Produces: 图片升级结果点击路由、当前索引状态、下载回调和缺原图普通灯箱降级。

- [ ] **Step 1: 写失败测试，锁定 ProjectCard 接线**

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./ProjectCard.tsx', import.meta.url), 'utf8');

test('ProjectCard routes supported retouch results into comparison viewer', () => {
  assert.match(source, /RetouchComparisonViewer/);
  assert.match(source, /buildRetouchComparisonItems/);
  assert.match(source, /isRetouchComparisonScope/);
  assert.match(source, /setRetouchComparisonOpen\(true\)/);
  assert.match(source, /sourcePreviewUrl \|\| targetResult\.sourceUrl/);
});

test('ProjectCard preserves normal lightbox fallback and visible entry copy', () => {
  assert.match(source, /原图缺失，暂无法对比/);
  assert.match(source, /滑动对比/);
  assert.match(source, /放大查看/);
  assert.match(source, /setLightboxOpen\(true\)/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/shell/components/ProjectCard.retouchComparison.test.mjs`  
Expected: FAIL，缺少专用查看器和打开逻辑。

- [ ] **Step 3: 在 ProjectCard 中完成最小接线**

实现以下结构：

```tsx
const [retouchComparisonOpen, setRetouchComparisonOpen] = useState(false);
const [retouchComparisonIndex, setRetouchComparisonIndex] = useState(0);
const isRetouchComparisonProject = isRetouchComparisonScope(project.module, project.subFeature);
const retouchComparisonItems = buildRetouchComparisonItems({
  module: project.module,
  subFeature: project.subFeature,
  projectName: project.name,
  results: project.results,
});

const openImage = (resultId: string) => {
  const targetResult = project.results.find((result) => result.id === resultId);
  if (isRetouchComparisonProject && targetResult?.status === 'completed' && targetResult.imageUrl) {
    const comparisonIndex = retouchComparisonItems.findIndex((item) => item.id === resultId);
    if (comparisonIndex >= 0 && (targetResult.sourcePreviewUrl || targetResult.sourceUrl)) {
      setRetouchComparisonIndex(comparisonIndex);
      setRetouchComparisonOpen(true);
      return;
    }
    addToast('原图缺失，暂无法对比', 'info');
  }
  // 保留既有 translation 和 ImageLightbox 分支。
};
```

结果图片按钮增加悬浮入口文案，有原图显示“滑动对比”，缺原图显示“放大查看”。详情弹窗的 `Escape` effect 在 `retouchComparisonOpen` 时不得同时关闭底层项目详情。

在现有 `ImageLightbox` 旁渲染：

```tsx
<RetouchComparisonViewer
  open={retouchComparisonOpen}
  items={retouchComparisonItems}
  currentIndex={retouchComparisonIndex}
  onIndexChange={setRetouchComparisonIndex}
  onClose={() => setRetouchComparisonOpen(false)}
  onDownloadCurrent={() => {
    const currentItem = retouchComparisonItems[retouchComparisonIndex];
    const resultIndex = project.results.findIndex((result) => result.id === currentItem?.id);
    if (resultIndex >= 0) void handleDownloadSingle(project.results[resultIndex], resultIndex);
  }}
/>
```

- [ ] **Step 4: 运行接线与现有产品还原回归**

Run: `node --test src/shell/components/ProjectCard.retouchComparison.test.mjs src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs src/shell/components/ProjectCard.productRestoreCredits.test.mjs`  
Expected: 全部 PASS。

- [ ] **Step 5: 只暂存本功能 hunk 并提交**

```bash
git add src/shell/components/ProjectCard.retouchComparison.test.mjs
git add -p src/shell/components/ProjectCard.tsx
git diff --cached --check
git commit -m "feat: wire retouch comparison viewer"
```

在 `git add -p` 中只接受 `RetouchComparisonViewer` import、对比状态/映射、`openImage` 路由、悬浮入口、Escape 守卫和查看器渲染 hunk；拒绝工作区原有其他修改。

### Task 4: 完整验证与本地浏览器验收

**Files:**
- Verify only; do not modify production files unless a failing check proves a defect in Tasks 1–3.

**Interfaces:**
- Consumes: 完成后的图片升级结果卡和本地持久化项目。
- Produces: 自动化、构建、健康检查和真实浏览器交互证据。

- [ ] **Step 1: 运行定向测试**

Run:

```bash
node --test \
  src/shell/components/retouchComparison.test.mjs \
  src/shell/components/RetouchComparisonViewer.test.mjs \
  src/shell/components/ProjectCard.retouchComparison.test.mjs \
  src/shell/modules/Retouch/ProductRestoreAnalysisPanel.test.mjs \
  src/shell/components/ProjectCard.productRestoreCredits.test.mjs
```

Expected: 全部 PASS。

- [ ] **Step 2: 运行类型检查与生产构建**

Run: `npm run build`  
Expected: `tsc -b` 和 `vite build` exit 0。

- [ ] **Step 3: 运行本地健康检查**

Run: `npm run doctor`  
Expected: 前端、后端和 worker 健康；若服务未启动，先运行 `npm run local` 后重试。

- [ ] **Step 4: 浏览器真实验收**

在 `http://127.0.0.1:3000/` 打开现有图片升级项目并验证：

1. 点击原图精修、白底精修或产品还原的已完成结果，出现标题和 `1 / N`。
2. 鼠标从画布左侧移动到右侧，`aria-valuenow` 和可见遮罩同步变化。
3. 鼠标按下拖动后分割线继续跟随；释放后停止触控类拖动语义。
4. 点击下一张，图片切换且分割线恢复 50%。
5. 聚焦分割手柄后按方向键，遮罩每次变化 2%，不切换图片。
6. 点击下载触发现有结果下载；`Escape` 只关闭查看器，项目详情仍保留。
7. 刷新页面后重新打开项目，仍能读取持久化原图与结果图。

- [ ] **Step 5: 检查最终改动边界**

Run:

```bash
git diff --check
git status --short
git log -4 --oneline
```

Expected: 无 whitespace error；只报告本功能提交和用户原有未提交修改；没有云上发布操作。
