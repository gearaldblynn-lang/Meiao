import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeShellDraftState,
  resolveHydratedShellDraftState,
} from './shellDraftState.ts';

test('hydrating shell draft treats the newest draft as authoritative over legacy materials', () => {
  const localDraft = {
    inputStateByScope: {
      'one_click:main_image': {
        promptText: 'new product',
        params: { targetWidth: '900' },
      },
    },
    materials: {
      product: [{
        id: 'new-product',
        type: 'product',
        url: 'https://example.com/new.png',
        remoteUrl: 'https://example.com/new.png',
        fileName: 'new.png',
      }],
    },
    updatedAt: 200,
  };

  const remoteDraft = {
    inputStateByScope: {
      'one_click:main_image': {
        promptText: 'old product',
        params: { targetWidth: '800' },
      },
    },
    materials: {
      product: [{
        id: 'old-product',
        type: 'product',
        url: 'https://example.com/old.png',
        remoteUrl: 'https://example.com/old.png',
        fileName: 'old.png',
      }],
    },
    updatedAt: 100,
  };

  const legacyMaterials = {
    product: [{
      id: 'branch-product-product-0',
      type: 'product',
      url: 'https://example.com/branch-old.png',
      remoteUrl: 'https://example.com/branch-old.png',
      fileName: 'product-1',
    }],
  };

  const hydrated = resolveHydratedShellDraftState({
    localDraft,
    remoteDraft,
    legacyMaterials,
  });

  assert.deepEqual(Object.keys(hydrated.materials), ['product']);
  assert.equal(hydrated.materials.product.length, 1);
  assert.equal(hydrated.materials.product[0].id, 'new-product');
  assert.equal(hydrated.inputStateByScope['one_click:main_image'].promptText, 'new product');
  assert.equal(hydrated.inputStateByScope['one_click:main_image'].params.targetWidth, '900');
});

test('shell draft state keeps deleted job tombstones bounded and deduped', () => {
  const normalized = normalizeShellDraftState({
    deletedJobIds: ['job-a', '', 'job-b', 'job-a', null],
    deletedProjectIds: ['project-a', 'project-a', 'project-b'],
    deletedResultIds: ['result-a', undefined, 'result-b'],
  });

  assert.deepEqual(normalized.deletedJobIds, ['job-a', 'job-b']);
  assert.deepEqual(normalized.deletedProjectIds, ['project-a', 'project-b']);
  assert.deepEqual(normalized.deletedResultIds, ['result-a', 'result-b']);
});
