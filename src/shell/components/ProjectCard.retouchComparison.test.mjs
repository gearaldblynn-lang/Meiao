import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = () => readFileSync(new URL('./ProjectCard.tsx', import.meta.url), 'utf8');

test('ProjectCard routes supported image-upgrade results into comparison viewer', () => {
  const projectCardSource = source();

  assert.match(projectCardSource, /RetouchComparisonViewer/);
  assert.match(projectCardSource, /buildRetouchComparisonItems/);
  assert.match(projectCardSource, /isRetouchComparisonScope/);
  assert.match(projectCardSource, /setRetouchComparisonOpen\(true\)/);
  assert.match(projectCardSource, /setRetouchComparisonIndex\(comparisonIndex\)/);
  assert.match(projectCardSource, /targetResult\.sourcePreviewUrl \|\| targetResult\.sourceUrl/);
});

test('ProjectCard preserves normal lightbox fallback and visible entry copy', () => {
  const projectCardSource = source();

  assert.match(projectCardSource, /原图缺失，暂无法对比/);
  assert.match(projectCardSource, /滑动对比/);
  assert.match(projectCardSource, /放大查看/);
  assert.match(projectCardSource, /setLightboxOpen\(true\)/);
});

test('ProjectCard keeps the detail overlay open while the comparison viewer handles Escape', () => {
  const projectCardSource = source();

  assert.match(projectCardSource, /if \(!detailOpen \|\| lightboxOpen \|\| retouchComparisonOpen\) return/);
  assert.match(projectCardSource, /<RetouchComparisonViewer[\s\S]*onDownloadCurrent=/);
  assert.match(projectCardSource, /onClose=\{\(\) => setRetouchComparisonOpen\(false\)\}/);
});
