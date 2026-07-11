import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const helperUrl = new URL('./storyboardGenerationState.mjs', import.meta.url);

const loadHelper = async () => {
  assert.equal(existsSync(helperUrl), true, 'storyboard generation state helper must exist');
  return import(helperUrl.href);
};

test('storyboard provider states map to one board-state contract', async () => {
  const { applyStoryboardBoardResult } = await loadHelper();
  const board = { id: 'board-1', status: 'pending', imageUrl: '' };

  assert.equal(applyStoryboardBoardResult(board, { status: 'pending' }).status, 'generating');
  assert.equal(applyStoryboardBoardResult(board, { status: 'queued' }).status, 'generating');
  assert.equal(applyStoryboardBoardResult(board, { status: 'running' }).status, 'generating');
  assert.equal(applyStoryboardBoardResult(board, { status: 'generating', backendJobId: 'job-1', taskId: 'provider-1' }).status, 'generating');
  assert.deepEqual(
    applyStoryboardBoardResult(board, { status: 'success', imageUrl: '/board.png', backendJobId: 'job-1', taskId: 'provider-1' }),
    {
      ...board,
      status: 'completed',
      imageUrl: '/board.png',
      backendJobId: 'job-1',
      taskId: 'provider-1',
      error: undefined,
    },
  );
  assert.equal(applyStoryboardBoardResult(board, { status: 'success', imageUrl: '' }).status, 'failed');
  assert.equal(applyStoryboardBoardResult(board, { status: 'failed', message: 'provider failed' }).status, 'failed');
  assert.equal(applyStoryboardBoardResult(board, { status: 'cancelled' }).status, 'failed');
  assert.match(applyStoryboardBoardResult(board, { status: 'cancelled' }).error, /中断|取消/);
});

test('storyboard project and shell status never treat pending boards as completed', async () => {
  const { deriveStoryboardProjectStatus, toStoryboardShellResultStatus } = await loadHelper();

  assert.equal(deriveStoryboardProjectStatus([
    { status: 'completed', imageUrl: '/first.png' },
    { status: 'pending' },
  ]), 'imaging');
  assert.equal(deriveStoryboardProjectStatus([
    { status: 'failed' },
    { status: 'pending' },
  ]), 'failed');
  assert.equal(deriveStoryboardProjectStatus([
    { status: 'completed', imageUrl: '/first.png' },
    { status: 'completed', imageUrl: '/second.png' },
  ]), 'completed');
  assert.equal(deriveStoryboardProjectStatus([{ status: 'failed' }]), 'failed');
  assert.equal(toStoryboardShellResultStatus({ status: 'pending' }), 'generating');
  assert.equal(toStoryboardShellResultStatus({ status: 'generating' }), 'generating');
  assert.equal(toStoryboardShellResultStatus({ status: 'completed', imageUrl: '/board.png' }), 'completed');
  assert.equal(toStoryboardShellResultStatus({ status: 'failed' }), 'error');
});

test('all storyboard image entry points consume the shared status mapper', () => {
  const shellSource = readFileSync(new URL('../../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
  const videoModuleSource = readFileSync(new URL('./VideoModule.tsx', import.meta.url), 'utf8');
  const initialBlock = shellSource.match(/if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'storyboard'\) \{[\s\S]*?if \(targetModule === AppModuleObj\.VIDEO && targetSubFeature === 'diagnosis'\) \{/)?.[0] || '';
  const regenerateBlock = shellSource.match(/const handleStoryboardRegenerateResult = useCallback\(async \([\s\S]*?const handleConfirmStoryboardImaging =/)?.[0] || '';
  const confirmBlock = shellSource.match(/const handleConfirmStoryboardImaging = useCallback\(async \([\s\S]*?const handleRegenerateResult =/)?.[0] || '';
  const editBlock = shellSource.match(/const handleStoryboardEditResult = useCallback\(async \([\s\S]*?const runEverythingReplaceEditGeneration =/)?.[0] || '';

  [initialBlock, regenerateBlock, confirmBlock, editBlock].forEach((block) => {
    assert.match(block, /applyStoryboardBoardResult\(/);
    assert.match(block, /deriveStoryboardProjectStatus\(/);
  });
  assert.match(videoModuleSource, /toStoryboardShellResultStatus\(board\)/);
  assert.doesNotMatch(videoModuleSource, /board\.status === 'failed' \? 'error' : board\.status === 'generating' \? 'generating' : 'completed'/);
});
