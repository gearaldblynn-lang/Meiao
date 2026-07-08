import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResizeFileName,
  calculateContainedResize,
  normalizeResizeDimension,
} from './imageResizeUtils.ts';

test('normalizeResizeDimension accepts positive integer pixel values only', () => {
  assert.equal(normalizeResizeDimension('800'), 800);
  assert.equal(normalizeResizeDimension('800.8'), 801);
  assert.equal(normalizeResizeDimension('0'), 0);
  assert.equal(normalizeResizeDimension('-10'), 0);
  assert.equal(normalizeResizeDimension('abc'), 0);
});

test('calculateContainedResize scales square images to the requested box', () => {
  assert.deepEqual(calculateContainedResize(1200, 1200, 800, 800), {
    width: 800,
    height: 800,
  });
});

test('calculateContainedResize preserves aspect ratio inside target bounds', () => {
  assert.deepEqual(calculateContainedResize(1200, 900, 800, 800), {
    width: 800,
    height: 600,
  });

  assert.deepEqual(calculateContainedResize(900, 1200, 800, 800), {
    width: 600,
    height: 800,
  });
});

test('calculateContainedResize can derive a missing dimension from the source ratio', () => {
  assert.deepEqual(calculateContainedResize(1200, 900, 800, 0), {
    width: 800,
    height: 600,
  });

  assert.deepEqual(calculateContainedResize(1200, 900, 0, 450), {
    width: 600,
    height: 450,
  });
});

test('buildResizeFileName keeps a readable source basename and output extension', () => {
  assert.equal(buildResizeFileName('hero image.png', 800, 800, 'image/jpeg'), 'hero-image-800x800.jpg');
  assert.equal(buildResizeFileName('商品主图.webp', 600, 450, 'image/png'), 'image-resize-600x450.png');
});
