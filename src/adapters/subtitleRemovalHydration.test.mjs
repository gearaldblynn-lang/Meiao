import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShellDataSnapshot } from './shellDataAdapter.ts';

const region = { x: 0, y: 0.7, width: 1, height: 0.3 };
const pixels = { x1: 0, y1: 1344, x2: 1080, y2: 1920 };

const makeJob = (overrides = {}) => ({
  id: 'subtitle-job-1',
  userId: 'user-1',
  module: 'video',
  taskType: 'subtitle_remove_video',
  provider: 'golden_subtitle',
  status: 'succeeded',
  priority: 0,
  payload: {
    taskPurpose: 'subtitle_removal',
    subFeature: 'subtitle_removal',
    sourceUrl: '/api/assets/file/source-video.mp4',
    sourceProjectId: 'source-project',
    sourceResultId: 'source-result',
    shellProjectId: 'subtitle-project',
    shellProjectName: '7月15日项目1',
    subtitleRegionNormalized: region,
  },
  providerTaskId: 'golden-task-1',
  result: {
    videoUrl: '/api/assets/file/subtitle-result.mp4',
    subtitleRegionPixels: pixels,
  },
  errorCode: '',
  errorMessage: '',
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1784073600000,
  updatedAt: 1784073660000,
  startedAt: 1784073601000,
  finishedAt: 1784073660000,
  cancelRequestedAt: null,
  ...overrides,
});

test('succeeded subtitle job hydrates a completed project with source and region metadata', () => {
  const snapshot = buildShellDataSnapshot({}, [makeJob()]);
  const project = snapshot.projects.find((item) => item.id === 'subtitle-project');

  assert.ok(project);
  assert.equal(project.subFeature, 'subtitle_removal');
  assert.equal(project.status, 'completed');
  assert.equal(project.results[0].sourceUrl, '/api/assets/file/source-video.mp4');
  assert.equal(project.results[0].videoUrl, '/api/assets/file/subtitle-result.mp4');
  assert.equal(project.results[0].backendJobId, 'subtitle-job-1');
  assert.deepEqual(project.results[0].subtitleRegionNormalized, region);
  assert.deepEqual(project.results[0].subtitleRegionPixels, pixels);
  assert.equal(project.results[0].sourceProjectId, 'source-project');
  assert.equal(project.results[0].sourceResultId, 'source-result');
});

test('queued and running subtitle jobs restore the same owned project and active task', () => {
  for (const status of ['queued', 'running']) {
    const job = makeJob({ status, providerTaskId: '', result: null, finishedAt: null });
    const snapshot = buildShellDataSnapshot({}, [job]);
    const project = snapshot.projects.find((item) => item.id === 'subtitle-project');
    const task = snapshot.tasks.find((item) => item.backendJobId === 'subtitle-job-1');

    assert.equal(project?.status, 'generating');
    assert.equal(project?.subFeature, 'subtitle_removal');
    assert.equal(project?.results[0]?.sourceUrl, '/api/assets/file/source-video.mp4');
    assert.deepEqual(project?.results[0]?.subtitleRegionNormalized, region);
    assert.equal(task?.projectId, 'subtitle-project');
    assert.equal(task?.subFeature, 'subtitle_removal');
  }
});

test('failed subtitle job remains visible with its humanized error and retry context', () => {
  const snapshot = buildShellDataSnapshot({}, [makeJob({
    status: 'failed',
    providerTaskId: 'golden-task-failed',
    result: null,
    errorCode: 'subtitle_provider_busy',
    errorMessage: '去字幕服务繁忙，请稍后重试',
  })]);
  const project = snapshot.projects.find((item) => item.id === 'subtitle-project');

  assert.equal(project?.status, 'error');
  assert.equal(project?.subFeature, 'subtitle_removal');
  assert.equal(project?.error, '去字幕服务繁忙，请稍后重试');
  assert.equal(project?.results[0]?.error, '去字幕服务繁忙，请稍后重试');
  assert.equal(project?.results[0]?.sourceUrl, '/api/assets/file/source-video.mp4');
  assert.deepEqual(project?.results[0]?.subtitleRegionNormalized, region);
});

test('durable subtitle success replaces its stale placeholder without touching another video project', () => {
  const unrelated = {
    id: 'video-generation-project',
    name: '原有短视频',
    module: 'video',
    subFeature: 'generation',
    status: 'completed',
    createdAt: 1784073500000,
    taskCount: 1,
    completedCount: 1,
    results: [{
      id: 'video-generation-result',
      imageUrl: '/api/assets/file/generated.mp4',
      videoUrl: '/api/assets/file/generated.mp4',
      mediaType: 'video',
      prompt: '原有生成结果',
      model: 'seedance',
      aspectRatio: '9:16',
      status: 'completed',
      createdAt: 1784073500000,
      module: 'video',
      subFeature: 'generation',
    }],
  };
  const placeholder = {
    id: 'subtitle-project',
    name: '7月15日项目1',
    module: 'video',
    subFeature: 'subtitle_removal',
    status: 'generating',
    createdAt: 1784073600000,
    taskCount: 1,
    completedCount: 0,
    backendJobId: 'subtitle-job-1',
    results: [{
      id: 'subtitle-project-result',
      imageUrl: '',
      videoUrl: '',
      mediaType: 'video',
      prompt: '去字幕',
      model: 'Golden 去字幕',
      aspectRatio: 'auto',
      status: 'generating',
      createdAt: 1784073600000,
      module: 'video',
      subFeature: 'subtitle_removal',
      backendJobId: 'subtitle-job-1',
      sourceUrl: '/api/assets/file/source-video.mp4',
      subtitleRegionNormalized: region,
    }],
  };

  const snapshot = buildShellDataSnapshot({ shellProjects: [placeholder, unrelated] }, [makeJob()]);
  const project = snapshot.projects.find((item) => item.id === 'subtitle-project');
  const untouched = snapshot.projects.find((item) => item.id === 'video-generation-project');

  assert.equal(project?.status, 'completed');
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0]?.videoUrl, '/api/assets/file/subtitle-result.mp4');
  assert.equal(untouched?.results[0]?.videoUrl, '/api/assets/file/generated.mp4');
  assert.equal(untouched?.subFeature, 'generation');
});
