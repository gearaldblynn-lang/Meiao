import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TranslationAssetMirrorScopeExpiredError,
  isTranslationAssetMirrorScopeCurrent,
  isTranslationAssetMirrorScopeExpiredError,
  isManagedTranslationAssetUrl,
  replaceTranslationResultAssetUrl,
} from './translationResultAsset.mjs';

const createProjects = () => ([{
  id: 'translation-main',
  module: 'translation',
  subFeature: 'main',
  results: [{
    id: 'result-1',
    imageUrl: 'https://provider.example/result-1.png',
    translationEditVersions: [
      { id: 'version-1', status: 'completed', imageUrl: 'https://provider.example/result-1.png' },
      { id: 'version-2', status: 'completed', imageUrl: 'https://provider.example/other.png' },
      { id: 'version-3', status: 'generating', imageUrl: 'https://provider.example/result-1.png' },
    ],
  }, {
    id: 'result-2',
    imageUrl: 'https://provider.example/result-1.png',
  }],
}, {
  id: 'translation-detail',
  module: 'translation',
  subFeature: 'detail',
  results: [{ id: 'result-1', imageUrl: 'https://provider.example/result-1.png' }],
}, {
  id: 'other-module',
  module: 'retouch',
  subFeature: 'main',
  results: [{ id: 'result-1', imageUrl: 'https://provider.example/result-1.png' }],
}]);

test('recognizes local managed translation asset URLs', () => {
  assert.equal(isManagedTranslationAssetUrl('/api/assets/file/asset-1'), true);
  assert.equal(isManagedTranslationAssetUrl('http://localhost:3000/api/assets/file/asset-1?download=1'), true);
  assert.equal(isManagedTranslationAssetUrl('https://provider.example/result.png'), false);
  assert.equal(isManagedTranslationAssetUrl('/api/assets/download-proxy?url=x'), false);
});

test('translation asset mirror scope rejects account changes and aborted work', () => {
  const controller = new AbortController();
  const scope = { userId: 'user-a', controller };
  const input = {
    scope,
    currentScope: scope,
    currentUserId: 'user-a',
    signal: controller.signal,
  };

  assert.equal(isTranslationAssetMirrorScopeCurrent(input), true);
  assert.equal(isTranslationAssetMirrorScopeCurrent({ ...input, currentUserId: 'user-b' }), false);
  assert.equal(isTranslationAssetMirrorScopeCurrent({ ...input, currentScope: { userId: 'user-a', controller } }), false);
  controller.abort('account changed');
  assert.equal(isTranslationAssetMirrorScopeCurrent(input), false);
});

test('translation asset scope expiry has a stable identity across async catch boundaries', () => {
  const error = new TranslationAssetMirrorScopeExpiredError();
  assert.equal(error.name, 'TranslationAssetMirrorScopeExpiredError');
  assert.equal(isTranslationAssetMirrorScopeExpiredError(error), true);
  assert.equal(isTranslationAssetMirrorScopeExpiredError(new DOMException('cancelled', 'AbortError')), false);
});

test('replaces only the exact translation result and matching completed versions', () => {
  const projects = createProjects();
  const originalSnapshot = structuredClone(projects);
  const replacement = replaceTranslationResultAssetUrl(projects, {
    projectId: 'translation-main',
    resultId: 'result-1',
    sourceUrl: 'https://provider.example/result-1.png',
    managedUrl: '/api/assets/file/asset-1',
  });

  assert.equal(replacement.updated, true);
  assert.equal(replacement.result.imageUrl, '/api/assets/file/asset-1');
  assert.equal(replacement.result.translationEditVersions[0].imageUrl, '/api/assets/file/asset-1');
  assert.equal(replacement.result.translationEditVersions[1].imageUrl, 'https://provider.example/other.png');
  assert.equal(replacement.result.translationEditVersions[2].imageUrl, 'https://provider.example/result-1.png');
  assert.equal(replacement.projects[0].results[1].imageUrl, 'https://provider.example/result-1.png');
  assert.equal(replacement.projects[1].results[0].imageUrl, 'https://provider.example/result-1.png');
  assert.equal(replacement.projects[2].results[0].imageUrl, 'https://provider.example/result-1.png');
  assert.deepEqual(projects, originalSnapshot, 'replacement must not mutate persisted project state');
  assert.notEqual(replacement.projects, projects);
  assert.notEqual(replacement.project, projects[0]);
  assert.notEqual(replacement.result, projects[0].results[0]);
});

test('supports detail translation results', () => {
  const projects = createProjects();
  const replacement = replaceTranslationResultAssetUrl(projects, {
    projectId: 'translation-detail',
    resultId: 'result-1',
    sourceUrl: 'https://provider.example/result-1.png',
    managedUrl: '/api/assets/file/detail-asset',
  });

  assert.equal(replacement.updated, true);
  assert.equal(replacement.result.imageUrl, '/api/assets/file/detail-asset');
});

test('rejects stale sources, unrelated modules, and non-translation subfeatures', () => {
  const projects = createProjects();
  projects.push({
    id: 'translation-other',
    module: 'translation',
    subFeature: 'listing',
    results: [{ id: 'result-1', imageUrl: 'https://provider.example/result-1.png' }],
  });

  for (const input of [
    { projectId: 'translation-main', resultId: 'result-1', sourceUrl: 'https://provider.example/stale.png' },
    { projectId: 'other-module', resultId: 'result-1', sourceUrl: 'https://provider.example/result-1.png' },
    { projectId: 'translation-other', resultId: 'result-1', sourceUrl: 'https://provider.example/result-1.png' },
  ]) {
    const replacement = replaceTranslationResultAssetUrl(projects, {
      ...input,
      managedUrl: '/api/assets/file/asset-1',
    });
    assert.deepEqual(replacement, { projects, updated: false, project: null, result: null });
  }
});

test('rejects explicitly unrelated nested results inside a translation project', () => {
  const projects = createProjects();
  projects[0].results[0] = {
    ...projects[0].results[0],
    module: 'retouch',
    subFeature: 'main',
  };

  const replacement = replaceTranslationResultAssetUrl(projects, {
    projectId: 'translation-main',
    resultId: 'result-1',
    sourceUrl: 'https://provider.example/result-1.png',
    managedUrl: '/api/assets/file/asset-1',
  });
  assert.deepEqual(replacement, { projects, updated: false, project: null, result: null });
});
