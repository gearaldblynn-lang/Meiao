import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSliceFileName,
  buildSliceRanges,
  buildVisibleAreaSplitLine,
  normalizeSplitLines,
} from './imageSliceUtils.ts';

test('normalizeSplitLines sorts lines, rounds pixels, removes duplicates, and ignores unsafe edges', () => {
  assert.deepEqual(
    normalizeSplitLines([900.8, 0, 300.2, 299.7, 1200, -4, 1199, 600], 1200),
    [300, 600, 901],
  );
});

test('buildSliceRanges creates full-height ranges from manual split lines', () => {
  assert.deepEqual(
    buildSliceRanges(1200, [900, 300, 600]),
    [
      { index: 0, y: 0, height: 300 },
      { index: 1, y: 300, height: 300 },
      { index: 2, y: 600, height: 300 },
      { index: 3, y: 900, height: 300 },
    ],
  );
});

test('buildSliceRanges rejects images without a usable height', () => {
  assert.throws(() => buildSliceRanges(0, [100]), /image height/i);
});

test('buildSliceFileName preserves the source basename and pads the slice index', () => {
  assert.equal(buildSliceFileName('详情 长图.png', 2, 12, 'image/jpeg'), 'detail-long-image-03-of-12.jpg');
  assert.equal(buildSliceFileName('product.webp', 0, 3, 'image/png'), 'product-01-of-03.png');
});

test('buildVisibleAreaSplitLine places a new line in the current viewport instead of full image center', () => {
  assert.equal(
    buildVisibleAreaSplitLine({
      imageHeight: 22982,
      viewportHeight: 648,
      renderedHeight: 22982,
      scrollTop: 0,
    }),
    324,
  );

  assert.equal(
    buildVisibleAreaSplitLine({
      imageHeight: 22982,
      viewportHeight: 648,
      renderedHeight: 22982,
      scrollTop: 8000,
    }),
    8324,
  );
});
