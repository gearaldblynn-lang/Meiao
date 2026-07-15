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
    batchId: 'subtitle-project',
    batchIndex: 0,
    batchCount: 1,
    shellResultId: 'subtitle-project-result-0',
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
  assert.equal(project?.results[0]?.errorCode, 'subtitle_provider_busy');
  assert.equal(project?.results[0]?.sourceUrl, '/api/assets/file/source-video.mp4');
  assert.deepEqual(project?.results[0]?.subtitleRegionNormalized, region);
});

test('persisted locally failed batch item keeps the metadata required for retry after refresh', () => {
  const failedResult = {
    id: 'subtitle-project-result-0',
    imageUrl: '',
    videoUrl: '',
    mediaType: 'video',
    prompt: '去除选定区域内的视频字幕',
    model: 'Golden 去字幕',
    aspectRatio: 'auto',
    status: 'error',
    createdAt: 1784073600000,
    module: 'video',
    subFeature: 'subtitle_removal',
    sourceUrl: '/api/assets/file/source-video.mp4',
    sourceProjectId: 'source-project',
    sourceResultId: 'source-result',
    fileName: 'source-video.mp4',
    batchId: 'subtitle-project',
    batchIndex: 0,
    batchCount: 3,
    subtitleRegionNormalized: region,
    subtitleRegionPixels: pixels,
    error: '耐久任务创建失败',
    errorCode: 'subtitle_job_create_failed',
    clientSubmissionKey: 'subtitle-removal-stable-key',
    draftNonce: 'draft-stable',
  };
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'subtitle-project',
      name: '7月15日项目1',
      module: 'video',
      subFeature: 'subtitle_removal',
      status: 'error',
      createdAt: 1784073600000,
      taskCount: 3,
      completedCount: 0,
      results: [failedResult],
    }],
  }, []);
  const restored = snapshot.projects.find((item) => item.id === 'subtitle-project')?.results[0];

  assert.equal(restored?.batchId, 'subtitle-project');
  assert.equal(restored?.batchIndex, 0);
  assert.equal(restored?.batchCount, 3);
  assert.equal(restored?.sourceProjectId, 'source-project');
  assert.equal(restored?.sourceResultId, 'source-result');
  assert.equal(restored?.errorCode, 'subtitle_job_create_failed');
  assert.equal(restored?.clientSubmissionKey, 'subtitle-removal-stable-key');
  assert.equal(restored?.draftNonce, 'draft-stable');
  assert.deepEqual(restored?.subtitleRegionNormalized, region);
  assert.deepEqual(restored?.subtitleRegionPixels, pixels);
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

test('subtitle batch hydrates into one ordered project with active and partial terminal states', () => {
  const makeBatchJob = (batchIndex, status) => makeJob({
    id: `subtitle-job-${batchIndex}`,
    status,
    providerTaskId: status === 'running' ? '' : `golden-task-${batchIndex}`,
    payload: {
      ...makeJob().payload,
      sourceUrl: `/api/assets/file/source-video-${batchIndex}.mp4`,
      batchId: 'subtitle-project',
      batchIndex,
      batchCount: 3,
      shellResultId: `subtitle-project-result-${batchIndex}`,
    },
    result: status === 'succeeded' ? {
      videoUrl: `/api/assets/file/subtitle-result-${batchIndex}.mp4`,
      subtitleRegionPixels: pixels,
    } : null,
    errorCode: status === 'failed' ? 'subtitle_provider_busy' : '',
    errorMessage: status === 'failed' ? '去字幕服务繁忙，请稍后重试' : '',
    finishedAt: status === 'running' ? null : 1784073660000 + batchIndex,
  });

  const activeSnapshot = buildShellDataSnapshot({}, [
    makeBatchJob(2, 'running'),
    makeBatchJob(0, 'succeeded'),
    makeBatchJob(1, 'failed'),
  ]);
  const activeProjects = activeSnapshot.projects.filter((item) => item.id === 'subtitle-project');
  assert.equal(activeProjects.length, 1);
  assert.deepEqual(
    activeProjects[0].results.map((result) => result.id),
    ['subtitle-project-result-0', 'subtitle-project-result-1', 'subtitle-project-result-2'],
  );
  assert.deepEqual(activeProjects[0].results.map((result) => result.batchIndex), [0, 1, 2]);
  assert.equal(activeProjects[0].taskCount, 3);
  assert.equal(activeProjects[0].completedCount, 1);
  assert.equal(activeProjects[0].status, 'generating');

  const terminalSnapshot = buildShellDataSnapshot({}, [
    makeBatchJob(2, 'succeeded'),
    makeBatchJob(0, 'succeeded'),
    makeBatchJob(1, 'failed'),
  ]);
  const terminalProject = terminalSnapshot.projects.find((item) => item.id === 'subtitle-project');
  assert.equal(terminalProject?.results.length, 3);
  assert.equal(terminalProject?.taskCount, 3);
  assert.equal(terminalProject?.completedCount, 2);
  assert.equal(terminalProject?.status, 'error');
});
