import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskFallbackProjects, filterProjectsForScope, sortProjectsNewestFirst } from './shellScopeFilters.ts';

const getDefaultSubFeature = (module) => module === 'one_click' ? 'first_image' : 'default';

test('project-level one-click subfeatures do not drift into another active tab when results omit subFeature', () => {
  const projects = [
    {
      id: 'main-project',
      name: '主图项目',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-05',
      results: [
        {
          id: 'main-result',
          imageUrl: '/main.png',
          prompt: '主图结果',
          model: '旧任务',
          aspectRatio: '1:1',
          status: 'completed',
          createdAt: '05-05',
          module: 'one_click',
        },
      ],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'main_image',
    },
  ];

  const detailProjects = filterProjectsForScope({
    projects,
    pageMode: 'module',
    activeModule: 'one_click',
    activeSubFeature: 'detail_page',
    getDefaultSubFeature,
  });

  assert.deepEqual(detailProjects, []);
});

test('active scoped tasks create fallback project cards when project hydration is not ready', () => {
  const projects = [];
  const tasks = [{
    id: 'job-1',
    projectId: 'project-from-job-1',
    module: 'one_click',
    type: 'plan',
    status: 'generating',
    title: '策划: 新产品主图',
    progress: 18,
    createdAt: '05-18',
    subFeature: 'main_image',
    backendJobId: 'job-1',
    total: 1,
    completed: 0,
  }];

  const fallbackProjects = buildTaskFallbackProjects(projects, tasks);

  assert.equal(fallbackProjects.length, 1);
  assert.equal(fallbackProjects[0].id, 'task-project-project-from-job-1');
  assert.equal(fallbackProjects[0].module, 'one_click');
  assert.equal(fallbackProjects[0].subFeature, 'main_image');
  assert.equal(fallbackProjects[0].status, 'generating');
  assert.equal(fallbackProjects[0].backendJobId, 'job-1');
  assert.deepEqual(fallbackProjects[0].results, []);
});

test('task fallback project cards are skipped when a project already represents the task', () => {
  const projects = [{
    id: 'project-from-job-1',
    name: '已有项目',
    module: 'one_click',
    status: 'planning',
    createdAt: '05-18',
    results: [],
    taskCount: 1,
    completedCount: 0,
    subFeature: 'main_image',
    backendJobId: 'job-1',
  }];
  const tasks = [{
    id: 'job-1',
    projectId: 'project-from-job-1',
    module: 'one_click',
    type: 'plan',
    status: 'generating',
    title: '策划: 新产品主图',
    createdAt: '05-18',
    subFeature: 'main_image',
    backendJobId: 'job-1',
  }];

  assert.deepEqual(buildTaskFallbackProjects(projects, tasks), []);
});

test('project cards sort newest first by created timestamp and same-day project number', () => {
  const projects = [
    {
      id: 'proj-plan-1779990000000',
      name: '5月29日项目12',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-29',
      results: [],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'first_image',
    },
    {
      id: 'legacy-without-timestamp',
      name: '5月29日项目15',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-29',
      results: [],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'first_image',
    },
    {
      id: 'proj-plan-1780000000000',
      name: '5月29日项目14',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-29',
      results: [],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'first_image',
    },
    {
      id: 'older-project',
      name: '5月28日项目99',
      module: 'one_click',
      status: 'completed',
      createdAt: '05-28',
      results: [],
      taskCount: 1,
      completedCount: 1,
      subFeature: 'first_image',
    },
  ];

  assert.deepEqual(
    sortProjectsNewestFirst(projects).map((project) => project.name),
    ['5月29日项目15', '5月29日项目14', '5月29日项目12', '5月28日项目99'],
  );
});
