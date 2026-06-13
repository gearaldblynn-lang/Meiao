import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compactAppStateForStorage, mergeAppStateForStorage } from './appStateMerge.mjs';

const serverSource = () => readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('mysql app state writes suppress binary logging for full state payloads', () => {
  const source = serverSource();

  assert.match(source, /const runAppStateWriteWithoutBinlog = async \(pool, sql, params\) =>/);
  assert.match(source, /SET SESSION sql_log_bin = 0/);
  assert.match(source, /SET SESSION sql_log_bin = 1/);
  assert.match(source, /await runAppStateWriteWithoutBinlog\(pool,[\s\S]*INSERT INTO app_states \(user_id, state_json, updated_at\)[\s\S]*ON DUPLICATE KEY UPDATE state_json = VALUES\(state_json\), updated_at = VALUES\(updated_at\)/);
});

test('mysql app state write failures redact oversized state payloads before logging', () => {
  const source = serverSource();

  assert.match(source, /const redactAppStateWriteError = \(error\) =>/);
  assert.match(source, /error\.sql = '\[redacted app_states write sql\]'/);
  assert.match(source, /error\.sqlMessage = String\(error\.sqlMessage \|\| error\.message \|\| 'app_states write failed'\)\.slice\(0, 500\)/);
  assert.match(source, /catch \(error\) \{[\s\S]*throw redactAppStateWriteError\(error\);[\s\S]*\} finally \{/);
});

test('mergeAppStateForStorage preserves existing project cards when a draft-only write arrives', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'project-a',
      backendJobId: 'job-a',
      name: '已完成项目',
      results: [{ id: 'result-a', taskId: 'provider-a', imageUrl: '/a.png' }],
    }],
  }, {
    shellDraft: {
      inputStateByScope: { 'one_click:first_image': { promptText: '新草稿' } },
      materials: {},
    },
    shellProjects: [],
  });

  assert.equal(merged.shellProjects.length, 1);
  assert.equal(merged.shellProjects[0].id, 'project-a');
  assert.equal(merged.shellDraft.inputStateByScope['one_click:first_image'].promptText, '新草稿');
});

test('mergeAppStateForStorage does not let empty draft input wipe existing scoped prompt', () => {
  const merged = mergeAppStateForStorage({
    shellDraft: {
      inputStateByScope: {
        'one_click:sku': {
          promptText: '林一新产品 SKU 输入',
          params: { mode: 'SKU', count: '3' },
        },
      },
      materials: {
        product: [{
          id: 'product-new',
          url: 'https://example.com/new.png',
          remoteUrl: 'https://example.com/new.png',
          localAssetId: '',
        }],
      },
    },
  }, {
    shellDraft: {
      inputStateByScope: {
        'one_click:sku': {
          promptText: '',
          params: { count: '5' },
        },
      },
      materials: {},
    },
  });

  assert.equal(merged.shellDraft.inputStateByScope['one_click:sku'].promptText, '林一新产品 SKU 输入');
  assert.equal(merged.shellDraft.inputStateByScope['one_click:sku'].params.count, '5');
  assert.equal(merged.shellDraft.materials.product[0].remoteUrl, 'https://example.com/new.png');
});

test('mergeAppStateForStorage treats incoming draft materials as authoritative per type', () => {
  const merged = mergeAppStateForStorage({
    shellDraft: {
      inputStateByScope: {},
      materials: {
        product: [{
          id: 'old-product',
          url: 'https://example.com/old.png',
          remoteUrl: 'https://example.com/old.png',
        }],
        styleRef: [{
          id: 'style-ref',
          url: 'https://example.com/style.png',
          remoteUrl: 'https://example.com/style.png',
        }],
      },
    },
  }, {
    shellDraft: {
      inputStateByScope: {},
      materials: {
        product: [{
          id: 'new-product',
          url: 'https://example.com/new.png',
          remoteUrl: 'https://example.com/new.png',
        }],
      },
    },
  });

  assert.equal(merged.shellDraft.materials.product.length, 1);
  assert.equal(merged.shellDraft.materials.product[0].id, 'new-product');
  assert.equal(merged.shellDraft.materials.styleRef[0].id, 'style-ref');
});

test('mergeAppStateForStorage lets incoming project updates win without duplicating backend jobs', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'project-a',
      backendJobId: 'job-a',
      name: '旧项目名',
      results: [{ id: 'old-result', taskId: 'provider-a', imageUrl: '/old.png' }],
    }],
  }, {
    shellProjects: [{
      id: 'project-a-updated',
      backendJobId: 'job-a',
      name: '新项目名',
      results: [{ id: 'new-result', taskId: 'provider-a', imageUrl: '/new.png' }],
    }],
  });

  assert.equal(merged.shellProjects.length, 1);
  assert.equal(merged.shellProjects[0].id, 'project-a-updated');
  assert.equal(merged.shellProjects[0].name, '新项目名');
  assert.equal(merged.shellProjects[0].results[0].imageUrl, '/new.png');
});

test('mergeAppStateForStorage lets a submitted edit job replace the old result identity while generating', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'project-a',
      module: 'one_click',
      status: 'completed',
      taskCount: 1,
      completedCount: 1,
      results: [{
        id: 'result-a',
        planId: 'plan-a',
        taskId: 'old-provider-task',
        backendJobId: 'old-backend-job',
        imageUrl: '/old.png',
        status: 'completed',
      }],
    }],
  }, {
    shellProjects: [{
      id: 'project-a',
      module: 'one_click',
      status: 'generating',
      taskCount: 1,
      completedCount: 0,
      results: [{
        id: 'result-a',
        planId: 'plan-a',
        taskId: 'new-provider-task',
        backendJobId: 'new-backend-job',
        imageUrl: '',
        status: 'generating',
      }],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'generating');
  assert.equal(merged.shellProjects[0].results[0].status, 'generating');
  assert.equal(merged.shellProjects[0].results[0].taskId, 'new-provider-task');
  assert.equal(merged.shellProjects[0].results[0].backendJobId, 'new-backend-job');
  assert.equal(merged.shellProjects[0].results[0].imageUrl, '');
});

test('mergeAppStateForStorage replaces stale planning placeholders with terminal backend failure', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'proj-plan-failed-retry',
      module: 'one_click',
      status: 'error',
      taskCount: 2,
      completedCount: 0,
      subFeature: 'first_image',
      results: [
        {
          id: 'task-proj-plan-failed-retry-error',
          status: 'error',
          imageUrl: '',
          prompt: '共 1 张参考图，其中 1 张策划失败。',
          module: 'one_click',
          subFeature: 'first_image',
        },
        {
          id: 'planning-job-failed-pending',
          status: 'generating',
          imageUrl: '',
          prompt: '任务正在运行',
          backendJobId: 'planning-job-failed',
          module: 'one_click',
          subFeature: 'first_image',
        },
      ],
    }],
  }, {
    shellProjects: [{
      id: 'proj-plan-failed-retry',
      module: 'one_click',
      status: 'error',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-job-failed',
      results: [{
        id: 'planning-job-failed-error',
        status: 'error',
        imageUrl: '',
        prompt: 'Kie 素材上传超时',
        error: 'Kie 素材上传超时',
        backendJobId: 'planning-job-failed',
        module: 'one_click',
        subFeature: 'first_image',
      }],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'error');
  assert.equal(merged.shellProjects[0].taskCount, 1);
  assert.equal(merged.shellProjects[0].results.length, 1);
  assert.equal(merged.shellProjects[0].results[0].backendJobId, 'planning-job-failed');
  assert.equal(merged.shellProjects[0].results[0].status, 'error');
});

test('mergeAppStateForStorage clears planning job pending placeholders after planning succeeds', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'planning-succeeded-but-pending',
      module: 'one_click',
      status: 'generating',
      taskCount: 2,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-job-succeeded',
      planningTaskId: 'planning-job-succeeded',
      plans: [{
        id: 'plan-after-success',
        title: '首图裂变1-复刻主图参考1',
        selected: true,
      }],
      selectedPlanId: 'plan-after-success',
      results: [{
        id: 'planning-job-succeeded-pending',
        status: 'generating',
        imageUrl: '',
        prompt: '任务已提交，等待执行',
        backendJobId: 'planning-job-succeeded',
        module: 'one_click',
        subFeature: 'first_image',
      }],
    }],
  }, {
    shellProjects: [{
      id: 'planning-succeeded-but-pending',
      module: 'one_click',
      status: 'planning',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      backendJobId: 'planning-job-succeeded',
      planningTaskId: 'planning-job-succeeded',
      plans: [{
        id: 'plan-after-success',
        title: '首图裂变1-复刻主图参考1',
        selected: true,
      }],
      selectedPlanId: 'plan-after-success',
      results: [],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'planning');
  assert.equal(merged.shellProjects[0].taskCount, 1);
  assert.equal(merged.shellProjects[0].completedCount, 0);
  assert.equal(merged.shellProjects[0].results.length, 0);
  assert.equal(merged.shellProjects[0].plans.length, 1);
});

test('mergeAppStateForStorage keeps plan-only pending one-click projects out of generating state', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'proj-plan-only-pending',
      module: 'one_click',
      status: 'generating',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      plans: [{
        id: 'plan-only-1',
        title: '首图裂变1',
        selected: true,
      }],
      schemes: [{
        id: 'plan-only-1',
        status: 'pending',
        uiTitle: '首图裂变1',
        editedContent: '策划内容',
        selected: true,
      }],
      results: [],
    }],
  }, {
    shellProjects: [{
      id: 'proj-plan-only-pending',
      module: 'one_click',
      status: 'planning',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      plans: [{
        id: 'plan-only-1',
        title: '首图裂变1',
        selected: true,
      }],
      schemes: [{
        id: 'plan-only-1',
        status: 'pending',
        uiTitle: '首图裂变1',
        editedContent: '策划内容',
        selected: true,
      }],
      results: [],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'planning');
  assert.equal(merged.shellProjects[0].taskCount, 1);
  assert.equal(merged.shellProjects[0].completedCount, 0);
  assert.equal(merged.shellProjects[0].schemes[0].status, 'pending');
});

test('mergeAppStateForStorage drops invalid completed one-click media from failed planning placeholders', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'failed-planning-project',
      module: 'one_click',
      status: 'completed',
      taskCount: 2,
      completedCount: 1,
      subFeature: 'first_image',
      plans: [{
        id: 'planning-error',
        title: '5月29日项目12',
        selected: true,
        schemeContent: 'fetch failed',
      }],
      results: [{
        id: 'planning-error',
        planId: 'planning-error',
        status: 'completed',
        imageUrl: 'https://example.com/bad.png',
        prompt: 'fetch failed',
        module: 'one_click',
        subFeature: 'first_image',
      }],
    }],
  }, {
    shellProjects: [{
      id: 'failed-planning-project',
      module: 'one_click',
      status: 'error',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      results: [{
        id: 'task-plan-error',
        status: 'error',
        imageUrl: '',
        prompt: '共 1 张参考图，其中 1 张策划失败。',
        error: '共 1 张参考图，其中 1 张策划失败。',
        module: 'one_click',
        subFeature: 'first_image',
      }],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'error');
  assert.equal(merged.shellProjects[0].taskCount, 1);
  assert.equal(merged.shellProjects[0].completedCount, 0);
  assert.equal(merged.shellProjects[0].plans.length, 1);
  assert.equal(merged.shellProjects[0].plans[0].planningFailed, true);
  assert.equal(merged.shellProjects[0].plans[0].selected, false);
  assert.equal(merged.shellProjects[0].results.length, 0);
});

test('mergeAppStateForStorage keeps persisted auth-text pollution as failed planning card without backend identity', () => {
  const authText = 'Unauthorized - Authentication failed. Please check that your Authorization and Content-Type headers are correctly set.';
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'auth-dirty-project',
      module: 'one_click',
      status: 'error',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      plans: [{
        id: 'auth-dirty-plan',
        title: '首图参考 1',
        selected: true,
        schemeContent: authText,
      }],
      results: [{
        id: 'auth-dirty-result',
        planId: 'auth-dirty-plan',
        status: 'error',
        imageUrl: '',
        prompt: authText,
        error: authText,
        module: 'one_click',
        subFeature: 'first_image',
      }],
    }],
  }, {});

  assert.equal(merged.shellProjects.length, 1);
  assert.equal(merged.shellProjects[0].status, 'error');
  assert.equal(merged.shellProjects[0].plans.length, 1);
  assert.equal(merged.shellProjects[0].plans[0].planningFailed, true);
  assert.equal(merged.shellProjects[0].plans[0].selected, false);
  assert.match(merged.shellProjects[0].plans[0].error, /Authentication failed/);
  assert.equal(merged.shellProjects[0].results.length, 0);
  assert.equal(merged.shellProjects[0].taskCount, 1);
});

test('mergeAppStateForStorage keeps historical no-identity one-click failures visible instead of storing hidden dirty cards', () => {
  const failureText = '网络连接失败，请检查网络后重试';
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'network-dirty-project',
      module: 'one_click',
      status: 'error',
      taskCount: 1,
      completedCount: 0,
      subFeature: 'first_image',
      plans: [{
        id: 'network-dirty-plan',
        title: '首图参考 1',
        selected: true,
        schemeContent: failureText,
      }],
      results: [{
        id: 'network-dirty-result',
        planId: 'network-dirty-plan',
        status: 'error',
        imageUrl: '',
        prompt: failureText,
        error: failureText,
        module: 'one_click',
        subFeature: 'first_image',
      }],
    }],
  }, {});

  assert.equal(merged.shellProjects.length, 1);
  assert.equal(merged.shellProjects[0].status, 'error');
  assert.equal(merged.shellProjects[0].plans.length, 1);
  assert.equal(merged.shellProjects[0].plans[0].planningFailed, true);
  assert.equal(merged.shellProjects[0].plans[0].selected, false);
  assert.equal(merged.shellProjects[0].results.length, 0);
  assert.equal(merged.shellProjects[0].taskCount, 1);
});

test('mergeAppStateForStorage deep-merges one-click planning project snapshots without dropping plans', () => {
  const existingPlans = Array.from({ length: 5 }, (_, index) => ({
    id: `plan-${index + 1}`,
    title: `方案 ${index + 1}`,
    schemeContent: `旧方案 ${index + 1}`,
    selected: true,
  }));
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'proj-plan-5',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'planning',
      taskCount: 5,
      completedCount: 0,
      planningTaskId: 'kie-a,kie-b,kie-c,kie-d,kie-e',
      plans: existingPlans,
      results: [],
    }],
  }, {
    shellProjects: [{
      id: 'proj-plan-5',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'planning',
      taskCount: 1,
      completedCount: 0,
      planningTaskId: 'kie-a',
      plans: [{
        id: 'plan-1',
        title: '方案 1 新标题',
        schemeContent: '新方案 1',
        selected: false,
      }],
      results: [],
    }],
  });

  assert.equal(merged.shellProjects.length, 1);
  assert.equal(merged.shellProjects[0].plans.length, 5);
  assert.equal(merged.shellProjects[0].plans[0].title, '方案 1 新标题');
  assert.equal(merged.shellProjects[0].plans[0].selected, false);
  assert.deepEqual(merged.shellProjects[0].plans.map((plan) => plan.id), ['plan-1', 'plan-2', 'plan-3', 'plan-4', 'plan-5']);
  assert.equal(merged.shellProjects[0].taskCount, 5);
  assert.equal(merged.shellProjects[0].planningTaskId, 'kie-e');
});

test('mergeAppStateForStorage strips internal backend ids from planning task ids', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'duosang-stale-sku-project',
      module: 'one_click',
      subFeature: 'sku',
      status: 'planning',
      backendJobId: '6296de5c861e08699d96a92b',
      planningTaskId: '209a398cc2f3c9e1aabaf48a',
      taskCount: 2,
      completedCount: 1,
      plans: [
        { id: 'plan-1', title: 'SKU一', selected: true, schemeContent: '真实策划一' },
        { id: 'plan-2', title: 'SKU二', selected: true, schemeContent: '真实策划二' },
      ],
      results: [{
        id: '0db3a02612f517a9ea0c581210b37e8c',
        planId: 'plan-1',
        taskId: '0db3a02612f517a9ea0c581210b37e8c',
        backendJobId: '6296de5c861e08699d96a92b',
        imageUrl: '/sku-1.png',
        status: 'completed',
      }],
    }],
    oneClickMemory: {
      sku: {
        projects: [{
          id: 'duosang-stale-sku-project',
          status: 'planning',
          planningTaskId: '209a398cc2f3c9e1aabaf48a',
          plans: [
            { id: 'plan-1', title: 'SKU一', selected: true, schemeContent: '真实策划一' },
            { id: 'plan-2', title: 'SKU二', selected: true, schemeContent: '真实策划二' },
          ],
        }],
      },
    },
  }, {});

  assert.equal(merged.shellProjects[0].planningTaskId, undefined);
  assert.equal(merged.shellProjects[0].status, 'completed');
  assert.equal(merged.shellProjects[0].completedCount, 1);
  assert.equal(merged.shellProjects[0].taskCount, 2);
  assert.equal(merged.oneClickMemory.sku.projects[0].planningTaskId, undefined);
});

test('mergeAppStateForStorage keeps recovered sku plans when a stale completed snapshot writes back', () => {
  const recoveredPlans = [
    { id: 'planning-job-plan-1', title: 'SKU一', selected: true, schemeContent: '第一张策划' },
    { id: 'planning-job-plan-2', title: 'SKU二', selected: true, schemeContent: '第二张策划' },
  ];
  const completedResult = {
    id: 'provider-sku-1',
    planId: 'planning-job-plan-1',
    taskId: 'provider-sku-1',
    backendJobId: 'image-job-1',
    imageUrl: '/sku-1.png',
    status: 'completed',
  };
  const staleProject = {
    id: 'proj-sku',
    module: 'one_click',
    subFeature: 'sku',
    status: 'completed',
    taskCount: 1,
    completedCount: 1,
    plans: [],
    results: [completedResult],
    backendJobId: 'image-job-1',
  };

  const merged = mergeAppStateForStorage({
    shellProjects: [{
      ...staleProject,
      status: 'planning',
      taskCount: 2,
      plans: recoveredPlans,
      planningTaskId: 'planning-job',
    }],
    oneClickMemory: {
      sku: {
        projects: [{
          id: 'proj-sku',
          taskCount: 2,
          plans: recoveredPlans,
          schemes: [
            { id: 'planning-job-plan-1', planId: 'planning-job-plan-1', taskId: 'provider-sku-1', resultUrl: '/sku-1.png', status: 'completed' },
            { id: 'planning-job-plan-2', planId: 'planning-job-plan-2', status: 'planning' },
          ],
          planningTaskId: 'planning-job',
        }],
      },
    },
  }, {
    shellProjects: [staleProject],
    oneClickMemory: {
      sku: {
        projects: [{
          id: 'proj-sku',
          taskCount: 1,
          plans: [],
          schemes: [{ id: 'provider-sku-1', taskId: 'provider-sku-1', resultUrl: '/sku-1.png', status: 'completed' }],
        }],
      },
    },
  });

  assert.equal(merged.shellProjects[0].taskCount, 2);
  assert.equal(merged.shellProjects[0].plans.length, 2);
  assert.equal(merged.shellProjects[0].planningTaskId, 'planning-job');
  assert.equal(merged.oneClickMemory.sku.projects[0].taskCount, 2);
  assert.equal(merged.oneClickMemory.sku.projects[0].plans.length, 2);
  assert.equal(merged.oneClickMemory.sku.projects[0].schemes.length, 2);
  assert.equal(merged.oneClickMemory.sku.projects[0].schemes[0].planId, 'planning-job-plan-1');
});

test('mergeAppStateForStorage does not let stale planning failure overwrite recovered plans', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'proj-plan-recovered',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'planning',
      backendJobId: 'planning-job-a',
      taskCount: 1,
      completedCount: 0,
      plans: [{
        id: 'planning-job-a-plan-1',
        title: '首图裂变1-复刻主图参考1',
        schemeContent: '真实策划方案',
        selected: true,
      }],
      results: [],
    }],
  }, {
    shellProjects: [{
      id: 'proj-plan-recovered',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'error',
      backendJobId: 'planning-job-a',
      taskCount: 1,
      completedCount: 0,
      plans: [],
      results: [{
        id: 'task-proj-plan-recovered-error',
        status: 'error',
        imageUrl: '',
        prompt: '共 1 张参考图，其中 1 张策划失败。',
      }],
    }],
  });

  assert.equal(merged.shellProjects.length, 1);
  assert.equal(merged.shellProjects[0].status, 'planning');
  assert.equal(merged.shellProjects[0].results.length, 0);
  assert.equal(merged.shellProjects[0].plans.length, 1);
  assert.equal(merged.shellProjects[0].plans[0].title, '首图裂变1-复刻主图参考1');
});

test('mergeAppStateForStorage does not let stale one-click branch failure overwrite recovered plans without job id', () => {
  const recoveredProject = {
    id: 'proj-plan-recovered',
    module: 'one_click',
    subFeature: 'first_image',
    status: 'planning',
    backendJobId: 'planning-job-a',
    taskCount: 1,
    completedCount: 0,
    plans: [{
      id: 'planning-job-a-plan-1',
      title: '首图裂变1-复刻主图参考1',
      schemeContent: '真实策划方案',
      selected: true,
    }],
    results: [],
  };
  const staleBranchProject = {
    id: 'proj-plan-recovered',
    module: 'one_click',
    subFeature: 'first_image',
    status: 'error',
    taskCount: 1,
    completedCount: 0,
    results: [{
      id: 'task-proj-plan-recovered-error',
      status: 'error',
      imageUrl: '',
      prompt: '共 1 张参考图，其中 1 张策划失败。',
    }],
  };

  const merged = mergeAppStateForStorage({
    oneClickMemory: {
      firstImage: { projects: [recoveredProject] },
    },
  }, {
    oneClickMemory: {
      firstImage: { projects: [staleBranchProject] },
    },
  });

  const project = merged.oneClickMemory.firstImage.projects[0];
  assert.equal(project.status, 'planning');
  assert.equal(project.results.length, 0);
  assert.equal(project.plans.length, 1);
  assert.equal(project.plans[0].title, '首图裂变1-复刻主图参考1');
});

test('mergeAppStateForStorage deep-merges one-click branch projects and schemes', () => {
  const existingProjects = [{
    id: 'proj-branch-5',
    taskCount: 5,
    plans: Array.from({ length: 5 }, (_, index) => ({
      id: `branch-plan-${index + 1}`,
      title: `分支方案 ${index + 1}`,
    })),
    schemes: Array.from({ length: 5 }, (_, index) => ({
      id: `scheme-${index + 1}`,
      taskId: `kie-${index + 1}`,
      resultUrl: `/scheme-${index + 1}.png`,
    })),
  }];
  const merged = mergeAppStateForStorage({
    oneClickMemory: {
      firstImage: {
        projects: existingProjects,
      },
    },
  }, {
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'proj-branch-5',
          taskCount: 1,
          plans: [{ id: 'branch-plan-1', title: '分支方案 1 新标题' }],
          schemes: [{ id: 'scheme-1', taskId: 'kie-1', resultUrl: '/scheme-1-new.png' }],
        }],
      },
    },
  });

  const project = merged.oneClickMemory.firstImage.projects[0];
  assert.equal(project.plans.length, 5);
  assert.equal(project.schemes.length, 5);
  assert.equal(project.plans[0].title, '分支方案 1 新标题');
  assert.equal(project.schemes[0].resultUrl, '/scheme-1-new.png');
  assert.equal(project.taskCount, 5);
});

test('mergeAppStateForStorage keeps sibling results that share a project id', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'project-with-many-results',
      taskCount: 2,
      completedCount: 1,
      results: [
        { id: 'result-a', projectId: 'project-with-many-results', taskId: 'provider-a', imageUrl: '/a.png' },
      ],
    }],
  }, {
    shellProjects: [{
      id: 'project-with-many-results',
      taskCount: 2,
      completedCount: 2,
      results: [
        { id: 'result-b', projectId: 'project-with-many-results', taskId: 'provider-b', imageUrl: '/b.png' },
      ],
    }],
  });

  assert.deepEqual(
    merged.shellProjects[0].results.map((result) => result.id),
    ['result-b', 'result-a'],
  );
  assert.equal(merged.shellProjects[0].completedCount, 2);
});

test('mergeAppStateForStorage does not collapse non-project sibling items by project id', () => {
  const merged = mergeAppStateForStorage({
    translationMemory: {
      main: {
        files: [
          { id: 'file-a', projectId: 'translation-batch-1', resultUrl: '/a.png' },
        ],
      },
    },
    retouchMemory: {
      tasks: [
        { id: 'retouch-task-a', projectId: 'retouch-project-1', resultUrl: '/a.png' },
      ],
    },
  }, {
    translationMemory: {
      main: {
        files: [
          { id: 'file-b', projectId: 'translation-batch-1', resultUrl: '/b.png' },
        ],
      },
    },
    retouchMemory: {
      tasks: [
        { id: 'retouch-task-b', projectId: 'retouch-project-1', resultUrl: '/b.png' },
      ],
    },
  });

  assert.deepEqual(merged.translationMemory.main.files.map((file) => file.id), ['file-b', 'file-a']);
  assert.deepEqual(merged.retouchMemory.tasks.map((task) => task.id), ['retouch-task-b', 'retouch-task-a']);
});

test('mergeAppStateForStorage clears stale video failure fields when a completed video snapshot arrives', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'video-project-late-success',
      module: 'video',
      subFeature: 'generation',
      status: 'error',
      taskCount: 2,
      completedCount: 0,
      backendJobId: 'job-video-late-success',
      error: '请求超时，请稍后重试',
      results: [{
        id: 'provider-video-late-success',
        taskId: 'provider-video-late-success',
        backendJobId: 'job-video-late-success',
        status: 'error',
        imageUrl: '',
        videoUrl: '',
        error: '请求超时，请稍后重试',
      }],
    }],
  }, {
    shellProjects: [{
      id: 'video-project-late-success',
      module: 'video',
      subFeature: 'generation',
      status: 'completed',
      taskCount: 1,
      completedCount: 1,
      backendJobId: 'job-video-late-success',
      results: [{
        id: 'provider-video-late-success',
        taskId: 'provider-video-late-success',
        backendJobId: 'job-video-late-success',
        status: 'completed',
        imageUrl: '/late-video.mp4',
        videoUrl: '/late-video.mp4',
      }],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'completed');
  assert.equal(merged.shellProjects[0].taskCount, 1);
  assert.equal(merged.shellProjects[0].completedCount, 1);
  assert.equal(merged.shellProjects[0].error, undefined);
  assert.equal(merged.shellProjects[0].results.length, 1);
  assert.equal(merged.shellProjects[0].results[0].status, 'completed');
  assert.equal(merged.shellProjects[0].results[0].videoUrl, '/late-video.mp4');
  assert.equal(merged.shellProjects[0].results[0].error, undefined);
});

test('mergeAppStateForStorage preserves translation files across concurrent branch writes', () => {
  const merged = mergeAppStateForStorage({
    translationMemory: {
      main: { files: [{ id: 'file-a', projectId: 'batch-a', resultUrl: '/a.png' }] },
    },
  }, {
    translationMemory: {
      main: { files: [{ id: 'file-b', projectId: 'batch-b', resultUrl: '/b.png' }] },
    },
  });

  assert.deepEqual(merged.translationMemory.main.files.map((file) => file.id), ['file-b', 'file-a']);
});

test('mergeAppStateForStorage replaces stale translation processing file with completed same source', () => {
  const merged = mergeAppStateForStorage({
    translationMemory: {
      main: {
        files: [{
          id: 'stale-file',
          fileName: 'source-a.png',
          status: 'processing',
          progress: 12,
          sourceUrl: 'https://example.com/source-a.png',
          error: '任务已提交云端，结果待同步',
          projectId: 'translation-batch-1',
        }],
      },
    },
  }, {
    translationMemory: {
      main: {
        files: [{
          id: 'completed-file',
          fileName: 'source-a.png',
          status: 'completed',
          progress: 100,
          sourceUrl: 'https://example.com/source-a.png',
          resultUrl: '/result-a.png',
          taskId: 'provider-a',
          backendJobId: 'backend-job-a',
          projectId: 'translation-batch-1',
        }],
      },
    },
  });

  assert.equal(merged.translationMemory.main.files.length, 1);
  assert.equal(merged.translationMemory.main.files[0].id, 'completed-file');
  assert.equal(merged.translationMemory.main.files[0].status, 'completed');
  assert.equal(merged.translationMemory.main.files[0].error, undefined);
  assert.equal(merged.translationMemory.main.files[0].resultUrl, '/result-a.png');
  assert.equal(merged.translationMemory.main.isProcessing, false);
});

test('mergeAppStateForStorage does not keep translation processing true for empty pending placeholders', () => {
  const merged = mergeAppStateForStorage({
    translationMemory: {
      removeText: {
        isProcessing: true,
        files: [
          { id: 'empty-pending-1', fileName: 'white.jpg', status: 'pending', progress: 0 },
          { id: 'empty-pending-2', fileName: 'pink.jpg', status: 'pending', progress: 0 },
        ],
      },
    },
  }, {});

  assert.equal(merged.translationMemory.removeText.isProcessing, false);
});

test('mergeAppStateForStorage keeps translation processing true when a persisted file has executable identity', () => {
  const merged = mergeAppStateForStorage({
    translationMemory: {
      main: {
        isProcessing: false,
        files: [{
          id: 'active-file',
          fileName: 'source.jpg',
          status: 'processing',
          progress: 12,
          sourceUrl: 'https://example.com/source.jpg',
        }],
      },
    },
  }, {});

  assert.equal(merged.translationMemory.main.isProcessing, true);
});

test('mergeAppStateForStorage prunes existing projects covered by deletion tombstones', () => {
  const merged = mergeAppStateForStorage({
    shellProjects: [
      {
        id: 'deleted-project',
        backendJobId: 'job-a',
        name: '已删除项目',
        results: [{ id: 'result-a', taskId: 'provider-a', imageUrl: '/a.png' }],
      },
      {
        id: 'partial-project',
        name: '部分删除项目',
        results: [
          { id: 'deleted-result', imageUrl: '/deleted.png' },
          { id: 'kept-result', imageUrl: '/kept.png' },
        ],
      },
    ],
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'branch-deleted-project',
          schemes: [{ id: 'scheme-a', taskId: 'job-b', resultUrl: '/b.png' }],
        }],
      },
    },
  }, {
    shellDraft: {
      inputStateByScope: {},
      materials: {},
      deletedProjectIds: ['deleted-project'],
      deletedJobIds: ['job-b'],
      deletedResultIds: ['deleted-result'],
    },
  });

  assert.deepEqual(merged.shellProjects.map((project) => project.id), ['partial-project']);
  assert.deepEqual(merged.shellProjects[0].results.map((result) => result.id), ['kept-result']);
  assert.deepEqual(merged.shellDraft.deletedProjectIds, ['deleted-project']);
  assert.deepEqual(merged.shellDraft.deletedJobIds, ['job-b']);
  assert.deepEqual(merged.shellDraft.deletedResultIds, ['deleted-result']);
  assert.deepEqual(merged.oneClickMemory.firstImage.projects, []);
});

test('mergeAppStateForStorage keeps clean first-image completion from being polluted by stale failures', () => {
  const plans = Array.from({ length: 4 }, (_, index) => ({
    id: `client-plan-${index + 1}`,
    title: `首图方案 ${index + 1}`,
    selected: true,
    schemeContent: `客户端首图方案 ${index + 1}`,
  }));
  const completedResults = plans.map((plan, index) => ({
    id: `provider-${index + 1}`,
    planId: plan.id,
    projectId: 'polluted-first-image-project',
    imageUrl: `/first-image-${index + 1}.png`,
    status: 'completed',
    taskId: `provider-${index + 1}`,
    backendJobId: `image-job-${index + 1}`,
    module: 'one_click',
    subFeature: 'first_image',
  }));
  const staleFailures = [
    {
      id: 'failed-planning-job-error',
      planId: plans[0].id,
      projectId: 'polluted-first-image-project',
      status: 'error',
      imageUrl: '',
      backendJobId: 'failed-planning-job',
      error: 'The server is currently being maintained, please try again later~',
    },
    {
      id: 'task-img-network-error-1',
      planId: plans[0].id,
      projectId: 'polluted-first-image-project',
      status: 'error',
      imageUrl: '',
      error: '网络连接失败，请检查网络后重试',
    },
    {
      id: plans[2].id,
      planId: plans[2].id,
      projectId: 'polluted-first-image-project',
      status: 'error',
      imageUrl: '',
      error: '网络连接失败，请检查网络后重试',
    },
  ];

  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'polluted-first-image-project',
      name: '5月26日项目2',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'error',
      taskCount: 13,
      completedCount: 4,
      plans: [
        ...plans,
        { id: 'e0e7abe685d2f5986735dd7f-plan-1', title: '后台重复策划', selected: true },
        { id: 'a81be24d397a41067b599126-plan-1', title: '后台重复策划', selected: true },
      ],
      results: [
        ...completedResults,
        ...staleFailures,
      ],
      error: 'The server is currently being maintained, please try again later~',
    }],
  }, {
    shellProjects: [{
      id: 'polluted-first-image-project',
      name: '5月26日项目2',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'completed',
      taskCount: 4,
      completedCount: 4,
      plans,
      results: completedResults,
    }],
  });

  const project = merged.shellProjects[0];
  assert.equal(project.status, 'completed');
  assert.equal(project.taskCount, 4);
  assert.equal(project.completedCount, 4);
  assert.equal(project.error, undefined);
  assert.deepEqual(project.plans.map((plan) => plan.id), plans.map((plan) => plan.id));
  assert.deepEqual(project.results.map((result) => result.status), ['completed', 'completed', 'completed', 'completed']);
});

test('mergeAppStateForStorage ignores late frontend network placeholders after backend success', () => {
  const completedResult = {
    id: 'provider-success-1',
    planId: 'client-plan-1',
    projectId: 'late-network-project',
    imageUrl: '/first-image-success.png',
    status: 'completed',
    taskId: 'provider-task-success-1',
    backendJobId: 'backend-job-success-1',
    module: 'one_click',
    subFeature: 'first_image',
  };

  const merged = mergeAppStateForStorage({
    shellProjects: [{
      id: 'late-network-project',
      name: '6月1日项目3',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'completed',
      taskCount: 1,
      completedCount: 1,
      plans: [{
        id: 'client-plan-1',
        title: '首图裂变1-复刻主图参考1',
        selected: true,
        schemeContent: '真实策划结果',
      }],
      results: [completedResult],
    }],
  }, {
    shellProjects: [{
      id: 'late-network-project',
      name: '6月1日项目3',
      module: 'one_click',
      subFeature: 'first_image',
      status: 'error',
      taskCount: 1,
      completedCount: 0,
      results: [{
        id: 'frontend-network-error-after-success',
        projectId: 'late-network-project',
        status: 'error',
        imageUrl: '',
        error: '网络连接失败，请检查网络后重试',
        prompt: '网络连接失败，请检查网络后重试',
      }],
      error: '网络连接失败，请检查网络后重试',
    }],
  });

  const project = merged.shellProjects[0];
  assert.equal(project.status, 'completed');
  assert.equal(project.taskCount, 1);
  assert.equal(project.completedCount, 1);
  assert.equal(project.error, undefined);
  assert.deepEqual(project.results, [completedResult]);
});

test('mergeAppStateForStorage normalizes polluted one-click branch schemes', () => {
  const plans = Array.from({ length: 4 }, (_, index) => ({
    id: `client-plan-${index + 1}`,
    title: `首图方案 ${index + 1}`,
    selected: true,
  }));
  const completedSchemes = plans.map((plan, index) => ({
    id: plan.id,
    planId: plan.id,
    resultUrl: `/branch-${index + 1}.png`,
    status: 'completed',
    taskId: `provider-${index + 1}`,
    backendJobId: `image-job-${index + 1}`,
  }));

  const merged = mergeAppStateForStorage({
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'polluted-branch-project',
          status: 'error',
          taskCount: 9,
          completedCount: 4,
          plans: [
            ...plans,
            { id: 'e0e7abe685d2f5986735dd7f-plan-1', title: '后台重复策划' },
            { id: 'a81be24d397a41067b599126-plan-1', title: '后台重复策划' },
          ],
          schemes: [
            ...completedSchemes,
            { id: 'client-plan-1-error', planId: 'client-plan-1', status: 'error', error: '网络连接失败，请检查网络后重试' },
            { id: 'client-plan-2', planId: 'client-plan-2', status: 'error', error: '网络连接失败，请检查网络后重试' },
            { id: 'e0e7abe685d2f5986735dd7f-plan-1', status: 'pending' },
          ],
          error: '网络连接失败，请检查网络后重试',
        }],
      },
    },
  }, {
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'polluted-branch-project',
          status: 'completed',
          taskCount: 4,
          completedCount: 4,
          plans,
          schemes: completedSchemes,
        }],
      },
    },
  });

  const project = merged.oneClickMemory.firstImage.projects[0];
  assert.equal(project.status, 'completed');
  assert.equal(project.taskCount, 4);
  assert.equal(project.completedCount, 4);
  assert.equal(project.error, undefined);
  assert.deepEqual(project.plans.map((plan) => plan.id), plans.map((plan) => plan.id));
  assert.deepEqual(project.schemes.map((scheme) => scheme.status), ['completed', 'completed', 'completed', 'completed']);
  assert.deepEqual(project.schemes.map((scheme) => scheme.resultUrl), completedSchemes.map((scheme) => scheme.resultUrl));
});

test('mergeAppStateForStorage normalizes stale placeholders for every project module', () => {
  const staleProject = (module, subFeature, id) => ({
    id,
    module,
    subFeature,
    status: 'error',
    taskCount: 4,
    completedCount: 1,
    error: '网络连接失败，请检查网络后重试',
    results: [
      {
        id: `${id}-provider`,
        planId: `${id}-slot`,
        imageUrl: module === 'video' ? '' : `/${id}.png`,
        videoUrl: module === 'video' ? `/${id}.mp4` : '',
        status: 'completed',
        taskId: `${id}-provider`,
        backendJobId: `${id}-job`,
      },
      {
        id: `${id}-network-error`,
        planId: `${id}-slot`,
        imageUrl: '',
        videoUrl: '',
        status: 'error',
        error: '网络连接失败，请检查网络后重试',
      },
      {
        id: `${id}-pending-placeholder`,
        planId: `${id}-slot`,
        imageUrl: '',
        videoUrl: '',
        status: 'generating',
      },
    ],
  });
  const completedProject = (module, subFeature, id) => ({
    id,
    module,
    subFeature,
    status: 'completed',
    taskCount: 1,
    completedCount: 1,
    results: [staleProject(module, subFeature, id).results[0]],
  });

  const merged = mergeAppStateForStorage({
    shellProjects: [
      staleProject('retouch', 'white_bg', 'retouch-project'),
      staleProject('buyer_show', 'image', 'buyer-show-project'),
      staleProject('xhs_cover', 'cover', 'xhs-project'),
      staleProject('video', 'generation', 'video-project'),
    ],
    buyerShowMemory: {
      sets: [staleProject('buyer_show', 'image', 'buyer-show-set')],
    },
    xhsCoverMemory: {
      projects: [staleProject('xhs_cover', 'cover', 'xhs-memory-project')],
    },
    videoMemory: {
      veoProjects: [staleProject('video', 'generation', 'video-memory-project')],
      storyboard: {
        projects: [staleProject('video', 'storyboard', 'storyboard-project')],
      },
    },
  }, {
    shellProjects: [
      completedProject('retouch', 'white_bg', 'retouch-project'),
      completedProject('buyer_show', 'image', 'buyer-show-project'),
      completedProject('xhs_cover', 'cover', 'xhs-project'),
      completedProject('video', 'generation', 'video-project'),
    ],
    buyerShowMemory: {
      sets: [completedProject('buyer_show', 'image', 'buyer-show-set')],
    },
    xhsCoverMemory: {
      projects: [completedProject('xhs_cover', 'cover', 'xhs-memory-project')],
    },
    videoMemory: {
      veoProjects: [completedProject('video', 'generation', 'video-memory-project')],
      storyboard: {
        projects: [completedProject('video', 'storyboard', 'storyboard-project')],
      },
    },
  });

  const allProjects = [
    ...merged.shellProjects,
    ...merged.buyerShowMemory.sets,
    ...merged.xhsCoverMemory.projects,
    ...merged.videoMemory.veoProjects,
    ...merged.videoMemory.storyboard.projects,
  ];
  assert.equal(allProjects.length, 8);
  allProjects.forEach((project) => {
    assert.equal(project.status, 'completed', project.id);
    assert.equal(project.taskCount, 1, project.id);
    assert.equal(project.completedCount, 1, project.id);
    assert.equal(project.error, undefined, project.id);
    assert.equal(project.results.length, 1, project.id);
    assert.equal(project.results[0].status, 'completed', project.id);
  });
});

test('compactAppStateForStorage removes recursively nested one-click project history', () => {
  const compacted = compactAppStateForStorage({
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'project-a',
          name: '项目 A',
          schemes: [],
          projects: [{ id: 'nested-project' }],
          activeProjectId: 'nested-project',
        }],
      },
    },
  });

  assert.equal(Object.hasOwn(compacted.oneClickMemory.firstImage.projects[0], 'projects'), false);
  assert.equal(Object.hasOwn(compacted.oneClickMemory.firstImage.projects[0], 'activeProjectId'), false);
});

test('compactAppStateForStorage removes nested generation context snapshots from one-click history', () => {
  const compacted = compactAppStateForStorage({
    oneClickMemory: {
      firstImage: {
        projects: [{
          id: 'project-a',
          name: '项目 A',
          generationContext: {
            prompt: '生成提示',
            params: { ratio: '1:1' },
            materials: {
              product: [{ remoteUrl: 'https://example.com/product.png' }],
            },
            projects: [{ id: 'nested-project', prompt: '重复历史项目' }],
            activeProjectId: 'nested-project',
            tasks: [{ id: 'runtime-task' }],
          },
        }],
      },
    },
  });

  const context = compacted.oneClickMemory.firstImage.projects[0].generationContext;
  assert.equal(context.prompt, '生成提示');
  assert.equal(context.params.ratio, '1:1');
  assert.equal(context.materials.product[0].remoteUrl, 'https://example.com/product.png');
  assert.equal(Object.hasOwn(context, 'projects'), false);
  assert.equal(Object.hasOwn(context, 'activeProjectId'), false);
  assert.equal(Object.hasOwn(context, 'tasks'), false);
});

test('compactAppStateForStorage strips inline image previews from translation history', () => {
  const compacted = compactAppStateForStorage({
    translationMemory: {
      detail: {
        files: [{
          id: 'file-a',
          sourceUrl: 'https://example.com/source.png',
          sourcePreviewUrl: 'data:image/png;base64,abc',
        }],
      },
    },
  });

  assert.equal(compacted.translationMemory.detail.files[0].sourcePreviewUrl, '');
  assert.equal(compacted.translationMemory.detail.files[0].sourceUrl, 'https://example.com/source.png');
});

// 根因 #1 漂移④:后端 normalizeProjectLikeItem 在"部分完成"时谎报已完成。
// 真实场景:2 张已完成 + 1 张仍在生成(带 provider task id)。正确行为=选项 A:
// 只要还有任务在跑就 generating,直到全部完成;taskCount 必须把在跑的任务也数进去
// (2 完成 + 1 生成中 = 3,而非 max(2,1)=2)。当前后端用 maxNumber 取最大值,
// 会把在跑的那张吞掉、误判 completedMediaCount(2) >= taskCount(2) → 谎报完成。
// 这与前端(已正确判 generating)产生漂移,正是"同步翻烧饼"的来源之一。
test('mergeAppStateForStorage keeps a partially-completed project generating until every task finishes', () => {
  const mkResult = (id, status, imageUrl) => ({
    id,
    taskId: `task-${id}`,
    imageUrl,
    status,
    module: 'retouch',
    subFeature: 'original',
  });
  const merged = mergeAppStateForStorage({
    shellProjects: [],
  }, {
    shellProjects: [{
      id: 'proj-partial',
      module: 'retouch',
      status: 'generating',
      taskCount: 3,
      completedCount: 2,
      subFeature: 'original',
      results: [
        mkResult('r1', 'completed', 'https://example.com/r1.png'),
        mkResult('r2', 'completed', 'https://example.com/r2.png'),
        mkResult('r3', 'generating', ''),
      ],
    }],
  });

  assert.equal(merged.shellProjects[0].status, 'generating', '还有任务在跑时不得谎报已完成');
  assert.equal(merged.shellProjects[0].taskCount, 3, 'taskCount 必须把还在跑的任务也数进去(2 完成 + 1 生成中 = 3)');
});
