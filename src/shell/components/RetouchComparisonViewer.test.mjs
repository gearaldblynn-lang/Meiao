import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () => readFileSync(
  new URL('./RetouchComparisonViewer.tsx', import.meta.url),
  'utf8',
);

test('viewer exposes pointer mask, slider keyboard and image labels', () => {
  const viewerSource = source();

  assert.match(viewerSource, /onPointerDown/);
  assert.match(viewerSource, /onPointerMove/);
  assert.match(viewerSource, /onPointerUp/);
  assert.match(viewerSource, /setPointerCapture/);
  assert.match(viewerSource, /clipPath/);
  assert.match(viewerSource, /role="slider"/);
  assert.match(viewerSource, /aria-label="调整前后对比遮罩"/);
  assert.match(viewerSource, /aria-valuenow=/);
  assert.match(viewerSource, />原图</);
  assert.match(viewerSource, />升级后</);
});

test('viewer supports close, navigation, download and mismatch feedback', () => {
  const viewerSource = source();

  assert.match(viewerSource, /event\.key === 'Escape'/);
  assert.match(viewerSource, /getLoopedComparisonIndex/);
  assert.match(viewerSource, /onDownloadCurrent/);
  assert.match(viewerSource, /前后比例不同/);
  assert.match(viewerSource, /原图加载失败/);
  assert.match(viewerSource, /结果加载失败/);
  assert.match(viewerSource, /setDividerPercent\(50\)/);
});

test('viewer renders only the active pair with contain sizing and touch-safe canvas', () => {
  const viewerSource = source();

  assert.match(viewerSource, /const item = items\[currentIndex\]/);
  assert.match(viewerSource, /object-contain/);
  assert.match(viewerSource, /touchAction: 'none'/);
  assert.doesNotMatch(viewerSource, /items\.map\(/);
});

test('viewer synchronizes zoom and pan across both comparison layers', () => {
  const viewerSource = source();

  assert.match(viewerSource, /zoomScale/);
  assert.match(viewerSource, /panOffset/);
  assert.match(viewerSource, /translate3d\(/);
  assert.match(viewerSource, /scale\(/);
  assert.match(viewerSource, /data-comparison-layer="original"/);
  assert.match(viewerSource, /data-comparison-layer="result"/);
});

test('viewer exposes compact zoom controls, wheel zoom, panning and reset', () => {
  const viewerSource = source();

  assert.match(viewerSource, /aria-label="缩小对比图"/);
  assert.match(viewerSource, /aria-label="放大对比图"/);
  assert.match(viewerSource, /aria-label="重置缩放"/);
  assert.match(viewerSource, /onWheel=/);
  assert.match(viewerSource, /onDoubleClick=/);
  assert.match(viewerSource, /interactionModeRef/);
  assert.match(viewerSource, /event\.code === 'Space'/);
  assert.match(viewerSource, /滚轮缩放/);
});
