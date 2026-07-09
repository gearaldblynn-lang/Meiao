import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldPersistSyncedProjectFromJobs } from './syncedProjectPersistence.ts';

const completedMediaResult = (overrides = {}) => ({
  id: 'result-1',
  status: 'completed',
  imageUrl: 'http://example.com/api/assets/file/abc/result.png',
  backendJobId: 'job-backend-1',
  ...overrides,
});

const jobSourcedProject = (overrides = {}) => ({
  id: 'proj-1783561700716',
  name: '7月9日项目5',
  module: 'everything_replace',
  subFeature: 'product_replace',
  status: 'completed',
  sourceType: 'job',
  backendJobId: 'job-backend-1',
  results: [completedMediaResult()],
  taskCount: 1,
  completedCount: 1,
  ...overrides,
});

test('missing job-sourced completed media card is persisted for any module (多桑 项目5 断链修复)', () => {
  const project = jobSourcedProject();
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), true);
});

test('missing job-sourced generating card with backend identity is persisted (刷新后进行中卡不丢)', () => {
  const project = jobSourcedProject({
    status: 'generating',
    results: [completedMediaResult({ status: 'generating', imageUrl: '', backendJobId: 'job-backend-1' })],
    completedCount: 0,
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), true);
});

test('missing job-sourced error card is persisted (既有行为保持)', () => {
  const project = jobSourcedProject({
    status: 'error',
    results: [completedMediaResult({ status: 'error', imageUrl: '' })],
    completedCount: 0,
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), true);
});

test('missing translation job card keeps persisting (根因#既有翻译恢复不回退)', () => {
  const project = jobSourcedProject({ module: 'translation', subFeature: 'main' });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), true);
});

test('job card without backendJobId is never persisted (无身份占位不落库,根因#36)', () => {
  const project = jobSourcedProject({
    backendJobId: '',
    results: [completedMediaResult({ backendJobId: '' })],
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), false);
});

test('missing persisted-sourced card is not persisted from jobs sync', () => {
  const project = jobSourcedProject({ sourceType: 'persisted' });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), false);
});

test('one-click planning card without results is not persisted from jobs sync', () => {
  const project = jobSourcedProject({
    module: 'one_click',
    subFeature: 'main_image',
    status: 'planning',
    results: [],
    completedCount: 0,
    plans: [{ id: 'plan-1', schemeContent: '方案内容' }],
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [] }), false);
});

test('already persisted card with no diff is not re-persisted', () => {
  const project = jobSourcedProject();
  const state = { shellProjects: [jobSourcedProject()] };
  assert.equal(shouldPersistSyncedProjectFromJobs(project, state), false);
});

test('already persisted card is re-persisted when completed media count increases', () => {
  const persisted = jobSourcedProject({
    results: [completedMediaResult({ status: 'generating', imageUrl: '' })],
    completedCount: 0,
    status: 'generating',
  });
  const project = jobSourcedProject();
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [persisted] }), true);
});

test('already persisted generating card is re-persisted when a new active identity appears', () => {
  const persisted = jobSourcedProject({
    status: 'generating',
    results: [completedMediaResult({ status: 'generating', imageUrl: '', backendJobId: 'job-backend-1' })],
    completedCount: 0,
  });
  const project = jobSourcedProject({
    status: 'generating',
    results: [
      completedMediaResult({ status: 'generating', imageUrl: '', backendJobId: 'job-backend-1' }),
      completedMediaResult({ id: 'result-2', status: 'generating', imageUrl: '', backendJobId: 'job-backend-2' }),
    ],
    completedCount: 0,
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [persisted] }), true);
});

test('persisted planning/generating card flips to error is persisted', () => {
  const persisted = jobSourcedProject({
    status: 'generating',
    results: [completedMediaResult({ status: 'generating', imageUrl: '' })],
    completedCount: 0,
  });
  const project = jobSourcedProject({
    status: 'error',
    results: [completedMediaResult({ status: 'error', imageUrl: '' })],
    completedCount: 0,
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [persisted] }), true);
});

test('one-click planning snapshot change still triggers persistence (既有策划修复行为)', () => {
  const persisted = jobSourcedProject({
    module: 'one_click',
    status: 'planning',
    results: [],
    completedCount: 0,
    plans: [{ id: 'plan-1', schemeContent: '旧方案' }],
  });
  const project = jobSourcedProject({
    module: 'one_click',
    status: 'planning',
    results: [],
    completedCount: 0,
    plans: [{ id: 'plan-1', schemeContent: '新方案' }],
  });
  assert.equal(shouldPersistSyncedProjectFromJobs(project, { shellProjects: [persisted] }), true);
});
