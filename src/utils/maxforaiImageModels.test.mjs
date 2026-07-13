import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAXFORAI_IMAGE_MODEL_IDS,
  getMaxForAiImageModel,
  isMaxForAiImageModel,
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

test('MaxForAI maps every documented ratio and resolution to an exact size', () => {
  const expected = {
    '1:1': ['1024x1024', '2048x2048', '2880x2880'],
    '16:9': ['1536x864', '2048x1152', '3840x2160'],
    '9:16': ['864x1536', '1152x2048', '2160x3840'],
    '4:3': ['1344x1008', '2048x1536', '3264x2448'],
    '3:4': ['1008x1344', '1536x2048', '2448x3264'],
    '3:2': ['1536x1024', '2016x1344', '3504x2336'],
    '2:3': ['1024x1536', '1344x2016', '2336x3504'],
  };

  for (const [ratio, sizes] of Object.entries(expected)) {
    ['1K', '2K', '4K'].forEach((resolution, index) => {
      assert.equal(resolveMaxForAiImageSize(ratio, resolution), sizes[index]);
    });
  }

  assert.equal(resolveMaxForAiImageSize('auto', '4K'), 'auto');
  assert.throws(
    () => resolveMaxForAiImageSize('4:5', '1K'),
    /MaxForAI 不支持的图片比例或分辨率/,
  );
});
