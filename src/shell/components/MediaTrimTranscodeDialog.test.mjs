import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MediaTrimTranscodeDialog.tsx', import.meta.url), 'utf8');

test('media trim dialog has a responsive preview and accessible two-thumb range', () => {
  assert.match(source, /Slider\.Root/);
  assert.match(source, /Slider\.Thumb/);
  assert.match(source, /minStepsBetweenThumbs/);
  assert.match(source, /aria-label="裁剪开始时间"/);
  assert.match(source, /aria-label="裁剪结束时间"/);
  assert.match(source, /object-contain/);
  assert.match(source, /min\(46vh, 360px\)/);
});

test('media trim dialog exposes analysis, conversion, persistence, progress, and next actions', () => {
  assert.match(source, /正在分析素材/);
  assert.match(source, /转换中/);
  assert.match(source, /保存素材中/);
  assert.match(source, /转换并继续/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="progressbar"/);
});

test('media trim dialog follows the current shell visual language', () => {
  assert.match(source, /var\(--bg-base\)/);
  assert.match(source, /var\(--accent\)/);
  assert.match(source, /var\(--border-subtle\)/);
  assert.match(source, /rounded-\[28px\]/);
});

test('media trim dialog cleans the temporary server session on cancellation', () => {
  assert.match(source, /cancelMediaTranscodeSession/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /media_transcode_cancelled/);
});

test('media preview playback is constrained to the selected trim range', () => {
  assert.match(source, /resolveMediaPreviewBoundary/);
  assert.match(source, /onPlay=\{handlePreviewPlay\}/);
  assert.match(source, /onSeeking=\{handlePreviewSeeking\}/);
  assert.match(source, /onTimeUpdate=\{handlePreviewTimeUpdate\}/);
});
