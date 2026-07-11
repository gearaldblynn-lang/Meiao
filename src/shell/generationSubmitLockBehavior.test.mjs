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

test('generation submit lock uses a synchronous ref and covers every generation module', () => {
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
  assert.doesNotMatch(guardBlock, /product_replace/);
});

test('active submit guard treats backend-identified running work as active', () => {
  const source = shellApp();
  const activeBlock = sliceBetween(
    source,
    'const hasActiveGuardedGeneration = (',
    'const isActiveRegenerationStatus =',
  );

  assert.doesNotMatch(activeBlock, /&& !hasRuntimeTaskIdentity\(task\)/);
  assert.doesNotMatch(activeBlock, /project\.status === 'generating' && !hasRuntimeTaskIdentity\(project\)/);
  assert.doesNotMatch(activeBlock, /project\.status === 'planning' && \!\(project\.plans \|\| \[\]\)\.length && !hasRuntimeTaskIdentity\(project\)/);
  assert.doesNotMatch(activeBlock, /&& !hasRuntimeTaskIdentity\(result\)/);
  assert.match(activeBlock, /isActiveTaskStatus\(task\.status\)/);
  assert.match(activeBlock, /project\.status === 'generating'/);
  assert.match(activeBlock, /project\.status === 'planning'/);
});

test('storyboard submit lock remains held through material upload and job creation', () => {
  const source = shellApp();
  const storyboardBlock = sliceBetween(
    source,
    "if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'storyboard') {",
    "if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'diagnosis') {",
  );

  const beforeMaterialUpload = storyboardBlock.slice(0, storyboardBlock.indexOf('await ensureMaterialRemoteUrls'));
  assert.match(storyboardBlock, /if \(!beginGuardedSubmit\(\)\) return/);
  assert.doesNotMatch(beforeMaterialUpload, /releaseGuardedSubmit\(\)/);
  assert.match(storyboardBlock, /finally \{[\s\S]*releaseGuardedSubmit\(\)/);
});

test('job-created callbacks do not release the submit lock early', () => {
  const source = shellApp();
  const oneClickPlanningBlock = sliceBetween(
    source,
    'const onJobCreated = (jobId: string, providerTaskId?: string) => {',
    'const { runShellOneClickPlanning } = await loadShellWorkflowModule();',
  );
  const standardGenerationBlock = sliceBetween(
    source,
    'const newProject: Project = {',
    'const result = targetModule === AppModuleObj.VIDEO',
  );
  const translationBlock = sliceBetween(
    source,
    'const result = await runShellImageGeneration({',
    "if (result.status !== 'success'",
  );

  assert.doesNotMatch(oneClickPlanningBlock, /releaseGuardedSubmit\(\)/);
  assert.doesNotMatch(standardGenerationBlock, /releaseGuardedSubmit\(\)/);
  assert.doesNotMatch(translationBlock, /releaseGuardedSubmit\(\)/);
});
