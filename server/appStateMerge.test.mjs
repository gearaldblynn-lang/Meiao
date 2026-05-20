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
