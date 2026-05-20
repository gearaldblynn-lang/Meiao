import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('project rules require secondary confirmation for all destructive delete actions', () => {
  const rules = read('../../../../../开发规范.md');

  assert.match(rules, /## 6\. 任何删除都必须二次确认/);
  assert.match(rules, /删除、移除、清空、永久删除/);
  assert.match(rules, /不允许按钮直接执行删除/);
  assert.match(rules, /同类删除入口尽量复用同一个确认组件/);
});

test('shell result cards require confirmation before deleting generated results', () => {
  const source = read('./ResultCard.tsx');

  assert.match(source, /import ConfirmDialog from '\.\/ConfirmDialog'/);
  assert.match(source, /const \[confirmDeleteOpen, setConfirmDeleteOpen\] = useState\(false\)/);
  assert.match(source, /setConfirmDeleteOpen\(true\); setMenuOpen\(false\);/);
  assert.match(source, /<ConfirmDialog[\s\S]*title="删除图片"/);
  assert.doesNotMatch(source, /onDelete\(result\.id\); setMenuOpen\(false\);/);
});

test('shell input material preview removals happen immediately without confirmation', () => {
  const source = read('./MaterialPreviewBar.tsx');

  assert.doesNotMatch(source, /import ConfirmDialog from '\.\/ConfirmDialog'/);
  assert.doesNotMatch(source, /pendingRemove/);
  assert.doesNotMatch(source, /title="删除素材"/);
  assert.match(source, /onRemoveMaterial\(type, m\.id\)/);
});

test('shell preset library deletions use confirmation instead of direct removal', () => {
  const source = read('./PresetLibrary.tsx');

  assert.match(source, /import ConfirmDialog from '\.\/ConfirmDialog'/);
  assert.match(source, /const \[pendingDeleteId, setPendingDeleteId\] = useState<string \| null>\(null\)/);
  assert.match(source, /setPendingDeleteId\(preset\.id\)/);
  assert.match(source, /const pendingDeletePreset = pendingDeleteId \?/);
  assert.match(source, /<ConfirmDialog[\s\S]*title="删除预设"/);
  assert.doesNotMatch(source, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleDelete\(preset\.id\); \}\}/);
});

test('plan editor confirms deleting planning cards while keeping result deletion on the outer confirmed flow', () => {
  const source = read('./PlanEditor.tsx');

  assert.match(source, /import ConfirmDialog from '\.\/ConfirmDialog'/);
  assert.match(source, /const \[pendingDeletePlan, setPendingDeletePlan\] = useState<\{ id: string; title: string \} \| null>\(null\)/);
  assert.match(source, /setPendingDeletePlan\(\{ id: plan\.id, title: plan\.title \}\)/);
  assert.match(source, /<ConfirmDialog[\s\S]*title="删除策划方案"/);
  assert.match(source, /onRequestDeleteResult\?\.\(result\.id\)/);
});

test('prompt copy controls live inside prompt panels while generating cards expose interrupt action', () => {
  const projectCardSource = read('./ProjectCard.tsx');
  const planEditorSource = read('./PlanEditor.tsx');

  assert.match(projectCardSource, /aria-label="复制 Prompt"/);
  assert.match(projectCardSource, /label="中断"/);
  assert.match(projectCardSource, /label="修改"/);
  assert.match(projectCardSource, /disabled/);
  assert.match(projectCardSource, /onCancelTask\?\.\(project\.id\)/);
  assert.match(projectCardSource, /hasResult \? \([\s\S]*label="修改"[\s\S]*\) : \([\s\S]*label="中断"[\s\S]*disabled/);
  assert.doesNotMatch(projectCardSource, /label="Prompt"/);
  assert.doesNotMatch(projectCardSource, /label="中断"[\s\S]{0,180}\) : <div \/>/);

  assert.match(planEditorSource, /aria-label="复制 Prompt"/);
  assert.match(planEditorSource, /onCancelGeneration/);
  assert.match(planEditorSource, /label="中断"/);
  assert.match(planEditorSource, /label="修改"/);
  assert.match(planEditorSource, /disabled/);
  assert.match(planEditorSource, /hasResult \? \([\s\S]*label="修改"[\s\S]*\) : \([\s\S]*label="中断"[\s\S]*disabled/);
  assert.doesNotMatch(planEditorSource, /label="Prompt"/);
  assert.doesNotMatch(planEditorSource, /label="中断"[\s\S]{0,180}\) : <div \/>/);
});

test('task action buttons use an exclusive pending key to prevent duplicate submissions', () => {
  const projectCardSource = read('./ProjectCard.tsx');
  const shellSource = read('../../ShellMigratedApp.tsx');

  assert.match(shellSource, /const \[pendingActionKeys, setPendingActionKeys\] = useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(shellSource, /const pendingActionKeysRef = useRef<Set<string>>\(new Set\(\)\)/);
  assert.match(shellSource, /const beginExclusiveAction = useCallback/);
  assert.match(shellSource, /`regenerate:\$\{projectId\}:\$\{resultId\}`/);
  assert.match(shellSource, /`confirm-plan:\$\{projectId\}`/);
  assert.match(shellSource, /`storyboard-image:\$\{projectId\}`/);

  assert.match(projectCardSource, /pendingActionKeys\?: Record<string, boolean>/);
  assert.match(projectCardSource, /const getRegenerateActionKey = \(resultId: string\) => `regenerate:\$\{project\.id\}:\$\{resultId\}`/);
  assert.match(projectCardSource, /disabled=\{regeneratePending \|\| isGeneratingResult\}/);
  assert.match(projectCardSource, /disabled=\{isConfirmPlanPending \|\| isProjectActivelyGenerating\}/);
  assert.match(projectCardSource, /disabled=\{isStoryboardImagePending\}/);
});
