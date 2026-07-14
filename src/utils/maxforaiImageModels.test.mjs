import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAXFORAI_IMAGE_MODEL_IDS,
  MAXFORAI_SUPPORTED_RESOLUTIONS,
  getMaxForAiImageModel,
  isMaxForAiImageModel,
  normalizeMaxForAiImageResolution,
  resolveMaxForAiImageModelId,
  resolveMaxForAiImageSize,
} from './maxforaiImageModels.mjs';

test('MaxForAI exposes only the replacement relay model', () => {
  assert.deepEqual(MAXFORAI_IMAGE_MODEL_IDS, ['maxforai-image-2-relay']);
  assert.deepEqual(getMaxForAiImageModel('maxforai-image-2-relay'), {
    id: 'maxforai-image-2-relay',
    label: 'image-2中转',
    upstreamModel: 'gpt-image-2',
  });
  assert.equal(resolveMaxForAiImageModelId('image-2中转'), 'maxforai-image-2-relay');
  assert.equal(resolveMaxForAiImageModelId('gpt-image-2'), '');
  assert.equal(isMaxForAiImageModel('maxforai-image-2-relay'), true);
  assert.equal(isMaxForAiImageModel('gpt-image-2'), false);

  for (const retired of [
    'maxforai-image-2-standard',
    'maxforai-image-2-pro',
    'maxforai-image-2-max',
    'Image-2标准',
    'Image-2高',
    'Image-2超高',
  ]) {
    assert.equal(resolveMaxForAiImageModelId(retired), '');
  }
});

test('MaxForAI exposes only 1K and 2K and normalizes legacy 4K to 2K', () => {
  assert.deepEqual(MAXFORAI_SUPPORTED_RESOLUTIONS, ['1K', '2K']);
  assert.equal(normalizeMaxForAiImageResolution('1K'), '1K');
  assert.equal(normalizeMaxForAiImageResolution('2k'), '2K');
  assert.equal(normalizeMaxForAiImageResolution('4K'), '2K');
  assert.equal(normalizeMaxForAiImageResolution(''), '1K');
  assert.throws(
    () => normalizeMaxForAiImageResolution('8K'),
    /MaxForAI 不支持的图片分辨率/,
  );
});

test('MaxForAI maps every documented ratio to exact 1K and 2K sizes', () => {
  const expected = {
    '1:1': ['1024x1024', '2048x2048'],
    '16:9': ['1536x864', '2048x1152'],
    '9:16': ['864x1536', '1152x2048'],
    '4:3': ['1344x1008', '2048x1536'],
    '3:4': ['1008x1344', '1536x2048'],
    '3:2': ['1536x1024', '2016x1344'],
    '2:3': ['1024x1536', '1344x2016'],
  };

  for (const [ratio, sizes] of Object.entries(expected)) {
    MAXFORAI_SUPPORTED_RESOLUTIONS.forEach((resolution, index) => {
      assert.equal(resolveMaxForAiImageSize(ratio, resolution), sizes[index]);
    });
    assert.equal(resolveMaxForAiImageSize(ratio, '4K'), sizes[1]);
  }

  assert.equal(resolveMaxForAiImageSize('auto', '1K'), 'auto');
  assert.equal(resolveMaxForAiImageSize('auto', '2K'), 'auto');
  assert.equal(resolveMaxForAiImageSize('auto', '4K'), 'auto');
  assert.throws(
    () => resolveMaxForAiImageSize('4:5', '1K'),
    /MaxForAI 不支持的图片比例或分辨率/,
  );
});
