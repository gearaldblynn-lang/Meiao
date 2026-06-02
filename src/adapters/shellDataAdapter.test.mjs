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

test('shell data adapter keeps recovered planning shell project over stale one-click branch failure', () => {
  const recoveredProject = {
    id: 'proj-plan-recovered',
    name: '5月26日项目4',
    module: 'one_click',
    status: 'planning',
    createdAt: '05-26',
    backendJobId: 'planning-job-a',
    taskCount: 1,
    completedCount: 0,
    results: [],
    plans: [{
      id: 'planning-job-a-plan-1',
      title: '首图裂变1-复刻主图参考1',
      sellingPoints: ['首图裂变1-复刻主图参考1'],
      sceneDescription: '已恢复的策划方案',
      styleDirection: '',
      colorPalette: '',
      composition: '',
      textLayout: '已恢复的策划方案',
      selected: true,
      schemeContent: '[SCHEME_START]\n- 参考图标识：首图裂变1-复刻主图参考1\n[SCHEME_END]',
    }],
    selectedPlanId: 'planning-job-a-plan-1',
    subFeature: 'first_image',
  };
  const staleBranchProject = {
    id: 'proj-plan-recovered',
    name: '5月26日项目4',
    status: 'error',
    createdAt: '05-26',
    updatedAt: 1779763628798,
    backendJobId: 'planning-job-a',
    taskCount: 1,
    completedCount: 0,
    plans: recoveredProject.plans,
    selectedPlanId: 'planning-job-a-plan-1',
    schemes: [{
      id: 'task-proj-plan-recovered-error',
      status: 'error',
      prompt: '共 1 张参考图，其中 1 张策划失败。',
      error: '共 1 张参考图，其中 1 张策划失败。',
    }],
  };

  const snapshot = buildShellDataSnapshot({
    shellProjects: [recoveredProject],
    oneClickMemory: {
      firstImage: { projects: [staleBranchProject] },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'proj-plan-recovered');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.results.length, 0);
  assert.equal(project?.plans?.[0]?.title, '首图裂变1-复刻主图参考1');
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

test('shell data adapter keeps providerless one-click image jobs out of visible generating cards', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'retry-project',
      name: '5月28日项目10',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-28',
      subFeature: 'first_image',
      plans: [{ id: 'plan-1', title: '方案 1', selected: true }],
      selectedPlanId: 'plan-1',
      taskCount: 1,
      completedCount: 1,
      results: [
        { id: 'result-old', planId: 'plan-1', status: 'completed', imageUrl: '/old.png', backendJobId: 'job-old' },
      ],
    }],
  }, [{
    id: 'job-new',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'running',
    payload: {
      shellProjectId: 'retry-project',
      shellPlanId: 'plan-1',
      prompt: '重新生成',
      subFeature: 'first_image',
    },
    result: null,
    createdAt: 1779954810000,
    updatedAt: 1779954810000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'retry-project');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.completedCount, 1);
  assert.equal(project?.results.some((result) => result.backendJobId === 'job-new'), false);
  assert.ok(project?.results.some((result) => result.backendJobId === 'job-old' && result.status === 'completed'));
  assert.equal(snapshot.tasks.find((task) => task.backendJobId === 'job-new')?.status, 'generating');
});

test('shell data adapter keeps providerless KIE media jobs out of visible generating cards for every module', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'translation-project',
      name: '翻译任务',
      module: 'translation',
      status: 'generating',
      createdAt: '05-29',
      taskCount: 1,
      completedCount: 0,
      results: [],
    }],
  }, [{
    id: 'translation-job-no-provider',
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'running',
    payload: {
      shellProjectId: 'translation-project',
      prompt: '翻译图片',
    },
    result: null,
    createdAt: 1780026972564,
    updatedAt: 1780026972564,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'translation-project');
  assert.equal(project?.results.some((result) => result.backendJobId === 'translation-job-no-provider'), false);
  assert.equal(snapshot.tasks.find((task) => task.backendJobId === 'translation-job-no-provider')?.status, 'generating');
});

test('shell data adapter surfaces provider id for a retry-waiting one-click edit job', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'project-edit-1',
      name: '5月29日项目1 · 修改',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-29',
      subFeature: 'first_image',
      plans: [{ id: 'plan-edit-1', title: '修改', selected: true, sourceResultUrl: '/old.png' }],
      selectedPlanId: 'plan-edit-1',
      taskCount: 1,
      completedCount: 0,
      results: [],
    }],
  }, [{
    id: 'job-edit-1',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'retry_waiting',
    providerTaskId: 'new-provider-task',
    payload: {
      shellProjectId: 'project-edit-1',
      shellPlanId: 'plan-edit-1',
      prompt: '修改右上角产品',
      subFeature: 'first_image',
    },
    result: null,
    createdAt: 1780016966434,
    updatedAt: 1780017057235,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'project-edit-1');
  assert.equal(project?.status, 'generating');
  assert.equal(project?.results[0]?.status, 'generating');
  assert.equal(project?.results[0]?.taskId, 'new-provider-task');
  assert.equal(project?.results[0]?.backendJobId, 'job-edit-1');
  assert.equal(snapshot.tasks.find((task) => task.backendJobId === 'job-edit-1')?.status, 'generating');
});

test('shell data adapter does not display internal backend job ids as planning KIE task ids', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-id-project',
      name: '5月29日项目1',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-29',
      subFeature: 'first_image',
      plans: [{
        id: 'plan-1',
        title: '首图裂变1',
        selected: true,
        schemeContent: '策划内容',
      }],
      selectedPlanId: 'plan-1',
      taskCount: 1,
      completedCount: 0,
      results: [],
    }],
  }, [{
    id: 'internal-planning-job-id',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: '',
    payload: {
      shellProjectId: 'planning-id-project',
      prompt: '策划',
      subFeature: 'first_image',
    },
    result: {
      content: '[SCHEME_START]\n- 参考图标识：首图裂变1\n[SCHEME_END]',
      providerTaskId: '',
      creditsConsumed: 0.2,
    },
    createdAt: 1780026972564,
    updatedAt: 1780026972564,
    finishedAt: 1780026972564,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'planning-id-project');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.backendJobId, 'internal-planning-job-id');
  assert.equal(project?.planningTaskId, undefined);
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

test('shell data adapter restores storyboard planning credits and task id from saved projects', () => {
  const snapshot = buildShellDataSnapshot({
    videoMemory: {
      storyboard: {
        projects: [{
          id: 'storyboard-planning-credits-project',
          name: '分镜策划积分项目',
          createdAt: 1779442347056,
          creditsConsumed: 0.2,
          planningTaskId: 'storyboard-planning-job-id',
          shots: [{
            id: 'shot-1',
            description: '商品特写',
            prompt: 'Close up product shot',
            scriptContent: '商品特写',
          }],
          boards: [{
            id: 'board-1',
            title: '分段一',
            shotIds: ['shot-1'],
            status: 'completed',
            imageUrl: '/storyboard-board.png',
            prompt: '分镜板',
            taskId: 'storyboard-image-task-id',
            creditsConsumed: 3,
          }],
        }],
      },
    },
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'storyboard-planning-credits-project');
  assert.equal(project?.creditsConsumed, 0.2);
  assert.equal(project?.planningTaskId, 'storyboard-planning-job-id');
  assert.equal(project?.results[0]?.taskId, 'storyboard-image-task-id');
  assert.equal(project?.results[0]?.creditsConsumed, 3);
});

test('shell data adapter backfills storyboard planning ids from completed KIE chat jobs', () => {
  const projectCreatedAt = 1779442347056;
  const snapshot = buildShellDataSnapshot({
    videoMemory: {
      storyboard: {
        projects: [{
          id: `video_${projectCreatedAt}_0_cuz4`,
          name: '分镜方案 8',
          createdAt: projectCreatedAt,
          creditsConsumed: 0.2,
          boards: [{
            id: 'board-1',
            status: 'completed',
            imageUrl: '/storyboard-board.png',
            taskId: 'storyboard-image-task-id',
            creditsConsumed: 3,
          }],
        }],
      },
    },
  }, [{
    id: 'storyboard-planning-backend-job',
    module: 'video',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'succeeded',
    payload: { model: 'gemini-3-flash-openai' },
    result: {
      content: '[{"description":"商品特写","prompt":"product","script":"分镜1"}]',
      providerTaskId: '',
      creditsConsumed: 0.2,
    },
    createdAt: projectCreatedAt + 128,
    updatedAt: projectCreatedAt + 1000,
  }]);

  const project = snapshot.projects.find((item) => item.id === `video_${projectCreatedAt}_0_cuz4`);
  assert.equal(project?.planningTaskId, undefined);
  assert.equal(project?.creditsConsumed, 0.2);
  assert.equal(project?.results.length, 1);
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

test('shell data adapter completes delayed one-click detail jobs after the initial concurrency window', () => {
  const plans = Array.from({ length: 8 }).map((_, index) => ({
    id: `detail-plan-${index + 1}`,
    title: `详情第${index + 1}屏`,
    sellingPoints: [],
    sceneDescription: `详情第${index + 1}屏`,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: '',
    selected: true,
    schemeContent: `详情第${index + 1}屏`,
  }));
  const baseProject = {
    id: 'detail-delayed-project',
    name: '详情八张批量',
    module: 'one_click',
    status: 'generating',
    createdAt: '05-20',
    plans,
    selectedPlanId: plans[0].id,
    taskCount: 8,
    completedCount: 4,
    subFeature: 'detail_page',
    results: plans.map((plan, index) => ({
      id: `provider-detail-${index + 1}`,
      planId: plan.id,
      imageUrl: index < 4 ? `/old-detail-${index + 1}.png` : '',
      prompt: plan.schemeContent,
      model: 'gpt-image-2',
      aspectRatio: 'auto',
      status: index < 4 ? 'completed' : 'generating',
      createdAt: '05-20',
      module: 'one_click',
      subFeature: 'detail_page',
      taskId: `provider-detail-${index + 1}`,
      backendJobId: `job-detail-${index + 1}`,
    })),
  };
  const jobs = plans.map((plan, index) => ({
    id: `job-detail-${index + 1}`,
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: `provider-detail-${index + 1}`,
    payload: {
      prompt: `提示词 ${index + 1}`,
      shellProjectId: 'detail-delayed-project',
      shellPlanId: plan.id,
      subFeature: 'detail_page',
      batchIndex: index + 1,
      batchCount: 8,
    },
    result: {
      imageUrl: `/new-detail-${index + 1}.png`,
      providerTaskId: `provider-detail-${index + 1}`,
      creditsConsumed: 3,
    },
    createdAt: 2000 + index,
    updatedAt: 3000 + index,
    finishedAt: 3000 + index,
  }));

  const snapshot = buildShellDataSnapshot({ shellProjects: [baseProject] }, jobs);
  const project = snapshot.projects.find((item) => item.id === 'detail-delayed-project');

  assert.equal(project?.status, 'completed');
  assert.equal(project?.taskCount, 8);
  assert.equal(project?.completedCount, 8);
  assert.equal(project?.results.length, 8);
  assert.equal(project?.results.find((result) => result.planId === 'detail-plan-8')?.imageUrl, '/new-detail-8.png');
});

test('shell data adapter completes delayed terminal jobs for every generated project module', () => {
  const modules = [
    ['translation', 'main', 'kie_image', 'imageUrl', '/translation-final.png'],
    ['retouch', 'original', 'kie_image', 'imageUrl', '/retouch-final.png'],
    ['buyer_show', 'image', 'kie_image', 'imageUrl', '/buyer-show-final.png'],
    ['xhs_cover', 'cover', 'kie_image', 'imageUrl', '/xhs-cover-final.png'],
    ['video', 'generation', 'kie_video', 'videoUrl', '/video-final.mp4'],
  ];
  const shellProjects = modules.map(([module, subFeature]) => ({
    id: `${module}-project`,
    name: `${module} 项目`,
    module,
    status: 'generating',
    createdAt: '05-20',
    subFeature,
    taskCount: 1,
    completedCount: 0,
    results: [{
      id: `${module}-provider-task`,
      projectId: `${module}-project`,
      imageUrl: '',
      prompt: `${module} prompt`,
      model: 'kie',
      aspectRatio: 'auto',
      status: 'generating',
      createdAt: '05-20',
      module,
      subFeature,
      taskId: `${module}-provider-task`,
      backendJobId: `${module}-job`,
    }],
  }));
  const jobs = modules.map(([module, subFeature, taskType, urlKey, url]) => ({
    id: `${module}-job`,
    module,
    taskType,
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: `${module}-provider-task`,
    payload: {
      prompt: `${module} prompt`,
      shellProjectId: `${module}-project`,
      subFeature,
      batchCount: 1,
    },
    result: {
      [urlKey]: url,
      providerTaskId: `${module}-provider-task`,
      creditsConsumed: 3,
    },
    createdAt: 2000,
    updatedAt: 3000,
    finishedAt: 3000,
  }));

  const snapshot = buildShellDataSnapshot({ shellProjects }, jobs);

  modules.forEach(([module, , , urlKey, url]) => {
    const project = snapshot.projects.find((item) => item.id === `${module}-project`);
    assert.equal(project?.status, 'completed', module);
    assert.equal(project?.taskCount, 1, module);
    assert.equal(project?.completedCount, 1, module);
    assert.equal(project?.results.length, 1, module);
    assert.equal(urlKey === 'videoUrl' ? project?.results[0]?.videoUrl : project?.results[0]?.imageUrl, url, module);
  });
});

test('shell data adapter marks terminal failed backend jobs on existing project cards across modules', () => {
  const modules = [
    ['one_click', 'main_image', 'kie_image'],
    ['translation', 'main', 'kie_image'],
    ['retouch', 'original', 'kie_image'],
    ['buyer_show', 'image', 'kie_image'],
    ['xhs_cover', 'cover', 'kie_image'],
    ['video', 'generation', 'kie_video'],
  ];
  const shellProjects = modules.map(([module, subFeature]) => ({
    id: `${module}-failed-project`,
    name: `${module} 失败项目`,
    module,
    status: 'generating',
    createdAt: '05-20',
    subFeature,
    taskCount: 1,
    completedCount: 0,
    results: [{
      id: `${module}-failed-provider-task`,
      projectId: `${module}-failed-project`,
      imageUrl: '',
      prompt: `${module} prompt`,
      model: 'kie',
      aspectRatio: 'auto',
      status: 'generating',
      createdAt: '05-20',
      module,
      subFeature,
      taskId: `${module}-failed-provider-task`,
      backendJobId: `${module}-failed-job`,
    }],
  }));
  const jobs = modules.map(([module, subFeature, taskType]) => ({
    id: `${module}-failed-job`,
    module,
    taskType,
    provider: 'kie',
    status: 'failed',
    providerTaskId: `${module}-failed-provider-task`,
    payload: {
      prompt: `${module} prompt`,
      shellProjectId: `${module}-failed-project`,
      subFeature,
      batchCount: 1,
    },
    result: null,
    errorMessage: `${module} backend failed`,
    createdAt: 2000,
    updatedAt: 3000,
    finishedAt: 3000,
  }));

  const snapshot = buildShellDataSnapshot({ shellProjects }, jobs);

  modules.forEach(([module]) => {
    const project = snapshot.projects.find((item) => item.id === `${module}-failed-project`);
    assert.equal(project?.status, 'error', module);
    assert.equal(project?.completedCount, 0, module);
    assert.equal(project?.results.length, 1, module);
    assert.equal(project?.results[0]?.status, 'error', module);
    assert.match(project?.results[0]?.error || project?.results[0]?.prompt || '', /backend failed/, module);
  });
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
  assert.equal(project?.backendJobId, 'planning-chat-job');
  assert.equal(project?.planningTaskId, undefined);
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter marks completed but unparsable planning jobs as failed instead of leaving placeholders active', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-empty-placeholder',
      name: '正在策划的首图',
      module: 'one_click',
      status: 'generating',
      createdAt: '06-02',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-empty-job',
    }],
  }, [
    {
      id: 'planning-empty-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'resp_empty_planning',
      payload: {
        shellProjectId: 'planning-empty-placeholder',
        shellPlanningPurpose: 'one_click_planning',
        model: 'gemini-3-flash-openai',
        subFeature: 'first_image',
      },
      result: {
        text: 'I cannot fulfill this request.',
        creditsConsumed: 0.12,
      },
      createdAt: 1780380000000,
      updatedAt: 1780380001000,
      finishedAt: 1780380001000,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'planning-empty-placeholder');
  assert.equal(project?.status, 'error');
  assert.equal(project?.planningTaskId, 'resp_empty_planning');
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0]?.status, 'error');
  assert.equal(project?.results[0]?.taskId, 'resp_empty_planning');
  assert.match(project?.error || '', /I cannot fulfill this request/);
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter does not let an unparsable fallback planning response overwrite recovered plans', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-recovered-project',
      name: '已经有方案的首图',
      module: 'one_click',
      status: 'planning',
      createdAt: '06-02',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-empty-fallback-job',
      plans: [{
        id: 'plan-ok',
        title: '首图裂变1',
        sellingPoints: [],
        sceneDescription: '保留参考图构图并替换商品。',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
        schemeContent: '可用方案',
      }],
      selectedPlanId: 'plan-ok',
    }],
  }, [
    {
      id: 'planning-empty-fallback-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'resp_empty_fallback',
      payload: {
        shellProjectId: 'planning-recovered-project',
        shellPlanningPurpose: 'one_click_planning',
        subFeature: 'first_image',
      },
      result: { text: 'I cannot fulfill this request.' },
      createdAt: 1780380000000,
      updatedAt: 1780380001000,
      finishedAt: 1780380001000,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'planning-recovered-project');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.plans?.length, 1);
  assert.equal(project?.plans?.[0]?.id, 'plan-ok');
  assert.equal(project?.results.length, 0);
  assert.equal(project?.error, undefined);
});

test('shell data adapter lets completed planning jobs replace stale planning failure placeholders', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-failed-placeholder',
      name: '5月26日项目3',
      module: 'one_click',
      status: 'error',
      createdAt: '05-26',
      results: [{
        id: 'task-planning-failed-placeholder-error',
        imageUrl: '',
        prompt: '共 1 张参考图，其中 1 张策划失败。',
        model: 'GPT Image 2',
        aspectRatio: '1:1',
        status: 'error',
        createdAt: '05-26',
        module: 'one_click',
        subFeature: 'first_image',
      }],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-chat-job-after-poll-error',
    }],
  }, [
    {
      id: 'planning-chat-job-after-poll-error',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: {
        model: 'gemini-3-flash-openai',
        shellProjectId: 'planning-failed-placeholder',
        shellPlanningPurpose: 'one_click_planning',
        subFeature: 'first_image',
      },
      result: {
        content: `[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考1
- 参考图标识：复刻主图参考1
- 设计意图：后台已完成但前端轮询失败
- 画面描述：恢复真实策划方案
- 画面比例：1:1
[SCHEME_END]`,
        creditsConsumed: 0.21,
      },
      createdAt: 1779763306286,
      updatedAt: 1779763394371,
      finishedAt: 1779763394371,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'planning-failed-placeholder');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.results?.length, 0);
  assert.equal(project?.plans?.length, 1);
  assert.equal(project?.plans?.[0]?.title, '首图裂变1-复刻主图参考1');
  assert.equal(project?.creditsConsumed, 0.21);
  assert.equal(project?.backendJobId, 'planning-chat-job-after-poll-error');
});

test('shell data adapter clears planning job pending placeholders once planning succeeds', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'planning-succeeded-but-pending',
      name: '5月29日项目1',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-29',
      backendJobId: 'planning-job-succeeded',
      planningTaskId: 'planning-job-succeeded',
      plans: [{
        id: 'plan-after-success',
        title: '首图裂变1-复刻主图参考1',
        sellingPoints: [],
        sceneDescription: '',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
      }],
      selectedPlanId: 'plan-after-success',
      results: [{
        id: 'planning-job-succeeded-pending',
        imageUrl: '',
        prompt: '一键主详',
        model: 'gemini-3-flash-openai',
        aspectRatio: 'auto',
        status: 'generating',
        createdAt: '05-29',
        module: 'one_click',
        subFeature: 'first_image',
        backendJobId: 'planning-job-succeeded',
        error: '任务已提交，等待执行',
      }],
      taskCount: 2,
      completedCount: 0,
      subFeature: 'first_image',
    }],
  }, [
    {
      id: 'planning-job-succeeded',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: {
        model: 'gemini-3-flash-openai',
        shellProjectId: 'planning-succeeded-but-pending',
        shellProjectName: '5月29日项目1',
        shellPlanningPurpose: 'one_click_planning',
        subFeature: 'first_image',
      },
      result: {
        content: `[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考1
- 参考图标识：复刻主图参考1
- 设计意图：策划已成功
- 画面描述：方案内容
- 画面比例：1:1
[SCHEME_END]`,
        creditsConsumed: 0.32,
      },
      createdAt: 1780026938780,
      updatedAt: 1780026971959,
      finishedAt: 1780026971959,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'planning-succeeded-but-pending');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.completedCount, 0);
  assert.equal(project?.results.length, 0);
  assert.equal(project?.plans?.length, 1);
  assert.equal(project?.planningTaskId, 'planning-job-succeeded');
});

test('shell data adapter drops persisted one-click planning placeholder plans after planning succeeds', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'dusang-planning-project',
      name: '5月29日项目7',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-29',
      backendJobId: 'dusang-planning-job',
      results: [{
        id: 'dusang-planning-job-pending',
        imageUrl: '',
        prompt: '一键主详',
        model: 'gemini-3-flash-openai',
        aspectRatio: 'auto',
        status: 'generating',
        createdAt: '05-29',
        module: 'one_click',
        subFeature: 'first_image',
        backendJobId: 'dusang-planning-job',
        error: '任务正在运行',
      }],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
    }],
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'dusang-planning-project',
          name: '5月29日项目7',
          status: 'planning',
          schemes: [{
            id: 'dusang-planning-job-pending',
            backendJobId: 'dusang-planning-job',
            status: 'generating',
            originalContent: '一键主详',
            editedContent: '一键主详',
            selected: true,
            subFeature: 'first_image',
          }],
          selectedPlanId: 'dusang-planning-job-pending',
          taskCount: 1,
          completedCount: 0,
        }],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, [{
    id: 'dusang-planning-job',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: 'kie-chat-provider-id',
    payload: {
      model: 'gemini-3-flash-openai',
      shellProjectId: 'dusang-planning-project',
      shellProjectName: '5月29日项目7',
      shellPlanningPurpose: 'one_click_planning',
      subFeature: 'first_image',
    },
    result: {
      providerTaskId: 'kie-chat-provider-id',
      content: `[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考1
- 参考图标识：复刻主图参考1
- 设计意图：真实策划已返回
- 画面描述：真实方案内容
- 画面比例：1:1
[SCHEME_END]`,
    },
    createdAt: 1780042215231,
    updatedAt: 1780042257231,
    finishedAt: 1780042257231,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'dusang-planning-project');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.results.length, 0);
  assert.equal(project?.plans?.length, 1);
  assert.equal(project?.plans?.[0]?.id, 'dusang-planning-job-plan-1');
  assert.equal(project?.plans?.[0]?.schemeContent?.includes('真实方案内容'), true);
  assert.equal(project?.plans?.some((plan) => plan.schemeContent === '一键主详'), false);
  assert.equal(project?.selectedPlanId, 'dusang-planning-job-plan-1');
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.planningTaskId, 'kie-chat-provider-id');
});

test('shell data adapter does not expose internal backend job ids as planning provider ids', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'duosang-stale-sku-project',
      name: '5月26日项目6',
      module: 'one_click',
      status: 'planning',
      createdAt: '05-26',
      backendJobId: '6296de5c861e08699d96a92b',
      planningTaskId: '209a398cc2f3c9e1aabaf48a',
      plans: [{
        id: '209a398cc2f3c9e1aabaf48a-plan-1',
        title: 'SKU一',
        sellingPoints: [],
        sceneDescription: '真实策划一',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '真实策划一',
        selected: true,
        schemeContent: '真实策划一',
      }, {
        id: '209a398cc2f3c9e1aabaf48a-plan-2',
        title: 'SKU二',
        sellingPoints: [],
        sceneDescription: '真实策划二',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '真实策划二',
        selected: true,
        schemeContent: '真实策划二',
      }],
      selectedPlanId: '209a398cc2f3c9e1aabaf48a-plan-1',
      results: [{
        id: '0db3a02612f517a9ea0c581210b37e8c',
        planId: '209a398cc2f3c9e1aabaf48a-plan-1',
        imageUrl: 'https://example.com/sku-1.png',
        prompt: '真实生图 prompt',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'completed',
        createdAt: '05-26',
        module: 'one_click',
        subFeature: 'sku',
        taskId: '0db3a02612f517a9ea0c581210b37e8c',
        backendJobId: '6296de5c861e08699d96a92b',
      }],
      taskCount: 2,
      completedCount: 1,
      subFeature: 'sku',
    }],
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'duosang-stale-sku-project');
  assert.equal(project?.planningTaskId, undefined);
  assert.equal(project?.status, 'completed');
  assert.equal(project?.completedCount, 1);
  assert.equal(project?.taskCount, 2);
  assert.equal(project?.plans?.length, 2);
  assert.equal(project?.results.length, 1);
});

test('shell data adapter shows active one-click planning jobs without fake generation result prompts', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'active-planning-project',
      name: '5月29日项目8',
      module: 'one_click',
      status: 'planning',
      createdAt: '05-29',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'active-planning-job',
    }],
  }, [{
    id: 'active-planning-job',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'running',
    payload: {
      shellProjectId: 'active-planning-project',
      shellProjectName: '5月29日项目8',
      shellPlanningPurpose: 'one_click_planning',
      subFeature: 'first_image',
      model: 'gemini-3-flash-openai',
      messages: [{ role: 'user', content: [{ type: 'text', text: '真实策划输入' }] }],
    },
    createdAt: 1780042590341,
    updatedAt: 1780042595341,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'active-planning-project');
  assert.equal(project?.status, 'generating');
  assert.equal(project?.results.length, 0);
  assert.equal(project?.plans?.length || 0, 0);
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.backendJobId, 'active-planning-job');
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].type, 'plan');
  assert.equal(snapshot.tasks[0].projectId, 'active-planning-project');
  assert.equal(snapshot.tasks[0].prompt, '真实策划输入');
});

test('shell data adapter removes stale one-click planning result placeholders from completed projects', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'completed-project-with-stale-planning-result',
      name: '5月29日项目5',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-29',
      backendJobId: 'image-job-after-planning',
      planningTaskId: 'kie-chat-provider-id',
      plans: [{
        id: 'real-plan-1',
        title: '首图裂变1-复刻主图参考1',
        sellingPoints: [],
        sceneDescription: '真实方案内容',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '真实方案内容',
        selected: true,
        schemeContent: '[SCHEME_START]\n- 画面描述：真实方案内容\n[SCHEME_END]',
      }],
      selectedPlanId: 'real-plan-1',
      results: [
        {
          id: 'image-provider-task-id',
          planId: 'real-plan-1',
          imageUrl: 'https://example.com/result.png',
          prompt: '真实生图 prompt',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'completed',
          createdAt: '05-29',
          module: 'one_click',
          subFeature: 'first_image',
          taskId: 'image-provider-task-id',
          backendJobId: 'image-job-after-planning',
        },
        {
          id: 'planning-job-pending',
          imageUrl: '',
          prompt: '一键主详',
          model: 'gemini-3-flash-openai',
          aspectRatio: 'auto',
          status: 'generating',
          createdAt: '05-29',
          module: 'one_click',
          subFeature: 'first_image',
          backendJobId: 'planning-job',
          error: '任务正在运行',
        },
      ],
      taskCount: 2,
      completedCount: 1,
      subFeature: 'first_image',
    }],
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'completed-project-with-stale-planning-result');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0]?.id, 'image-provider-task-id');
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.completedCount, 1);
});

test('shell data adapter replaces stale one-click planning placeholders with the terminal backend failure', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'proj-plan-failed-retry',
      name: '5月29日项目2',
      module: 'one_click',
      status: 'error',
      createdAt: '05-29',
      results: [
        {
          id: 'task-proj-plan-failed-retry-error',
          imageUrl: '',
          prompt: '共 1 张参考图，其中 1 张策划失败。',
          model: 'GPT Image 2',
          aspectRatio: '1:1',
          status: 'error',
          createdAt: '05-29',
          module: 'one_click',
          subFeature: 'first_image',
        },
      ],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-job-failed',
    }],
  }, [
    {
      id: 'planning-job-failed',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'failed',
      payload: {
        model: 'gemini-3-flash-openai',
        shellProjectId: 'proj-plan-failed-retry',
        shellProjectName: '5月29日项目2',
        shellPlanningPurpose: 'one_click_planning',
        subFeature: 'first_image',
      },
      errorCode: 'provider_timeout',
      errorMessage: 'Kie 素材上传超时',
      retryCount: 2,
      maxRetries: 2,
      createdAt: 1780023092895,
      updatedAt: 1780023626471,
      finishedAt: 1780023626471,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'proj-plan-failed-retry');
  assert.equal(project?.status, 'error');
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0]?.backendJobId, 'planning-job-failed');
  assert.equal(project?.results[0]?.status, 'error');
  assert.equal(project?.results[0]?.error, 'Kie 素材上传超时');
});

test('shell data adapter backfills missing planning schemes after the first sku image completed', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'sku-project-after-first-image',
      name: '5月26日项目6',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-26',
      results: [{
        id: 'provider-sku-1',
        planId: 'sku-planning-job-plan-1',
        imageUrl: '/sku-1.png',
        prompt: 'SKU 一出图提示词',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'completed',
        createdAt: '05-26',
        module: 'one_click',
        subFeature: 'sku',
        taskId: 'provider-sku-1',
        backendJobId: 'sku-image-job-1',
        creditsConsumed: 3,
      }],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'sku',
      backendJobId: 'sku-image-job-1',
      selectedPlanId: 'sku-planning-job-plan-1',
    }],
  }, [
    {
      id: 'sku-planning-job',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      payload: {
        shellProjectId: 'sku-project-after-first-image',
        shellPlanningPurpose: 'one_click_planning',
        subFeature: 'sku',
      },
      result: {
        content: `[SCHEME_START]
- SKU标识：[SKU一 - 车前子壳1罐（200g）]
- 画面风格：统一白底
- 画面描述：一罐商品
- 文案内容排版：主标题：“车前子壳1罐（200g）”
- 画面比例：1:1
[SCHEME_END]

[SCHEME_START]
- SKU标识：[SKU二 - 车前子壳2罐（2*200g）]
- 画面风格：统一白底
- 画面描述：两罐商品
- 文案内容排版：主标题：“车前子壳2罐（2*200g）”
- 画面比例：1:1
[SCHEME_END]`,
        creditsConsumed: 0.27,
      },
      createdAt: 1779765280879,
      updatedAt: 1779765365886,
      finishedAt: 1779765365886,
    },
    {
      id: 'sku-image-job-1',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'provider-sku-1',
      payload: {
        shellProjectId: 'sku-project-after-first-image',
        shellPlanId: 'sku-planning-job-plan-1',
        subFeature: 'sku',
        batchIndex: 1,
        batchCount: 1,
      },
      result: {
        imageUrl: '/sku-1.png',
        providerTaskId: 'provider-sku-1',
        creditsConsumed: 3,
      },
      createdAt: 1779765426203,
      updatedAt: 1779765742814,
      finishedAt: 1779765742814,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'sku-project-after-first-image');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.taskCount, 2);
  assert.equal(project?.completedCount, 1);
  assert.equal(project?.results.length, 1);
  assert.equal(project?.plans?.length, 2);
  assert.deepEqual(project?.plans?.map((plan) => plan.title), [
    '[SKU一 - 车前子壳1罐（200g）]',
    '[SKU二 - 车前子壳2罐（2*200g）]',
  ]);
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

test('shell data adapter keeps multiple first-image planning plans but exposes only the latest planning provider task', () => {
  const baseProject = {
    id: 'first-planning-project',
    name: '多参考图首图裂变',
    module: 'one_click',
    status: 'generating',
    createdAt: '05-20',
    results: [],
    taskCount: 2,
    completedCount: 0,
    subFeature: 'first_image',
  };
  const makePlanningJob = (id, providerTaskId, refIndex) => ({
    id,
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId,
    payload: {
      model: 'gemini-3-flash-openai',
      shellProjectId: 'first-planning-project',
      shellPlanningPurpose: 'one_click_planning',
      shellReferenceIndex: refIndex,
    },
    result: {
      content: `[SCHEME_START]
- 屏序/类型：首图裂变${refIndex}-复刻主图参考${refIndex}
- 参考图标识：复刻主图参考${refIndex}
- 设计意图：保留第 ${refIndex} 张参考图结构
- 画面描述：第 ${refIndex} 张参考图生成方案
- 画面比例：1:1
[SCHEME_END]`,
      providerTaskId,
      creditsConsumed: 0.34,
    },
    createdAt: 1000 + refIndex,
    updatedAt: 2000 + refIndex,
  });

  const snapshot = buildShellDataSnapshot({
    shellProjects: [baseProject],
  }, [
    makePlanningJob('planning-job-a', 'kie-plan-a', 1),
    makePlanningJob('planning-job-b', 'kie-plan-b', 2),
  ]);

  const project = snapshot.projects.find((item) => item.id === 'first-planning-project');
  assert.equal(project?.status, 'planning');
  assert.equal(project?.plans?.length, 2);
  assert.deepEqual(project?.plans?.map((plan) => plan.id), ['planning-job-a-plan-1', 'planning-job-b-plan-1']);
  assert.deepEqual(project?.plans?.map((plan) => plan.title), ['首图裂变1-复刻主图参考1', '首图裂变2-复刻主图参考2']);
  assert.equal(project?.planningTaskId, 'kie-plan-b');
  assert.equal(project?.taskCount, 2);
  assert.equal(snapshot.projects.some((item) => item.id === 'job-planning-job-b'), false);
});

test('shell data adapter keeps multiple completed image provider tasks for one plan', () => {
  const baseProject = {
    id: 'first-image-project-with-two-results',
    name: '同一方案多图结果',
    module: 'one_click',
    status: 'generating',
    createdAt: '05-20',
    results: [],
    taskCount: 2,
    completedCount: 0,
    subFeature: 'first_image',
    selectedPlanId: 'plan-a',
    plans: [{
      id: 'plan-a',
      title: '首图裂变方案',
      sellingPoints: ['卖点'],
      sceneDescription: '场景',
      styleDirection: '风格',
      colorPalette: '配色',
      composition: '构图',
      textLayout: '排版',
      selected: true,
      schemeContent: '首图裂变方案',
    }],
  };
  const makeImageJob = (id, providerTaskId, imageUrl) => ({
    id,
    module: 'one_click',
    taskType: 'image',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId,
    payload: {
      prompt: '首图裂变方案',
      shellProjectId: 'first-image-project-with-two-results',
      shellPlanId: 'plan-a',
      batchCount: 2,
      aspectRatio: '1:1',
      model: 'gpt-image-2',
    },
    result: {
      imageUrl,
      providerTaskId,
      creditsConsumed: 3,
    },
    createdAt: 3000,
    updatedAt: 4000,
  });

  const snapshot = buildShellDataSnapshot({
    shellProjects: [baseProject],
  }, [
    makeImageJob('image-job-a', 'kie-img-a', 'https://example.com/a.png'),
    makeImageJob('image-job-b', 'kie-img-b', 'https://example.com/b.png'),
  ]);

  const project = snapshot.projects.find((item) => item.id === 'first-image-project-with-two-results');
  assert.equal(project?.status, 'completed');
  assert.equal(project?.results.length, 2);
  assert.deepEqual(project?.results.map((result) => result.taskId), ['kie-img-a', 'kie-img-b']);
  assert.deepEqual(project?.results.map((result) => result.planId), ['plan-a', 'plan-a']);
  assert.deepEqual(project?.results.map((result) => result.imageUrl), ['https://example.com/a.png', 'https://example.com/b.png']);
  assert.equal(project?.completedCount, 2);
  assert.equal(project?.taskCount, 2);
});

test('shell data adapter removes completed media generated from failed one-click planning text', () => {
  const snapshot = buildShellDataSnapshot({
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'failed-planning-generated-project',
          name: '5月29日项目12',
          module: 'one_click',
          subFeature: 'first_image',
          status: 'completed',
          taskCount: 2,
          completedCount: 1,
          plans: [{
            id: 'planning-job-error',
            title: '5月29日项目12',
            selected: true,
            schemeContent: 'fetch failed',
          }],
          selectedPlanId: 'planning-job-error',
          schemes: [
            {
              id: 'planning-job-error',
              status: 'completed',
              resultUrl: 'https://example.com/bad.png',
              taskId: 'kie-bad-image',
              backendJobId: 'image-job-from-failed-plan',
              editedContent: 'fetch failed',
              prompt: 'fetch failed',
            },
            {
              id: 'task-plan-error',
              status: 'error',
              editedContent: '共 1 张参考图，其中 1 张策划失败。',
              prompt: '共 1 张参考图，其中 1 张策划失败。',
              error: '共 1 张参考图，其中 1 张策划失败。',
            },
          ],
        }],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'failed-planning-generated-project');
  assert.equal(project?.status, 'error');
  assert.equal(project?.completedCount, 0);
  assert.equal(project?.taskCount, 1);
  assert.equal(project?.plans, undefined);
  assert.equal(project?.results.length, 1);
  assert.equal(project?.results[0]?.status, 'error');
  assert.equal(project?.results.some((result) => result.imageUrl), false);
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

test('shell data adapter does not resurrect deleted pending results from completed backend jobs', () => {
  const snapshot = buildShellDataSnapshot({
    shellDraft: {
      deletedJobIds: ['deleted-backend-job'],
      inputStateByScope: {},
      materials: {},
      updatedAt: Date.now(),
    },
    shellProjects: [
      {
        id: 'project-with-deleted-pending-result',
        name: '删除中的项目',
        module: 'one_click',
        status: 'generating',
        subFeature: 'first_image',
        createdAt: '05-18',
        results: [
          {
            id: 'task-provider-pending-0',
            imageUrl: '',
            prompt: '用户已删除的方案',
            model: 'gpt-image-2',
            aspectRatio: '1:1',
            status: 'generating',
            createdAt: '05-18',
            module: 'one_click',
            backendJobId: 'deleted-backend-job',
          },
          {
            id: 'kept-result',
            imageUrl: '/kept.png',
            prompt: '保留方案',
            model: 'gpt-image-2',
            aspectRatio: '1:1',
            status: 'completed',
            createdAt: '05-18',
            module: 'one_click',
            backendJobId: 'kept-backend-job',
          },
        ],
        taskCount: 2,
        completedCount: 1,
      },
    ],
  }, [
    {
      id: 'deleted-backend-job',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'provider-finished-after-delete',
      payload: { prompt: '用户已删除的方案', projectId: 'project-with-deleted-pending-result', subFeature: 'first_image' },
      result: { imageUrl: '/deleted-finished.png', providerTaskId: 'provider-finished-after-delete' },
      createdAt: Date.now(),
      finishedAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'project-with-deleted-pending-result');
  assert.deepEqual(project?.results.map((result) => result.id), ['kept-result']);
  assert.equal(snapshot.projects.some((item) => item.id === 'job-deleted-backend-job'), false);
  assert.equal(snapshot.tasks.some((task) => task.id === 'deleted-backend-job'), false);
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

test('shell data adapter keeps active video project cards after refresh while backend job is running', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [
      {
        id: 'video-project-active',
        name: '短视频任务',
        module: 'video',
        status: 'generating',
        createdAt: '05-20',
        results: [],
        taskCount: 1,
        completedCount: 0,
        subFeature: 'generation',
        backendJobId: 'job-video-active',
      },
    ],
  }, [
    {
      id: 'job-video-active',
      module: 'video',
      taskType: 'kie_seedance_video',
      provider: 'kie',
      status: 'running',
      providerTaskId: 'provider-video-active',
      payload: {
        prompt: '视频脚本',
        subFeature: 'generation',
        aspectRatio: '9:16',
        resolution: '720p',
      },
      createdAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'video-project-active');
  assert.ok(project);
  assert.equal(project.status, 'generating');
  assert.equal(project.backendJobId, 'job-video-active');
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].mediaType, 'video');
  assert.equal(project.results[0].status, 'generating');
  assert.equal(project.results[0].backendJobId, 'job-video-active');
  assert.equal(project.results[0].prompt, '视频脚本');
  const task = snapshot.tasks.find((item) => item.id === 'job-video-active');
  assert.ok(task);
  assert.equal(task.projectId, 'video-project-active');
  assert.equal(task.type, 'video');
  assert.equal(task.status, 'generating');
});

test('shell data adapter keeps active non-video project cards after refresh while backend job is running', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [
      {
        id: 'main-image-active',
        name: '主图任务',
        module: 'one_click',
        status: 'generating',
        createdAt: '05-20',
        results: [],
        taskCount: 1,
        completedCount: 0,
        subFeature: 'main_image',
        backendJobId: 'job-main-active',
      },
    ],
  }, [
    {
      id: 'job-main-active',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'queued',
      providerTaskId: 'provider-main-active',
      payload: {
        prompt: '主图生成脚本',
        subFeature: 'main_image',
        shellProjectId: 'main-image-active',
        aspectRatio: '1:1',
      },
      createdAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'main-image-active');
  assert.ok(project);
  assert.equal(project.status, 'generating');
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].mediaType, 'image');
  assert.equal(project.results[0].status, 'generating');
  assert.equal(project.results[0].taskId, 'provider-main-active');
  assert.equal(project.results[0].backendJobId, 'job-main-active');
  const task = snapshot.tasks.find((item) => item.id === 'job-main-active');
  assert.ok(task);
  assert.equal(task.projectId, 'main-image-active');
  assert.equal(task.type, 'image');
  assert.equal(task.status, 'pending');
});

test('shell data adapter merges completed backend video results into the original project card', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [
      {
        id: 'video-project-completed',
        name: '短视频任务',
        module: 'video',
        status: 'generating',
        createdAt: '05-20',
        results: [{
          id: 'job-video-completed-pending',
          imageUrl: '',
          mediaType: 'video',
          prompt: '视频脚本',
          model: 'bytedance/seedance-2-fast',
          aspectRatio: '9:16',
          status: 'generating',
          createdAt: '05-20',
          module: 'video',
          subFeature: 'generation',
          backendJobId: 'job-video-completed',
        }],
        taskCount: 1,
        completedCount: 0,
        subFeature: 'generation',
        backendJobId: 'job-video-completed',
      },
    ],
  }, [
    {
      id: 'job-video-completed',
      module: 'video',
      taskType: 'kie_seedance_video',
      provider: 'kie',
      status: 'succeeded',
      payload: { prompt: '视频脚本', subFeature: 'generation', aspectRatio: '9:16' },
      result: {
        videoUrl: '/generated-video.mp4',
        creditsConsumed: 186,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'video-project-completed');
  assert.ok(project);
  assert.equal(project.status, 'completed');
  assert.equal(project.completedCount, 1);
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].videoUrl, '/generated-video.mp4');
  assert.equal(project.results[0].mediaType, 'video');
  assert.equal(project.results[0].status, 'completed');
  assert.equal(snapshot.tasks.length, 0);
});

test('shell data adapter clears stale video failure fields when backend video succeeds later', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [
      {
        id: 'video-project-late-success',
        name: '短视频误报失败',
        module: 'video',
        status: 'error',
        createdAt: '05-26',
        error: '请求超时，请稍后重试',
        results: [{
          id: 'provider-video-late-success',
          imageUrl: '',
          videoUrl: '',
          mediaType: 'video',
          prompt: '视频脚本',
          model: 'bytedance/seedance-2-fast',
          aspectRatio: '9:16',
          status: 'error',
          createdAt: '05-26',
          module: 'video',
          subFeature: 'generation',
          backendJobId: 'job-video-late-success',
          taskId: 'provider-video-late-success',
          error: '请求超时，请稍后重试',
        }],
        taskCount: 2,
        completedCount: 0,
        subFeature: 'generation',
        backendJobId: 'job-video-late-success',
      },
    ],
  }, [
    {
      id: 'job-video-late-success',
      module: 'video',
      taskType: 'kie_seedance_video',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'provider-video-late-success',
      payload: { prompt: '视频脚本', subFeature: 'generation', aspectRatio: '9:16' },
      result: {
        videoUrl: '/late-video.mp4',
        providerTaskId: 'provider-video-late-success',
        creditsConsumed: 495,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      finishedAt: Date.now(),
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'video-project-late-success');
  assert.ok(project);
  assert.equal(project.status, 'completed');
  assert.equal(project.taskCount, 1);
  assert.equal(project.completedCount, 1);
  assert.equal(project.error, undefined);
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].status, 'completed');
  assert.equal(project.results[0].videoUrl, '/late-video.mp4');
  assert.equal(project.results[0].error, undefined);
});

test('shell data adapter does not append parsed planning plans onto an existing one-click plan project', () => {
  const plans = Array.from({ length: 4 }).map((_, index) => ({
    id: `client-plan-${index + 1}`,
    title: `主图${index + 1}`,
    sellingPoints: [],
    sceneDescription: `客户端方案 ${index + 1}`,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: '',
    selected: true,
    schemeContent: `客户端方案 ${index + 1}`,
  }));
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'main-project-with-plans',
      name: '主图四张',
      module: 'one_click',
      status: 'planning',
      createdAt: '05-21',
      results: [],
      plans,
      selectedPlanId: plans[0].id,
      taskCount: 4,
      completedCount: 0,
      subFeature: 'main_image',
    }],
  }, [
    {
      id: 'abcdefabcdefabcdefabcdef',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'kie-planning-provider',
      payload: {
        shellProjectId: 'main-project-with-plans',
        subFeature: 'main_image',
      },
      result: {
        content: `[SCHEME_START]
- 屏序/类型：主图1
- 设计意图：不应该重新扩容
- 画面描述：服务端重新解析出的方案 1
[SCHEME_END]
[SCHEME_START]
- 屏序/类型：主图2
- 设计意图：不应该重新扩容
- 画面描述：服务端重新解析出的方案 2
[SCHEME_END]
[SCHEME_START]
- 屏序/类型：主图3
- 设计意图：不应该重新扩容
- 画面描述：服务端重新解析出的方案 3
[SCHEME_END]
[SCHEME_START]
- 屏序/类型：主图4
- 设计意图：不应该重新扩容
- 画面描述：服务端重新解析出的方案 4
[SCHEME_END]`,
        creditsConsumed: 0.33,
      },
      createdAt: 2000,
      updatedAt: 3000,
      finishedAt: 3000,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'main-project-with-plans');
  assert.ok(project);
  assert.equal(project.plans?.length, 4);
  assert.deepEqual(project.plans?.map((plan) => plan.id), plans.map((plan) => plan.id));
  assert.equal(project.taskCount, 4);
  assert.equal(project.planningTaskId, 'kie-planning-provider');
  assert.equal(project.plans?.some((plan) => plan.id.startsWith('abcdefabcdefabcdefabcdef-plan-')), false);
});

test('shell data adapter preserves same-plan one-click main-image result history by backend task', () => {
  const plans = ['plan-1', 'plan-2', 'plan-3', 'plan-4'].map((id) => ({
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
  }));
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'main-project-retry',
      name: '主图四张',
      module: 'one_click',
      status: 'generating',
      createdAt: '05-21',
      plans,
      selectedPlanId: 'plan-1',
      taskCount: 4,
      completedCount: 1,
      subFeature: 'main_image',
      results: [{
        id: 'old-provider-plan-1',
        planId: 'plan-1',
        imageUrl: '/old-plan-1.png',
        prompt: '旧提示词 plan-1',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'completed',
        createdAt: '05-21',
        module: 'one_click',
        subFeature: 'main_image',
        taskId: 'old-provider-plan-1',
        backendJobId: 'old-job-plan-1',
      }],
    }],
  }, [
    {
      id: 'new-job-plan-1',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'succeeded',
      providerTaskId: 'new-provider-plan-1',
      payload: {
        prompt: '新提示词 plan-1',
        shellProjectId: 'main-project-retry',
        shellPlanId: 'plan-1',
        subFeature: 'main_image',
        batchIndex: 1,
        batchCount: 4,
      },
      result: {
        imageUrl: '/new-plan-1.png',
        providerTaskId: 'new-provider-plan-1',
      },
      createdAt: 3000,
      updatedAt: 4000,
      finishedAt: 4000,
    },
  ]);

  const project = snapshot.projects.find((item) => item.id === 'main-project-retry');
  assert.ok(project);
  assert.equal(project.taskCount, 4);
  assert.equal(project.results.length, 2);
  assert.deepEqual(project.results.map((result) => result.taskId), ['old-provider-plan-1', 'new-provider-plan-1']);
  assert.deepEqual(project.results.map((result) => result.imageUrl), ['/old-plan-1.png', '/new-plan-1.png']);
});

test('shell data adapter preserves distinct same-plan one-click task results after refresh', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'main-project-same-plan-tasks',
      name: '主图同方案多任务',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-25',
      selectedPlanId: 'plan-1',
      taskCount: 2,
      completedCount: 2,
      subFeature: 'main_image',
      plans: [{
        id: 'plan-1',
        title: '方案 1',
        sellingPoints: [],
        sceneDescription: '同一方案生成两个真实任务',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
        schemeContent: '方案 1',
      }],
      results: [
        {
          id: 'provider-same-plan-a',
          planId: 'plan-1',
          imageUrl: '/same-plan-a.png',
          prompt: '同方案任务 A',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'completed',
          createdAt: '05-25',
          module: 'one_click',
          subFeature: 'main_image',
          taskId: 'provider-same-plan-a',
          backendJobId: 'job-same-plan-a',
        },
        {
          id: 'provider-same-plan-b',
          planId: 'plan-1',
          imageUrl: '/same-plan-b.png',
          prompt: '同方案任务 B',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'completed',
          createdAt: '05-25',
          module: 'one_click',
          subFeature: 'main_image',
          taskId: 'provider-same-plan-b',
          backendJobId: 'job-same-plan-b',
        },
      ],
    }],
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'main-project-same-plan-tasks');
  assert.ok(project);
  assert.equal(project.results.length, 2);
  assert.deepEqual(project.results.map((result) => result.taskId), ['provider-same-plan-a', 'provider-same-plan-b']);
  assert.equal(project.completedCount, 2);
  assert.equal(project.taskCount, 2);
});

test('shell data adapter lets completed backend one-click jobs clear stale same-plan failure placeholders', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'main-project-recovers-error',
      name: '主图失败后后台完成',
      module: 'one_click',
      status: 'error',
      createdAt: '05-25',
      selectedPlanId: 'plan-1',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'main_image',
      plans: [{
        id: 'plan-1',
        title: '方案 1',
        sellingPoints: [],
        sceneDescription: '后台稍后完成',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
        schemeContent: '方案 1',
      }],
      results: [{
        id: 'task-img-error-0',
        planId: 'plan-1',
        imageUrl: '',
        prompt: '前端等待中断后误判失败',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'error',
        createdAt: '05-25',
        module: 'one_click',
        subFeature: 'main_image',
        error: '前端等待中断后误判失败',
      }],
    }],
  }, [{
    id: 'backend-job-late-success',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: 'provider-late-success',
    payload: {
      prompt: '后台完成结果',
      shellProjectId: 'main-project-recovers-error',
      shellPlanId: 'plan-1',
      subFeature: 'main_image',
      batchIndex: 1,
      batchCount: 1,
    },
    result: {
      imageUrl: '/late-success.png',
      providerTaskId: 'provider-late-success',
    },
    createdAt: 3000,
    updatedAt: 4000,
    finishedAt: 4000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'main-project-recovers-error');
  assert.ok(project);
  assert.equal(project.status, 'completed');
  assert.equal(project.taskCount, 1);
  assert.equal(project.completedCount, 1);
  assert.deepEqual(project.results.map((result) => result.status), ['completed']);
  assert.equal(project.results[0].taskId, 'provider-late-success');
  assert.equal(project.results[0].imageUrl, '/late-success.png');
});

test('shell data adapter clears stale planning failure when backend planning job later succeeds with existing plans', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'first-image-planning-recovers',
      name: '5月28日项目9',
      module: 'one_click',
      status: 'error',
      createdAt: '05-28',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-job-1',
      plans: [{
        id: 'planning-job-1-plan-1',
        title: '首图裂变1-复刻主图参考1',
        sellingPoints: [],
        sceneDescription: '真实策划内容',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
        schemeContent: '真实策划内容',
      }],
      results: [{
        id: 'task-plan-error',
        imageUrl: '',
        prompt: '共 1 张参考图，其中 1 张策划失败。',
        model: 'kie_chat',
        aspectRatio: 'auto',
        status: 'error',
        createdAt: '05-28',
        module: 'one_click',
        subFeature: 'first_image',
        error: '共 1 张参考图，其中 1 张策划失败。',
      }],
    }],
  }, [{
    id: 'planning-job-1',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: 'kie-planning-task-1',
    payload: {
      shellPlanningPurpose: 'one_click_planning',
      shellProjectId: 'first-image-planning-recovers',
      subFeature: 'first_image',
    },
    result: {
      content: '真实策划内容',
      creditsConsumed: 0.23,
      providerTaskId: 'kie-planning-task-1',
    },
    createdAt: 3000,
    updatedAt: 4000,
    finishedAt: 4000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'first-image-planning-recovers');
  assert.ok(project);
  assert.equal(project.status, 'planning');
  assert.equal(project.results.length, 0);
  assert.equal(project.plans?.length, 1);
  assert.equal(project.creditsConsumed, 0.23);
  assert.equal(project.planningTaskId, 'kie-planning-task-1');
});

test('shell data adapter reconstructs a one-click planning project from a successful fallback planning job', () => {
  const snapshot = buildShellDataSnapshot({}, [{
    id: 'fallback-planning-job',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'succeeded',
    providerTaskId: 'resp-fallback-provider',
    payload: {
      shellPlanningPurpose: 'one_click_planning',
      shellProjectId: 'proj-plan-fallback',
      shellProjectName: '5月29日项目1',
      subFeature: 'first_image',
      shellReferenceUrl: 'https://example.com/ref.jpg',
      model: 'gemini-3-flash-openai',
      fallbackModels: ['gpt-5-4-openai-resp'],
    },
    result: {
      content: `[SCHEME_START]
- 屏序/类型：首图裂变1-复刻主图参考1
- 参考图标识：复刻主图参考1
- 设计意图：fallback 后 GPT5.4 成功返回
- 画面描述：真实策划内容
- 画面比例：1:1
[SCHEME_END]`,
      modelUsed: 'gpt-5-4-openai-resp',
      fallbackFrom: 'gemini-3-flash-openai',
      providerTaskId: 'resp-fallback-provider',
      creditsConsumed: 0.42,
    },
    createdAt: 3000,
    updatedAt: 4000,
    finishedAt: 4000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'proj-plan-fallback');
  assert.ok(project);
  assert.equal(project.name, '5月29日项目1');
  assert.equal(project.status, 'planning');
  assert.equal(project.subFeature, 'first_image');
  assert.equal(project.results.length, 0);
  assert.equal(project.plans?.length, 1);
  assert.equal(project.plans?.[0]?.schemeContent?.includes('真实策划内容'), true);
  assert.equal(project.plans?.[0]?.sourceReferenceUrl, 'https://example.com/ref.jpg');
  assert.equal(project.planningTaskId, 'resp-fallback-provider');
  assert.equal(project.creditsConsumed, 0.42);
});

test('shell data adapter reconstructs a tracked failed one-click planning project without a persisted snapshot', () => {
  const snapshot = buildShellDataSnapshot({}, [{
    id: 'planning-failed-job',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'failed',
    providerTaskId: 'kie-failed-planning-provider',
    errorCode: 'provider_bad_request',
    errorMessage: '上游返回失败：内容不可用',
    payload: {
      shellPlanningPurpose: 'one_click_planning',
      shellProjectId: 'proj-plan-failed',
      shellProjectName: '5月29日项目失败',
      subFeature: 'first_image',
      model: 'gemini-3-flash-openai',
      fallbackModels: ['gpt-5-4-openai-resp'],
    },
    result: {},
    createdAt: 3000,
    updatedAt: 4000,
    finishedAt: 4000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'proj-plan-failed');
  assert.ok(project);
  assert.equal(project.name, '5月29日项目失败');
  assert.equal(project.status, 'error');
  assert.equal(project.subFeature, 'first_image');
  assert.equal(project.backendJobId, 'planning-failed-job');
  assert.equal(project.planningTaskId, 'kie-failed-planning-provider');
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].status, 'error');
  assert.equal(project.results[0].taskId, 'kie-failed-planning-provider');
  assert.match(project.results[0].error, /上游返回失败/);
});

test('shell data adapter promotes matched failed one-click planning jobs over pending planning state', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'proj-plan-stuck',
      name: '6月2日项目失败',
      module: 'one_click',
      status: 'planning',
      createdAt: '06-02',
      backendJobId: 'planning-failed-job',
      results: [],
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      plans: [{
        id: 'planning-failed-job-plan-1',
        title: '首图裂变1-复刻主图参考1',
        selected: true,
        schemeContent: '[SCHEME_START]\n- 画面描述：旧占位\n[SCHEME_END]',
      }],
      selectedPlanId: 'planning-failed-job-plan-1',
    }],
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'proj-plan-stuck',
          name: '6月2日项目失败',
          status: 'planning',
          backendJobId: 'planning-failed-job',
          plans: [{
            id: 'planning-failed-job-plan-1',
            title: '首图裂变1-复刻主图参考1',
            selected: true,
            schemeContent: '[SCHEME_START]\n- 画面描述：旧占位\n[SCHEME_END]',
          }],
          selectedPlanId: 'planning-failed-job-plan-1',
          taskCount: 1,
          completedCount: 0,
        }],
      },
      mainImage: { projects: [] },
      detailPage: { projects: [] },
      sku: { projects: [] },
    },
  }, [{
    id: 'planning-failed-job',
    module: 'one_click',
    taskType: 'kie_chat',
    provider: 'kie',
    status: 'failed',
    providerTaskId: 'kie-failed-planning-provider',
    errorCode: 'provider_timeout',
    errorMessage: 'Kie Claude 请求超时',
    payload: {
      shellPlanningPurpose: 'one_click_planning',
      shellProjectId: 'proj-plan-stuck',
      shellProjectName: '6月2日项目失败',
      subFeature: 'first_image',
      model: 'claude-sonnet-4-openai',
    },
    result: {},
    createdAt: 3000,
    updatedAt: 4000,
    finishedAt: 4000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'proj-plan-stuck');
  assert.ok(project);
  assert.equal(project.status, 'error');
  assert.equal(project.backendJobId, 'planning-failed-job');
  assert.equal(project.planningTaskId, 'kie-failed-planning-provider');
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].status, 'error');
  assert.equal(project.results[0].backendJobId, 'planning-failed-job');
  assert.match(project.error, /Kie Claude 请求超时/);
});

test('shell data adapter collapses duplicate no-media failures for the same one-click plan', () => {
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'one-task-duplicate-failures',
      name: '单任务失败重复卡',
      module: 'one_click',
      status: 'error',
      createdAt: '05-28',
      selectedPlanId: 'plan-1',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'main_image',
      plans: [{
        id: 'plan-1',
        title: '方案 1',
        sellingPoints: [],
        sceneDescription: '方案 1',
        styleDirection: '',
        colorPalette: '',
        composition: '',
        textLayout: '',
        selected: true,
        schemeContent: '方案 1',
      }],
      results: [{
        id: 'provider-old',
        planId: 'plan-1',
        imageUrl: '',
        prompt: '旧失败占位',
        model: 'gpt-image-2',
        aspectRatio: '1:1',
        status: 'error',
        createdAt: '05-28',
        module: 'one_click',
        subFeature: 'main_image',
        taskId: 'provider-old',
        backendJobId: 'image-job-old',
        error: '旧失败占位',
      }],
    }],
  }, [{
    id: 'image-job-new',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'failed',
    providerTaskId: 'provider-new',
    errorMessage: '任务失败',
    payload: {
      prompt: '方案 1',
      shellProjectId: 'one-task-duplicate-failures',
      shellPlanId: 'plan-1',
      subFeature: 'main_image',
      batchIndex: 1,
      batchCount: 1,
    },
    result: {
      providerTaskId: 'provider-new',
    },
    createdAt: 3000,
    updatedAt: 4000,
    finishedAt: 4000,
  }]);

  const project = snapshot.projects.find((item) => item.id === 'one-task-duplicate-failures');
  assert.ok(project);
  assert.equal(project.results.length, 1);
  assert.equal(project.results[0].planId, 'plan-1');
  assert.equal(project.results[0].taskId, 'provider-new');
  assert.equal(project.results[0].backendJobId, 'image-job-new');
});

test('shell data adapter normalizes polluted first-image projects after backend success', () => {
  const plans = Array.from({ length: 4 }, (_, index) => ({
    id: `client-plan-${index + 1}`,
    title: `首图方案 ${index + 1}`,
    sellingPoints: [],
    sceneDescription: `客户端首图方案 ${index + 1}`,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: '',
    selected: true,
    schemeContent: `客户端首图方案 ${index + 1}`,
  }));
  const completedResults = plans.map((plan, index) => ({
    id: `provider-${index + 1}`,
    planId: plan.id,
    projectId: 'polluted-first-image-project',
    imageUrl: `/first-image-${index + 1}.png`,
    prompt: `完成结果 ${index + 1}`,
    model: 'gpt-image-2',
    aspectRatio: '1:1',
    status: 'completed',
    createdAt: '05-26',
    module: 'one_click',
    subFeature: 'first_image',
    taskId: `provider-${index + 1}`,
    backendJobId: `image-job-${index + 1}`,
  }));
  const snapshot = buildShellDataSnapshot({
    shellProjects: [{
      id: 'polluted-first-image-project',
      name: '5月26日项目2',
      module: 'one_click',
      status: 'error',
      createdAt: '05-26',
      selectedPlanId: plans[0].id,
      taskCount: 13,
      completedCount: 4,
      subFeature: 'first_image',
      plans: [
        ...plans,
        { id: 'e0e7abe685d2f5986735dd7f-plan-1', title: '后台重复策划', selected: true, schemeContent: '不应扩容任务卡' },
        { id: 'a81be24d397a41067b599126-plan-1', title: '后台重复策划', selected: true, schemeContent: '不应扩容任务卡' },
      ],
      results: [
        ...completedResults,
        {
          id: 'failed-planning-job-error',
          planId: plans[0].id,
          projectId: 'polluted-first-image-project',
          imageUrl: '',
          prompt: 'The server is currently being maintained, please try again later~',
          model: 'kie_chat',
          aspectRatio: 'auto',
          status: 'error',
          createdAt: '05-26',
          module: 'one_click',
          subFeature: 'first_image',
          backendJobId: 'failed-planning-job',
          error: 'The server is currently being maintained, please try again later~',
        },
        {
          id: 'task-img-network-error-1',
          planId: plans[0].id,
          projectId: 'polluted-first-image-project',
          imageUrl: '',
          prompt: '网络连接失败，请检查网络后重试',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'error',
          createdAt: '05-26',
          module: 'one_click',
          subFeature: 'first_image',
          error: '网络连接失败，请检查网络后重试',
        },
        {
          id: plans[2].id,
          planId: plans[2].id,
          projectId: 'polluted-first-image-project',
          imageUrl: '',
          prompt: '网络连接失败，请检查网络后重试',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'error',
          createdAt: '05-26',
          module: 'one_click',
          subFeature: 'first_image',
          error: '网络连接失败，请检查网络后重试',
        },
        {
          id: 'frontend-network-error-after-success',
          projectId: 'polluted-first-image-project',
          imageUrl: '',
          prompt: '网络连接失败，请检查网络后重试',
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          status: 'error',
          createdAt: '05-26',
          module: 'one_click',
          subFeature: 'first_image',
          error: '网络连接失败，请检查网络后重试',
        },
      ],
    }],
  }, []);

  const project = snapshot.projects.find((item) => item.id === 'polluted-first-image-project');
  assert.ok(project);
  assert.equal(project.status, 'completed');
  assert.equal(project.taskCount, 4);
  assert.equal(project.completedCount, 4);
  assert.deepEqual(project.plans?.map((plan) => plan.id), plans.map((plan) => plan.id));
  assert.deepEqual(project.results.map((result) => result.status), ['completed', 'completed', 'completed', 'completed']);
  assert.deepEqual(project.results.map((result) => result.imageUrl), completedResults.map((result) => result.imageUrl));
});
