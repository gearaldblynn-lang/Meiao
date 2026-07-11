import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('generation lock remains active for the same semantic input after backend job creation', () => {
  assert.match(shellSource, /buildGenerationSubmissionKey\(\{[\s\S]*prompt: promptText[\s\S]*params: currentParams[\s\S]*materials: filteredMaterials/);
  assert.match(shellSource, /const currentGenerationSubmitLockKey = buildGenerationSubmissionKey\(\{/);
  assert.doesNotMatch(shellSource, /onJobCreated: \(jobId, providerTaskId\) => \{\s*releaseGuardedSubmit\(\)/);
  assert.doesNotMatch(shellSource, /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{\s*releaseGuardedSubmit\(\)/);
  assert.match(shellSource, /finally \{[\s\S]*releaseGuardedSubmit\(\)/);
});

test('storyboard project deletion aborts local preparation and cancels every durable job id', () => {
  assert.match(shellSource, /const deletedStoryboardProjectIdsRef = useRef<Set<string>>/);
  assert.match(shellSource, /taskControllersRef\.current\[project\.id\] = storyboardController/);
  assert.match(shellSource, /deletedStoryboardProjectIdsRef\.current\.has\(project\.id\)/);
  assert.match(shellSource, /signal: storyboardController\.signal/);
  assert.match(shellSource, /collectStoryboardProjectJobIds\(storyboardProject, \{/);
  assert.match(shellSource, /cancelInternalJob\(jobId\)/);
  const deleteProjectBlock = shellSource.match(/const handleDeleteProject = useCallback\([\s\S]*?const handleStoryboardRegenerateResult = useCallback/)?.[0] || '';
  assert.match(deleteProjectBlock, /\}, \[projects, tasks, videoMemory,/);
});

test('storyboard cancel and single-result delete update videoMemory instead of only shell mirrors', () => {
  assert.match(shellSource, /markStoryboardProjectCancelled/);
  assert.match(shellSource, /setVideoMemory\(\(prev\) => \{/);
  assert.match(shellSource, /const storyboardBoard = storyboardProject\?\.boards\.find/);
  assert.match(shellSource, /collectStoryboardBoardJobIds\(storyboardProject, resultId/);
  assert.match(shellSource, /fetchInternalJobs\(200\)/);
  assert.match(shellSource, /jobs: historicalJobs/);
  assert.match(shellSource, /removeStoryboardBoardResult\(item, resultId\)/);
  assert.match(shellSource, /persistDeletionToSharedState\(\{[\s\S]*projectId,[\s\S]*resultId,[\s\S]*jobIds: Array\.from\(deletionGuard\.jobIds\),[\s\S]*preserveStoryboardBoardSlot: true/);
});

test('single storyboard deletion fails closed and opens the pending slot only after persistence', () => {
  const deleteBlock = shellSource.match(/const handleDeleteResult = useCallback\(async[\s\S]*?const handleDeletePlan = useCallback/)?.[0] || '';
  const persistIndex = deleteBlock.indexOf('const synced = await persistDeletionToSharedState');
  const resetIndex = deleteBlock.indexOf('removeStoryboardBoardResult(item, resultId)');
  const guardIndex = deleteBlock.indexOf('storyboardBoardDeletionGuardsRef.current.set');
  const historyIndex = deleteBlock.indexOf('await fetchInternalJobs(200)');

  assert.match(deleteBlock, /catch \{[\s\S]*addToast\('无法读取分镜任务历史，请稍后重试删除'/);
  assert.match(deleteBlock, /catch \{[\s\S]*return;/);
  assert.ok(persistIndex >= 0);
  assert.ok(resetIndex > persistIndex);
  assert.ok(guardIndex >= 0 && guardIndex < historyIndex);
  assert.match(deleteBlock, /await Promise\.allSettled\(activeStoryboardJobIds\.map/);
  assert.match(shellSource, /phase: 'collecting'/);
  assert.match(shellSource, /deletionGuard\.jobIds\.add\(backendJobId\)/);
  assert.match(shellSource, /deletionGuard\.cancellationPromises\.set\(backendJobId/);
  assert.match(shellSource, /if \(deletionGuard\.phase === 'committed'\)/);
  assert.match(deleteBlock, /deletionGuard\.phase = 'committed'/);
  assert.match(shellSource, /persistDeletionToSharedState\(\{[\s\S]*jobIds: Array\.from\(deletionGuard\.jobIds\)/);
  assert.match(shellSource, /autoResumeBlocked: undefined/);
});

test('automatic storyboard resume ignores work still owned by a local controller', () => {
  const resumeEffect = shellSource.match(/useEffect\(\(\) => \{\s*const resumableProject[\s\S]*?const handleRegenerateResult = useCallback/)?.[0] || '';

  assert.match(resumeEffect, /taskControllersRef\.current\[resumableProject\.id\]/);
  assert.match(resumeEffect, /cancelledStoryboardProjectIdsRef\.current\.has\(project\.id\)/);
  assert.match(resumeEffect, /return undefined/);
});

test('automatic storyboard resume reuses the initial board submission key after refresh', () => {
  assert.match(shellSource, /clientSubmissionKey: `\$\{project\.clientSubmissionKey \|\| `storyboard:\$\{project\.id\}`\}:board:\$\{boardIndex\}`/);
  assert.doesNotMatch(shellSource, /clientSubmissionKey: `\$\{project\.clientSubmissionKey[\s\S]*?:confirm:/);
});

test('storyboard edit registers cancellation before upload and forwards a semantic key', () => {
  const editBlock = shellSource.match(/const handleStoryboardEditResult = useCallback\(async \([\s\S]*?const handleEditResult = useCallback/)?.[0] || '';
  const beforeUpload = editBlock.slice(0, editBlock.indexOf('await Promise.all(files.map'));

  assert.match(beforeUpload, /const storyboardController = new AbortController\(\)/);
  assert.match(beforeUpload, /taskControllersRef\.current\[projectId\] = storyboardController/);
  assert.match(editBlock, /storyboardController\.signal\.aborted/);
  assert.match(editBlock, /uploadInternalAssetStream\(\{[\s\S]*signal: storyboardController\.signal/);
  assert.match(editBlock, /signal: storyboardController\.signal/);
  assert.match(editBlock, /clientSubmissionKey: storyboardSubmissionKey/);
  assert.match(editBlock, /finally \{[\s\S]*delete taskControllersRef\.current\[projectId\]/);
});

test('storyboard regenerate and edit cannot tear down a deletion guard while it is collecting', () => {
  const regenerateBlock = shellSource.match(/const handleStoryboardRegenerateResult = useCallback\(async[\s\S]*?const handleConfirmStoryboardImaging = useCallback/)?.[0] || '';
  const editBlock = shellSource.match(/const handleStoryboardEditResult = useCallback\(async[\s\S]*?const handleEditResult = useCallback/)?.[0] || '';

  [regenerateBlock, editBlock].forEach((block) => {
    assert.match(block, /deletionGuard\?\.phase === 'collecting'/);
    assert.match(block, /分镜结果正在删除，请等待完成/);
    assert.match(block, /return true/);
  });
});
