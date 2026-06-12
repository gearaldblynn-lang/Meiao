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
