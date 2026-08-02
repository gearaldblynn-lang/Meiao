import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTranslationRegionEditRequest } from './translationRegionEditRequest.mjs';

const eraseRegion = {
  index: 1,
  xRatio: 0.1,
  yRatio: 0.2,
  widthRatio: 0.3,
  heightRatio: 0.2,
  instruction: '删除区域内的文字',
};

test('pure erase submits source image then marked guide image', () => {
  const request = buildTranslationRegionEditRequest({
    sourceImageUrl: 'source.png',
    guideImageUrl: 'guide.png',
    regions: [eraseRegion],
  });

  assert.equal(request.mode, 'standard_dual_image');
  assert.deepEqual(request.imageUrls, ['source.png', 'guide.png']);
});

test('replacement and mixed edits preserve source then guide input order', () => {
  const replacement = buildTranslationRegionEditRequest({
    sourceImageUrl: 'source.png',
    guideImageUrl: 'guide.png',
    regions: [{ ...eraseRegion, instruction: '文案替换为“NEW”' }],
  });
  const mixed = buildTranslationRegionEditRequest({
    sourceImageUrl: 'source.png',
    guideImageUrl: 'guide.png',
    regions: [eraseRegion, { ...eraseRegion, index: 2, xRatio: 0.6, instruction: '文案改成产品亮点' }],
  });

  assert.equal(replacement.mode, 'standard_dual_image');
  assert.deepEqual(replacement.imageUrls, ['source.png', 'guide.png']);
  assert.equal(mixed.mode, 'standard_dual_image');
  assert.deepEqual(mixed.imageUrls, ['source.png', 'guide.png']);
});

test('request rejects missing model image urls', () => {
  assert.throws(() => buildTranslationRegionEditRequest({
    sourceImageUrl: 'source.png',
    guideImageUrl: '',
    regions: [eraseRegion],
  }), /guideImageUrl/);
});

test('negated erase wording stays on the standard non-destructive edit route', () => {
  const request = buildTranslationRegionEditRequest({
    sourceImageUrl: 'source.png',
    guideImageUrl: 'guide.png',
    regions: [{ ...eraseRegion, instruction: '不要删除文字，只把文字改成红色' }],
  });

  assert.equal(request.mode, 'standard_dual_image');
  assert.deepEqual(request.imageUrls, ['source.png', 'guide.png']);
  assert.doesNotMatch(request.prompt, /删除类任务：/);
});
