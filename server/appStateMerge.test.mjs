import test from 'node:test';
import assert from 'node:assert/strict';

import { compactAppStateForStorage, mergeAppStateForStorage } from './appStateMerge.mjs';

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
  assert.equal(merged.shellProjects[0].planningTaskId, 'kie-a,kie-b,kie-c,kie-d,kie-e');
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
