import test from 'node:test';
import assert from 'node:assert/strict';

import { upsertShellProjectIntoPersistedState } from './shellPersistence.ts';
import { buildPersistedAppState } from '../utils/appState.ts';

// 根因 #1 验收测试:前端持久化对账必须遵守"已完成结果必胜"。
// 这条单测把"卡片一直处理中 / 已完成被覆盖"那类复发 bug 钉成可回归的契约。
// 现在大概率 RED(前端 mergeArrayByStableKeys 是浅合并,无 completed-wins),
// 统一前后端对账逻辑后应转 GREEN。

test('shell persistence keeps a completed result when a late generating update for the same id arrives', () => {
  const state = buildPersistedAppState();
  const completedProject = {
    id: 'proj-1',
    name: '精修项目',
    module: 'retouch',
    status: 'completed',
    createdAt: '06-12',
    completedAt: '06-12',
    results: [{
      id: 'r1',
      imageUrl: 'https://example.com/r1.png',
      prompt: 'p',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      status: 'completed',
      createdAt: '06-12',
      module: 'retouch',
      subFeature: 'original',
    }],
    taskCount: 1,
    completedCount: 1,
    subFeature: 'original',
  };

  const first = upsertShellProjectIntoPersistedState(state, completedProject);

  // 一条迟到的"仍在处理中"快照(同 result id、无媒体)——这是真实竞态:后台已完成,
  // 但前端一个慢轮询回包带着旧的 generating 状态又写了回来。
  const lateGenerating = {
    ...completedProject,
    status: 'generating',
    completedCount: 0,
    results: [{
      ...completedProject.results[0],
      imageUrl: '',
      status: 'generating',
    }],
  };

  const second = upsertShellProjectIntoPersistedState(first, lateGenerating);
  const merged = second.shellProjects.find((p) => p.id === 'proj-1');
  const r1 = merged.results.find((r) => r.id === 'r1');

  assert.equal(r1.imageUrl, 'https://example.com/r1.png', '已完成媒体不得被迟到的 generating 更新覆盖');
  assert.equal(r1.status, 'completed', '已完成结果状态不得被退回 generating');
});

// 根因 #1 漂移④验收测试:项目级状态推导必须"只要还有任务在跑,就 generating,
// 直到全部完成"。已确认产品正确行为=选项 A(部分完成仍显示生成中,不得谎报已完成)。
// 探针已证实前端=generating / 后端=completed 不一致;统一后两边都应判 generating、
// 且 taskCount 必须把还在跑的任务也数进去(2 完成 + 1 生成中 = 3,而非 2)。
test('shell persistence keeps a partially-completed project generating until every task finishes', () => {
  const state = buildPersistedAppState();
  const mkResult = (id, status, imageUrl) => ({
    id,
    imageUrl,
    prompt: 'p',
    model: 'gpt-image-2',
    aspectRatio: '1:1',
    status,
    createdAt: '06-12',
    module: 'retouch',
    subFeature: 'original',
    taskId: `task-${id}`,
  });
  const partialProject = {
    id: 'proj-partial',
    name: '部分完成项目',
    module: 'retouch',
    status: 'generating',
    createdAt: '06-12',
    results: [
      mkResult('r1', 'completed', 'https://example.com/r1.png'),
      mkResult('r2', 'completed', 'https://example.com/r2.png'),
      mkResult('r3', 'generating', ''),
    ],
    taskCount: 3,
    completedCount: 2,
    subFeature: 'original',
  };

  const next = upsertShellProjectIntoPersistedState(state, partialProject);
  const merged = next.shellProjects.find((p) => p.id === 'proj-partial');

  assert.equal(merged.status, 'generating', '还有任务在跑时不得谎报已完成');
  assert.equal(merged.taskCount, 3, 'taskCount 必须把还在跑的任务也数进去(2 完成 + 1 生成中 = 3)');
});

// 根因 #1 漂移③验收测试:stale 占位检测不能只保护 one_click。
// 当 prompt 等于模块自己的中文标签(说明是 fallback 出来的占位、用户没填真实内容)、
// 又无 media/无 provider 身份/id 带 -pending,这种"假占位"应在所有模块被识别为 stale 并过滤。
// 现状:isStaleOneClickPlanningPlaceholderItem 硬编码 '一键主详' 且只在 isOneClick 路径调用,
// 其它模块(如 retouch)同模式占位会一直保留,看起来"卡处理中"。
test('shell persistence drops stale fallback-prompt placeholders for non-one_click modules', () => {
  const state = buildPersistedAppState();
  const partialProject = {
    id: 'proj-retouch-stale',
    name: '精修项目',
    module: 'retouch',
    status: 'generating',
    createdAt: '06-13',
    subFeature: 'original',
    results: [
      {
        id: 'r1',
        imageUrl: 'https://example.com/r1.png',
        prompt: 'p',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'completed',
        createdAt: '06-13',
        module: 'retouch',
        subFeature: 'original',
      },
      // 假占位:prompt 是模块标签 fallback、id 带 -pending、无 media/无身份/有 backendJobId
      {
        id: 'r2-pending',
        imageUrl: '',
        prompt: '产品精修',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'generating',
        createdAt: '06-13',
        module: 'retouch',
        subFeature: 'original',
        backendJobId: 'job-stale',
      },
    ],
    taskCount: 2,
    completedCount: 1,
  };

  const next = upsertShellProjectIntoPersistedState(state, partialProject);
  const merged = next.shellProjects.find((p) => p.id === 'proj-retouch-stale');

  assert.equal(merged.results.length, 1, 'fallback-prompt 占位应被过滤,只保留真实完成项');
  assert.equal(merged.results[0].id, 'r1', '保留的应是真实完成项 r1');
});
