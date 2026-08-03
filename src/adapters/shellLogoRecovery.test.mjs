import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('Logo result recovery resumes the existing internal generation job before generic provider recovery', () => {
  const start = appSource.indexOf('const handleRecoverResult = useCallback');
  const end = appSource.indexOf('\n  const handleCancelTask = useCallback', start);
  const recovery = start >= 0 && end > start ? appSource.slice(start, end) : '';

  assert.match(recovery, /isLogoReplaceRecovery/);
  assert.match(recovery, /fetchInternalJob\(targetResult\.backendJobId!?\)/);
  assert.match(recovery, /resumeLogoReplaceGenerationResult/);
  assert.match(recovery, /buildShellModuleConfig/);
  assert.ok(
    recovery.indexOf('resumeLogoReplaceGenerationResult') < recovery.indexOf('recoverKieAiTask'),
    'Logo recovery must complete the guarded post-processing path before generic provider recovery',
  );
});

test('Logo analysis failure recovery reuses the successful analysis job before creating generation', () => {
  const start = appSource.indexOf('const handleRegenerateResult = useCallback');
  const end = appSource.indexOf('\n  useEffect(() => {', start);
  const regeneration = start >= 0 && end > start ? appSource.slice(start, end) : '';

  assert.match(regeneration, /isLogoReplaceAnalysisRecovery/);
  assert.match(regeneration, /job\.payload\?\.taskPurpose === 'logo_replace_analysis'/);
  assert.match(regeneration, /logoReplaceAnalysisJobIds/);
  assert.match(regeneration, /shellPurpose: 'logo_replace_recovery'/);
  assert.match(regeneration, /runShellRetouchWorkflow/);
  assert.match(appSource, /activeLogoReplaceAnalysisJobId/);
  assert.match(appSource, /logoReplaceAnalysisJobId: activeLogoReplaceAnalysisJobId/);
});

test('job-hydrated Logo failures bypass direct backend retry and reach Logo analysis recovery', () => {
  const start = appSource.indexOf('const handleRegenerateResult = useCallback');
  const end = appSource.indexOf('\n  useEffect(() => {', start);
  const regeneration = start >= 0 && end > start ? appSource.slice(start, end) : '';
  const genericRetry = regeneration.match(/if \(project\.sourceType === 'job'[\s\S]*?await retryInternalJob\(resultId\);/)?.[0] || '';

  assert.match(regeneration, /const isLogoReplaceRegeneration = project\.module === AppModuleObj\.EVERYTHING_REPLACE/);
  assert.match(genericRetry, /!isLogoReplaceRegeneration/);
  assert.ok(
    regeneration.indexOf('const isLogoReplaceRegeneration') < regeneration.indexOf("if (project.sourceType === 'job'"),
    'Logo retry classification must exist before the generic backend-job retry branch',
  );
  assert.ok(
    regeneration.indexOf("if (project.sourceType === 'job'") < regeneration.indexOf('const isLogoReplaceAnalysisRecovery'),
    'the generic branch may remain earlier only when it explicitly excludes Logo recovery',
  );
});
