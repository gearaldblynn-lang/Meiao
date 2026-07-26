import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const projectCardSource = readFileSync(new URL('../../shell/components/ProjectCard.tsx', import.meta.url), 'utf8');

test('failed translation retry wires historical snapshot and original dimensions into the image job', () => {
  const failedBranchStart = shellSource.indexOf("if (result.status !== 'error') {");
  const failedBranchEnd = shellSource.indexOf(
    "if (project.sourceType === 'job' && !isModelReplaceRegeneration)",
    failedBranchStart,
  );
  assert.ok(failedBranchStart >= 0 && failedBranchEnd > failedBranchStart);
  const failedBranch = shellSource.slice(failedBranchStart, failedBranchEnd);

  assert.match(failedBranch, /buildTranslationFailedRetryPlan\(/);
  assert.match(failedBranch, /executeTranslationRetryPipeline\(/);
  assert.match(failedBranch, /taskMetadata:\s*\{[\s\S]*?\.\.\.failedRetryPlan\.taskMetadata/);
});

test('translation result UI labels original-size output as auto instead of provider matched ratio', () => {
  assert.match(projectCardSource, /getTranslationResultRatioLabel/);
  assert.match(projectCardSource, /const getTranslationRatioLabel = \(result: GeneratedResult\) =>\s*getTranslationResultRatioLabel\(result\)/);
});

test('hydrated optimized retry resumes its generation stage automatically', () => {
  assert.match(shellSource, /translationRetryStage === 'generation_pending'/);
  assert.match(shellSource, /handleRegenerateResult\(project\.id, result\.id\)/);
  assert.match(shellSource, /resumePlanningResult: failedRetryPlan\.resumePlanningResult/);
  assert.match(shellSource, /clientSubmissionKey:/);
});
