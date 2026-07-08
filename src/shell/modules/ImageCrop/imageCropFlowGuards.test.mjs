import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('image crop generated projects use numeric precise timestamps', () => {
  const moduleSource = read('./ImageCropModule.tsx');

  assert.match(moduleSource, /const createdAt = Date\.now\(\);/);
  assert.match(moduleSource, /createdAt,\s*\n\s*completedAt: createdAt,/);
  assert.match(moduleSource, /createdAtPrecise: true/);
  assert.doesNotMatch(moduleSource, /createdAt: todayLabel\(\)/);
  assert.doesNotMatch(moduleSource, /completedAt: todayLabel\(\)/);
});

test('image crop generation warns when project history persistence fails', () => {
  const moduleSource = read('./ImageCropModule.tsx');

  assert.match(moduleSource, /const slicePersisted = await onPersistProject\(project\);/);
  assert.ok(moduleSource.includes('const sliceHistorySaved = slicePersisted !== false;'));
  assert.ok(moduleSource.includes("sliceHistorySaved ? `已生成 ${slices.length} 张切片并保存历史记录。` : '切片已生成，但历史记录保存失败，请先下载本次 ZIP。'"));
  assert.match(moduleSource, /const resizePersisted = await onPersistProject\(project\);/);
  assert.ok(moduleSource.includes('const resizeHistorySaved = resizePersisted !== false;'));
  assert.ok(moduleSource.includes("resizeHistorySaved ? `已等比例缩放 ${resized.length} 张图片并保存历史记录。` : '图片已生成，但历史记录保存失败，请先下载本次 ZIP。'"));
});

test('image crop generated projects are inserted into the visible runtime list before persistence', () => {
  const shellAppSource = read('../../../ShellMigratedApp.tsx');

  assert.match(shellAppSource, /const persistImageCropProject = useCallback\(async \(project: Project\) => \{/);
  assert.ok(shellAppSource.includes('setProjects((prev) => {'));
  assert.ok(shellAppSource.includes('const next = [project, ...prev.filter((item) => item.id !== project.id)];'));
  assert.ok(shellAppSource.includes('projectsRef.current = next;'));
  assert.ok(shellAppSource.includes('return persistProjectToSharedState(project);'));
  assert.ok(shellAppSource.includes('onPersistProject={persistImageCropProject}'));
});

test('image crop project deletion also cleans uploaded generated assets', () => {
  const shellAppSource = read('../../../ShellMigratedApp.tsx');

  assert.match(shellAppSource, /const deleteImageCropAssets = useCallback\(\(results: GeneratedResult\[\] = \[\]\) => \{/);
  assert.match(shellAppSource, /deleteInternalAssetByUrl\(url\)/);
  assert.match(shellAppSource, /project\?\.module === AppModuleObj\.IMAGE_CROP && result\?\.imageUrl/);
  assert.match(shellAppSource, /project\?\.module === AppModuleObj\.IMAGE_CROP\) \{\s*deleteImageCropAssets\(project\.results \|\| \[\]\);/);
});
