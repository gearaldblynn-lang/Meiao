import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPersistedAppState, createDefaultOneClickState, createDefaultVideoState } from './appState.ts';
import { buildShellDataSnapshot } from '../adapters/shellDataAdapter.ts';
import { pruneKnownLegacyGarbageFromPersistedState, prunePersistedAppStateForDeletion } from './persistedDeletion.ts';

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
