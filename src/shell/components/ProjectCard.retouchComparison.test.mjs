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

  assert.match(projectCardSource, /if \(!detailOpen \|\| lightboxOpen \|\| retouchComparisonOpen \|\| translationCompareOpen\) return/);
  assert.match(projectCardSource, /<RetouchComparisonViewer[\s\S]*onDownloadCurrent=/);
  assert.match(projectCardSource, /onClose=\{\(\) => setRetouchComparisonOpen\(false\)\}/);
});

test('ProjectCard reuses the slider and wheel viewer for model replacement and completed translation', () => {
  const projectCardSource = source();

  assert.match(projectCardSource, /isRetouchComparisonScope\(project\.module, project\.subFeature\)/);
  assert.match(projectCardSource, /everything_replace[\s\S]*model_replace/);
  assert.match(projectCardSource, /滑动查看替换效果/);
  assert.match(projectCardSource, /模特替换前后对比/);
  assert.match(projectCardSource, /resultLabel=\{project\.subFeature === 'model_replace' \? '替换后' : undefined\}/);
  assert.match(projectCardSource, /heading="滑动查看翻译效果"/);
  assert.match(projectCardSource, /dialogLabel="出海翻译前后对比"/);
  assert.match(projectCardSource, /resultLabel="翻译后"/);
  assert.match(projectCardSource, /overlayZIndex=\{520\}/);
  assert.match(projectCardSource, /headerActions=/);
  assert.match(projectCardSource, /setTranslationVersionIndexes/);
  assert.match(projectCardSource, /openTranslationRegionEdit/);
  assert.match(
    projectCardSource,
    /onClick=\{\(\) => \{\s*setTranslationCompareOpen\(false\);\s*openTranslationRegionEdit\(result, pathLabel\);\s*\}\}/,
  );
});
