import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adjustComparisonDividerPercent,
  buildRetouchComparisonItems,
  clampComparisonPan,
  clampComparisonZoom,
  getComparisonDividerPercent,
  getComparisonZoomPan,
  getLoopedComparisonIndex,
  getSteppedComparisonZoom,
  hasDifferentImageAspectRatio,
  isRetouchComparisonScope,
} from './retouchComparison.ts';

test('comparison scope includes only the three image-upgrade subfeatures', () => {
  for (const subFeature of ['original', 'white_bg', 'product_restore']) {
    assert.equal(isRetouchComparisonScope('retouch', subFeature), true);
  }

  assert.equal(isRetouchComparisonScope('translation', 'original'), false);
  assert.equal(isRetouchComparisonScope('retouch', 'enhance'), false);
  assert.equal(isRetouchComparisonScope('retouch', undefined), false);
});

test('comparison items keep completed images in order and prefer source preview', () => {
  const items = buildRetouchComparisonItems({
    module: 'retouch',
    subFeature: 'original',
    projectName: '7月16日项目',
    results: [
      {
        id: 'a',
        status: 'completed',
        imageUrl: '/a-result.png',
        sourcePreviewUrl: '/a-preview.png',
        sourceUrl: '/a-source.png',
        fileName: 'a.png',
        originalWidth: 1000,
        originalHeight: 1000,
      },
      { id: 'b', status: 'generating', imageUrl: '', sourceUrl: '/b.png' },
      { id: 'c', status: 'completed', imageUrl: '/c-result.png', sourceUrl: '/c-source.png' },
      { id: 'd', status: 'error', imageUrl: '/d-result.png', sourceUrl: '/d-source.png' },
    ],
  });

  assert.deepEqual(items.map((item) => item.id), ['a', 'c']);
  assert.equal(items[0].originalUrl, '/a-preview.png');
  assert.equal(items[0].title, 'a.png');
  assert.equal(items[0].subFeatureLabel, '原图精修');
  assert.equal(items[0].originalWidth, 1000);
  assert.equal(items[1].originalUrl, '/c-source.png');
  assert.equal(items[1].title, '7月16日项目 #2');
});

test('comparison items preserve completed results without original for graceful fallback', () => {
  const items = buildRetouchComparisonItems({
    module: 'retouch',
    subFeature: 'white_bg',
    projectName: '白底项目',
    results: [{ id: 'legacy', status: 'completed', imageUrl: '/legacy-result.png' }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].originalUrl, undefined);
  assert.equal(items[0].subFeatureLabel, '白底精修');
});

test('unsupported projects never expose comparison items', () => {
  assert.deepEqual(buildRetouchComparisonItems({
    module: 'translation',
    subFeature: 'original',
    projectName: '翻译项目',
    results: [{ id: 'a', status: 'completed', imageUrl: '/result.png', sourceUrl: '/source.png' }],
  }), []);
});

test('divider calculations clamp and keyboard helpers stay deterministic', () => {
  assert.equal(getComparisonDividerPercent(150, { left: 100, width: 200 }), 25);
  assert.equal(getComparisonDividerPercent(20, { left: 100, width: 200 }), 0);
  assert.equal(getComparisonDividerPercent(500, { left: 100, width: 200 }), 100);
  assert.equal(getComparisonDividerPercent(150, { left: 100, width: 0 }), 50);

  assert.equal(getLoopedComparisonIndex(0, -1, 3), 2);
  assert.equal(getLoopedComparisonIndex(2, 1, 3), 0);
  assert.equal(getLoopedComparisonIndex(2, 1, 0), 0);

  assert.equal(adjustComparisonDividerPercent(50, 'ArrowLeft'), 48);
  assert.equal(adjustComparisonDividerPercent(99, 'ArrowRight'), 100);
  assert.equal(adjustComparisonDividerPercent(1, 'ArrowLeft'), 0);
  assert.equal(adjustComparisonDividerPercent(50, 'Enter'), 50);
});

test('aspect comparison tolerates tiny measurement differences', () => {
  assert.equal(hasDifferentImageAspectRatio(
    { width: 1000, height: 1000 },
    { width: 2000, height: 2000 },
  ), false);
  assert.equal(hasDifferentImageAspectRatio(
    { width: 1000, height: 1000 },
    { width: 1600, height: 900 },
  ), true);
  assert.equal(hasDifferentImageAspectRatio(
    undefined,
    { width: 1600, height: 900 },
  ), false);
});

test('comparison zoom stays between 100% and 400% in stable steps', () => {
  assert.equal(clampComparisonZoom(0.5), 1);
  assert.equal(clampComparisonZoom(2.375), 2.375);
  assert.equal(clampComparisonZoom(5), 4);

  assert.equal(getSteppedComparisonZoom(1, 'in'), 1.25);
  assert.equal(getSteppedComparisonZoom(3.9, 'in'), 4);
  assert.equal(getSteppedComparisonZoom(1.25, 'out'), 1);
  assert.equal(getSteppedComparisonZoom(1, 'out'), 1);
});

test('comparison pan is clamped to the visible zoomed canvas', () => {
  assert.deepEqual(clampComparisonPan(
    { x: 999, y: -999 },
    2,
    { width: 200, height: 100 },
  ), { x: 100, y: -50 });

  assert.deepEqual(clampComparisonPan(
    { x: 40, y: 20 },
    1,
    { width: 200, height: 100 },
  ), { x: 0, y: 0 });
});

test('comparison zoom keeps the cursor focal point stable and resets pan at 100%', () => {
  assert.deepEqual(getComparisonZoomPan({
    currentZoom: 1,
    nextZoom: 2,
    currentPan: { x: 0, y: 0 },
    focalPoint: { x: 50, y: 0 },
    viewport: { width: 200, height: 100 },
  }), { x: -50, y: 0 });

  assert.deepEqual(getComparisonZoomPan({
    currentZoom: 2,
    nextZoom: 1,
    currentPan: { x: -50, y: 20 },
    focalPoint: { x: 50, y: 0 },
    viewport: { width: 200, height: 100 },
  }), { x: 0, y: 0 });
});
