import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
const localJobStoreSource = readFileSync(new URL('./localJobStore.mjs', import.meta.url), 'utf8');
const jobRuntimeSource = readFileSync(new URL('./jobRuntime.mjs', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const temporalWorkerSource = readFileSync(new URL('./temporalWorker.mjs', import.meta.url), 'utf8');
const temporalWorkflowSource = readFileSync(new URL('./temporal/workflows.mjs', import.meta.url), 'utf8');

test('failed job logs keep providerTaskId from the thrown provider error', () => {
  assert.match(jobManagerSource, /buildJobRuntimeLogMeta\(\{ job: latestJob, error, finishedAt, retryCount: failure\.retryCount \}\)/);
  assert.match(localJobStoreSource, /buildJobRuntimeLogMeta\(\{ job: failedJob, error, finishedAt: failedJob\.finishedAt \|\| Date\.now\(\), retryCount: failedJob\.retryCount \}\)/);
  assert.match(jobRuntimeSource, /providerTaskId,\s*\n\s*provider:/);
  assert.match(jobRuntimeSource, /error\?\.providerTaskId/);
});

test('job logs expose stable diagnostic correlation fields', () => {
  assert.match(jobRuntimeSource, /diagnosticSchemaVersion: DIAGNOSTIC_SCHEMA_VERSION/);
  assert.match(jobRuntimeSource, /eventKind: 'job_runtime'/);
  assert.match(jobRuntimeSource, /traceId,/);
  assert.match(jobRuntimeSource, /correlationId: firstNonEmpty\(providerTaskId, job\?\.id, requestId\)/);
  assert.match(jobRuntimeSource, /errorOrigin: classifyRuntimeErrorOrigin\(error\)/);
  assert.match(jobRuntimeSource, /inputImageUrlCount: inputCounts\.imageUrlCount/);
});

test('job worker writes provider submission boundary logs around execution', () => {
  assert.match(jobManagerSource, /action: 'provider_submit_started'/);
  assert.match(jobManagerSource, /action: 'provider_submit_succeeded'/);
  assert.match(jobManagerSource, /action: 'provider_submit_failed'/);
  assert.match(jobManagerSource, /providerSubmitPhase: 'started'/);
  assert.match(jobManagerSource, /providerSubmitPhase: 'failed'/);
  assert.match(jobRuntimeSource, /countMessageInputs/);
  assert.match(jobRuntimeSource, /messageCounts\.imageUrlCount/);
});

test('job worker persists task platform attempt and stage events around execution', () => {
  assert.match(jobManagerSource, /createJobAttempt/);
  assert.match(jobManagerSource, /recordJobEvent/);
  assert.match(jobManagerSource, /finishJobAttempt/);
  assert.match(jobManagerSource, /stage: 'provider_submit'/);
  assert.match(jobManagerSource, /eventName: 'provider_task_id_received'/);
  assert.match(jobManagerSource, /stage: controller\.signal\.aborted \? 'cancelled' : 'completed'/);
  assert.match(jobManagerSource, /providerSubmitted: Boolean\(error\?\.providerTaskId \|\| latestJob\?\.providerTaskId\)/);
});

test('successful job logs include provider credits for billing statistics', () => {
  assert.match(jobManagerSource, /buildJobRuntimeLogMeta\(\{ job: refreshedJob, result: output, finishedAt \}\)/);
  assert.match(localJobStoreSource, /buildJobRuntimeLogMeta\(\{ job: finishedJob, result: \{ providerTaskId: finishedJob\.providerTaskId, result: finishedJob\.result \}, finishedAt: finishedJob\.finishedAt \}\)/);
  assert.match(jobRuntimeSource, /creditsConsumed = normalizeLogCreditsConsumed/);
  assert.match(jobRuntimeSource, /creditsConsumed !== undefined \? \{ creditsConsumed \} : \{\}/);
});

test('usage statistics persist successful actual credits per account', () => {
  assert.match(serverSource, /credits_consumed DECIMAL\(12,2\) DEFAULT 0/);
  assert.match(serverSource, /ensureMysqlColumn\(pool, 'usage_daily', 'credits_consumed', 'DECIMAL\(12,2\) DEFAULT 0'\)/);
  assert.match(serverSource, /'analysis_token_usage'/);
  assert.match(serverSource, /credits_consumed = credits_consumed \+ VALUES\(credits_consumed\)/);
  assert.match(serverSource, /creditsConsumed: Number\(r\.credits_consumed \|\| 0\)/);
  assert.match(serverSource, /row\.creditsConsumed = Number\(row\.creditsConsumed \|\| 0\) \+ extractUsageCreditsConsumed\(log\)/);
});

test('usage statistics cover billed xhs cover and video job completions', () => {
  assert.match(serverSource, /const USAGE_MODULES = new Set\(\['agent_center', 'one_click', 'translation', 'buyer_show', 'retouch', 'video', 'xhs_cover'\]\)/);
  assert.match(serverSource, /const USAGE_JOB_COMPLETED_TASK_TYPES = new Set\(\['dreamina_video', 'kie_seedance_video', 'kie_video', 'kie_veo'\]\)/);
  assert.match(serverSource, /const shouldTrackUsageStatLog = \(log = \{\}\) =>/);
  assert.match(serverSource, /log\.action === 'job_completed'/);
  assert.match(serverSource, /JSON_UNQUOTE\(JSON_EXTRACT\(meta_json, '\$\.taskType'\)\) IN \('dreamina_video','kie_seedance_video','kie_video','kie_veo'\)/);
});

test('usage statistics can be viewed by staff in their own account scope', () => {
  assert.match(serverSource, /const viewer = await requireDbUser\(req, res\)/);
  assert.match(serverSource, /const requestedUserId = normalizeLogFilterValue\(url\.searchParams\.get\('userId'\)\)/);
  assert.match(serverSource, /const userId = viewer\.role === 'admin' \? requestedUserId : viewer\.id/);
  assert.match(serverSource, /const viewer = localRequireUser\(req, res, store\)/);
});

test('task platform diagnostics have schema initialization and admin-only routes', () => {
  assert.match(serverSource, /ensureTaskPlatformSchema\(pool\)/);
  assert.match(serverSource, /url\.pathname === '\/api\/admin\/task-platform\/health'/);
  assert.match(serverSource, /url\.pathname === '\/api\/admin\/task-platform\/jobs'/);
  assert.match(serverSource, /taskPlatformTimelineMatch/);
  assert.match(serverSource, /listTaskPlatformJobs\(pool/);
  assert.match(serverSource, /getTaskPlatformTimeline\(pool/);
  assert.match(serverSource, /requireDbAdmin\(req, res\)/);
});

test('local json store only reconciles running jobs during server bootstrap', () => {
  const normalizeLocalStoreBody = serverSource.match(/const normalizeLocalStoreShape = \(store, options = \{\}\) => \{[\s\S]*?\n\};/)?.[0] || '';
  const readLocalStoreBody = serverSource.match(/const readLocalStore = \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  const bootstrapBody = serverSource.match(/const bootstrap = async \(\) => \{[\s\S]*?localJobWorker = createLocalJobWorker/)?.[0] || '';

  assert.match(normalizeLocalStoreBody, /options\.reconcileRunningJobs/);
  assert.match(normalizeLocalStoreBody, /normalizeLocalJobs\(Array\.isArray\(store\.jobs\)/);
  assert.doesNotMatch(readLocalStoreBody, /reconcileRestartedLocalJobs/);
  assert.match(serverSource, /const reconcileLocalStoreJobsAfterRestart = \(\) =>/);
  assert.match(bootstrapBody, /reconcileLocalStoreJobsAfterRestart\(\)/);
});

test('dual task engine mirrors new mysql jobs to optional temporal workflows', () => {
  assert.match(serverSource, /createTemporalTaskAdapter\(\)/);
  assert.match(serverSource, /mirrorDbJobToTemporalIfEnabled/);
  assert.match(serverSource, /normalizeTaskEngineMode\(process\.env\.MEIAO_TASK_ENGINE\)/);
  assert.match(serverSource, /const executionMode = engine === 'temporal' \? 'execute' : 'observe'/);
  assert.match(serverSource, /temporalTaskAdapter\.startJobWorkflow\(job, \{ executionMode, ledger: 'mysql' \}\)/);
  assert.match(serverSource, /const workflowAvailable = result\.started \|\| result\.code === 'temporal_workflow_already_started'/);
  assert.match(serverSource, /eventName: result\.started[\s\S]*'temporal_workflow_already_started'[\s\S]*'temporal_workflow_unavailable'/);
  assert.match(serverSource, /engine === 'temporal' && !workflowAvailable/);
  assert.match(jobManagerSource, /shouldMysqlWorkerProcessTaskEngine\(taskEngine\)/);
});

test('mysql temporal engine starts a real temporal worker instead of the inline mysql worker', () => {
  assert.match(serverSource, /createMysqlTemporalActivities/);
  assert.match(serverSource, /if \(taskEngine !== 'mysql' && temporalTaskAdapter\.configured\) \{/);
  assert.match(serverSource, /activities: createMysqlTemporalActivities\(/);
  assert.match(serverSource, /if \(taskEngine !== 'temporal'\) \{[\s\S]*jobWorker = createJobWorker/);
});

test('temporal engine keeps durable running jobs owned by temporal after restart', () => {
  assert.match(serverSource, /if \(taskEngine !== 'temporal'\) \{[\s\S]*reconcileRestartedRunningJobs\(pool\)/);
  assert.match(serverSource, /reconcileStaleProviderlessRunningJobs/);
  assert.match(serverSource, /await runTemporalStaleRunningJobReconcile\(pool, 'startup'\)/);
  assert.match(serverSource, /startTemporalStaleRunningJobReconciler\(pool\)/);
  assert.match(serverSource, /resumePendingDbTemporalJobs\(pool\)/);
  assert.match(serverSource, /temporal_workflow_already_started/);
  assert.match(serverSource, /const retriedJob = await getJobById\(pool, job\.id\)/);
  assert.match(serverSource, /await mirrorDbJobToTemporalIfEnabled\(pool, retriedJob\)/);
  assert.match(serverSource, /normalizeTaskEngineMode\(process\.env\.MEIAO_TASK_ENGINE\) !== 'temporal'[\s\S]*jobWorker\?\.trigger\?\.\(\)/);
  assert.match(temporalWorkflowSource, /heartbeatTimeout: '30 seconds'/);
  assert.match(temporalWorkflowSource, /maximumAttempts: 3/);
  assert.match(temporalWorkerSource, /temporalActivityHeartbeat/);
  assert.match(temporalWorkerSource, /const isSameMysqlClaim = \(job, claimedAt\) =>/);
  assert.match(temporalWorkerSource, /if \(!isSameMysqlClaim\(latestBeforeComplete, claimedAt\)\) \{/);
  assert.match(temporalWorkerSource, /safeHeartbeat\(heartbeat, \{ jobId: refreshedJob\.id, stage: 'provider_submit', providerTaskId: value \}\)/);
});

test('local temporal engine starts a real worker and does not also trigger the inline worker', () => {
  assert.match(serverSource, /createLocalTemporalActivities/);
  assert.match(serverSource, /startMeiaoTemporalWorker/);
  assert.match(serverSource, /const executionMode = engine === 'temporal' \? 'execute' : 'observe'/);
  assert.match(serverSource, /attachLocalJobWorkflowExecution\(store, job\.id, result, \{ engine, executionMode \}\)/);
  assert.match(serverSource, /if \(taskEngine !== 'temporal'\) \{[\s\S]*localJobWorker = createLocalJobWorker/);
  assert.match(serverSource, /if \(!shouldUseTemporalForLocalExecution\(\)\) \{[\s\S]*localJobWorker\?\.trigger\?\.\(\)/);
});

test('video jobs force zero automatic retries at the server entry points', () => {
  assert.match(serverSource, /const normalizeJobMaxRetries = \(taskType, value\) => \(/);
  assert.match(serverSource, /VIDEO_JOB_TASK_TYPES\.has\(String\(taskType \|\| ''\)\) \? 0 : value/);
  const maxRetryAssignments = serverSource.match(/maxRetries: normalizeJobMaxRetries\(body\.taskType, body\.maxRetries\)/g) || [];
  assert.equal(maxRetryAssignments.length, 2);
});
