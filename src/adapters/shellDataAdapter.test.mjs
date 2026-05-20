import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShellDataSnapshot } from './shellDataAdapter.ts';

test('shell data adapter keeps one-click submodule projects separated', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          { id: 'first-project', name: '首图项目', schemes: [{ id: 'first-result', status: 'completed', resultUrl: '/first.png', prompt: 'first' }] },
        ],
      },
      mainImage: {
        projects: [
          { id: 'main-project', name: '主图项目', schemes: [{ id: 'main-result', status: 'completed', resultUrl: '/main.png', prompt: 'main' }] },
        ],
      },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  assert.equal(snapshot.projects.find((project) => project.id === 'first-project')?.subFeature, 'first_image');
  assert.equal(snapshot.projects.find((project) => project.id === 'main-project')?.subFeature, 'main_image');
});

test('shell data adapter splits legacy mixed one-click projects by result subfeature', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          {
            id: 'mixed-project',
            name: '旧混合项目',
            schemes: [
              { id: 'first-result', status: 'completed', resultUrl: '/first.png', subFeature: 'first_image' },
              { id: 'main-result', status: 'completed', resultUrl: '/main.png', subFeature: 'main_image', prompt: '子功能：main_image\n主图任务' },
              { id: 'detail-result', status: 'completed', resultUrl: '/detail.png', subFeature: 'detail_page', originalContent: '详情页生成提示' },
              { id: 'sku-result', status: 'completed', resultUrl: '/sku.png', subMode: 'sku' },
            ],
          },
        ],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  const mixedProjects = snapshot.projects
    .filter((project) => project.id.startsWith('mixed-project'))
    .sort((a, b) => String(a.subFeature).localeCompare(String(b.subFeature)));

  assert.deepEqual(mixedProjects.map((project) => project.subFeature), [
    'detail_page',
    'first_image',
    'main_image',
    'sku',
  ]);
  assert.ok(mixedProjects.every((project) => project.results.length === 1));
  assert.ok(mixedProjects.every((project) => project.results[0].subFeature === project.subFeature));
});

test('shell data adapter keeps persisted one-click projects inside their saved branch when results lack explicit subfeature', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          {
            id: 'branch-project',
            name: '首图项目 1',
            schemes: [
              { id: 'saved-first', status: 'completed', resultUrl: '/first.png', prompt: '首图裂变方案' },
              { id: 'saved-main', status: 'completed', resultUrl: '/main.png', prompt: '主图卖点展示' },
            ],
          },
        ],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  const branchProjects = snapshot.projects.filter((project) => project.id.startsWith('branch-project'));
  assert.equal(branchProjects.length, 1);
  assert.equal(branchProjects[0].subFeature, 'first_image');
  assert.equal(branchProjects[0].results.length, 2);
});

test('shell data adapter maps persisted one-click scheme ids onto result plan ids', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      detailPage: {
        projects: [
          {
            id: 'detail-project',
            name: '详情项目',
            plans: [
              { id: 'plan-a', title: '第1页', selected: true },
              { id: 'plan-b', title: '第2页', selected: true },
            ],
            schemes: [
              { id: 'plan-a', status: 'completed', resultUrl: '/a.png', editedContent: '第1页方案' },
              { id: 'plan-b', status: 'completed', resultUrl: '/b.png', editedContent: '第2页方案' },
            ],
          },
        ],
      },
      firstImage: { projects: [] },
      mainImage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'detail-project');
  assert.deepEqual(project?.results.map((result) => result.planId), ['plan-a', 'plan-b']);
  assert.equal(project?.results[1].imageUrl, '/b.png');
});

test('shell data adapter preserves one-click persisted project order from the saved branch', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          { id: 'first-1', name: '首图项目 1', createdAt: 1000, updatedAt: 3000, schemes: [{ id: 'result-1', status: 'completed', resultUrl: '/1.png' }] },
          { id: 'first-2', name: '首图项目 2', createdAt: 2000, updatedAt: 1000, schemes: [{ id: 'result-2', status: 'completed', resultUrl: '/2.png' }] },
          { id: 'first-3', name: '首图项目 3', createdAt: 3000, updatedAt: 2000, schemes: [{ id: 'result-3', status: 'completed', resultUrl: '/3.png' }] },
        ],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  assert.deepEqual(snapshot.projects.map((project) => project.id), ['first-1', 'first-2', 'first-3']);
});

test('shell data adapter backfills one-click generation context from saved branch config and materials', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        config: {
          aspectRatio: '1:1',
          model: 'gpt-image-2',
          quality: '1k',
          resolutionMode: 'custom',
          targetWidth: 800,
          targetHeight: 800,
        },
        uploadedProductUrls: ['https://example.com/product.png'],
        uploadedDesignReferenceUrls: ['https://example.com/reference.png'],
        projects: [
          { id: 'ctx-project', name: '上下文项目', schemes: [{ id: 'ctx-result', status: 'completed', resultUrl: '/ctx.png' }] },
        ],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  assert.equal(snapshot.projects[0].generationContext?.params.ratio, '1:1');
  assert.equal(snapshot.projects[0].generationContext?.materials.product[0].remoteUrl, 'https://example.com/product.png');
});

test('shell data adapter does not create synthetic current one-click project cards from branch schemes', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          { id: 'saved-project', name: '首图项目', schemes: [{ id: 'saved-result', status: 'completed', resultUrl: '/saved.png' }] },
        ],
        schemes: [
          { id: 'current-result', status: 'completed', resultUrl: '/current.png', prompt: '当前首图方案' },
        ],
      },
      mainImage: { projects: [], schemes: [{ id: 'main-current', status: 'completed', prompt: '当前主图方案' }] },
      detailPage: { projects: [], schemes: [] },
      sku: { projects: [], schemes: [] },
    },
  }, []);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].id, 'saved-project');
  assert.equal(snapshot.projects.find((project) => project.id.startsWith('one-click-current-')), undefined);
});

test('shell data adapter keeps translation submode files separated from backend jobs', () => {
  const snapshot = buildShellDataSnapshot({
    translationMemory: {
      main: { files: [{ id: 'main-file', fileName: 'main.png', status: 'completed', resultUrl: '/main-translated.png' }] },
      detail: { files: [{ id: 'detail-file', fileName: 'detail.png', status: 'completed', resultUrl: '/detail-translated.png' }] },
      removeText: { files: [{ id: 'remove-file', fileName: 'remove.png', status: 'completed', resultUrl: '/remove.png' }] },
    },
  }, [
    {
      id: 'job-1',
      module: 'translation',
      taskType: 'remove_text',
      provider: 'kie',
      status: 'running',
      payload: { prompt: 'remove copy' },
      result: null,
      createdAt: Date.now(),
    },
  ]);

  assert.equal(snapshot.projects.find((project) => project.id === 'main-file')?.subFeature, 'main');
  assert.equal(snapshot.projects.find((project) => project.id === 'detail-file')?.subFeature, 'detail');
  assert.equal(snapshot.projects.find((project) => project.id === 'remove-file')?.subFeature, 'remove_text');
  assert.equal(snapshot.tasks.find((task) => task.id === 'job-1')?.subFeature, 'remove_text');
});

test('shell data adapter preserves translation source metadata on restored results', () => {
  const snapshot = buildShellDataSnapshot({
    translationMemory: {
      main: {
        files: [{
          id: 'translation-batch-file-1',
          fileName: 'nested/folder/source-a.png',
          relativePath: 'nested/folder/source-a.png',
          status: 'completed',
          progress: 100,
          sourceUrl: 'https://example.com/source-a.png',
          sourcePreviewUrl: 'https://example.com/source-a.png',
          resultUrl: 'https://example.com/result-a.png',
          matchedAspectRatio: '3:4',
          prompt: '翻译结果 A',
          model: 'gpt-image-2',
          aspectRatio: 'auto',
          subFeature: 'main',
          projectId: 'translation-batch-1',
          projectName: '主图出海批次 1',
        }],
      },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'translation-batch-1');
  assert.equal(project?.results[0]?.sourceUrl, 'https://example.com/source-a.png');
  assert.equal(project?.results[0]?.relativePath, 'nested/folder/source-a.png');
  assert.equal(project?.results[0]?.aspectRatio, '3:4');
});

test('shell data adapter preserves provider task ids and consumed credits for project cards', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'persisted-project',
      name: '已保存项目',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-16',
      taskCount: 1,
      completedCount: 1,
      creditsConsumed: 3.03,
      planningTaskId: 'planning-kie-task-id',
      results: [{
        id: 'result-1',
        imageUrl: '/result.png',
        prompt: '主图',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'completed',
        createdAt: '05-16',
        module: 'one_click',
        taskId: 'kie-visible-task-id',
        creditsConsumed: 3,
      }],
    }],
  }, []);

  assert.equal(snapshot.projects[0]?.creditsConsumed, 3.03);
  assert.equal(snapshot.projects[0]?.planningTaskId, 'planning-kie-task-id');
  assert.equal(snapshot.projects[0]?.results[0]?.taskId, 'kie-visible-task-id');
  assert.equal(snapshot.projects[0]?.results[0]?.creditsConsumed, 3);
});

test('shell data adapter restores one-click planning credits from saved projects', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'planning-credits-project',
          name: '策划积分项目',
          creditsConsumed: 0.03,
          planningTaskId: 'planning-kie-chat-id',
          plans: [{ id: 'plan-1', title: '方案1', selected: true }],
          schemes: [{ id: 'plan-1', status: 'completed' }],
        }],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'planning-credits-project');
  assert.equal(project?.creditsConsumed, 0.03);
  assert.equal(project?.planningTaskId, 'planning-kie-chat-id');
});

test('shell data adapter drops idle persisted items that have no result, error, running state, or plans', () => {
  const snapshot = buildShellDataSnapshot({
    translationMemory: {
      main: {
        files: [{
          id: 'empty-legacy-file',
          fileName: 'empty.png',
          status: 'completed',
          progress: 100,
        }],
      },
      detail: { files: [], isProcessing: false },
      removeText: { files: [], isProcessing: false },
    },
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'planning-project',
          name: '待确认策划',
          plans: [{ id: 'plan-1', title: '方案1', selected: true }],
          schemes: [{ id: 'plan-1', status: 'completed' }],
        }],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  assert.equal(snapshot.projects.some((project) => project.id === 'empty-legacy-file'), false);
  assert.equal(snapshot.projects.some((project) => project.id === 'planning-project'), true);
});

test('shell data adapter does not synthesize untracked one-click image jobs during refresh', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          { id: 'persisted-first', name: '账号持久化首图项目', schemes: [{ id: 'first-result', status: 'completed', resultUrl: '/first.png' }] },
        ],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, [
    {
      id: 'old-job-first',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      payload: { prompt: '旧首图任务', subFeature: 'first_image' },
      result: { imageUrl: '/old-first.png' },
      createdAt: Date.now(),
    },
    {
      id: 'running-job-main',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      payload: { prompt: '正在生成主图', subFeature: 'main_image' },
      result: null,
      createdAt: Date.now(),
    },
  ]);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects.find((project) => project.id === 'persisted-first')?.subFeature, 'first_image');
  assert.equal(snapshot.projects.some((project) => project.id === 'job-old-job-first'), false);
  assert.equal(snapshot.projects.some((project) => project.id === 'job-running-job-main'), false);
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter does not let completed planning jobs override persisted one-click image results', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      detailPage: {
        projects: [
          {
            id: 'completed-detail-project',
            name: '已出图详情项目',
            planningTaskId: 'planning-provider-id',
            schemes: [
              { id: 'plan-1', status: 'completed', resultUrl: '/detail-1.png', taskId: 'image-task-1' },
              { id: 'plan-2', status: 'completed', resultUrl: '/detail-2.png', taskId: 'image-task-2' },
            ],
          },
        ],
      },
      firstImage: { projects: [] },
      mainImage: { projects: [] },
      sku: { projects: [] },
    },
  }, [
    {
      id: 'planning-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'planning-provider-id',
      payload: { projectId: 'completed-detail-project', subFeature: 'detail_page' },
      result: { content: '[SCHEME_START]\n- 屏序/类型：第1页\n[SCHEME_END]' },
      createdAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'completed-detail-project');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.results.length, 2);
  assert.deepEqual(project?.results.map((result) => result.planId), ['plan-1', 'plan-2']);
});

test('shell data adapter does not synthesize orphan terminal failed image jobs', () => {
  const snapshot = buildShellDataSnapshot({}, [
    {
      id: 'old-failed-image-job',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'failed',
      payload: { prompt: '【硬约束】历史失败任务', subFeature: 'first_image' },
      result: null,
      errorCode: 'service_restarted',
      errorMessage: '服务重启导致任务中断',
      createdAt: 1000,
      updatedAt: 2000,
    },
  ]);

  assert.equal(snapshot.projects.some((item) => item.id === 'job-old-failed-image-job'), false);
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter reconnects terminal failed image jobs only to persisted placeholders', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'failed-placeholder',
      backendJobId: 'failed-image-job',
      name: '正在生成的首图',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-18',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
    }],
  }, [
    {
      id: 'failed-image-job',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'failed',
      payload: { prompt: '【硬约束】当前失败任务', subFeature: 'first_image' },
      result: null,
      errorCode: 'provider_bad_request',
      errorMessage: '上游明确返回失败',
      createdAt: 1000,
      updatedAt: 2000,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'failed-placeholder');
  assert.equal(project?.status, 'error');
  assert.equal(project?.backendJobId, 'failed-image-job');
  assert.equal(project?.results[0]?.status, 'error');
  assert.equal(project?.results[0]?.error, '上游明确返回失败');
  assert.equal(snapshot.projects.some((item) => item.id === 'job-failed-image-job'), false);
});

test('shell data adapter merges completed one-click image jobs by payload project and plan id', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'persisted-plan-project',
      name: '首图策划项目',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-19',
      results: [],
      plans: [{
        id: 'plan-1',
        title: '首图裂变1',
        sellingPoints: [],
        sceneDescription: '方案内容',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
        schemeContent: '方案内容',
      }],
      selectedPlanId: 'plan-1',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
    }],
  }, [
    {
      id: 'image-job-with-project-id',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'provider-image-task',
      payload: {
        prompt: '【硬约束】首图生成提示词',
        shellProjectId: 'persisted-plan-project',
        shellPlanId: 'plan-1',
        subFeature: 'first_image',
        batchIndex: 1,
        batchCount: 1,
      },
      result: {
        imageUrl: '/generated-first.png',
        creditsConsumed: 5,
      },
      createdAt: 2000,
      updatedAt: 3000,
      finishedAt: 3000,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'persisted-plan-project');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.backendJobId, 'image-job-with-project-id');
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0]?.planId, 'plan-1');
  assert.equal(project?.results[0]?.taskId, 'provider-image-task');
  assert.equal(project?.results[0]?.backendJobId, 'image-job-with-project-id');
  assert.equal(project?.results[0]?.imageUrl, '/generated-first.png');
  assert.equal(snapshot.projects.some((item) => item.id === 'job-image-job-with-project-id'), false);
});

test('shell data adapter accumulates multiple one-click image jobs for the same project without dropping partial successes', () => {
  const baseProject = {
    id: 'multi-plan-project',
    name: '首图六张批量',
    module: 'one_click',
    status: 'generating',
    createdAt: '05-19',
    results: [{
      id: 'provider-plan-2',
      planId: 'plan-2',
      imageUrl: '',
      prompt: '第二张待同步',
      model: 'gpt-image-2',
      aspectRatio: '1:1',
      status: 'generating',
      createdAt: '05-19',
      module: 'one_click',
      subFeature: 'first_image',
      taskId: 'provider-plan-2',
      backendJobId: 'job-plan-2',
    }],
    plans: ['plan-1', 'plan-2', 'plan-3'].map((id) => ({
      id,
      title: id,
      sellingPoints: [],
      sceneDescription: id,
      styleDirection: '',
      colorPalette: '',
      composition: '',
      textLayout: '',
      selected: true,
      schemeContent: id,
    })),
    selectedPlanId: 'plan-1',
    taskCount: 3,
    completedCount: 0,
    subFeature: 'first_image',
  };
  const makeJob = (id, planId, status, imageUrl = '') => ({
    id,
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    status,
    providerTaskId: `provider-${planId}`,
    payload: {
      prompt: `提示词 ${planId}`,
      shellProjectId: 'multi-plan-project',
      shellPlanId: planId,
      subFeature: 'first_image',
      batchIndex: Number(planId.slice(-1)),
      batchCount: 3,
    },
    result: imageUrl ? {
      imageUrl,
      providerTaskId: `provider-${planId}`,
      creditsConsumed: 3,
    } : {},
    errorMessage: status === 'failed' ? '第 3 张失败' : '',
    createdAt: 2000,
    updatedAt: 3000,
    finishedAt: 3000,
  });

  const snapshot = buildShellDataSnapshot({ shellProjects: [baseProject] }, [
    makeJob('job-plan-3', 'plan-3', 'failed'),
    makeJob('job-plan-2', 'plan-2', 'succeeded', '/plan-2.png'),
    makeJob('job-plan-1', 'plan-1', 'succeeded', '/plan-1.png'),
  ]);

  const project = snapshot.projects.find((item) => item.id === 'multi-plan-project');
  assert.equal(project?.status, 'error');
  assert.equal(project?.taskCount, 3);
  assert.equal(project?.completedCount, 2);
  assert.deepEqual(project?.results.map((result) => result.planId), ['plan-2', 'plan-3', 'plan-1']);
  assert.equal(project?.results.find((result) => result.planId === 'plan-2')?.imageUrl, '/plan-2.png');
  assert.equal(project?.results.find((result) => result.planId === 'plan-1')?.imageUrl, '/plan-1.png');
  assert.equal(project?.results.find((result) => result.planId === 'plan-3')?.status, 'error');
});

test('shell data adapter reconnects legacy one-click image jobs by exact scheme content only', () => {
  const schemeContent = '设计意图：完全基于参考图内容修改调整，把原强首图骨架改成信任收口图。';
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-project-with-scheme',
      name: '等待出图的首图项目',
      module: 'one_click',
      status: 'planning',
      createdAt: '05-19',
      results: [],
      plans: [{
        id: 'plan-exact',
        title: '首图裂变1',
        sellingPoints: [],
        sceneDescription: schemeContent,
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: schemeContent,
        selected: true,
        schemeContent,
      }],
      selectedPlanId: 'plan-exact',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
    }],
  }, [
    {
      id: 'legacy-image-job-with-scheme',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'provider-legacy-image',
      payload: {
        prompt: '【硬约束】旧代码提交的提示词',
        schemeContent,
        subFeature: 'first_image',
        batchIndex: 1,
        batchCount: 1,
      },
      result: {
        imageUrl: '/legacy-restored.png',
      },
      createdAt: 2000,
      updatedAt: 3000,
      finishedAt: 3000,
    },
    {
      id: 'planning-job-for-same-project',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: '',
      payload: {
        shellProjectId: 'planning-project-with-scheme',
        subFeature: 'first_image',
      },
      result: {
        content: `[SCHEME_START]
- 屏序/类型：首图裂变1
- 画面描述：${schemeContent}
[SCHEME_END]`,
      },
      createdAt: 1000,
      updatedAt: 1500,
      finishedAt: 1500,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'planning-project-with-scheme');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.results[0]?.planId, 'plan-exact');
  assert.equal(project?.results[0]?.imageUrl, '/legacy-restored.png');
  assert.equal(project?.results[0]?.backendJobId, 'legacy-image-job-with-scheme');
  assert.equal(snapshot.projects.some((item) => item.id === 'job-legacy-image-job-with-scheme'), false);
});

test('shell data adapter restores completed one-click planning jobs only into persisted placeholders', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-placeholder',
      name: '正在策划的首图',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-18',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-chat-job',
    }],
  }, [
    {
      id: 'planning-chat-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: { model: 'gemini-3-flash-openai' },
      result: {
        text: `[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考1
- 参考图标识：复刻主图参考1
- 设计意图：少甜也酥脆
- 画面描述：四宫格饼干口感展示
- 画面比例：1:1
[SCHEME_END]`,
        creditsConsumed: 0.47,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'planning-placeholder');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.subFeature, 'first_image');
  assert.equal(project?.plans?.length, 1);
  assert.equal(project?.plans?.[0]?.title, '首图裂变1-复刻主图参考1');
  assert.equal(project?.creditsConsumed, 0.47);
  assert.equal(project?.planningTaskId, 'planning-chat-job');
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter does not synthesize unpersisted completed planning jobs', () => {
  const planningResult = (title) => ({
    text: `[SCHEME_START]
- 屏序/类型：${title}
- 参考图标识：参考1
- 设计意图：保留最近一次策划
- 画面描述：单张主图
- 画面比例：1:1
[SCHEME_END]`,
  });
  const snapshot = buildShellDataSnapshot({}, [
    {
      id: 'new-planning-chat-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: { model: 'gemini-3-flash-openai' },
      result: planningResult('最新策划'),
      createdAt: 2000,
      updatedAt: 2100,
    },
    {
      id: 'old-planning-chat-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: { model: 'gemini-3-flash-openai' },
      result: planningResult('旧策划'),
      createdAt: 1000,
      updatedAt: 1100,
    },
  ]);

  assert.equal(snapshot.projects.some((item) => item.id === 'job-new-planning-chat-job'), false);
  assert.equal(snapshot.projects.some((item) => item.id === 'job-old-planning-chat-job'), false);
  assert.equal(snapshot.projects.filter((item) => item.status === 'planning').length, 0);
});

test('shell data adapter reconnects completed planning jobs by payload project id', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'persisted-before-job-id',
      name: '崩溃前已保存占位',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-18',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
    }],
  }, [
    {
      id: 'planning-job-created-after-placeholder',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: {
        model: 'gemini-3-flash-openai',
        shellProjectId: 'persisted-before-job-id',
        shellPlanningPurpose: 'one_click_planning',
      },
      result: {
        text: `[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考1
- 参考图标识：复刻主图参考1
- 设计意图：恢复到原项目占位
- 画面描述：单张主图
- 画面比例：1:1
[SCHEME_END]`,
      },
      createdAt: 2000,
      updatedAt: 2100,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'persisted-before-job-id');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.backendJobId, 'planning-job-created-after-placeholder');
  assert.equal(project?.plans?.[0]?.title, '首图裂变1-复刻主图参考1');
  assert.equal(snapshot.projects.some((item) => item.id === 'job-planning-job-created-after-placeholder'), false);
});

test('shell data adapter does not restore jobs hidden by deletion tombstones', () => {
  const snapshot = buildShellDataSnapshot({
    shellDraft: {
      deletedJobIds: ['deleted-image-job', 'deleted-planning-job'],
      inputStateByScope: {},
      materials: {},
      updatedAt: Date.now(),
    },
    shellProjects: [
      {
        id: 'visible-planning-placeholder',
        backendJobId: 'visible-planning-job',
        name: '可恢复策划',
        module: 'one_click',
        status: 'generating',
        createdAt: '05-18',
        results: [],
        taskCount: 1,
        completedCount: 0,
        subFeature: 'first_image',
      },
    ],
  }, [
    {
      id: 'deleted-image-job',
      module: 'one_click',
      taskType: 'image',
      provider: 'kie',
      status: 'succeeded',
      payload: { prompt: 'deleted image' },
      result: { imageUrl: 'https://example.com/deleted.png' },
      createdAt: 3000,
    },
    {
      id: 'deleted-planning-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: { model: 'gemini-3-flash-openai' },
      result: {
        text: `[SCHEME_START]
- 屏序/类型：已删除策划
- 参考图标识：参考1
- 设计意图：不要复活
- 画面描述：单张主图
- 画面比例：1:1
[SCHEME_END]`,
      },
      createdAt: 4000,
    },
    {
      id: 'visible-planning-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: { model: 'gemini-3-flash-openai' },
      result: {
        text: `[SCHEME_START]
- 屏序/类型：可恢复策划
- 参考图标识：参考1
- 设计意图：只恢复未删除
- 画面描述：单张主图
- 画面比例：1:1
[SCHEME_END]`,
      },
      createdAt: 5000,
    },
  ]);

  assert.equal(snapshot.projects.some((item) => item.id === 'job-deleted-image-job'), false);
  assert.equal(snapshot.projects.some((item) => item.id === 'job-deleted-planning-job'), false);
  assert.equal(snapshot.projects.some((item) => item.id === 'visible-planning-placeholder'), true);
  assert.equal(snapshot.projects.some((item) => item.id === 'job-visible-planning-job'), false);
});

test('shell data adapter hides persisted projects and results covered by deletion tombstones', () => {
  const snapshot = buildShellDataSnapshot({
    shellDraft: {
      deletedJobIds: ['deleted-job'],
      deletedProjectIds: ['deleted-project'],
      deletedResultIds: ['deleted-result'],
      inputStateByScope: {},
      materials: {},
      updatedAt: Date.now(),
    },
    shellProjects: [
      {
        id: 'deleted-project',
        name: '已删除项目',
        module: 'one_click',
        status: 'completed',
        createdAt: '05-18',
        results: [{ id: 'result-a', imageUrl: '/a.png', prompt: 'A', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-18', module: 'one_click' }],
        taskCount: 1,
        completedCount: 1,
      },
      {
        id: 'job-backed-project',
        backendJobId: 'deleted-job',
        name: '已删除任务项目',
        module: 'one_click',
        status: 'completed',
        createdAt: '05-18',
        results: [{ id: 'result-b', imageUrl: '/b.png', prompt: 'B', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-18', module: 'one_click' }],
        taskCount: 1,
        completedCount: 1,
      },
      {
        id: 'partial-project',
        name: '部分删除项目',
        module: 'one_click',
        status: 'completed',
        createdAt: '05-18',
        results: [
          { id: 'deleted-result', imageUrl: '/deleted.png', prompt: 'deleted', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-18', module: 'one_click' },
          { id: 'kept-result', imageUrl: '/kept.png', prompt: 'kept', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: '05-18', module: 'one_click' },
        ],
        taskCount: 2,
        completedCount: 2,
      },
    ],
  }, []);

  assert.equal(snapshot.projects.some((item) => item.id === 'deleted-project'), false);
  assert.equal(snapshot.projects.some((item) => item.id === 'job-backed-project'), false);
  const partial = snapshot.projects.find((item) => item.id === 'partial-project');
  assert.deepEqual(partial?.results.map((result) => result.id), ['kept-result']);
});

test('shell data adapter does not duplicate terminal backend jobs already stored as project cards', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [
      {
        id: 'persisted-job-card',
        name: '已落库项目',
        module: 'one_click',
        status: 'completed',
        subFeature: 'first_image',
        backendJobId: 'finished-job-1',
        results: [
          {
            id: 'persisted-result',
            imageUrl: '/persisted.png',
            status: 'completed',
            taskId: 'provider-finished-1',
            subFeature: 'first_image',
          },
        ],
        taskCount: 1,
        completedCount: 1,
      },
    ],
  }, [
    {
      id: 'finished-job-1',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'provider-finished-1',
      payload: { prompt: '后端完成任务', subFeature: 'first_image' },
      result: { imageUrl: '/job-copy.png', providerTaskId: 'provider-finished-1' },
      createdAt: Date.now(),
      finishedAt: Date.now(),
    },
  ]);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].id, 'persisted-job-card');
  assert.equal(snapshot.projects[0].backendJobId, 'finished-job-1');
  assert.equal(snapshot.projects[0].results[0].imageUrl, '/persisted.png');
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter keeps active task titles compact while preserving backend job prompts', () => {
  const longPrompt = '详情页生成提示：'.repeat(20);
  const snapshot = buildShellDataSnapshot({}, [
    {
      id: 'job-full-prompt',
      module: 'one_click',
      taskType: 'detail_page',
      provider: 'kie',
      status: 'running',
      payload: { prompt: longPrompt, subFeature: 'detail_page' },
      result: { imageUrl: '/detail.png' },
      createdAt: Date.now(),
    },
  ]);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].id, 'job-job-full-prompt');
  assert.equal(snapshot.projects[0].subFeature, 'detail_page');
  assert.equal(snapshot.tasks[0].title, '详情页任务 prompt');
  assert.equal(snapshot.tasks[0].prompt, longPrompt);
  assert.equal(snapshot.tasks[0].subFeature, 'detail_page');
});

test('shell data adapter backfills legacy one-click prompts from content fields', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [
          {
            id: 'legacy-content-project',
            name: '旧内容项目',
            schemes: [
              {
                id: 'legacy-content-result',
                status: 'completed',
                resultUrl: '/legacy-content.png',
                content: '旧版 content 文案',
              },
            ],
          },
        ],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  assert.equal(snapshot.projects[0].results[0].prompt, '旧版 content 文案');
});

test('shell data adapter backfills legacy one-click prompts from project config when result text is missing', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      sku: {
        projects: [
          {
            id: 'legacy-config-project',
            name: '旧配置项目',
            config: {
              productInfo: 'SKU 主输入框描述',
              combinations: [{ sceneDescription: '第1套场景要求', skuCopyText: 'SKU 文案' }],
            },
            schemes: [
              {
                id: 'legacy-config-result',
                status: 'completed',
                resultUrl: '/legacy-config.png',
              },
            ],
          },
        ],
      },
      firstImage: { projects: [] },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
    },
  }, []);

  assert.equal(snapshot.projects[0].results[0].prompt, 'SKU 主输入框描述\nSKU1：第1套场景要求：SKU 文案');
});

test('shell data adapter keeps one-click active backend jobs in their submitted subfeature bucket', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [
      {
        id: 'persisted-first-active',
        name: '首图活动项目',
        module: 'one_click',
        status: 'generating',
        createdAt: '05-19',
        results: [],
        taskCount: 1,
        completedCount: 0,
        subFeature: 'first_image',
      },
      {
        id: 'persisted-main-active',
        name: '主图活动项目',
        module: 'one_click',
        status: 'generating',
        createdAt: '05-19',
        results: [],
        taskCount: 1,
        completedCount: 0,
        subFeature: 'main_image',
      },
    ],
  }, [
    {
      id: 'job-first',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      payload: { prompt: '子功能：first_image\n首图任务', subFeature: 'first_image', shellProjectId: 'persisted-first-active' },
      result: { imageUrl: '/first.png' },
      createdAt: Date.now(),
    },
    {
      id: 'job-main',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'queued',
      payload: { prompt: '子功能：main_image\n主图任务', subMode: 'main_image', shellProjectId: 'persisted-main-active' },
      result: { imageUrl: '/main.png' },
      createdAt: Date.now(),
    },
  ]);

  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.projects.find((project) => project.id === 'persisted-first-active')?.subFeature, 'first_image');
  assert.equal(snapshot.projects.find((project) => project.id === 'persisted-main-active')?.subFeature, 'main_image');
  assert.equal(snapshot.tasks.find((task) => task.id === 'job-first')?.subFeature, 'first_image');
  assert.equal(snapshot.tasks.find((task) => task.id === 'job-main')?.subFeature, 'main_image');
});

test('shell data adapter ignores untracked legacy one-click image jobs even when prompt hints are recognizable', () => {
  const snapshot = buildShellDataSnapshot({}, [
    {
      id: 'legacy-first',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      payload: { prompt: '首图裂变1-复刻主图参考1\n生成首图点击视觉' },
      result: { imageUrl: '/legacy-first.png' },
      createdAt: Date.now(),
    },
    {
      id: 'legacy-main',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'retry_waiting',
      payload: { prompt: '主图1-核心卖点展示\n生成商品主图' },
      result: { imageUrl: '/legacy-main.png' },
      createdAt: Date.now(),
    },
    {
      id: 'legacy-unknown',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      payload: { prompt: '泛化旧任务，没有可识别子功能' },
      result: { imageUrl: '/legacy-unknown.png' },
      createdAt: Date.now(),
    },
  ]);

  assert.equal(snapshot.projects.length, 0);
  assert.equal(snapshot.tasks.length, 0);
});
