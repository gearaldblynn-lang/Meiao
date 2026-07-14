import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflowSource = readFileSync(new URL('./shellWorkflow.ts', import.meta.url), 'utf8');
const productRestoreWorkflowSource = readFileSync(new URL('./shellProductRestoreWorkflow.ts', import.meta.url), 'utf8');
const arkSource = readFileSync(new URL('../services/arkService.ts', import.meta.url), 'utf8');
const storyboardSource = readFileSync(new URL('../services/videoStoryboardService.ts', import.meta.url), 'utf8');
const shellAppSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../types.ts', import.meta.url), 'utf8');
const internalApiSource = readFileSync(new URL('../services/internalApi.ts', import.meta.url), 'utf8');
const visibilitySource = readFileSync(new URL('./shellJobVisibility.ts', import.meta.url), 'utf8');

test('internal job context is a shared additive payload contract', () => {
  assert.match(
    typesSource,
    /export interface JobContext \{[\s\S]*?taskPurpose\?: string;[\s\S]*?shellProjectId\?: string;[\s\S]*?shellProjectName\?: string;[\s\S]*?shellPlanId\?: string;[\s\S]*?shellBoardId\?: string;[\s\S]*?shellPurpose\?: string;[\s\S]*?subFeature\?: string;[\s\S]*?traceId\?: string;[\s\S]*?\}/,
  );
  assert.match(typesSource, /export type InternalJobPayload = Record<string, unknown> & JobContext;/);
  assert.match(internalApiSource, /payload: InternalJobPayload;/);
});

test('active workflow job creators spread named JobContext values', () => {
  assert.match(workflowSource, /const oneClickPlanningJobContext = \{[\s\S]*?\} satisfies JobContext;/);
  assert.match(workflowSource, /const oneClickGenerationJobContext = \{[\s\S]*?\} satisfies JobContext;/);
  assert.match(workflowSource, /const buyerShowPlanningJobContext = \{[\s\S]*?\} satisfies JobContext;/);
  assert.match(workflowSource, /const buyerShowJobContext = \{[\s\S]*?\} satisfies JobContext;/);
  assert.match(workflowSource, /\.\.\.oneClickGenerationJobContext/);
  assert.match(workflowSource, /\.\.\.buyerShowJobContext/);
  assert.match(storyboardSource, /const storyboardPlanningJobContext = \{[\s\S]*?\} satisfies JobContext;/);
  assert.match(storyboardSource, /const storyboardBoardImageJobContext = \{[\s\S]*?\} satisfies JobContext;/);
  assert.match(storyboardSource, /\.\.\.storyboardPlanningJobContext/);
  assert.match(storyboardSource, /\.\.\.storyboardBoardImageJobContext/);
});

test('retouch analysis and image jobs inherit the pre-created shell project identity', () => {
  assert.match(
    workflowSource,
    /analyzeRetouchTask\([\s\S]{0,500}input\.onJobCreated[\s\S]{0,300}taskPurpose:\s*'retouch_analysis'/,
  );
  assert.match(
    arkSource,
    /analyzeRetouchTask[\s\S]{0,300}onJobCreated\?:\s*AnalysisJobCreatedCallback[\s\S]{0,180}jobMetadata\?:\s*Record<string, unknown>/,
  );
  assert.match(
    workflowSource,
    /processWithKieAi\([\s\S]{0,900}\.\.\.\(input\.taskMetadata\s*\|\|\s*\{\}\)[\s\S]{0,300}input\.onJobCreated/,
  );
});

test('storyboard planning and board image jobs carry project and board bindings', () => {
  assert.match(storyboardSource, /taskPurpose:\s*'storyboard_planning'/);
  assert.match(storyboardSource, /shellPlanningPurpose:\s*'storyboard_planning'/);
  assert.match(storyboardSource, /taskPurpose:\s*'storyboard_board_image'/);
  assert.match(storyboardSource, /shellBoardId:\s*String\(jobContext\.shellBoardId \|\| board\.id\)\.trim\(\)/);
  assert.match(
    shellAppSource,
    /generateStoryboardScript\([\s\S]{0,500}shellProjectId:\s*project\.id[\s\S]{0,180}shellProjectName:\s*project\.name/,
  );
  assert.match(
    shellAppSource,
    /generateStoryboardBoardImage\([\s\S]{0,500}shellProjectId:\s*projectId[\s\S]{0,180}shellBoardId:\s*board\.id/,
  );
});

test('product restoration analysis is an explicit bound control purpose', () => {
  assert.match(visibilitySource, /'product_restore_analysis'/);
  assert.match(
    productRestoreWorkflowSource,
    /jobMetadata:\s*\{[\s\S]{0,500}\.{3}\(input\.taskMetadata \|\| \{\}\)[\s\S]{0,300}taskPurpose:\s*'product_restore_analysis'/,
  );
});

test('product restoration lifecycle persists durable analysis before image callbacks', () => {
  assert.match(shellAppSource, /const cloneProductRestoreAnalysis\s*=/);
  assert.match(
    shellAppSource,
    /const cloneProductRestoreContext[\s\S]{0,500}focusIds:\s*\[\.\.\.productRestoreContext\.focusIds\][\s\S]{0,500}normalizedAnalysis:\s*cloneProductRestoreAnalysis/,
  );
  assert.match(
    shellAppSource,
    /productRestore:\s*productRestoreContext[\s\S]{0,180}cloneProductRestoreContext\(productRestoreContext\)/,
  );
  assert.match(
    shellAppSource,
    /onProductRestoreAnalysisCompleted:\s*async\s*\(context\)[\s\S]{0,2200}completedCount:\s*0[\s\S]{0,1200}await persistProjectToSharedState/,
  );
  assert.match(
    shellAppSource,
    /status:\s*isOneClickSubmit \|\| isProductRestoreSubmit \? 'planning' : 'generating'/,
  );
  assert.match(shellAppSource, /taskCount:\s*isProductRestoreSubmit \? batchCount/);
  assert.match(
    shellAppSource,
    /isProductRestoreSubmit\s*\?\s*\[\]\s*:\s*\[\{/,
  );
});

test('product restoration refresh resumes the existing analysis and only missing image targets', () => {
  assert.match(shellAppSource, /productRestoreResumeProjectIdsRef/);
  assert.match(shellAppSource, /recoverProductRestoreAnalysisBatch\(\{/);
  assert.match(shellAppSource, /if \(analysis\.status === 'generating'\) return/);
  assert.match(shellAppSource, /existingTargetKeys/);
  assert.match(shellAppSource, /missingTargets/);
  assert.match(shellAppSource, /runShellProductRestoreItem\(\{/);
  assert.match(shellAppSource, /targetMaterialId[\s\S]{0,180}batchIndex/);
});

test('product restoration context persistence fails closed before image fan-out', () => {
  assert.match(
    shellAppSource,
    /const analysisPersisted = await persistProjectToSharedState\(analysisProject\);[\s\S]{0,500}if \(!analysisPersisted\)[\s\S]{0,500}throw/,
  );
  assert.match(
    shellAppSource,
    /const analysisRecovery = await retryPersistedProductRestoreAnalysis\(\{[\s\S]{0,200}persist: persistProjectToSharedState/,
  );
  assert.match(
    shellAppSource,
    /resumedProject = analysisRecovery\.project;[\s\S]{0,300}!analysisRecovery\.persisted[\s\S]{0,300}\) return;[\s\S]{0,300}fetchInternalJobs/,
  );
  assert.match(
    shellAppSource,
    /const hydratedProjectPersisted = await persistProjectToSharedState\(resumedProject\);[\s\S]{0,500}!hydratedProjectPersisted[\s\S]{0,500}\) return;[\s\S]{0,1200}missingTargets/,
  );
});

test('product restoration deletion aborts execution and aggregates late job identities', () => {
  assert.match(shellAppSource, /type ProductRestoreProjectDeletionGuard = \{/);
  assert.match(shellAppSource, /productRestoreProjectDeletionGuardsRef/);
  assert.match(
    shellAppSource,
    /const recordProductRestoreJobCreated = useCallback[\s\S]{0,1800}deletionGuard\.jobIds\.add\(backendJobId\)[\s\S]{0,900}cancelInternalJob\(backendJobId\)[\s\S]{0,1200}persistDeletionToSharedState/,
  );
  assert.match(
    shellAppSource,
    /taskControllersRef\.current\[projectId\] = controller;/,
  );
  assert.match(
    shellAppSource,
    /const onJobCreated = \(jobId: string, providerTaskId\?: string\) => \{[\s\S]{0,300}recordProductRestoreJobCreated/,
  );
  assert.match(
    shellAppSource,
    /const productRestoreDeletionGuard: ProductRestoreProjectDeletionGuard[\s\S]{0,1400}taskControllersRef\.current\[projectId\]\?\.abort\(\)/,
  );
  assert.match(
    shellAppSource,
    /persistDeletionToSharedState\(\{ projectId, jobIds: Array\.from\(productRestoreDeletionGuard\.jobIds\) \}\)/,
  );
});

test('product restoration cancellation and deletion aggregate the analysis and image jobs', () => {
  assert.match(
    shellAppSource,
    /project\.generationContext\?\.productRestore\?\.analysisJobId/,
  );
  assert.match(
    shellAppSource,
    /collectShellDeletionJobIds\(projectId, projects, tasks\)[\s\S]{0,350}productRestore\?\.analysisJobId/,
  );
  assert.match(shellAppSource, /product_restore_cancelled/);
});

test('product restoration durable cancellation clears only after explicit retry persistence', () => {
  assert.match(
    typesSource,
    /export interface ProductRestoreCancellationMarker \{[\s\S]*?status: 'cancelled';[\s\S]*?jobIds: string\[\];[\s\S]*?\}/,
  );
  assert.match(
    typesSource,
    /export interface ProductRestoreCancellationReset \{[\s\S]*?status: 'retry_reset';[\s\S]*?resetAt: number;[\s\S]*?\}/,
  );

  const assertOrdered = (source, needles) => {
    let cursor = -1;
    needles.forEach((needle) => {
      const next = source.indexOf(needle, cursor + 1);
      assert.ok(next > cursor, `expected ${needle} after offset ${cursor}`);
      cursor = next;
    });
  };
  const manualRetryBlock = shellAppSource.slice(
    shellAppSource.indexOf('const manualSubmissionKey = ['),
    shellAppSource.indexOf('let analysisContextPersisted = false;'),
  );
  assertOrdered(manualRetryBlock, [
    'persistProductRestoreExplicitRetryReset',
    'persist: persistProjectToSharedState',
    'if (!manualAttemptPersisted)',
    'clearForExplicitRetry(project.id)',
    'new AbortController()',
  ]);

  const singleRetryBlock = shellAppSource.slice(
    shellAppSource.indexOf('const retryBaseProject: Project = {'),
    shellAppSource.indexOf('const syncRetryItem = async'),
  );
  assertOrdered(singleRetryBlock, [
    'persistProductRestoreExplicitRetryReset',
    'persist: persistProjectToSharedState',
    'if (!retryMarkerCleared)',
    'clearForExplicitRetry(project.id)',
    'new AbortController()',
  ]);
});
