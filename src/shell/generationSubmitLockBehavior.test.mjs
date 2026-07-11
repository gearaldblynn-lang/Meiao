import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellApp = () => readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const shellWorkflow = () => readFileSync(new URL('../adapters/shellWorkflow.ts', import.meta.url), 'utf8');

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test('generation submit lock uses a synchronous ref across every runnable generation module', () => {
  const source = shellApp();
  const lockBlock = sliceBetween(
    source,
    'const beginGenerationSubmitLock = useCallback',
    'const endGenerationSubmitLock = useCallback',
  );
  const guardBlock = sliceBetween(
    source,
    'const shouldGuardGenerationSubmit =',
    'const hasRuntimeTaskIdentity =',
  );

  assert.match(lockBlock, /generationSubmitLocksRef\.current\.has\(lockKey\)/);
  assert.match(lockBlock, /generationSubmitLocksRef\.current\.add\(lockKey\)/);
  assert.match(guardBlock, /module === AppModuleObj\.ONE_CLICK/);
  assert.match(guardBlock, /module === AppModuleObj\.TRANSLATION/);
  assert.match(guardBlock, /module === AppModuleObj\.BUYER_SHOW/);
  assert.match(guardBlock, /module === AppModuleObj\.RETOUCH/);
  assert.match(guardBlock, /module === AppModuleObj\.EVERYTHING_REPLACE/);
  assert.match(guardBlock, /module === AppModuleObj\.VIDEO/);
  assert.match(guardBlock, /module === AppModuleObj\.XHS_COVER/);
});

test('semantic submit key allows different inputs without reopening the same paid request', () => {
  const source = shellApp();
  assert.doesNotMatch(source, /const hasActiveGuardedGeneration = \(/);
  assert.doesNotMatch(source, /当前已有任务未返回，请等待完成或取消后再提交。/);
  assert.match(
    source,
    /const currentGenerationSubmitLockKey = buildGenerationSubmissionKey\(\{[\s\S]*prompt: promptText[\s\S]*params: currentParams[\s\S]*materials: filteredMaterials/,
  );
});

test('storyboard semantic lock remains held through backend completion', () => {
  const source = shellApp();
  const storyboardBlock = sliceBetween(
    source,
    "if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'storyboard') {",
    "if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'diagnosis') {",
  );

  const beforeMaterialUpload = storyboardBlock.slice(0, storyboardBlock.indexOf('await ensureMaterialRemoteUrls'));
  assert.match(storyboardBlock, /if \(!beginGuardedSubmit\(\)\) return/);
  assert.doesNotMatch(beforeMaterialUpload, /releaseGuardedSubmit\(\)/);
  assert.doesNotMatch(storyboardBlock, /onJobCreated: \(jobId, providerTaskId\) => \{\s*releaseGuardedSubmit\(\)/);
  assert.match(storyboardBlock, /finally \{[\s\S]*releaseGuardedSubmit\(\)/);
});

test('standard video keeps the semantic lock after job creation and releases in finally', () => {
  const source = shellApp();
  const standardGenerationBlock = sliceBetween(
    source,
    'const newProject: Project = {',
    'const result = targetModule === AppModuleObj.VIDEO',
  );

  assert.doesNotMatch(standardGenerationBlock, /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{\s*releaseGuardedSubmit\(\)/);
  assert.match(source, /finally \{[\s\S]*releaseGuardedSubmit\(\)/);
});

test('standard video forwards the semantic submission key into every backend payload', () => {
  const source = shellApp();
  const workflowSource = shellWorkflow();
  const standardVideoCall = sliceBetween(
    source,
    'const result = targetModule === AppModuleObj.VIDEO',
    ': null;',
  );
  const videoWorkflowStart = workflowSource.indexOf('export const runShellVideoGeneration = async');
  assert.notEqual(videoWorkflowStart, -1, 'missing standard video workflow');
  const videoWorkflow = workflowSource.slice(videoWorkflowStart);

  assert.match(standardVideoCall, /taskMetadata:\s*\{\s*clientSubmissionKey:\s*guardedSubmitLockKey\s*\}/);
  assert.equal((videoWorkflow.match(/\.\.\.\(input\.taskMetadata \|\| \{\}\)/g) || []).length, 2);
});
