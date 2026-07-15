import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUBTITLE_REGION,
  MIN_SUBTITLE_REGION_SIZE,
  clampSubtitleRegion,
  moveSubtitleRegion,
  resizeSubtitleRegion,
  subtitleRegionToPixels,
} from './subtitleRemovalRegion.mjs';

test('default subtitle region covers the bottom thirty percent', () => {
  assert.deepEqual(DEFAULT_SUBTITLE_REGION, { x: 0, y: 0.7, width: 1, height: 0.3 });
});

test('clamp normalizes invalid values and keeps the region in frame', () => {
  assert.deepEqual(
    clampSubtitleRegion({ x: -0.4, y: 1.4, width: 0, height: Number.NaN }),
    { x: 0, y: 0.98, width: MIN_SUBTITLE_REGION_SIZE, height: MIN_SUBTITLE_REGION_SIZE },
  );
});

test('moving a region preserves its size while clamping its position', () => {
  assert.deepEqual(
    moveSubtitleRegion(
      { x: 0.2, y: 0.7, width: 0.4, height: 0.2 },
      { x: 0.8, y: 0.5 },
    ),
    { x: 0.6, y: 0.8, width: 0.4, height: 0.2 },
  );
});

test('resize clamps to a two-percent minimum and stays inside the frame', () => {
  const resized = resizeSubtitleRegion(
    { x: 0.8, y: 0.8, width: 0.2, height: 0.2 },
    'nw',
    { x: 0.5, y: 0.5 },
  );

  assert.ok(resized.width >= MIN_SUBTITLE_REGION_SIZE);
  assert.ok(resized.height >= MIN_SUBTITLE_REGION_SIZE);
  assert.ok(resized.x >= 0 && resized.y >= 0);
  assert.ok(resized.x + resized.width <= 1);
  assert.ok(resized.y + resized.height <= 1);
});

test('pixel conversion works for portrait and landscape videos', () => {
  assert.deepEqual(subtitleRegionToPixels(DEFAULT_SUBTITLE_REGION, 1080, 1920), {
    x1: 0,
    y1: 1344,
    x2: 1080,
    y2: 1920,
  });
  assert.deepEqual(subtitleRegionToPixels(DEFAULT_SUBTITLE_REGION, 1920, 1080), {
    x1: 0,
    y1: 756,
    x2: 1920,
    y2: 1080,
  });
});

test('pixel conversion rejects missing authoritative dimensions', () => {
  assert.throws(
    () => subtitleRegionToPixels(DEFAULT_SUBTITLE_REGION, 0, 1080),
    (error) => error?.code === 'subtitle_region_invalid_dimensions',
  );
});
