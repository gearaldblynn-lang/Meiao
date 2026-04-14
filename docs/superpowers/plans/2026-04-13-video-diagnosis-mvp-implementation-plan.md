# 视频诊断系统 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有短视频模块下新增一个可测试的“视频诊断系统”子功能，支持 TikTok 优先、抖音基础接入的字段勘探与证据型诊断报告。

**Architecture:** 前端在 `VideoModule` 内新增并列子模式与最小工作台，后端新增一个专用视频诊断探测接口，负责 URL 标准化、Spider 网关调用、字段 flatten、统一聚合与基础报告生成。状态持久化继续沿用 `videoMemory`，诊断流程不复用队列任务系统，先以同步接口完成数据验证型 MVP。

**Tech Stack:** React + TypeScript、Node.js `node:test`、现有 `internalApi` 请求封装、现有本地服务端 `server/index.mjs`

---

## File Structure

### Existing files to modify

- `types.ts`
  - 为 `VideoSubMode` 增加 `DIAGNOSIS`
  - 新增视频诊断状态、响应、证据卡片等类型
- `utils/appState.ts`
  - 补充 `createDefaultVideoState()` 的诊断默认状态
- `modules/Video/VideoModule.tsx`
  - 在分镜配置与诊断系统之间切换
  - 连接诊断页状态与请求
- `services/internalApi.ts`
  - 新增视频诊断 API 调用函数
- `server/index.mjs`
  - 新增视频诊断探测 POST 路由

### New files to create

- `modules/Video/VideoDiagnosisPanel.tsx`
  - 最小诊断工作台 UI
- `modules/Video/videoDiagnosisUtils.mjs`
  - 前端无副作用辅助逻辑，例如结果摘要、字段分组显示
- `modules/Video/videoDiagnosisUtils.test.mjs`
  - 前端诊断辅助函数测试
- `server/videoDiagnosisProbe.mjs`
  - 核心后端探测与聚合逻辑
- `server/videoDiagnosisProbe.test.mjs`
  - 探测逻辑测试

## Task 1: Add Persistent Diagnosis State And Types

**Files:**
- Modify: `types.ts`
- Modify: `utils/appState.ts`
- Test: `modules/Video/videoDiagnosisUtils.test.mjs`

- [ ] **Step 1: Write the failing test for default diagnosis state shape**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultVideoState } from '../../utils/appState';
import { VideoSubMode } from '../../types';

test('createDefaultVideoState initializes diagnosis mode memory', () => {
  const state = createDefaultVideoState();

  assert.equal(state.subMode, VideoSubMode.STORYBOARD);
  assert.equal(state.diagnosis.platform, 'tiktok');
  assert.equal(state.diagnosis.url, '');
  assert.deepEqual(state.diagnosis.analysisItems, ['video_basic', 'video_metrics', 'author_profile']);
  assert.equal(state.diagnosis.probe.status, 'idle');
  assert.equal(state.diagnosis.report.status, 'idle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- modules/Video/videoDiagnosisUtils.test.mjs`

Expected: FAIL with missing `diagnosis` state or missing exported types.

- [ ] **Step 3: Add diagnosis types in `types.ts`**

```ts
export enum VideoSubMode {
  LONG_VIDEO = 'long_video',
  VEO = 'veo',
  STORYBOARD = 'storyboard',
  DIAGNOSIS = 'diagnosis',
}

export type VideoDiagnosisPlatform = 'tiktok' | 'douyin';
export type VideoDiagnosisAccessMode = 'spider_api' | 'web_session';
export type VideoDiagnosisAnalysisItem =
  | 'video_basic'
  | 'video_metrics'
  | 'author_profile'
  | 'comment_sample'
  | 'recent_posts'
  | 'risk_signals';

export interface VideoDiagnosisEvidenceItem {
  label: string;
  source: string;
  fieldPath: string;
  value: string;
}

export interface VideoDiagnosisInferenceItem {
  title: string;
  level: 'info' | 'warning' | 'risk';
  summary: string;
}

export interface VideoDiagnosisActionItem {
  title: string;
  detail: string;
}

export interface VideoDiagnosisProbeResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  sources: Array<{ key: string; status: 'success' | 'error' | 'skipped'; summary: string }>;
  fields: string[];
  raw: Record<string, unknown> | null;
  normalized: Record<string, unknown> | null;
  missingCriticalFields: string[];
  error: string;
  completedAt: number | null;
}

export interface VideoDiagnosisReportResult {
  status: 'idle' | 'ready';
  summary: string;
  evidence: VideoDiagnosisEvidenceItem[];
  inferences: VideoDiagnosisInferenceItem[];
  actions: VideoDiagnosisActionItem[];
}

export interface VideoDiagnosisState {
  platform: VideoDiagnosisPlatform;
  accessMode: VideoDiagnosisAccessMode;
  url: string;
  analysisItems: VideoDiagnosisAnalysisItem[];
  probe: VideoDiagnosisProbeResult;
  report: VideoDiagnosisReportResult;
}
```

- [ ] **Step 4: Add default diagnosis state in `utils/appState.ts`**

```ts
diagnosis: {
  platform: 'tiktok',
  accessMode: 'spider_api',
  url: '',
  analysisItems: ['video_basic', 'video_metrics', 'author_profile'],
  probe: {
    status: 'idle',
    sources: [],
    fields: [],
    raw: null,
    normalized: null,
    missingCriticalFields: [],
    error: '',
    completedAt: null,
  },
  report: {
    status: 'idle',
    summary: '',
    evidence: [],
    inferences: [],
    actions: [],
  },
},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- modules/Video/videoDiagnosisUtils.test.mjs`

Expected: PASS with one test passing.

- [ ] **Step 6: Commit**

```bash
git add types.ts utils/appState.ts modules/Video/videoDiagnosisUtils.test.mjs
git commit -m "feat: add video diagnosis state model"
```

## Task 2: Build Server-Side Probe And Aggregation Logic

**Files:**
- Create: `server/videoDiagnosisProbe.mjs`
- Test: `server/videoDiagnosisProbe.test.mjs`

- [ ] **Step 1: Write the failing server tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenFieldPaths, extractTikTokVideoIdFromUrl, buildDiagnosisReport } from './videoDiagnosisProbe.mjs';

test('extractTikTokVideoIdFromUrl parses share url', () => {
  assert.equal(
    extractTikTokVideoIdFromUrl('https://www.tiktok.com/@demo/video/7388888888888888888'),
    '7388888888888888888'
  );
});

test('flattenFieldPaths returns nested object paths', () => {
  const fields = flattenFieldPaths({
    data: {
      statistics: { play_count: 83 },
      author: { nickname: 'demo' },
    },
  });

  assert.deepEqual(fields, [
    'data',
    'data.statistics',
    'data.statistics.play_count',
    'data.author',
    'data.author.nickname',
  ]);
});

test('buildDiagnosisReport separates evidence and inference', () => {
  const report = buildDiagnosisReport({
    platform: 'tiktok',
    normalized: {
      video: { playCount: 83, diggCount: 1, commentCount: 0, desc: 'demo' },
      author: { nickname: 'tester' },
      platformSignals: { hasDirectRiskField: false },
    },
    missingCriticalFields: ['platform.review_status'],
  });

  assert.match(report.summary, /83/);
  assert.equal(report.evidence.length > 0, true);
  assert.equal(report.inferences.length > 0, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/videoDiagnosisProbe.test.mjs`

Expected: FAIL because `videoDiagnosisProbe.mjs` does not exist.

- [ ] **Step 3: Implement minimal parsing, flattening, and report builders**

```js
export const extractTikTokVideoIdFromUrl = (url) => {
  const match = String(url || '').match(/\/video\/(\d+)/);
  return match ? match[1] : '';
};

export const extractDouyinVideoIdFromUrl = (url) => {
  const match = String(url || '').match(/\/video\/(\d+)/);
  return match ? match[1] : '';
};

export const flattenFieldPaths = (value, prefix = '', result = []) => {
  if (value === null || value === undefined) return result;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const nextPath = `${prefix}[${index}]`;
      result.push(nextPath);
      flattenFieldPaths(item, nextPath, result);
    });
    return result;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      result.push(nextPath);
      flattenFieldPaths(value[key], nextPath, result);
    });
  }
  return result;
};

export const buildDiagnosisReport = ({ platform, normalized, missingCriticalFields }) => {
  const playCount = Number(normalized?.video?.playCount || 0);
  const evidence = [
    {
      label: '播放量',
      source: platform === 'tiktok' ? 'tiktok/video-by-url-v2' : 'douyin/video-info',
      fieldPath: 'statistics.play_count',
      value: String(playCount),
    },
  ];
  const inferences = missingCriticalFields.length
    ? [{
        title: '缺少直接风险字段',
        level: 'warning',
        summary: `当前缺少 ${missingCriticalFields.join(', ')}，以下判断不代表平台后台真值。`,
      }]
    : [];
  return {
    summary: `当前视频已获取基础字段，播放量为 ${playCount}。`,
    evidence,
    inferences,
    actions: [
      {
        title: '继续补齐评论和近期作品样本',
        detail: '优先检查评论样本与账号近期作品，增强诊断可信度。',
      },
    ],
  };
};
```

- [ ] **Step 4: Implement probe orchestration with injectable fetch**

```js
export const createVideoDiagnosisProbe = ({ spiderFetch }) => async ({ platform, url, analysisItems }) => {
  const videoId = platform === 'tiktok' ? extractTikTokVideoIdFromUrl(url) : extractDouyinVideoIdFromUrl(url);
  if (!videoId) {
    return {
      probe: {
        status: 'error',
        sources: [],
        fields: [],
        raw: null,
        normalized: null,
        missingCriticalFields: ['video.id'],
        error: '无法从链接中解析视频 ID',
        completedAt: Date.now(),
      },
      report: {
        status: 'idle',
        summary: '',
        evidence: [],
        inferences: [],
        actions: [],
      },
    };
  }
  const rawVideo = await spiderFetch({ platform, source: 'video', videoId, url, analysisItems });
  const fields = flattenFieldPaths(rawVideo);
  const normalized = {
    video: {
      id: videoId,
      desc: rawVideo?.data?.desc || rawVideo?.aweme_detail?.desc || '',
      playCount: rawVideo?.data?.statistics?.play_count || rawVideo?.aweme_detail?.statistics?.play_count || 0,
      diggCount: rawVideo?.data?.statistics?.digg_count || rawVideo?.aweme_detail?.statistics?.digg_count || 0,
      commentCount: rawVideo?.data?.statistics?.comment_count || rawVideo?.aweme_detail?.statistics?.comment_count || 0,
    },
    author: {
      nickname: rawVideo?.data?.author?.nickname || rawVideo?.aweme_detail?.author?.nickname || '',
    },
    platformSignals: {
      hasDirectRiskField: fields.includes('data.review_status') || fields.includes('aweme_detail.review_status'),
    },
  };
  const missingCriticalFields = normalized.platformSignals.hasDirectRiskField ? [] : ['platform.review_status'];
  return {
    probe: {
      status: 'success',
      sources: [{ key: 'video', status: 'success', summary: '已获取视频详情' }],
      fields,
      raw: { video: rawVideo },
      normalized,
      missingCriticalFields,
      error: '',
      completedAt: Date.now(),
    },
    report: {
      status: 'ready',
      ...buildDiagnosisReport({ platform, normalized, missingCriticalFields }),
    },
  };
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- server/videoDiagnosisProbe.test.mjs`

Expected: PASS with probe utility tests succeeding.

- [ ] **Step 6: Commit**

```bash
git add server/videoDiagnosisProbe.mjs server/videoDiagnosisProbe.test.mjs
git commit -m "feat: add video diagnosis probe core"
```

## Task 3: Expose A Minimal Diagnosis API On The Server

**Files:**
- Modify: `server/index.mjs`
- Modify: `services/internalApi.ts`
- Test: `server/videoDiagnosisProbe.test.mjs`

- [ ] **Step 1: Write the failing integration-style test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../services/internalApi.ts', import.meta.url), 'utf8');

test('video diagnosis route and client are wired', () => {
  assert.match(serverSource, /\/api\/video-diagnosis\/probe/);
  assert.match(apiSource, /probeVideoDiagnosis/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- server/videoDiagnosisProbe.test.mjs`

Expected: FAIL because the route and client method do not exist.

- [ ] **Step 3: Add the server route**

```js
import { createVideoDiagnosisProbe } from './videoDiagnosisProbe.mjs';

const videoDiagnosisProbe = createVideoDiagnosisProbe({
  spiderFetch: async ({ platform, source, videoId, url }) => {
    if (platform === 'tiktok') {
      return await fetchSpiderJson('/v1/spider/tiktok/video-by-url-v2', { share_url: url });
    }
    return await fetchSpiderJson('/v1/spider/douyin/video-info', { aweme_id: videoId });
  },
});

if (url.pathname === '/api/video-diagnosis/probe' && req.method === 'POST') {
  const user = await requireDbUser(req, res);
  if (!user) return;
  const body = await readBody(req);
  const result = await videoDiagnosisProbe({
    platform: String(body.platform || 'tiktok'),
    url: String(body.url || ''),
    analysisItems: Array.isArray(body.analysisItems) ? body.analysisItems : [],
  });
  json(res, 200, result);
  return;
}
```

- [ ] **Step 4: Add the front-end API client**

```ts
export const probeVideoDiagnosis = async (payload: {
  platform: 'tiktok' | 'douyin';
  url: string;
  analysisItems: string[];
  accessMode: 'spider_api' | 'web_session';
}) => {
  return request<{
    probe: Record<string, unknown>;
    report: Record<string, unknown>;
  }>('/api/video-diagnosis/probe', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- server/videoDiagnosisProbe.test.mjs`

Expected: PASS with route and client wiring assertions succeeding.

- [ ] **Step 6: Commit**

```bash
git add server/index.mjs services/internalApi.ts server/videoDiagnosisProbe.test.mjs
git commit -m "feat: expose video diagnosis probe api"
```

## Task 4: Build The Minimal Video Diagnosis UI

**Files:**
- Create: `modules/Video/VideoDiagnosisPanel.tsx`
- Create: `modules/Video/videoDiagnosisUtils.mjs`
- Test: `modules/Video/videoDiagnosisUtils.test.mjs`
- Modify: `modules/Video/VideoModule.tsx`

- [ ] **Step 1: Write the failing UI utility tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProbeOutcome, formatEvidenceValue } from './videoDiagnosisUtils.mjs';

test('summarizeProbeOutcome returns a friendly probe summary', () => {
  assert.equal(
    summarizeProbeOutcome({
      sources: [{ key: 'video', status: 'success', summary: '已获取视频详情' }],
      missingCriticalFields: ['platform.review_status'],
    }),
    '已完成 1 个数据源勘探，缺失 1 个关键字段'
  );
});

test('formatEvidenceValue stringifies primitive values', () => {
  assert.equal(formatEvidenceValue(83), '83');
  assert.equal(formatEvidenceValue(true), 'true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- modules/Video/videoDiagnosisUtils.test.mjs`

Expected: FAIL because the utility file does not exist.

- [ ] **Step 3: Implement the UI utilities**

```js
export const summarizeProbeOutcome = (probe) => {
  const sourceCount = Array.isArray(probe?.sources) ? probe.sources.length : 0;
  const missingCount = Array.isArray(probe?.missingCriticalFields) ? probe.missingCriticalFields.length : 0;
  return `已完成 ${sourceCount} 个数据源勘探，缺失 ${missingCount} 个关键字段`;
};

export const formatEvidenceValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
};
```

- [ ] **Step 4: Implement the diagnosis panel and wire it into `VideoModule.tsx`**

```tsx
const VideoDiagnosisPanel: React.FC<Props> = ({
  state,
  onChange,
  onProbe,
}) => (
  <div className="grid grid-cols-[360px_minmax(0,1fr)] gap-6 h-full">
    <aside className="rounded-3xl border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="text-sm font-black text-slate-800">视频诊断系统</h2>
      <select value={state.platform} onChange={(event) => onChange({ platform: event.target.value as any })}>
        <option value="tiktok">TikTok</option>
        <option value="douyin">抖音</option>
      </select>
      <textarea value={state.url} onChange={(event) => onChange({ url: event.target.value })} />
      <button onClick={onProbe}>开始勘探</button>
    </aside>
    <section className="min-w-0 grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
      <div className="rounded-3xl border border-slate-200 bg-slate-950 text-slate-100 p-5 overflow-auto">
        <pre>{JSON.stringify(state.probe.raw, null, 2)}</pre>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 overflow-auto">
        <p>{state.report.summary}</p>
      </div>
    </section>
  </div>
);
```

```tsx
{persistentState.subMode === VideoSubMode.DIAGNOSIS ? (
  <VideoDiagnosisPanel
    state={persistentState.diagnosis}
    onChange={(updates) => setVideoState((prev) => ({ ...prev, diagnosis: { ...prev.diagnosis, ...updates } }))}
    onProbe={handleDiagnosisProbe}
  />
) : (
  <StoryboardWorkspace ... />
)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- modules/Video/videoDiagnosisUtils.test.mjs`

Expected: PASS with the utility tests succeeding.

- [ ] **Step 6: Commit**

```bash
git add modules/Video/VideoDiagnosisPanel.tsx modules/Video/videoDiagnosisUtils.mjs modules/Video/videoDiagnosisUtils.test.mjs modules/Video/VideoModule.tsx
git commit -m "feat: add video diagnosis workspace ui"
```

## Task 5: Connect Probe Requests, Error States, And Manual Verification

**Files:**
- Modify: `modules/Video/VideoModule.tsx`
- Modify: `modules/Video/VideoDiagnosisPanel.tsx`
- Modify: `services/internalApi.ts`
- Test: `modules/Video/videoDiagnosisUtils.test.mjs`

- [ ] **Step 1: Write the failing source-level behavior test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const videoModuleSource = readFileSync(new URL('./VideoModule.tsx', import.meta.url), 'utf8');

test('video module handles diagnosis loading and error states', () => {
  assert.match(videoModuleSource, /probe\.status: 'loading'/);
  assert.match(videoModuleSource, /addToast/);
  assert.match(videoModuleSource, /probeVideoDiagnosis/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- modules/Video/videoDiagnosisUtils.test.mjs`

Expected: FAIL because the loading/error orchestration is not implemented yet.

- [ ] **Step 3: Implement probe execution flow in `VideoModule.tsx`**

```tsx
const handleDiagnosisProbe = async () => {
  setVideoState((prev) => ({
    ...prev,
    subMode: VideoSubMode.DIAGNOSIS,
    diagnosis: {
      ...prev.diagnosis,
      probe: { ...prev.diagnosis.probe, status: 'loading', error: '' },
    },
  }));

  try {
    const result = await probeVideoDiagnosis({
      platform: persistentState.diagnosis.platform,
      url: persistentState.diagnosis.url,
      analysisItems: persistentState.diagnosis.analysisItems,
      accessMode: persistentState.diagnosis.accessMode,
    });
    setVideoState((prev) => ({
      ...prev,
      diagnosis: {
        ...prev.diagnosis,
        probe: result.probe as any,
        report: result.report as any,
      },
    }));
    addToast({ type: 'success', message: '视频诊断勘探完成' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频诊断勘探失败';
    setVideoState((prev) => ({
      ...prev,
      diagnosis: {
        ...prev.diagnosis,
        probe: {
          ...prev.diagnosis.probe,
          status: 'error',
          error: message,
        },
      },
    }));
    addToast({ type: 'error', message });
  }
};
```

- [ ] **Step 4: Run automated tests and one manual smoke check**

Run: `npm test -- modules/Video/videoDiagnosisUtils.test.mjs server/videoDiagnosisProbe.test.mjs`

Expected: PASS with all diagnosis tests passing.

Run: `npm run doctor`

Expected: local front-end and local back-end health checks pass before manual UI smoke testing.

Manual smoke:
- 打开 `http://localhost:3000`
- 进入 `短视频` 模块
- 切到 `视频诊断系统`
- 输入一个 TikTok 视频链接
- 点击 `开始勘探`
- 验证页面出现原始 JSON、字段列表、诊断摘要

- [ ] **Step 5: Commit**

```bash
git add modules/Video/VideoModule.tsx modules/Video/VideoDiagnosisPanel.tsx modules/Video/videoDiagnosisUtils.test.mjs
git commit -m "feat: wire video diagnosis probe flow"
```

## Self-Review

### Spec coverage

- 子功能入口：Task 1 + Task 4
- TikTok 优先探测：Task 2 + Task 3
- 抖音基础接入：Task 2 + Task 3
- 原始 JSON / 字段路径 / 统一聚合：Task 2 + Task 4
- 证据与推断分层报告：Task 2 + Task 4 + Task 5
- 方便测试的最小工作台：Task 4 + Task 5

无明显遗漏；网页登录态增强按 spec 仅预留，不在本计划实现。

### Placeholder scan

- 没有使用 `TBD` / `TODO`
- 每个代码步骤都给了明确文件与示例代码
- 每个任务都包含明确命令与预期结果

### Type consistency

- `VideoSubMode.DIAGNOSIS` 与 `VideoDiagnosisState` 在 Task 1 定义，后续任务统一复用
- `probeVideoDiagnosis` 在 Task 3 定义，Task 5 调用名称一致
- `buildDiagnosisReport`、`flattenFieldPaths`、`createVideoDiagnosisProbe` 在 Task 2 中定义，未出现命名漂移
