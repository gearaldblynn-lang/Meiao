import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectShellDeletionJobIds,
  collectShellResultDeletionJobIds,
} from '../../utils/shellDeletionJobs.ts';
import {
  applyPersistedDeletionTombstones,
  prunePersistedAppStateForDeletion,
} from '../../utils/persistedDeletion.ts';
import { buildPersistedAppState } from '../../utils/appState.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('repository rules require secondary confirmation for all destructive delete actions', () => {
  const rules = read('../../../AGENTS.md');

  assert.match(rules, /### 任何删除都必须二次确认/);
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

test('shell result cards display generated images without cropping the backend asset', () => {
  const source = read('./ResultCard.tsx');
  const imageTag = source.match(/<img src=\{result\.imageUrl\}[\s\S]*?\/>/)?.[0] || '';

  assert.match(imageTag, /object-contain/);
  assert.doesNotMatch(imageTag, /object-cover/);
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
  assert.match(projectCardSource, /const isStoryboardAwaitingImageConfirmation = /);
  assert.match(projectCardSource, /if \(regeneratePending \|\| isGeneratingResult \|\| regenerationLockedByActiveProject\) return/);
  assert.match(shellSource, /const hasActiveRegenerationConflict = \(/);
  assert.match(shellSource, /hasActiveRegenerationConflict\(projects, tasks, project\)/);
  assert.match(shellSource, /请先中断或等待当前任务完成后再重生成/);
});

test('generation submits use semantic locks through completion while different inputs stay independent', () => {
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
  assert.match(shellSource, /buildGenerationSubmissionKey/);
  assert.doesNotMatch(shellSource, /hasActiveGuardedGeneration/);
  assert.doesNotMatch(shellSource, /hasCurrentActiveGuardedGeneration/);
  assert.match(handleGeneratePrefix, /const beginGuardedSubmit = \(\) => !hasGuardedSubmitLock \|\| beginGenerationSubmitLock\(guardedSubmitLockKey\)/);
  assert.match(handleGeneratePrefix, /const releaseGuardedSubmit = \(\) => \{/);
  assert.match(shellSource, /const currentGenerationSubmitLockKey = buildGenerationSubmissionKey\(\{/);
  // 2026-07-07 即时卡扩展到全模块后,锚点从 EVERYTHING_REPLACE 条件改为 !== BUYER_SHOW;顺序语义不变:守卫→toast→即时卡→素材上传
  assert.match(shellSource, /if \(!beginGuardedSubmit\(\)\) \{\s*return;\s*\}\s*addToast\('任务已提交，正在准备素材', 'info'\);[\s\S]*?const immediateProject = targetModule !== AppModuleObj\.BUYER_SHOW[\s\S]*?try \{\s*generationMaterials = await ensureMaterialRemoteUrls/);
  assert.doesNotMatch(translationBranch.match(/onJobCreated: \(jobId: string, providerTaskId\?: string\) => \{[\s\S]*?\n\s*\},/)?.[0] || '', /releaseGuardedSubmit\(\);/);
  assert.doesNotMatch(oneClickBranch.match(/const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{[\s\S]*?\n      \};/)?.[0] || '', /releaseGuardedSubmit\(\);/);
  assert.doesNotMatch(genericProjectBranch, /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{\s*releaseGuardedSubmit\(\);/);
  assert.match(oneClickBranch, /finally \{[\s\S]*releaseGuardedSubmit\(\);[\s\S]*setIsGenerating\(false\);[\s\S]*\}/);
});

test('buyer show shell publishes pending task cards and releases submit when image jobs are created', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const workflowSource = read('../../adapters/shellWorkflow.ts');
  // b0b5fff(2026-06-30 per-set references)在更早处新增了 BUYER_SHOW 比对,旧的宽泛捕获窗口
  // 会截错段落;锚定到真正的工作流分支起点(buyerShowSetCount 声明)。
  const buyerShowBranch = shellSource.match(/const buyerShowSetCount = targetModule === AppModuleObj\.BUYER_SHOW[\s\S]*?runShellRetouchWorkflow/)?.[0] || '';
  const buyerShowWorkflow = workflowSource.match(/export const runShellBuyerShowWorkflow = async \([\s\S]*?\n\};\n\ntype ShellRetouchMode/)?.[0] || '';

  assert.match(buyerShowBranch, /taskMetadata:\s*\{[\s\S]*shellProjectId:\s*projectId[\s\S]*shellProjectName:\s*projectName[\s\S]*batchCount[\s\S]*subFeature:\s*targetSubFeature[\s\S]*\}/);
  assert.match(workflowSource, /const submitBuyerShowImageJob = async/);
  assert.match(workflowSource, /createInternalJob\(\{[\s\S]*module: AppModule\.BUYER_SHOW[\s\S]*taskType: 'kie_image'/);
  assert.match(buyerShowWorkflow, /const \{ jobId \} = await submitBuyerShowImageJob/);
  assert.match(buyerShowWorkflow, /projectId: setProjectId \|\| undefined/);
  assert.match(buyerShowWorkflow, /projectTaskCount: state\.imageCount/);
  assert.match(buyerShowWorkflow, /input\.onJobCreated\?\.\(jobId\)/);
  assert.match(buyerShowWorkflow, /status:\s*'generating'/);
  assert.match(buyerShowWorkflow, /onItemCompleted\?\.\(item, currentBatchIndex, total\)/);
  assert.doesNotMatch(buyerShowWorkflow, /setPlan\.blocked/);
});

test('buyer show multi-set generation uses account concurrency and warns when concurrency is low', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const workflowSource = read('../../adapters/shellWorkflow.ts');
  const buyerShowBranch = shellSource.match(/const buyerShowSetCount = targetModule === AppModuleObj\.BUYER_SHOW[\s\S]*?runShellRetouchWorkflow/)?.[0] || '';
  const buyerShowWorkflow = workflowSource.match(/export const runShellBuyerShowWorkflow = async \([\s\S]*?\n\};\n\ntype ShellRetouchMode/)?.[0] || '';

  assert.match(workflowSource, /apiConfig\?: GlobalApiConfig/);
  assert.match(buyerShowBranch, /apiConfig,/);
  assert.match(buyerShowBranch, /多套买家秀将按批轮流生成/);
  assert.match(buyerShowBranch, /联系管理员提升并发数量/);
  assert.match(buyerShowWorkflow, /buyerShowConcurrency/);
  assert.match(buyerShowWorkflow, /runBuyerShowConcurrencyPool/);
  assert.match(buyerShowWorkflow, /for \(let taskIndex = 0; taskIndex < state\.imageCount; taskIndex \+= 1\)/);
  assert.match(buyerShowWorkflow, /shellProjectId: setProjectId \|\| input\.taskMetadata\?\.shellProjectId/);
  assert.match(buyerShowWorkflow, /batchIndex: setBatchIndex/);
  assert.match(buyerShowWorkflow, /batchCount: state\.imageCount/);
  assert.match(buyerShowWorkflow, /buyerShowGlobalBatchIndex: currentBatchIndex/);
  assert.match(buyerShowWorkflow, /imageIndex: setBatchIndex/);
  assert.match(workflowSource, /item\.buyerShowSetIndex === setIndex \|\| \(setIndex === 0 && typeof item\.buyerShowSetIndex !== 'number'\)/);
  assert.match(workflowSource, /Model reference images:/);
});

test('shell result deletion records backend job tombstones for pending results', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const deleteResultBlock = shellSource.match(/const handleDeleteResult = useCallback\([\s\S]*?\n  \}, \[[^\]]*persistDeletionToSharedState[^\]]*\]\);/)?.[0] || '';

  assert.match(deleteResultBlock, /const result = project\?\.results\.find\(\(item\) => item\.id === resultId\)/);
  assert.match(deleteResultBlock, /const resultJobIds = collectShellResultDeletionJobIds\(resultId, result\)/);
  assert.match(deleteResultBlock, /persistDeletionToSharedState\(\{ projectId, resultId, jobIds: resultJobIds \}\)/);
  assert.doesNotMatch(deleteResultBlock, /result\?\.taskId/);
  assert.doesNotMatch(deleteResultBlock, /jobIdsToDelete\s*=\s*resultJobIds\.length > 0 \? resultJobIds : \[resultId\]/);
});

test('deleting one batch result keeps sibling task tracking intact', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const deleteResultBlock = shellSource.match(/const handleDeleteResult = useCallback\([\s\S]*?\n  \}, \[[^\]]*persistDeletionToSharedState[^\]]*\]\);/)?.[0] || '';

  assert.doesNotMatch(deleteResultBlock, /t\.projectId !== projectId/);
  assert.match(deleteResultBlock, /!resultJobIds\.includes\(t\.backendJobId \|\| ''\)/);
});

test('single-result deletion persists the tombstone in parallel and reports physical delete failures', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const deleteResultBlock = shellSource.match(/const handleDeleteResult = useCallback\([\s\S]*?\n  \}, \[[^\]]*persistDeletionToSharedState[^\]]*\]\);/)?.[0] || '';

  assert.match(deleteResultBlock, /startDeletionOperations\(\{/);
  assert.match(deleteResultBlock, /persistTombstone: \(\) => persistDeletionToSharedState\(\{ projectId, resultId, jobIds: resultJobIds \}\)/);
  assert.match(deleteResultBlock, /resolveDeletionOutcome\(\{/);
});

test('project deletion collects every related backend job before physical deletion and tombstoning', () => {
  const shellSource = read('../../ShellMigratedApp.tsx');
  const deleteProjectBlock = shellSource.match(/const handleDeleteProject = useCallback\([\s\S]*?\n  \}, \[[^\]]*persistDeletionToSharedState[^\]]*\]\);/)?.[0] || '';

  assert.match(shellSource, /import \{ collectShellDeletionJobIds, collectShellResultDeletionJobIds \} from '\.\/utils\/shellDeletionJobs'/);
  assert.match(deleteProjectBlock, /const jobIds = Array\.from\(new Set\(\[/);
  assert.match(deleteProjectBlock, /\.\.\.collectShellDeletionJobIds\(projectId, projects, tasks\)/);
  assert.match(deleteProjectBlock, /generationContext\?\.productRestore\?\.analysisJobId/);
  assert.match(deleteProjectBlock, /productRestoreObservedJobIdsRef\.current\.get\(projectId\)/);
  assert.match(deleteProjectBlock, /startDeletionOperations\(\{/);
  assert.match(deleteProjectBlock, /persistTombstone: \(\) => persistDeletionToSharedState\(\{ projectId, jobIds \}\)/);
  assert.match(deleteProjectBlock, /resolveDeletionOutcome\(\{/);
});

test('collectShellDeletionJobIds includes project, result, task and synthetic project jobs only once', () => {
  const jobIds = collectShellDeletionJobIds('job-project-root', [{
    id: 'job-project-root',
    backendJobId: 'project-root',
    results: [
      { backendJobId: 'result-job-1' },
      { backendJobId: 'result-job-2' },
      { backendJobId: 'project-root' },
      { taskId: 'provider-task-must-not-be-deleted' },
    ],
  }], [
    { projectId: 'job-project-root', backendJobId: 'task-job-1' },
    { projectId: 'another-project', backendJobId: 'unrelated-job' },
  ]);

  assert.deepEqual(jobIds, ['project-root', 'result-job-1', 'result-job-2', 'task-job-1']);
});

test('collectShellResultDeletionJobIds excludes provider identities even when they use a job- prefix', () => {
  assert.deepEqual(collectShellResultDeletionJobIds('provider-result-id', {
    id: 'provider-result-id',
    taskId: 'provider-task-must-not-be-deleted',
    providerTaskId: 'provider-task-also-must-not-be-deleted',
    backendJobId: 'backend-job-1',
  }), ['backend-job-1']);

  assert.deepEqual(collectShellResultDeletionJobIds('job-provider-task-123', {
    id: 'job-provider-task-123',
    taskId: 'provider-task-must-not-be-deleted',
    providerTaskId: 'job-provider-task-123',
  }), []);
});

test('deleting a subtitle removal card never collects or mutates its source video project', () => {
  const sharedSourceUrl = '/api/assets/file/source-video.mp4';
  const sourceProject = {
    id: 'source-video-project',
    name: '原视频项目',
    module: 'video',
    subFeature: 'generation',
    status: 'completed',
    createdAt: 1784073000000,
    taskCount: 1,
    completedCount: 1,
    backendJobId: 'source-video-job',
    results: [{ id: 'source-video-result', backendJobId: 'source-video-job', videoUrl: sharedSourceUrl }],
  };
  const subtitleProject = {
    id: 'subtitle-project',
    name: '去字幕项目',
    module: 'video',
    subFeature: 'subtitle_removal',
    status: 'completed',
    createdAt: 1784073600000,
    taskCount: 3,
    completedCount: 2,
    backendJobId: 'subtitle-job-1',
    results: [1, 2, 3].map((index) => ({
      id: `subtitle-result-${index}`,
      backendJobId: `subtitle-job-${index}`,
      sourceUrl: sharedSourceUrl,
      videoUrl: index < 3 ? `/api/assets/file/subtitle-result-${index}.mp4` : '',
    })),
  };
  const projects = [sourceProject, subtitleProject];

  assert.deepEqual(collectShellDeletionJobIds('subtitle-project', projects, []), ['subtitle-job-1', 'subtitle-job-2', 'subtitle-job-3']);
  assert.deepEqual(sourceProject.results, [{ id: 'source-video-result', backendJobId: 'source-video-job', videoUrl: sharedSourceUrl }]);

  const target = { projectId: 'subtitle-project', jobIds: ['subtitle-job-1', 'subtitle-job-2', 'subtitle-job-3'] };
  const pruned = applyPersistedDeletionTombstones(prunePersistedAppStateForDeletion(
    buildPersistedAppState({ shellProjects: projects }),
    target,
  ), target);
  assert.ok(pruned.shellProjects.some((project) => project.id === 'source-video-project'));
  assert.equal(pruned.shellProjects.some((project) => project.id === 'subtitle-project'), false);
  assert.ok(pruned.shellDraft.deletedProjectIds.includes('subtitle-project'));
});

test('subtitle batch retry confirms every possibly-paid retry and blocks unknown submissions', () => {
  const projectCardSource = read('./ProjectCard.tsx');
  const shellSource = read('../../ShellMigratedApp.tsx');

  assert.match(projectCardSource, /subtitleRetryResultId/);
  assert.match(projectCardSource, /getSubtitleRemovalRetryDecision/);
  assert.match(projectCardSource, /将产生一次新的付费处理/);
  assert.match(projectCardSource, /可能产生一次新的付费处理/);
  assert.doesNotMatch(projectCardSource, /subtitleCanRecoverExistingTask/);
  assert.match(projectCardSource, /待管理员核实/);
  assert.match(shellSource, /project\.subFeature === 'subtitle_removal'/);
  assert.match(shellSource, /retryInternalJob\(result\.backendJobId\)/);
  assert.match(shellSource, /shellResultId: result\.id/);
  assert.match(shellSource, /clientSubmissionKey: result\.clientSubmissionKey/);
  assert.match(shellSource, /status: 'generating'/);
});
