import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appStateSource = readFileSync(new URL('../../utils/appState.ts', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('./XhsCoverModule.tsx', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('./XhsCoverSidebar.tsx', import.meta.url), 'utf8');

test('xhs cover defaults keep 3:4 ratio and single recommended style selected', () => {
  assert.match(appStateSource, /selectedStyleIds: \['workplace_big_text', 'yellow_pink_banner', 'sticker_energy'\]/);
  assert.match(appStateSource, /aspectRatio: '3:4'/);
});

test('xhs cover project deletion asks for confirmation before destructive actions', () => {
  assert.match(moduleSource, /window\.confirm\(`确认删除项目「\$\{targetProject\.name\}」吗？已生成图片也会一并删除。`\)/);
  assert.match(moduleSource, /window\.confirm\(`确认清空全部 \$\{projects\.length\} 个项目吗？已生成图片也会一并删除。`\)/);
});

test('xhs cover sidebar keeps style multi-select and local upload preview support', () => {
  assert.match(sidebarSource, /if \(current\.length <= 1\) return;/);
  assert.match(sidebarSource, /URL\.createObjectURL\(file\)/);
});

test('xhs cover module exposes project deletion and clear-all actions', () => {
  assert.match(moduleSource, /handleDeleteProject/);
  assert.match(moduleSource, /handleClearProjects/);
  assert.match(moduleSource, /删除项目/);
  assert.match(moduleSource, /清空项目/);
  assert.match(moduleSource, /projects\.length/);
});

test('xhs cover recovery state derives generating status from managed projects', () => {
  assert.match(moduleSource, /prev\.projects\.some\(\(project\) => project\.tasks\.some\(\(task\) => task\.status === 'generating'\)\)/);
});
