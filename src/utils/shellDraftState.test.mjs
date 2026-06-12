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

test('normalizing shell draft preserves everything replace logo placement templates', () => {
  const logoPlacement = {
    version: 1,
    baseRatio: '3:4',
    logoRatio: 2.2,
    templates: {
      '3:4': { anchorX: 'right', anchorY: 'top', offsetX: 0.08, offsetY: 0.06, widthRatio: 0.18 },
      '1:1': { anchorX: 'center', anchorY: 'bottom', offsetX: 0, offsetY: 0.08, widthRatio: 0.2 },
    },
  };

  const draft = normalizeShellDraftState({
    materials: {
      logo: [{
        id: 'logo-1',
        type: 'logo',
        url: 'https://example.com/logo.png',
        remoteUrl: 'https://example.com/logo.png',
        fileName: 'logo.png',
        subFeature: 'product_replace',
        originalWidth: 410,
        originalHeight: 175,
        logoPlacement,
      }],
    },
  });

  assert.deepEqual(draft.materials.logo[0].logoPlacement, logoPlacement);
});

test('hydrating shell draft keeps local logo placement when newer remote material lacks it', () => {
  const logoPlacement = {
    version: 1,
    baseRatio: '1:1',
    templates: {
      '1:1': { anchorX: 'right', anchorY: 'top', offsetX: 0.07, offsetY: 0.05, widthRatio: 0.18 },
    },
  };
  const localDraft = {
    updatedAt: 100,
    materials: {
      logo: [{
        id: 'logo-1',
        type: 'logo',
        url: 'https://example.com/logo-old.png',
        remoteUrl: 'https://example.com/logo-old.png',
        localAssetId: 'draft-logo-1',
        fileName: 'logo.png',
        subFeature: 'product_replace',
        logoPlacement,
      }],
    },
  };
  const remoteDraft = {
    updatedAt: 200,
    materials: {
      logo: [{
        id: 'logo-1',
        type: 'logo',
        url: 'https://example.com/logo-new.png',
        remoteUrl: 'https://example.com/logo-new.png',
        localAssetId: 'draft-logo-1',
        fileName: 'logo.png',
        subFeature: 'product_replace',
      }],
    },
  };

  const hydrated = resolveHydratedShellDraftState({ localDraft, remoteDraft });

  assert.deepEqual(hydrated.materials.logo[0].logoPlacement, logoPlacement);
  assert.equal(hydrated.materials.logo[0].remoteUrl, 'https://example.com/logo-new.png');
});

test('hydrating shell draft does not let a newer empty draft wipe local input', () => {
  const hydrated = resolveHydratedShellDraftState({
    localDraft: {
      inputStateByScope: {
        'one_click:sku': {
          promptText: '新产品 SKU 草稿',
          params: { mode: 'SKU' },
        },
      },
      updatedAt: 100,
    },
    remoteDraft: {
      inputStateByScope: {},
      materials: {},
      updatedAt: 200,
    },
  });

  assert.equal(hydrated.inputStateByScope['one_click:sku'].promptText, '新产品 SKU 草稿');
  assert.equal(hydrated.inputStateByScope['one_click:sku'].params.mode, 'SKU');
});

test('hydrating shell draft merges scopes and preserves non-empty prompt text', () => {
  const hydrated = resolveHydratedShellDraftState({
    localDraft: {
      inputStateByScope: {
        'one_click:sku': {
          promptText: '本地未提交输入',
          params: { mode: 'SKU', count: '3' },
        },
      },
      updatedAt: 100,
    },
    remoteDraft: {
      inputStateByScope: {
        'one_click:sku': {
          promptText: '',
          params: { count: '5' },
        },
        'one_click:main_image': {
          promptText: '远端主图草稿',
          params: { mode: '主图' },
        },
      },
      updatedAt: 200,
    },
  });

  assert.equal(hydrated.inputStateByScope['one_click:sku'].promptText, '本地未提交输入');
  assert.equal(hydrated.inputStateByScope['one_click:sku'].params.count, '5');
  assert.equal(hydrated.inputStateByScope['one_click:main_image'].promptText, '远端主图草稿');
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

test('remote shell draft normalization drops local-only material cache entries', () => {
  const normalized = normalizeShellDraftState({
    inputStateByScope: {
      'one_click:main_image': {
        promptText: '保留文字草稿',
        params: { mode: '主图' },
      },
    },
    materials: {
      product: [
        {
          id: 'local-only',
          type: 'product',
          url: '',
          localAssetId: 'draft-local-only',
          fileName: 'local-only.png',
        },
        {
          id: 'remote-ready',
          type: 'product',
          url: 'https://example.com/remote.png',
          remoteUrl: 'https://example.com/remote.png',
          localAssetId: 'draft-remote-ready',
          fileName: 'remote.png',
        },
      ],
    },
  }, { requirePersistableMaterialUrl: true });

  assert.equal(normalized.inputStateByScope['one_click:main_image'].promptText, '保留文字草稿');
  assert.equal(normalized.materials.product.length, 1);
  assert.equal(normalized.materials.product[0].id, 'remote-ready');
  assert.equal(normalized.materials.product[0].remoteUrl, 'https://example.com/remote.png');
});
