import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellApp = () => readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');

const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test('generation submit lock uses a synchronous ref and stays scoped to paid video submission', () => {
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
  assert.match(guardBlock, /module === AppModuleObj\.VIDEO/);
  assert.doesNotMatch(guardBlock, /AppModuleObj\.ONE_CLICK/);
  assert.doesNotMatch(guardBlock, /AppModuleObj\.TRANSLATION/);
  assert.doesNotMatch(guardBlock, /AppModuleObj\.BUYER_SHOW/);
});

test('completed submission no longer blocks a different active video task', () => {
  const source = shellApp();
  assert.doesNotMatch(source, /const hasActiveGuardedGeneration = \(/);
  assert.doesNotMatch(source, /当前已有任务未返回，请等待完成或取消后再提交。/);
  assert.match(
    source,
    /const isCurrentGenerationSubmitLocked = shouldGuardGenerationSubmit\(activeModule, activeSubFeature\)\s*&& Boolean\(generationSubmitLocks\[currentGenerationSubmitLockKey\]\)/,
  );
});

test('storyboard submit lock remains held through material upload and releases when the backend job exists', () => {
  const source = shellApp();
  const storyboardBlock = sliceBetween(
    source,
    "if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'storyboard') {",
    "if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'diagnosis') {",
  );

  const beforeMaterialUpload = storyboardBlock.slice(0, storyboardBlock.indexOf('await ensureMaterialRemoteUrls'));
  assert.match(storyboardBlock, /if \(!beginGuardedSubmit\(\)\) return/);
  assert.doesNotMatch(beforeMaterialUpload, /releaseGuardedSubmit\(\)/);
  assert.match(storyboardBlock, /onJobCreated: \(jobId, providerTaskId\) => \{\s*releaseGuardedSubmit\(\)/);
  assert.match(storyboardBlock, /finally \{[\s\S]*releaseGuardedSubmit\(\)/);
});

test('standard video job-created callback releases only the submit window', () => {
  const source = shellApp();
  const standardGenerationBlock = sliceBetween(
    source,
    'const newProject: Project = {',
    'const result = targetModule === AppModuleObj.VIDEO',
  );

  assert.match(standardGenerationBlock, /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{\s*releaseGuardedSubmit\(\)/);
});
