import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/services/internalApi.ts', import.meta.url), 'utf8');

test('server entry remains syntactically valid after credit wiring', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('./index.mjs', import.meta.url))], { stdio: 'pipe' });
});

test('user API exposes account credit fields to clients', () => {
  assert.match(typesSource, /creditLimitMode\?: 'unlimited' \| 'limited'/);
  assert.match(typesSource, /creditBalance\?: number/);
  assert.match(typesSource, /creditReserved\?: number/);
  assert.match(typesSource, /creditConsumed\?: number/);
  assert.match(typesSource, /creditAvailable\?: number/);
  assert.match(source, /creditLimitMode: user\.creditLimitMode/);
  assert.match(source, /creditAvailable: getCreditAvailable\(user\)/);
});

test('mysql schema stores account credit balances and ledger entries', () => {
  assert.match(source, /ensureMysqlColumn\(pool, 'users', 'credit_limit_mode'/);
  assert.match(source, /ensureMysqlColumn\(pool, 'users', 'credit_balance'/);
  assert.match(source, /ensureMysqlColumn\(pool, 'users', 'credit_reserved'/);
  assert.match(source, /ensureMysqlColumn\(pool, 'users', 'credit_consumed'/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS account_credit_ledger/);
  assert.match(source, /reservation_id VARCHAR\(24\) NULL/);
  assert.match(source, /ensureMysqlColumn\(pool, 'account_credit_ledger', 'reservation_id'/);
});

test('mysql and local user create and update routes parse credit controls', () => {
  assert.match(source, /const creditLimitMode = normalizeCreditLimitMode\(body\.creditLimitMode\)/);
  assert.match(source, /const creditBalance = normalizeCreditBalanceInput\(body\.creditBalance\)/);
  assert.match(source, /createDbUser\(\{ username, password, role, displayName, jobConcurrency, featurePermissions, creditLimitMode, creditBalance \}\)/);
  assert.match(source, /createUser\(\{ username, password, role, displayName, jobConcurrency, featurePermissions, creditLimitMode, creditBalance \}\)/);
  assert.equal(source.match(/const creditLimitMode = normalizeCreditLimitMode\(body\.creditLimitMode\)/g)?.length, 2);
  assert.equal(source.match(/const creditBalance = normalizeCreditBalanceInput\(body\.creditBalance\)/g)?.length, 2);
  assert.match(source, /nextCreditLimitMode = body\.creditLimitMode === undefined \? undefined : normalizeCreditLimitMode\(body\.creditLimitMode\)/);
  assert.match(source, /nextCreditBalance = body\.creditBalance === undefined \? undefined : normalizeCreditBalanceInput\(body\.creditBalance\)/);
});

test('internal API create and update payload types include account credit fields', () => {
  assert.match(apiSource, /creditLimitMode\?: 'unlimited' \| 'limited'/);
  assert.match(apiSource, /creditBalance\?: number/);
});

test('job queue reserves credits after dedupe and strips credit metadata before provider execution', () => {
  assert.match(source, /const creditReservation = await reserveDbJobCredits\(pool, user, jobPayload\)/);
  assert.match(source, /const job = await createJobRecord\(pool, user, attachCreditReservationToJobPayload\(jobPayload, creditReservation\)\)/);
  assert.match(source, /const creditReservation = reserveLocalJobCredits\(store, user, jobPayload\)/);
  assert.match(source, /const job = createLocalJobRecord\(store, user, attachCreditReservationToJobPayload\(jobPayload, creditReservation\)\)/);
  assert.match(source, /stripCreditReservationFromPayload\(scrubbedPayload\)/);
});

test('job workers settle or release account credits in mysql local and temporal paths', () => {
  const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
  const localJobSource = readFileSync(new URL('./localJobStore.mjs', import.meta.url), 'utf8');
  const temporalSource = readFileSync(new URL('./temporalWorker.mjs', import.meta.url), 'utf8');

  assert.match(jobManagerSource, /settleJobCredits\?\.\(\{ job: refreshedJob, output, finishedAt, aborted: controller\.signal\.aborted \}\)/);
  assert.match(jobManagerSource, /releaseJobCredits\?\.\(\{ job: latestJob, error, finishedAt, retryWaiting: failure\.status === 'retry_waiting' \}\)/);
  assert.match(localJobSource, /const finishedJob = await mutate\(\(completeStore\)[\s\S]{0,300}settleJobCredits\?\.\(\{ store: completeStore, job: nextJob, output, aborted: controller\.signal\.aborted \}\)/);
  assert.match(localJobSource, /const failureOutcome = await mutate\(\(failureStore\)[\s\S]{0,1800}isProviderCompletedOutputRejectedError\(error\)[\s\S]{0,900}settleJobCredits\?\.[\s\S]{0,900}releaseJobCredits\?\.[\s\S]{0,400}if \(failureOutcome\.stale\) return/);
  assert.match(temporalSource, /const finishedJob = await mutate\(\(completeStore\)[\s\S]{0,300}settleJobCredits\?\.\(\{ store: completeStore, job: nextJob, output, aborted: controller\.signal\.aborted \}\)/);
  assert.match(temporalSource, /const failureOutcome = await mutate\(\(failureStore\)[\s\S]{0,1800}isProviderCompletedOutputRejectedError\(error\)[\s\S]{0,900}settleJobCredits\?\.[\s\S]{0,900}releaseJobCredits\?\.[\s\S]{0,500}if \(failureOutcome\.stale\)/);
  assert.match(temporalSource, /settleJobCredits\?\.\(\{ job: refreshedJob, output, finishedAt, aborted: controller\.signal\.aborted \}\)/);
  assert.match(temporalSource, /releaseJobCredits\?\.\(\{ job: latestJob, error, finishedAt, retryWaiting: failure\.status === 'retry_waiting' \}\)/);
  assert.match(jobManagerSource, /isProviderCompletedOutputRejectedError\(error\)[\s\S]{0,900}settleJobCredits\?\.[\s\S]{0,900}releaseJobCredits\?\./);
  assert.match(temporalSource, /isProviderCompletedOutputRejectedError\(error\)[\s\S]{0,900}settleJobCredits\?\.[\s\S]{0,900}releaseJobCredits\?\./);
});

test('terminal jobs with reservations are reconciled after restart without double processing', () => {
  assert.match(source, /const reconcileDbTerminalJobCredits = async \(pool/);
  assert.match(source, /const reconcileLocalTerminalJobCredits = \(store/);
  assert.match(source, /await hasDbProcessedCreditReservation\(connection, reservation\)/);
  assert.match(source, /const reconciledCreditJobs = await reconcileDbTerminalJobCredits\(pool\)/);
  assert.match(source, /const reconciledCreditJobs = reconcileLocalTerminalJobCreditsAfterRestart\(\)/);
});

test('agent image generation reserves and settles credits in mysql and local paths', () => {
  const toolConversationSource = readFileSync(new URL('./agentToolConversation.mjs', import.meta.url), 'utf8');

  assert.match(source, /const agentImageCreditReservation = requestMode === 'image_generation' && !shouldUseToolCallingConversation\(version\)\s+\? await reserveDbAgentImageCredits\(pool, user, \{ sessionId, clientRequestId, model: version\?\.modelPolicy\?\.multimodalModel \}\)/);
  assert.match(source, /await settleDbAgentImageCredits\(pool, agentImageCreditReservation, \{ result, sessionId, clientRequestId \}\)/);
  assert.match(source, /await releaseDbAgentImageCredits\(pool, agentImageCreditReservation, \{ error, sessionId, clientRequestId \}\)/);
  assert.match(source, /const imageCreditReservation = await reserveDbAgentImageCredits\(pool, user, \{ sessionId, clientRequestId, taskType, model \}\)/);
  assert.match(source, /await settleDbAgentImageCredits\(pool, imageCreditReservation, \{ result: imageOutput, sessionId, clientRequestId \}\)/);
  assert.match(source, /return \{ imageUrl, providerTaskId, creditsConsumed: getProviderCreditsConsumed\(imageOutput\) \}/);

  assert.match(source, /agentImageCreditReservation = requestMode === 'image_generation' && !shouldUseToolCallingConversation\(version\)\s+\? reserveLocalAgentImageCredits\(store, user, \{ sessionId, clientRequestId, model: version\?\.modelPolicy\?\.multimodalModel \}\)/);
  assert.match(source, /settleLocalAgentImageCredits\(store, agentImageCreditReservation, \{ result, sessionId, clientRequestId \}\)/);
  assert.match(source, /releaseLocalAgentImageCredits\(store, agentImageCreditReservation, \{ error, sessionId, clientRequestId \}\)/);
  assert.match(source, /const imageCreditReservation = reserveLocalAgentImageCredits\(store, user, \{ sessionId, clientRequestId, taskType, model \}\)/);
  assert.match(source, /settleLocalAgentImageCredits\(store, imageCreditReservation, \{ result: imageOutput, sessionId, clientRequestId \}\)/);
  assert.match(source, /creditsConsumed: result\?\.creditsConsumed/);
  assert.match(toolConversationSource, /if \(error\?\.code === 'account_credit_insufficient'\) throw error/);
});
