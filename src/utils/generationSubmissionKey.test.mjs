import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGenerationSubmissionKey } from './generationSubmissionKey.ts';

test('generation submission key stays stable when the same material gains a remote url', () => {
  const base = {
    module: 'video',
    subFeature: 'storyboard',
    prompt: 'same storyboard',
    params: { ratio: '9:16', mode: 'viral_split' },
    materials: {
      product: [{ id: 'product-1', localAssetId: 'draft-product-1', fileName: 'product.jpg' }],
    },
  };

  const beforeUpload = buildGenerationSubmissionKey(base);
  const afterUpload = buildGenerationSubmissionKey({
    ...base,
    materials: {
      product: [{
        id: 'product-1',
        localAssetId: 'draft-product-1',
        fileName: 'product.jpg',
        remoteUrl: 'https://meiaoyuntai.com/api/assets/file/product-1',
      }],
    },
  });

  assert.equal(afterUpload, beforeUpload);
});

test('generation submission key changes for a genuinely different prompt or material', () => {
  const input = {
    module: 'video',
    subFeature: 'storyboard',
    prompt: 'storyboard A',
    params: { ratio: '9:16' },
    materials: {
      product: [{ id: 'product-1', localAssetId: 'draft-product-1', fileName: 'product.jpg' }],
    },
  };
  const original = buildGenerationSubmissionKey(input);

  assert.notEqual(buildGenerationSubmissionKey({ ...input, prompt: 'storyboard B' }), original);
  assert.notEqual(buildGenerationSubmissionKey({
    ...input,
    materials: {
      product: [{ id: 'product-2', localAssetId: 'draft-product-2', fileName: 'product-2.jpg' }],
    },
  }), original);
});

test('generation submission key ignores object insertion order', () => {
  const left = buildGenerationSubmissionKey({
    module: 'video',
    subFeature: 'generation',
    prompt: 'same',
    params: { ratio: '9:16', duration: '10s' },
    materials: {},
  });
  const right = buildGenerationSubmissionKey({
    module: 'video',
    subFeature: 'generation',
    prompt: 'same',
    params: { duration: '10s', ratio: '9:16' },
    materials: {},
  });

  assert.equal(right, left);
});
