import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPersistedAppState, createDefaultOneClickState, createDefaultVideoState } from './appState.ts';
import { buildShellDataSnapshot } from '../adapters/shellDataAdapter.ts';
import { collectStoryboardBoardJobIds } from '../shell/modules/Video/storyboardProjectActions.mjs';
import {
  applyPersistedDeletionTombstones,
  pruneKnownLegacyGarbageFromPersistedState,
  prunePersistedAppStateForDeletion,
} from './persistedDeletion.ts';

test('prunePersistedAppStateForDeletion removes deleted one-click result cards from persisted snapshots', () => {
  const defaultOneClick = createDefaultOneClickState();
  const state = buildPersistedAppState({
    oneClickMemory: {
      ...defaultOneClick,
      firstImage: {
        ...defaultOneClick.firstImage,
        projects: [
          {
            id: 'first-project',
            name: '首图项目',
            createdAt: 1,
            updatedAt: 1,
            productImages: [],
            logoImage: null,
            uploadedLogoUrl: null,
            styleImage: null,
            designReferences: [],
            uploadedDesignReferenceUrls: [],
            referenceDimensions: defaultOneClick.firstImage.referenceDimensions,
            referenceAnalysis: { status: 'idle', summary: '', analyzedAt: null },
            schemes: [
              { id: 'scheme-a', status: 'completed', resultUrl: '/a.png', prompt: 'A', selected: true },
              { id: 'scheme-b', status: 'completed', resultUrl: '/b.png', prompt: 'B', selected: true },
            ],
            config: defaultOneClick.firstImage.config,
            lastStyleUrl: null,
            uploadedProductUrls: [],
            directions: [],
          },
        ],
        activeProjectId: 'first-project',
      },
    },
  });

  const pruned = prunePersistedAppStateForDeletion(state, { projectId: 'first-project', resultId: 'scheme-a' });
  const snapshot = buildShellDataSnapshot(pruned, []);
  const project = snapshot.projects.find((item) => item.id === 'first-project');

  assert.ok(project);
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0].id, 'scheme-b');
});

test('prunePersistedAppStateForDeletion clears video diagnosis cards when removed', () => {
  const state = buildPersistedAppState({
    videoMemory: createDefaultVideoState(),
  });
  state.videoMemory.diagnosis.aiAnalysis = {
    status: 'success',
    summary: '分析完成',
    overallRisk: 'low',
    sections: [],
    topActions: [],
    error: '',
    completedAt: Date.now(),
  };
  state.videoMemory.diagnosis.report = {
    status: 'success',
    summary: '报告完成',
    evidence: [],
    inferences: [],
    actions: [],
  };
  state.videoMemory.diagnosis.probe = {
    status: 'success',
    sources: [],
    fields: [],
    raw: null,
    normalized: null,
    missingCriticalFields: [],
    error: '',
    completedAt: Date.now(),
  };

  const pruned = prunePersistedAppStateForDeletion(state, { projectId: 'video-diagnosis-result' });
  const snapshot = buildShellDataSnapshot(pruned, []);

  assert.equal(snapshot.projects.find((item) => item.id === 'video-diagnosis-result'), undefined);
  assert.equal(pruned.videoMemory.diagnosis.aiAnalysis.status, 'idle');
  assert.equal(pruned.videoMemory.diagnosis.report.status, 'idle');
});

test('storyboard project deletion prunes durable state and tombstones prevent job hydration from restoring it', () => {
  const videoMemory = createDefaultVideoState();
  const projectId = 'video_1781075783802_0_gslt';
  const backendJobId = 'storyboard-image-backend-job';
  videoMemory.storyboard.projects = [{
    id: projectId,
    name: '爆款复刻方案1',
    config: videoMemory.storyboard.config,
    status: 'failed',
    script: '分镜生成失败',
    shots: [{ id: 'shot-1', description: '商品特写', scriptContent: '商品特写', prompt: 'product close-up' }],
    boards: [{
      id: 'board-1',
      title: '分镜1',
      shotIds: ['shot-1'],
      scriptText: '商品特写',
      prompt: 'product close-up',
      taskId: 'provider-task-1',
      status: 'failed',
      error: '生成失败',
    }],
    planningTaskId: 'planning-provider-task',
    createdAt: 1781075783802,
    error: '生成失败',
  }];
  const state = buildPersistedAppState({ videoMemory });

  const pruned = prunePersistedAppStateForDeletion(state, { projectId, jobIds: [backendJobId] });
  pruned.shellDraft = {
    ...pruned.shellDraft,
    deletedProjectIds: [projectId],
    deletedJobIds: [backendJobId],
  };
  const snapshot = buildShellDataSnapshot(pruned, [{
    id: backendJobId,
    module: 'video',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'failed',
    providerTaskId: 'provider-task-1',
    payload: {
      shellProjectId: projectId,
      shellProjectName: '爆款复刻方案1',
      subFeature: 'storyboard',
      prompt: 'product close-up',
    },
    errorMessage: '生成失败',
    createdAt: 1781075783900,
  }]);

  assert.equal(pruned.videoMemory.storyboard.projects.some((project) => project.id === projectId), false);
  assert.equal(snapshot.projects.some((project) => project.id === projectId), false);
  assert.equal(snapshot.projects.some((project) => project.backendJobId === backendJobId), false);
});

test('prunePersistedAppStateForDeletion removes generic shell project cards', () => {
  const state = buildPersistedAppState({
    shellProjects: [{
      id: 'retouch-project-1',
      name: '产品精修项目',
      module: 'retouch',
      status: 'completed',
      createdAt: '05-13',
      results: [
        { id: 'retouch-result-a', imageUrl: '/a.png', prompt: 'A', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-13', module: 'retouch' },
        { id: 'retouch-result-b', imageUrl: '/b.png', prompt: 'B', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-13', module: 'retouch' },
      ],
      taskCount: 2,
      completedCount: 2,
      subFeature: 'original',
    }],
  });

  const oneResultPruned = prunePersistedAppStateForDeletion(state, { projectId: 'retouch-project-1', resultId: 'retouch-result-a' });
  let snapshot = buildShellDataSnapshot(oneResultPruned, []);
  let project = snapshot.projects.find((item) => item.id === 'retouch-project-1');
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0].id, 'retouch-result-b');

  const projectPruned = prunePersistedAppStateForDeletion(oneResultPruned, { projectId: 'retouch-project-1' });
  snapshot = buildShellDataSnapshot(projectPruned, []);
  project = snapshot.projects.find((item) => item.id === 'retouch-project-1');
  assert.equal(project, undefined);
});

test('targeted placeholder cleanup reconciles project counts after a recovered result', () => {
  const state = buildPersistedAppState({
    shellProjects: [{
      id: 'logo-project',
      name: 'Logo 项目',
      module: 'everything_replace',
      subFeature: 'logo_replace',
      status: 'error',
      taskCount: 2,
      completedCount: 1,
      error: 'Download download failed: 400',
      results: [
        {
          id: 'provider-task',
          taskId: 'provider-task',
          backendJobId: 'generation-job',
          status: 'completed',
          imageUrl: '/api/assets/file/final/result.png',
        },
        {
          id: 'task-placeholder-error',
          status: 'error',
          imageUrl: '',
        },
      ],
    }],
  });

  const pruned = prunePersistedAppStateForDeletion(state, {
    projectId: 'logo-project',
    resultId: 'task-placeholder-error',
    reconcileProjectCounts: true,
  });
  const project = pruned.shellProjects.find((item) => item.id === 'logo-project');

  assert.equal(project?.results.length, 1);
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.completedCount, 1);
  assert.equal(project?.status, 'completed');
  assert.equal(project?.error, undefined);
});

test('prunePersistedAppStateForDeletion removes pending result cards by backend job id', () => {
  const state = buildPersistedAppState({
    shellProjects: [{
      id: 'one-click-project',
      name: '一键生成项目',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-25',
      results: [
        {
          id: 'provider-result-a',
          backendJobId: 'backend-job-a',
          imageUrl: '',
          prompt: '结果待同步',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'generating',
          createdAt: '05-25',
          module: 'one_click',
        },
        {
          id: 'kept-result',
          backendJobId: 'backend-job-b',
          imageUrl: '/kept.png',
          prompt: '保留',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'completed',
          createdAt: '05-25',
          module: 'one_click',
        },
      ],
      taskCount: 2,
      completedCount: 1,
      subFeature: 'main_image',
    }],
  });

  const pruned = prunePersistedAppStateForDeletion(state, {
    projectId: 'one-click-project',
    resultId: 'task-img-123-pending-0',
    jobIds: ['backend-job-a'],
  });
  const snapshot = buildShellDataSnapshot(pruned, []);
  const project = snapshot.projects.find((item) => item.id === 'one-click-project');

  assert.ok(project);
  assert.deepEqual(project.results.map((result) => result.id), ['kept-result']);
});

test('storyboard result deletion keeps the board slot and sibling boards after hydration', () => {
  const videoMemory = createDefaultVideoState();
  videoMemory.storyboard.projects = [{
    id: 'storyboard-project',
    name: '双分镜项目',
    status: 'completed',
    config: videoMemory.storyboard.config,
    script: '测试脚本',
    shots: [],
    backendJobId: 'board-job-a',
    boards: [
      {
        id: 'board-a',
        title: '分镜 A',
        shotIds: [],
        scriptText: 'A',
        prompt: 'A prompt',
        imageUrl: '/a.png',
        status: 'completed',
        backendJobId: 'board-job-a',
        imageVersions: [{ id: 'a-v1', imageUrl: '/a.png', createdAt: 1 }],
      },
      {
        id: 'board-b',
        title: '分镜 B',
        shotIds: [],
        scriptText: 'B',
        prompt: 'B prompt',
        imageUrl: '/b.png',
        status: 'completed',
        backendJobId: 'board-job-b',
      },
    ],
    createdAt: 1,
  }];
  const jobs = [
    {
      id: 'board-job-old',
      module: 'video',
      taskType: 'kie_image',
      provider: 'kie',
      providerTaskId: 'provider-old',
      status: 'succeeded',
      payload: {
        shellProjectId: 'storyboard-project',
        planningPurpose: 'storyboard_board_image',
        boardId: 'board-a',
      },
      result: { imageUrl: '/old-a.png' },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'board-job-a',
      module: 'video',
      taskType: 'kie_image',
      provider: 'kie',
      providerTaskId: 'provider-new',
      status: 'succeeded',
      payload: {
        shellProjectId: 'storyboard-project',
        planningPurpose: 'storyboard_board_image',
        boardId: 'board-a',
      },
      result: { imageUrl: '/a.png' },
      createdAt: 2,
      updatedAt: 2,
    },
  ];
  const jobIds = collectStoryboardBoardJobIds(
    videoMemory.storyboard.projects[0],
    'board-a',
    { jobs },
  );
  const target = {
    projectId: 'storyboard-project',
    resultId: 'board-a',
    jobIds,
    preserveStoryboardBoardSlot: true,
  };
  const pruned = prunePersistedAppStateForDeletion(buildPersistedAppState({ videoMemory }), target);
  const tombstoned = applyPersistedDeletionTombstones(pruned, target);
  const snapshot = buildShellDataSnapshot(tombstoned, jobs);
  const project = snapshot.projects.find((item) => item.id === 'storyboard-project');
  const sourceProject = project?.storyboardSourceProject;

  assert.ok(project);
  assert.deepEqual(sourceProject?.boards.map((board) => board.id), ['board-a', 'board-b']);
  assert.equal(sourceProject?.boards[0].status, 'pending');
  assert.equal(sourceProject?.boards[0].autoResumeBlocked, true);
  assert.equal(sourceProject?.boards[0].imageUrl, undefined);
  assert.equal(sourceProject?.boards[0].backendJobId, undefined);
  assert.equal(sourceProject?.boards[1].imageUrl, '/b.png');
  assert.deepEqual(tombstoned.shellDraft?.deletedProjectIds, []);
  assert.deepEqual(tombstoned.shellDraft?.deletedResultIds, []);
  assert.deepEqual(tombstoned.shellDraft?.deletedJobIds, ['board-job-a', 'board-job-old']);
});

test('pruneKnownLegacyGarbageFromPersistedState removes the polluted local translation card only', () => {
  const state = buildPersistedAppState({
    shellProjects: [
      {
        id: 'x71k8b1fs',
        name: '58fb631330f14c75904f30807d893ff5.jpg',
        module: 'translation',
        status: 'completed',
        createdAt: '05-16',
        results: [{
          id: 'result-polluted',
          imageUrl: 'https://tempfile.example/file_00000000bb34722f9f44a038497df9fe.png',
          prompt: 'polluted',
          model: '旧任务',
          aspectRatio: 'auto',
          status: 'completed',
          createdAt: '05-16',
          module: 'translation',
          taskId: '20b6614861108842221f52272c654d92',
        }],
        taskCount: 1,
        completedCount: 1,
        subFeature: 'main',
      },
      {
        id: 'safe-translation-project',
        name: '正常出海翻译',
        module: 'translation',
        status: 'completed',
        createdAt: '05-16',
        results: [{
          id: 'safe-result',
          imageUrl: '/safe.png',
          prompt: 'safe',
          model: '旧任务',
          aspectRatio: 'auto',
          status: 'completed',
          createdAt: '05-16',
          module: 'translation',
        }],
        taskCount: 1,
        completedCount: 1,
        subFeature: 'main',
      },
    ],
    translationMemory: {
      main: {
        files: [
          { id: 'polluted-file', fileName: '58fb631330f14c75904f30807d893ff5.jpg', taskId: '20b6614861108842221f52272c654d92', status: 'completed', progress: 100 },
          { id: 'safe-file', fileName: 'normal.jpg', taskId: 'safe-task', status: 'completed', progress: 100 },
        ],
        isProcessing: false,
      },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
  });

  const pruned = pruneKnownLegacyGarbageFromPersistedState(state);
  const snapshot = buildShellDataSnapshot(pruned, []);

  assert.equal(snapshot.projects.some((project) => project.id === 'x71k8b1fs'), false);
  assert.equal(snapshot.projects.some((project) => project.id === 'safe-translation-project'), true);
  assert.equal(pruned.translationMemory.main.files.map((file) => file.id).join(','), 'safe-file');
});
