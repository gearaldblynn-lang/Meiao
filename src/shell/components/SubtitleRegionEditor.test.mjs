import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubtitleRegionEditor.tsx', import.meta.url), 'utf8');

test('subtitle region editor anchors interaction to the contained video rectangle', () => {
  assert.match(source, /preload="metadata"/);
  assert.match(source, /calculateContainedMediaRect/);
  assert.match(source, /containerWidth \/ mediaWidth/);
  assert.match(source, /containerHeight \/ mediaHeight/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /mediaRect\.width/);
  assert.match(source, /mediaRect\.height/);
});

test('subtitle region editor supports captured drag and eight-way resize through shared rules', () => {
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /moveSubtitleRegion/);
  assert.match(source, /resizeSubtitleRegion/);
  const handles = [...source.matchAll(/data-handle="(n|ne|e|se|s|sw|w|nw)"/g)].map((match) => match[1]);
  assert.deepEqual(handles, ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
});

test('subtitle region editor is keyboard accessible and cleans up playback listeners', () => {
  assert.match(source, /onKeyDown/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /videoRef\.current\?\.pause\(\)/);
  assert.match(source, /window\.removeEventListener\('pointermove'/);
  assert.match(source, /document\.removeEventListener\('visibilitychange'/);
});

test('subtitle region editor renders authoritative-looking preview pixel coordinates', () => {
  assert.match(source, /subtitleRegionToPixels/);
  assert.match(source, /x1/);
  assert.match(source, /y1/);
  assert.match(source, /x2/);
  assert.match(source, /y2/);
});
