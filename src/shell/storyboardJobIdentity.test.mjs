import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const videoModuleSource = readFileSync(new URL('./modules/Video/VideoModule.tsx', import.meta.url), 'utf8');

test('storyboard job-created callbacks persist backend identity without releasing submit locks', () => {
  assert.match(shellSource, /recordStoryboardJobCreated/);
  assert.match(shellSource, /planningJobId/);
  assert.match(shellSource, /backendJobId/);
  assert.match(shellSource, /setVideoMemory\(/);
  assert.match(shellSource, /setTasks\(/);
  assert.doesNotMatch(
    shellSource.match(/const recordStoryboardJobCreated[\s\S]*?const handleGenerate/)?.[0] || '',
    /releaseGuardedSubmit/,
  );
});

test('all storyboard planning and board submits carry stable project metadata', () => {
  const storyboardSubmitBlock = shellSource.match(/if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'storyboard'\) \{[\s\S]*?if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'diagnosis'\) \{/)?.[0] || '';
  const regenerateBlock = shellSource.match(/const handleStoryboardRegenerateResult = useCallback\(async \([\s\S]*?const handleConfirmStoryboardImaging =/)?.[0] || '';
  const confirmBlock = shellSource.match(/const handleConfirmStoryboardImaging = useCallback\(async \([\s\S]*?const handleRegenerateResult =/)?.[0] || '';
  const editBlock = shellSource.match(/const handleStoryboardEditResult = useCallback\(async \([\s\S]*?const runEverythingReplaceEditGeneration =/)?.[0] || '';

  assert.match(storyboardSubmitBlock, /shellProjectId: project\.id/);
  assert.match(storyboardSubmitBlock, /planningPurpose: 'storyboard_planning'/);
  assert.match(storyboardSubmitBlock, /phase: 'planning'/);
  [storyboardSubmitBlock, regenerateBlock, confirmBlock, editBlock].forEach((block) => {
    assert.match(block, /shellProjectId:/);
    assert.match(block, /planningPurpose: 'storyboard_board_image'/);
    assert.match(block, /phase:/);
    assert.match(block, /boardId:/);
    assert.match(block, /onJobCreated:/);
  });
});

test('job hydration merges recovered storyboard source data and exposes cancel ids', () => {
  const hydrationBlock = shellSource.match(/const hydrateShellJobs = useCallback\(async \(\) => \{[\s\S]*?traceStartup\('hydrate-shell-jobs:end'\)/)?.[0] || '';

  assert.match(hydrationBlock, /storyboardSourceProject/);
  assert.match(hydrationBlock, /mergeRecoveredStoryboardProjects/);
  assert.match(hydrationBlock, /fetchInternalJobs\(200\)/);
  assert.match(hydrationBlock, /fetchInternalJob\(/);
  assert.match(videoModuleSource, /backendJobId:/);
  assert.match(videoModuleSource, /planningJobId/);
});

test('storyboard confirmation state does not keep backend polling active', () => {
  const activeProjectBlock = shellSource.match(/const hasActiveBackendProject = projects\.some\(\(project\) => \{[\s\S]*?\n    \}\);/)?.[0] || '';

  assert.match(activeProjectBlock, /storyboardProjectStatus === 'awaiting_image_confirmation'/);
  assert.match(shellSource, /getResumableStoryboardBoard\(project\)/);
  assert.match(shellSource, /void handleConfirmStoryboardImaging\(resumableProject\.id\)/);
});
