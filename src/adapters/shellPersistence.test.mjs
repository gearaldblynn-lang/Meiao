import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShellDataSnapshot } from './shellDataAdapter.ts';
import { upsertOneClickProjectIntoPersistedState, upsertShellProjectIntoPersistedState, upsertTranslationFilesIntoPersistedState } from './shellPersistence.ts';
import { buildPersistedAppState } from '../utils/appState.ts';

test('orphan completed backend media jobs do not hydrate ghost project cards', () => {
  const snapshot = buildShellDataSnapshot(buildPersistedAppState(), [{
    id: 'completed-image-job',
    userId: 'user-1',
    module: 'one_click',
    taskType: 'image_generation',
    provider: 'kie',
    status: 'succeeded',
    priority: 0,
    payload: {
      prompt: '设计意图：完全基于参考图内容修改调整',
      subFeature: 'first_image',
      count: 1,
      aspectRatio: '1:1',
      model: 'gpt-image-2',
    },
    providerTaskId: 'provider-task-1',
    result: {
      imageResultUrls: ['https://example.com/result.png'],
      creditsConsumed: 3,
    },
    errorCode: '',
    errorMessage: '',
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: Date.now(),
    cancelRequestedAt: null,
  }]);

  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.projects.length, 0);
});

test('shell data hydration treats providerTaskId as the visible kie task id', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'provider-task-project',
      name: '外部任务 ID 项目',
      module: 'retouch',
      status: 'completed',
      createdAt: '05-18',
      results: [{
        id: 'local-result-id',
        imageUrl: 'https://example.com/result.png',
        prompt: '精修结果',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'completed',
        createdAt: '05-18',
        module: 'retouch',
        providerTaskId: 'kie-provider-visible-id',
      }],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'original',
    }],
  }, []);

  assert.equal(snapshot.projects[0].results[0].taskId, 'kie-provider-visible-id');
});

test('shell persistence writes generated one-click projects to the matching subfeature branch', () => {
  const state = buildPersistedAppState({
    oneClickMemory: {
      firstImage: { projects: [] },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  });

  const nextState = upsertOneClickProjectIntoPersistedState(state, {
    id: 'proj-sku-1',
    name: 'SKU 项目',
    module: 'one_click',
    status: 'completed',
    createdAt: '05-08',
    completedAt: '05-08',
    results: [{
      id: 'sku-result-1',
      imageUrl: '/sku.png',
      prompt: '模块：一键主详\n子功能：sku\n用户需求：新款杯子 SKU 命名',
      model: 'Nano Banana 2',
      aspectRatio: '1:1',
      status: 'completed',
      createdAt: '05-08',
      module: 'one_click',
      subFeature: 'sku',
    }],
    taskCount: 1,
    completedCount: 1,
    subFeature: 'sku',
    generationContext: {
      prompt: 'SKU 组合 prompt',
      params: { ratio: '1:1', model: 'gpt-image-2' },
      materials: {
        product: [{
          id: 'mat-1',
          type: 'product',
          url: 'https://example.com/product.png',
          remoteUrl: 'https://example.com/product.png',
          fileName: 'product.png',
          subFeature: 'sku',
        }],
      },
    },
  });

  assert.equal(nextState.oneClickMemory.sku.projects.length, 1);
  assert.equal(nextState.oneClickMemory.firstImage.projects.length, 0);
  assert.equal(nextState.oneClickMemory.sku.projects[0].schemes[0].editedContent.includes('新款杯子 SKU 命名'), true);

  const snapshot = buildShellDataSnapshot(nextState, []);
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].subFeature, 'sku');
  assert.equal(snapshot.projects[0].results[0].prompt.includes('新款杯子 SKU 命名'), true);
  assert.equal(snapshot.projects[0].generationContext?.materials.product[0].remoteUrl, 'https://example.com/product.png');
});

test('shell persistence does not nest one-click branch history inside each saved project', () => {
  const state = buildPersistedAppState({
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'old-project',
          name: '旧项目',
          schemes: [],
        }],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  });

  const nextState = upsertOneClickProjectIntoPersistedState(state, {
    id: 'new-project',
    name: '新项目',
    module: 'one_click',
    status: 'planning',
    createdAt: '05-18',
    results: [],
    taskCount: 1,
    completedCount: 0,
    subFeature: 'first_image',
  });

  const savedProject = nextState.oneClickMemory.firstImage.projects.find((project) => project.id === 'new-project');
  assert.ok(savedProject);
  assert.equal(Object.hasOwn(savedProject, 'projects'), false);
  assert.equal(nextState.oneClickMemory.firstImage.projects.length, 2);
});

test('shell persistence preserves planning credits and generated kie task ids in one-click branches', () => {
  const state = buildPersistedAppState({
    oneClickMemory: {
      firstImage: { projects: [] },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  });

  const nextState = upsertOneClickProjectIntoPersistedState(state, {
    id: 'proj-main-credits',
    name: '主图积分项目',
    module: 'one_click',
    status: 'completed',
    createdAt: '05-17',
    completedAt: '05-17',
    creditsConsumed: 0.09,
    planningTaskId: 'planning-kie-dashboard-id',
    plans: [{
      id: 'plan-1',
      title: '方案 1',
      sellingPoints: [],
      sceneDescription: '',
      styleDirection: '',
      colorPalette: '',
      composition: '',
      textLayout: '方案内容',
      selected: true,
      schemeContent: '方案内容',
    }],
    results: [{
      id: 'generated-result-1',
      planId: 'plan-1',
      imageUrl: '/main.png',
      prompt: '主图 prompt',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      status: 'completed',
      createdAt: '05-17',
      module: 'one_click',
      subFeature: 'main_image',
      taskId: 'image-kie-dashboard-id',
      creditsConsumed: 3,
    }],
    taskCount: 1,
    completedCount: 1,
    subFeature: 'main_image',
  });

  const saved = nextState.oneClickMemory.mainImage.projects[0];
  assert.equal(saved.creditsConsumed, 0.09);
  assert.equal(saved.planningTaskId, 'planning-kie-dashboard-id');
  assert.equal(saved.schemes[0].taskId, 'image-kie-dashboard-id');
  assert.equal(saved.schemes[0].creditsConsumed, 3);

  const snapshot = buildShellDataSnapshot(nextState, []);
  const project = snapshot.projects.find((item) => item.id === 'proj-main-credits');
  assert.equal(project?.creditsConsumed, 0.09);
  assert.equal(project?.planningTaskId, 'planning-kie-dashboard-id');
  assert.equal(project?.results[0]?.taskId, 'image-kie-dashboard-id');
  assert.equal(project?.results[0]?.creditsConsumed, 3);
});

test('shell persistence strips inline base64 previews from translation files before shared storage', () => {
  const state = buildPersistedAppState({
    translationMemory: {
      main: { files: [], isProcessing: false },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
  });

  const nextState = upsertTranslationFilesIntoPersistedState(state, 'detail', [{
    id: 'large-preview-file',
    fileName: '详情.png',
    relativePath: '详情.png',
    status: 'completed',
    progress: 100,
    sourceUrl: 'https://example.com/source.png',
    sourcePreviewUrl: 'data:image/png;base64,' + 'a'.repeat(1024),
    resultUrl: 'https://example.com/result.png',
    prompt: '详情翻译',
    model: 'gpt-image-2',
    aspectRatio: '1:1',
    subFeature: 'detail',
  }]);

  assert.equal(nextState.translationMemory.detail.files[0].sourcePreviewUrl, '');
  assert.equal(nextState.translationMemory.detail.files[0].sourceUrl, 'https://example.com/source.png');
});

test('shell persistence stores generic module project cards so they survive refresh', () => {
  const state = buildPersistedAppState();
  const nextState = upsertShellProjectIntoPersistedState(state, {
    id: 'retouch-project-1',
    name: '产品精修项目',
    module: 'retouch',
    status: 'completed',
    createdAt: '05-13',
    completedAt: '05-13',
    results: [{
      id: 'retouch-result-1',
      imageUrl: 'https://example.com/retouch.png',
      prompt: '精修 prompt',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      status: 'completed',
      createdAt: '05-13',
      module: 'retouch',
      subFeature: 'original',
    }],
    taskCount: 1,
    completedCount: 1,
    subFeature: 'original',
  });

  assert.equal(nextState.shellProjects.length, 1);
  const snapshot = buildShellDataSnapshot(nextState, []);
  const project = snapshot.projects.find((item) => item.id === 'retouch-project-1');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.results[0]?.imageUrl, 'https://example.com/retouch.png');
  assert.equal(project?.results[0]?.prompt, '精修 prompt');
});

test('shell persistence stores failed project cards for refresh recovery', () => {
  const state = buildPersistedAppState();
  const nextState = upsertShellProjectIntoPersistedState(state, {
    id: 'buyer-show-failed',
    name: '买家秀失败项目',
    module: 'buyer_show',
    status: 'error',
    createdAt: '05-13',
    results: [{
      id: 'buyer-show-failed-result',
      imageUrl: '',
      prompt: '模型生成失败',
      model: 'gpt-image-2',
      aspectRatio: '9:16',
      status: 'error',
      createdAt: '05-13',
      module: 'buyer_show',
      subFeature: 'image',
    }],
    taskCount: 1,
    completedCount: 0,
    subFeature: 'image',
  });

  const snapshot = buildShellDataSnapshot(nextState, []);
  const project = snapshot.projects.find((item) => item.id === 'buyer-show-failed');
  assert.equal(project?.status, 'error');
  assert.equal(project?.results[0]?.status, 'error');
  assert.equal(project?.results[0]?.prompt, '模型生成失败');
});

test('shell persistence replaces an existing one-click project instead of duplicating it', () => {
  const state = buildPersistedAppState();
  const project = {
    id: 'proj-main-1',
    name: '主图项目',
    module: 'one_click',
    status: 'completed',
    createdAt: '05-08',
    completedAt: '05-08',
    results: [{
      id: 'main-result-1',
      imageUrl: '/main.png',
      prompt: '第一次主图 prompt',
      model: 'Nano Banana 2',
      aspectRatio: '1:1',
      status: 'completed',
      createdAt: '05-08',
      module: 'one_click',
      subFeature: 'main_image',
    }],
    taskCount: 1,
    completedCount: 1,
    subFeature: 'main_image',
  };

  const firstState = upsertOneClickProjectIntoPersistedState(state, project);
  const secondState = upsertOneClickProjectIntoPersistedState(firstState, {
    ...project,
    results: [{ ...project.results[0], prompt: '第二次主图 prompt' }],
  });

  assert.equal(secondState.oneClickMemory.mainImage.projects.length, 1);
  assert.equal(secondState.oneClickMemory.mainImage.projects[0].schemes[0].editedContent, '第二次主图 prompt');
});

test('shell persistence merges partial shell project updates without dropping sibling plans and results', () => {
  const plans = [1, 2, 3].map((index) => ({
    id: `plan-${index}`,
    title: `方案 ${index}`,
    sellingPoints: [],
    sceneDescription: `方案 ${index}`,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: '',
    selected: true,
    schemeContent: `方案 ${index}`,
  }));
  const state = buildPersistedAppState({
    shellProjects: [{
      id: 'detail-project-3',
      name: '5月27日项目7',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-27',
      subFeature: 'detail_page',
      plans,
      selectedPlanId: 'plan-1',
      taskCount: 3,
      completedCount: 2,
      results: [
        { id: 'provider-1', planId: 'plan-1', imageUrl: '/one.png', prompt: '一', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-27', module: 'one_click', subFeature: 'detail_page', taskId: 'provider-1' },
        { id: 'provider-2', planId: 'plan-2', imageUrl: '/two.png', prompt: '二', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-27', module: 'one_click', subFeature: 'detail_page', taskId: 'provider-2' },
      ],
    }],
  });

  const nextState = upsertShellProjectIntoPersistedState(state, {
    id: 'detail-project-3',
    name: '5月27日项目7',
    module: 'one_click',
    status: 'completed',
    createdAt: '05-27',
    subFeature: 'detail_page',
    plans: [plans[2]],
    selectedPlanId: 'plan-3',
    taskCount: 1,
    completedCount: 1,
    results: [
      { id: 'provider-3', planId: 'plan-3', imageUrl: '/three.png', prompt: '三', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-27', module: 'one_click', subFeature: 'detail_page', taskId: 'provider-3' },
    ],
  });

  const project = nextState.shellProjects[0];
  assert.equal(project.taskCount, 3);
  assert.equal(project.completedCount, 3);
  assert.equal(project.status, 'completed');
  assert.deepEqual(project.plans.map((plan) => plan.id), ['plan-3', 'plan-1', 'plan-2']);
  assert.deepEqual(project.results.map((result) => result.taskId), ['provider-3', 'provider-1', 'provider-2']);
});

test('shell persistence merges partial one-click branch updates without shrinking the visible selection set', () => {
  const plans = [1, 2, 3].map((index) => ({
    id: `branch-plan-${index}`,
    title: `详情方案 ${index}`,
    sellingPoints: [],
    sceneDescription: `详情方案 ${index}`,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: '',
    selected: true,
    schemeContent: `详情方案 ${index}`,
  }));
  const schemes = plans.map((plan, index) => ({
    id: plan.id,
    uiTitle: plan.title,
    editedContent: plan.schemeContent,
    originalContent: plan.schemeContent,
    selected: true,
    status: 'completed',
    resultUrl: `/detail-${index + 1}.png`,
    taskId: `provider-${index + 1}`,
  }));
  const state = buildPersistedAppState({
    oneClickMemory: {
      detailPage: {
        projects: [{
          id: 'detail-branch-project',
          name: '5月27日项目7',
          module: 'one_click',
          subFeature: 'detail_page',
          status: 'completed',
          taskCount: 3,
          completedCount: 3,
          plans,
          schemes,
        }],
        schemes,
      },
    },
  });

  const nextState = upsertOneClickProjectIntoPersistedState(state, {
    id: 'detail-branch-project',
    name: '5月27日项目7',
    module: 'one_click',
    status: 'completed',
    createdAt: '05-27',
    subFeature: 'detail_page',
    plans: [plans[2]],
    selectedPlanId: plans[2].id,
    taskCount: 1,
    completedCount: 1,
    results: [{
      id: 'provider-3-new',
      planId: plans[2].id,
      imageUrl: '/detail-3-new.png',
      prompt: '第 3 张修改',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      status: 'completed',
      createdAt: '05-27',
      module: 'one_click',
      subFeature: 'detail_page',
      taskId: 'provider-3-new',
    }],
  });

  const project = nextState.oneClickMemory.detailPage.projects[0];
  assert.equal(project.taskCount, 3);
  assert.equal(project.schemes.length, 3);
  assert.equal(project.plans.length, 3);
  assert.equal(nextState.oneClickMemory.detailPage.schemes.length, 3);
});

test('shell persistence stores translation files into the matching branch so completed cards survive refresh', () => {
  const state = buildPersistedAppState({
    translationMemory: {
      main: { files: [], isProcessing: false },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
  });

  const nextState = upsertTranslationFilesIntoPersistedState(state, 'main', [
    {
      id: 'translation-file-1',
      fileName: 'folder-a.png',
      relativePath: 'folder-a.png',
      status: 'completed',
      progress: 100,
      sourceUrl: 'https://example.com/source-a.png',
      sourcePreviewUrl: 'https://example.com/source-a.png',
      resultUrl: 'https://example.com/result-a.png',
      matchedAspectRatio: '1:1',
      prompt: '主图出海结果 A',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      subFeature: 'main',
    },
    {
      id: 'translation-file-2',
      fileName: 'folder-b.png',
      relativePath: 'folder-b.png',
      status: 'pending',
      progress: 12,
      sourceUrl: 'https://example.com/source-b.png',
      sourcePreviewUrl: 'https://example.com/source-b.png',
      prompt: '主图出海结果 B',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      subFeature: 'main',
    },
  ]);

  assert.equal(nextState.translationMemory.main.files.length, 2);
  assert.equal(nextState.translationMemory.main.isProcessing, true);

  const snapshot = buildShellDataSnapshot(nextState, []);
  const firstProject = snapshot.projects.find((project) => project.id === 'translation-file-1');
  const secondProject = snapshot.projects.find((project) => project.id === 'translation-file-2');

  assert.equal(firstProject?.status, 'completed');
  assert.equal(firstProject?.results[0]?.imageUrl, 'https://example.com/result-a.png');
  assert.equal(secondProject?.status, 'generating');
  assert.equal(secondProject?.results.length, 0);
});

test('shell persistence restores video storyboard projects with board prompts and scripts', () => {
  const state = buildPersistedAppState({
    videoMemory: {
      storyboard: {
        projects: [{
          id: 'storyboard-project-1',
          name: '爆款复刻方案 1',
          status: 'completed',
          createdAt: 1778670000000,
          script: '完整脚本',
          config: {
            model: 'gpt-image-2',
            aspectRatio: '9:16',
          },
          shots: [],
          boards: [{
            id: 'board-1',
            title: '分段一',
            status: 'completed',
            imageUrl: 'https://example.com/storyboard-1.png',
            prompt: '宫格分镜图 prompt',
            scriptText: '动态脚本',
            dynamicScriptPrompt: '动态视频脚本提示词',
            shotIds: [],
          }],
        }],
      },
    },
  });

  const snapshot = buildShellDataSnapshot(state, []);
  const project = snapshot.projects.find((item) => item.id === 'storyboard-project-1');

  assert.equal(project?.status, 'completed');
  assert.equal(project?.subFeature, 'storyboard');
  assert.equal(project?.results[0]?.imageUrl, 'https://example.com/storyboard-1.png');
  assert.equal(project?.results[0]?.prompt.includes('宫格分镜图 prompt'), true);
});

test('shell persistence keeps translation files from one submit under one project id', () => {
  const state = buildPersistedAppState({
    translationMemory: {
      main: { files: [], isProcessing: false },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
  });

  const nextState = upsertTranslationFilesIntoPersistedState(state, 'detail', [
    {
      id: 'translation-file-a',
      fileName: 'folder-a/source-a.png',
      relativePath: 'folder-a/source-a.png',
      status: 'completed',
      progress: 100,
      sourceUrl: 'https://example.com/source-a.png',
      sourcePreviewUrl: 'https://example.com/source-a.png',
      resultUrl: 'https://example.com/result-a.png',
      matchedAspectRatio: '3:4',
      prompt: '详情出海结果 A',
      model: 'gpt-image-2',
      aspectRatio: 'auto',
      subFeature: 'detail',
      taskId: 'job-a',
      projectId: 'batch-1',
      projectName: '详情翻译批次 1',
    },
    {
      id: 'translation-file-b',
      fileName: 'folder-b/source-b.png',
      relativePath: 'folder-b/source-b.png',
      status: 'error',
      progress: 100,
      sourceUrl: 'https://example.com/source-b.png',
      sourcePreviewUrl: 'https://example.com/source-b.png',
      error: '生成失败',
      prompt: '详情出海结果 B',
      model: 'gpt-image-2',
      aspectRatio: 'auto',
      subFeature: 'detail',
      taskId: 'job-b',
      projectId: 'batch-1',
      projectName: '详情翻译批次 1',
    },
  ]);

  const snapshot = buildShellDataSnapshot(nextState, []);
  const projects = snapshot.projects.filter((project) => project.id.startsWith('batch-1'));

  assert.equal(projects.length, 1);
  assert.equal(projects[0].taskCount, 2);
  assert.equal(projects[0].completedCount, 1);
  assert.equal(projects[0].results.length, 2);
  assert.equal(projects[0].results[0].imageUrl, 'https://example.com/result-a.png');
  assert.equal(projects[0].results[0].subFeature, 'detail');
  assert.equal(projects[0].results[1].status, 'error');
});

test('shell persistence merges translation batches instead of replacing old history', () => {
  const state = buildPersistedAppState({
    translationMemory: {
      main: {
        files: [{
          id: 'old-file',
          fileName: 'old.png',
          relativePath: 'old.png',
          status: 'completed',
          progress: 100,
          sourceUrl: 'https://example.com/old-source.png',
          sourcePreviewUrl: 'https://example.com/old-source.png',
          resultUrl: 'https://example.com/old-result.png',
          prompt: '历史记录',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          subFeature: 'main',
          projectId: 'old-project',
          projectName: '旧项目',
        }],
        isProcessing: false,
      },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
  });

  const nextState = upsertTranslationFilesIntoPersistedState(state, 'main', [
    {
      id: 'new-file',
      fileName: 'new.png',
      relativePath: 'folder/new.png',
      status: 'pending',
      progress: 10,
      sourceUrl: 'https://example.com/new-source.png',
      sourcePreviewUrl: 'https://example.com/new-source.png',
      prompt: '新任务',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      subFeature: 'main',
      projectId: 'new-project',
      projectName: '新项目',
    },
  ]);

  const snapshot = buildShellDataSnapshot(nextState, []);
  assert.equal(snapshot.projects.some((project) => project.id === 'old-project'), true);
  assert.equal(snapshot.projects.some((project) => project.id === 'new-project'), true);
});
