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

test('project list supports confirmed batch deletion of selected project cards', () => {
  const source = read('./ProjectListView.tsx');

  assert.match(source, /import ConfirmDialog from '\.\/ConfirmDialog'/);
  assert.match(source, /const \[batchSelectMode, setBatchSelectMode\] = useState\(false\)/);
  assert.match(source, /const \[selectedProjectIds, setSelectedProjectIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
  assert.match(source, /const \[batchDeleteConfirmOpen, setBatchDeleteConfirmOpen\] = useState\(false\)/);
  assert.match(source, /const selectableProjectIds = useMemo\(\(\) => orderedProjects\.map\(\(project\) => project\.id\), \[orderedProjects\]\)/);
  assert.match(source, /selectedProjectIds\.forEach\(\(projectId\) => onDeleteProject\(projectId\)\)/);
  assert.match(source, /title="批量删除项目"/);
  assert.match(source, /message=\{`确定要删除已选的 \$\{selectedProjectIds\.size\} 个项目吗/);
  assert.match(source, /confirmText="批量删除"/);
  assert.match(source, /全选当前筛选结果/);
  assert.match(source, /批量选择/);
  assert.match(source, /aria-label=\{`\$\{selected \? '取消选择' : '选择'\}\$\{project\.name\}`\}/);
  assert.match(source, /onClick=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*toggleProjectSelection\(project\.id\);[\s\S]*\}\}/);
});

test('prompt copy controls live inside prompt panels while generating cards expose interrupt action', () => {
  const projectCardSource = read('./ProjectCard.tsx');
  const planEditorSource = read('./PlanEditor.tsx');

  assert.match(projectCardSource, /aria-label="复制 Prompt"/);
  assert.match(projectCardSource, /label="中断"/);
  assert.match(projectCardSource, /label=\{isEditPending\(result\.id\) \? '提交中' : '修改'\}/);
  assert.match(projectCardSource, /disabled/);
  assert.match(projectCardSource, /onCancelTask\?\.\(project\.id\)/);
  assert.match(projectCardSource, /hasResult \? \([\s\S]*label=\{isEditPending\(result\.id\) \? '提交中' : '修改'\}[\s\S]*\) : \([\s\S]*label="中断"[\s\S]*disabled/);
  assert.doesNotMatch(projectCardSource, /label="Prompt"/);
  assert.doesNotMatch(projectCardSource, /label="中断"[\s\S]{0,180}\) : <div \/>/);

  assert.match(planEditorSource, /aria-label="复制 Prompt"/);
  assert.match(planEditorSource, /onCancelGeneration/);
  assert.match(planEditorSource, /label="中断"/);
  assert.match(planEditorSource, /label=\{isEditPending \? '提交中' : '修改'\}/);
  assert.match(planEditorSource, /disabled/);
  assert.match(planEditorSource, /hasResult \? \([\s\S]*label=\{isEditPending \? '提交中' : '修改'\}[\s\S]*\) : \([\s\S]*label="中断"[\s\S]*disabled/);
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
  assert.match(shellSource, /const planActionKey = selectedPlans\.map\(\(plan\) => plan\.id\)\.filter\(Boolean\)\.join\('\|'\) \|\| 'unknown'/);
  assert.match(shellSource, /const actionKey = `confirm-plan:\$\{projectId\}:\$\{planActionKey\}`/);
  assert.doesNotMatch(shellSource, /const actionKey = `confirm-plan:\$\{projectId\}`/);
  assert.match(shellSource, /`storyboard-image:\$\{projectId\}`/);

  assert.match(projectCardSource, /pendingActionKeys\?: Record<string, boolean>/);
  assert.match(projectCardSource, /const getRegenerateActionKey = \(resultId: string\) => `regenerate:\$\{project\.id\}:\$\{resultId\}`/);
  assert.match(projectCardSource, /const regenerationLockedByActiveProject = isProjectActivelyGenerating \|\| hasGeneratingResult/);
  assert.match(projectCardSource, /disabled=\{regeneratePending \|\| isGeneratingResult \|\| regenerationLockedByActiveProject\}/);
  assert.match(projectCardSource, /const getConfirmPlanActionKey = \(planId: string\) => `confirm-plan:\$\{project\.id\}:\$\{planId\}`/);
  assert.match(projectCardSource, /isConfirmPlanPending=\{isPlanConfirmPending\}/);
  assert.match(projectCardSource, /disabled=\{isStoryboardImagePending\}/);
});

test('result regeneration is locked while the current project or scope is actively generating', () => {
  const projectCardSource = read('./ProjectCard.tsx');
  const shellSource = read('../../ShellMigratedApp.tsx');

  assert.match(projectCardSource, /const hasGeneratingResult = project\.results\.some\(\(result\) => isResultActivelyGenerating\(result\)\)/);
  assert.match(projectCardSource, /if \(isStoryboardAwaitingImageConfirmation \|\| regeneratePending \|\| isGeneratingResult \|\| regenerationLockedByActiveProject\) return/);
  assert.match(projectCardSource, /if \(regeneratePending \|\| isGeneratingResult \|\| regenerationLockedByActiveProject\) return/);
  assert.match(shellSource, /const hasActiveRegenerationConflict = \(/);
  assert.match(shellSource, /hasActiveRegenerationConflict\(projects, tasks, project\)/);
  assert.match(shellSource, /请先中断或等待当前任务完成后再重生成/);
});

test('all runnable bottom generation submits are guarded before material preparation or cloud submission', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const submitGuardBlock = shellSource.match(/const shouldGuardGenerationSubmit = [\s\S]*?\n\);/)?.[0] || '';
  const handleGeneratePrefix = shellSource.match(/const handleGenerate = useCallback\(async \(\) => \{[\s\S]*?if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'storyboard'\)/)?.[0] || '';
  const oneClickBranch = shellSource.match(/if \(targetModule === AppModuleObj\.ONE_CLICK\) \{[\s\S]*?\n    \}\n\n    \/\/ Create project/)?.[0] || '';
  const genericProjectBranch = shellSource.match(/\/\/ Create project[\s\S]*?const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{[\s\S]*?\n    \};/)?.[0] || '';
  const translationBranch = shellSource.match(/if \(targetModule === AppModuleObj\.TRANSLATION\) \{[\s\S]*?\n      return;\n    \}\n\n    if \(targetModule === AppModuleObj\.ONE_CLICK\)/)?.[0] || '';

  assert.match(submitGuardBlock, /module === AppModuleObj\.ONE_CLICK/);
  assert.match(submitGuardBlock, /module === AppModuleObj\.TRANSLATION/);
  assert.match(submitGuardBlock, /module === AppModuleObj\.BUYER_SHOW/);
  assert.match(submitGuardBlock, /module === AppModuleObj\.RETOUCH/);
  assert.match(submitGuardBlock, /module === AppModuleObj\.VIDEO/);
  assert.match(submitGuardBlock, /module === AppModuleObj\.XHS_COVER/);
  assert.match(shellSource, /const hasRuntimeTaskIdentity = /);
  assert.match(shellSource, /hasActiveGuardedGeneration/);
  assert.match(shellSource, /hasCurrentActiveGuardedGeneration/);
  assert.doesNotMatch(shellSource, /hasCurrentActiveGuardedVideoGeneration/);
  assert.match(handleGeneratePrefix, /const beginGuardedSubmit = \(\) => !hasGuardedSubmitLock \|\| beginGenerationSubmitLock\(guardedSubmitLockKey\)/);
  assert.match(handleGeneratePrefix, /const releaseGuardedSubmit = \(\) => \{/);
  assert.match(shellSource, /const isCurrentGenerationSubmitLocked = shouldGuardGenerationSubmit\(activeModule, activeSubFeature\)\s*&& \(Boolean\(generationSubmitLocks\[currentGenerationSubmitLockKey\]\) \|\| hasCurrentActiveGuardedGeneration\)/);
  assert.match(shellSource, /if \(!beginGuardedSubmit\(\)\) \{\s*return;\s*\}\s*addToast\('任务已提交，正在准备素材', 'info'\);[\s\S]*?const immediateProject = targetModule === AppModuleObj\.EVERYTHING_REPLACE[\s\S]*?try \{\s*generationMaterials = await ensureMaterialRemoteUrls/);
  assert.match(translationBranch, /onJobCreated: \(jobId: string, providerTaskId\?: string\) => \{[\s\S]*releaseGuardedSubmit\(\);[\s\S]*\}/);
  assert.match(oneClickBranch.match(/const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{[\s\S]*?\n      \};/)?.[0] || '', /releaseGuardedSubmit\(\);/);
  assert.match(genericProjectBranch, /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{[\s\S]*releaseGuardedSubmit\(\);[\s\S]*\}/);
  assert.match(oneClickBranch, /finally \{[\s\S]*releaseGuardedSubmit\(\);[\s\S]*setIsGenerating\(false\);[\s\S]*\}/);
});

test('buyer show shell publishes pending task cards and releases submit when image jobs are created', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const workflowSource = read('../../adapters/shellWorkflow.ts');
  const buyerShowBranch = shellSource.match(/targetModule === AppModuleObj\.BUYER_SHOW[\s\S]*?runShellRetouchWorkflow/)?.[0] || '';
  const buyerShowWorkflow = workflowSource.match(/export const runShellBuyerShowWorkflow = async \([\s\S]*?\n\};\n\ntype ShellRetouchMode/)?.[0] || '';

  assert.match(buyerShowBranch, /taskMetadata:\s*\{[\s\S]*shellProjectId:\s*projectId[\s\S]*shellProjectName:\s*projectName[\s\S]*batchCount[\s\S]*subFeature:\s*targetSubFeature[\s\S]*\}/);
  assert.match(buyerShowWorkflow, /const publishPendingBuyerShowJob = \(jobId: string, providerTaskId\?: string\) => \{/);
  assert.match(buyerShowWorkflow, /input\.onJobCreated\?\.\(jobId, providerTaskId\)/);
  assert.match(buyerShowWorkflow, /status:\s*'generating'/);
  assert.match(buyerShowWorkflow, /onItemCompleted\?\.\(pendingItem, currentBatchIndex, total\)/);
  assert.match(buyerShowWorkflow, /processWithKieAi\([\s\S]*publishPendingBuyerShowJob[\s\S]*\)/);
});

test('shell result deletion records backend job tombstones for pending results', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const deleteResultBlock = shellSource.match(/const handleDeleteResult = useCallback\([\s\S]*?\n  \}, \[projects, addToast, persistDeletionToSharedState\]\);/)?.[0] || '';

  assert.match(deleteResultBlock, /const result = project\?\.results\.find\(\(item\) => item\.id === resultId\)/);
  assert.match(deleteResultBlock, /const resultJobIds = Array\.from\(new Set\(/);
  assert.match(deleteResultBlock, /result\?\.backendJobId/);
  assert.match(deleteResultBlock, /persistDeletionToSharedState\(\{ projectId, resultId, jobIds: resultJobIds \}\)/);
});
