import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CREDIT_LIMIT_MODES,
  createCreditInsufficientError,
  estimateCreditReservation,
  getCreditAvailable,
  getJobCreditRetryReservationAction,
  getLocalCreditReservationState,
  normalizeCreditAccount,
  releaseLocalAccountCredits,
  reserveLocalAccountCredits,
  settleLocalAccountCredits,
  shouldReleaseJobCreditReservation,
} from './accountCredits.mjs';

const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const createLimitedStore = () => ({
  users: [{
    id: 'user-1',
    username: 'tester',
    creditLimitMode: 'limited',
    creditBalance: 10,
    creditReserved: 0,
    creditConsumed: 0,
  }],
  accountCreditLedger: [],
});

test('normalizeCreditAccount defaults existing users to unlimited without blocking credits', () => {
  const account = normalizeCreditAccount({ id: 'u1', username: 'internal' });

  assert.equal(account.creditLimitMode, CREDIT_LIMIT_MODES.UNLIMITED);
  assert.equal(account.creditBalance, 0);
  assert.equal(account.creditReserved, 0);
  assert.equal(account.creditConsumed, 0);
  assert.equal(getCreditAvailable(account), Number.POSITIVE_INFINITY);
});

test('reserveLocalAccountCredits skips unlimited users', () => {
  const store = {
    users: [{ id: 'u1', creditLimitMode: 'unlimited', creditBalance: 0, creditReserved: 0 }],
    accountCreditLedger: [],
  };

  const reservation = reserveLocalAccountCredits(store, 'u1', {
    amount: 5,
    jobId: 'job-1',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(reservation, null);
  assert.equal(store.users[0].creditReserved, 0);
  assert.equal(store.accountCreditLedger.length, 0);
});

test('reserveLocalAccountCredits reserves only when limited account has enough available credits', () => {
  const store = createLimitedStore();

  const reservation = reserveLocalAccountCredits(store, 'user-1', {
    amount: 4,
    jobId: 'job-1',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(reservation.amount, 4);
  assert.equal(store.users[0].creditReserved, 4);
  assert.equal(getCreditAvailable(store.users[0]), 6);
  assert.equal(store.accountCreditLedger[0].action, 'reserve');

  assert.throws(
    () => reserveLocalAccountCredits(store, 'user-1', {
      amount: 7,
      jobId: 'job-2',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
    }),
    /积分不足/
  );
});

test('settleLocalAccountCredits uses real provider credits and refunds over-estimates', () => {
  const store = createLimitedStore();
  const reservation = reserveLocalAccountCredits(store, 'user-1', {
    amount: 6,
    jobId: 'job-1',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  const settlement = settleLocalAccountCredits(store, reservation, {
    result: { creditsConsumed: 3.25 },
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(settlement.settledAmount, 3.25);
  assert.equal(settlement.source, 'provider');
  assert.equal(store.users[0].creditBalance, 6.75);
  assert.equal(store.users[0].creditReserved, 0);
  assert.equal(store.users[0].creditConsumed, 3.25);
  assert.equal(store.accountCreditLedger.at(-1).action, 'settle');
});

test('settleLocalAccountCredits deducts extra real credits and clamps balance at zero', () => {
  const store = createLimitedStore();
  const reservation = reserveLocalAccountCredits(store, 'user-1', {
    amount: 4,
    jobId: 'job-1',
    module: 'agent_center',
    taskType: 'agent_image',
    provider: 'kie',
  });

  const settlement = settleLocalAccountCredits(store, reservation, {
    result: { creditsConsumed: 12 },
    module: 'agent_center',
    taskType: 'agent_image',
    provider: 'kie',
  });

  assert.equal(settlement.settledAmount, 12);
  assert.equal(settlement.overageAmount, 8);
  assert.equal(store.users[0].creditBalance, 0);
  assert.equal(store.users[0].creditReserved, 0);
  assert.equal(store.users[0].creditConsumed, 12);
});

test('releaseLocalAccountCredits releases failed or cancelled reservations without consumption', () => {
  const store = createLimitedStore();
  const reservation = reserveLocalAccountCredits(store, 'user-1', {
    amount: 5,
    jobId: 'job-1',
    module: 'retouch',
    taskType: 'kie_image',
    provider: 'kie',
  });

  const release = releaseLocalAccountCredits(store, reservation, {
    reason: 'job_failed',
    module: 'retouch',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(release.releasedAmount, 5);
  assert.equal(store.users[0].creditBalance, 10);
  assert.equal(store.users[0].creditReserved, 0);
  assert.equal(store.users[0].creditConsumed, 0);
  assert.equal(store.accountCreditLedger.at(-1).action, 'release');
});

test('local reservations can settle or release after account mode changes', () => {
  const settleStore = createLimitedStore();
  const settlementReservation = reserveLocalAccountCredits(settleStore, 'user-1', {
    amount: 4,
    jobId: 'job-settle',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });
  settleStore.users[0].creditLimitMode = CREDIT_LIMIT_MODES.UNLIMITED;

  const settlement = settleLocalAccountCredits(settleStore, settlementReservation, {
    result: { creditsConsumed: 2 },
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(settlement.settledAmount, 2);
  assert.equal(settleStore.users[0].creditReserved, 0);
  assert.equal(settleStore.users[0].creditBalance, 8);
  assert.equal(settleStore.users[0].creditConsumed, 2);

  const releaseStore = createLimitedStore();
  const releaseReservation = reserveLocalAccountCredits(releaseStore, 'user-1', {
    amount: 5,
    jobId: 'job-release',
    module: 'retouch',
    taskType: 'kie_image',
    provider: 'kie',
  });
  releaseStore.users[0].creditLimitMode = CREDIT_LIMIT_MODES.UNLIMITED;

  const release = releaseLocalAccountCredits(releaseStore, releaseReservation, {
    reason: 'job_failed',
    module: 'retouch',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(release.releasedAmount, 5);
  assert.equal(releaseStore.users[0].creditReserved, 0);
  assert.equal(releaseStore.users[0].creditBalance, 10);
  assert.equal(releaseStore.users[0].creditConsumed, 0);
});

test('local settlement and release are idempotent per reservation', () => {
  const settleStore = createLimitedStore();
  const reservation = reserveLocalAccountCredits(settleStore, 'user-1', {
    amount: 4,
    jobId: 'job-idempotent',
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  const firstSettlement = settleLocalAccountCredits(settleStore, reservation, {
    result: { creditsConsumed: 2 },
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });
  const secondSettlement = settleLocalAccountCredits(settleStore, reservation, {
    result: { creditsConsumed: 2 },
    module: 'one_click',
    taskType: 'kie_image',
    provider: 'kie',
  });

  assert.equal(firstSettlement.settledAmount, 2);
  assert.equal(secondSettlement.alreadyProcessed, true);
  assert.equal(settleStore.users[0].creditBalance, 8);
  assert.equal(settleStore.users[0].creditReserved, 0);
  assert.equal(settleStore.users[0].creditConsumed, 2);
  assert.equal(settleStore.accountCreditLedger.filter((entry) => entry.action === 'settle').length, 1);

  const releaseStore = createLimitedStore();
  const releaseReservation = reserveLocalAccountCredits(releaseStore, 'user-1', {
    amount: 5,
    jobId: 'job-release-idempotent',
    module: 'retouch',
    taskType: 'kie_image',
    provider: 'kie',
  });
  const firstRelease = releaseLocalAccountCredits(releaseStore, releaseReservation, { reason: 'job_failed' });
  const secondRelease = releaseLocalAccountCredits(releaseStore, releaseReservation, { reason: 'job_failed' });

  assert.equal(firstRelease.releasedAmount, 5);
  assert.equal(secondRelease.alreadyProcessed, true);
  assert.equal(releaseStore.users[0].creditBalance, 10);
  assert.equal(releaseStore.users[0].creditReserved, 0);
  assert.equal(releaseStore.accountCreditLedger.filter((entry) => entry.action === 'release').length, 1);
});

test('estimateCreditReservation derives generation estimates from payload hints', () => {
  assert.equal(estimateCreditReservation({
    taskType: 'kie_image',
    provider: 'kie',
    payload: { outputCount: 3 },
  }), 9);

  assert.equal(estimateCreditReservation({
    taskType: 'kie_chat',
    provider: 'kie',
    payload: {},
  }), 1);

  assert.equal(estimateCreditReservation({
    taskType: 'dreamina_video',
    provider: 'kie',
    payload: {},
  }), 5);

  assert.equal(estimateCreditReservation({
    taskType: 'upload_asset',
    provider: 'internal',
    payload: {},
  }), 0);

  assert.equal(estimateCreditReservation({
    taskType: 'maxforai_video',
    provider: 'maxforai',
    payload: { model: 'maxforai-sora-v9-pro', seconds: 15 },
  }), 0);
});

test('voiceover parent reserves the existing five-credit video estimate despite internal provider', () => {
  assert.equal(estimateCreditReservation({
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    payload: { subFeature: 'voiceover_translation' },
  }), 5);

  const store = createLimitedStore();
  const amount = estimateCreditReservation({
    taskType: 'voiceover_translate_video',
    provider: 'internal',
  });
  const reservation = reserveLocalAccountCredits(store, 'user-1', {
    amount,
    jobId: 'voiceover-parent-1',
    module: 'video',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
  });
  assert.equal(reservation.amount, 5);
  assert.equal(store.users[0].creditReserved, 5);
  assert.throws(
    () => reserveLocalAccountCredits(store, 'user-1', {
      amount: 6,
      jobId: 'voiceover-parent-2',
      module: 'video',
      taskType: 'voiceover_translate_video',
      provider: 'internal',
    }),
    (error) => error?.code === 'account_credit_insufficient',
  );
});

test('createCreditInsufficientError exposes HTTP 402 details', () => {
  const error = createCreditInsufficientError({ required: 5, available: 2 });

  assert.equal(error.code, 'account_credit_insufficient');
  assert.equal(error.statusCode, 402);
  assert.equal(error.requiredCredits, 5);
  assert.equal(error.availableCredits, 2);
  assert.match(error.message, /积分不足/);
});

test('queued cancellation releases credit while submitted cancellation keeps it pending', () => {
  assert.equal(shouldReleaseJobCreditReservation({
    job: { status: 'cancelled', providerTaskId: '' },
    error: { code: 'request_cancelled' },
  }), true);
  assert.equal(shouldReleaseJobCreditReservation({
    job: { status: 'cancelled', providerTaskId: 'provider-task-1' },
    error: { code: 'request_cancelled' },
  }), false);
});

test('recoverable submitted failures and ambiguous submissions keep their reservation', () => {
  assert.equal(shouldReleaseJobCreditReservation({
    job: { providerTaskId: 'provider-task-1' },
    error: { code: 'provider_timeout' },
    retryWaiting: false,
  }), false);
  assert.equal(shouldReleaseJobCreditReservation({
    job: { providerTaskId: '' },
    error: { code: 'provider_submission_unknown' },
  }), false);
  assert.equal(shouldReleaseJobCreditReservation({
    job: { providerTaskId: 'provider-task-1' },
    error: { code: 'provider_bad_request', providerStatus: 'failed' },
  }), true);
  assert.equal(shouldReleaseJobCreditReservation({
    job: { providerTaskId: 'provider-task-1' },
    error: { code: 'provider_bad_response', providerStatus: 'success_without_result' },
  }), false);
  assert.equal(shouldReleaseJobCreditReservation({
    job: { providerTaskId: 'provider-task-1' },
    error: { code: 'provider_auth_invalid', providerStatus: 'auth_invalid' },
  }), false);
  assert.equal(shouldReleaseJobCreditReservation({
    job: { providerTaskId: 'provider-task-1' },
    error: { code: 'provider_job_failed', providerStatus: 'failed' },
  }), true);
});

test('retry reuses a pending reservation only when polling an existing provider task', () => {
  const pendingReservation = { id: 'reservation-1', userId: 'user-1', amount: 5 };
  assert.equal(getJobCreditRetryReservationAction({
    job: {
      providerTaskId: 'provider-task-1',
      payload: { __creditReservation: pendingReservation },
    },
    reservationProcessed: false,
  }), 'reuse');
  assert.equal(getJobCreditRetryReservationAction({
    job: {
      providerTaskId: '',
      payload: { __creditReservation: pendingReservation },
    },
    reservationProcessed: false,
  }), 'block');
  assert.equal(getJobCreditRetryReservationAction({
    job: {
      providerTaskId: 'chat-response-id',
      payload: { __creditReservation: pendingReservation },
    },
    reservationProcessed: false,
    providerTaskRecoverable: false,
  }), 'block');
  assert.equal(getJobCreditRetryReservationAction({
    job: {
      status: 'failed',
      errorCode: 'provider_bad_request',
      providerTaskId: 'provider-task-1',
      payload: { __creditReservation: pendingReservation },
    },
    reservationProcessed: false,
  }), 'block');
});

test('retry after a released reservation requires a new reservation before submit', () => {
  const store = createLimitedStore();
  const original = reserveLocalAccountCredits(store, 'user-1', {
    amount: 5,
    jobId: 'job-1',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
  });
  releaseLocalAccountCredits(store, original, { reason: 'job_failed' });

  assert.equal(getLocalCreditReservationState(store, original), 'processed');
  assert.equal(getJobCreditRetryReservationAction({
    job: {
      providerTaskId: '',
      payload: { __creditReservation: original },
    },
    reservationProcessed: true,
  }), 'reserve');

  const replacement = reserveLocalAccountCredits(store, 'user-1', {
    amount: 5,
    jobId: 'job-1',
    module: 'video',
    taskType: 'kie_seedance_video',
    provider: 'kie',
  });
  settleLocalAccountCredits(store, replacement, { result: { creditsConsumed: 5 } });
  const duplicateSettlement = settleLocalAccountCredits(store, replacement, { result: { creditsConsumed: 5 } });

  assert.equal(duplicateSettlement.alreadyProcessed, true);
  assert.equal(store.users[0].creditReserved, 0);
  assert.equal(store.users[0].creditBalance, 5);
  assert.equal(store.users[0].creditConsumed, 5);
});

test('mysql settlement and release lock the account before checking reservation state', () => {
  assert.match(serverSource, /const lockDbCreditAccount = async \(connection, userId\) => \{[\s\S]*FOR UPDATE/);
  assert.equal(
    (serverSource.match(/await lockDbCreditAccount\(connection, reservation\.userId\)/g) || []).length,
    2
  );

  const settleBody = serverSource.match(/const settleDbAccountCredits = async[\s\S]*?\n\};/)?.[0] || '';
  const releaseBody = serverSource.match(/const releaseDbAccountCredits = async[\s\S]*?\n\};/)?.[0] || '';
  for (const body of [settleBody, releaseBody]) {
    assert.ok(body.indexOf('lockDbCreditAccount') < body.indexOf('hasDbProcessedCreditReservation'));
  }
});

test('cancel and retry routes enforce reservation lifecycle before queueing work', () => {
  assert.match(serverSource, /shouldReleaseJobCreditReservation/);
  assert.match(serverSource, /releaseQueuedCredits:[\s\S]{0,240}releaseDbJobCredits\(\{[\s\S]{0,120}pool: connection,[\s\S]{0,120}request_cancelled/);
  assert.ok((serverSource.match(/releaseLocalJobCredits\(\{ store, job,[\s\S]{0,180}request_cancelled/g) || []).length >= 1);
  assert.match(serverSource, /getJobCreditRetryReservationAction/);
  assert.match(serverSource, /getLocalCreditReservationState/);
  assert.match(serverSource, /withMysqlSubmissionLock\([\s\S]{0,200}withMysqlTransaction\(connection/);
  assert.match(serverSource, /payload_json:\s*JSON\.stringify\(retryPayload\)[\s\S]*requestRetryJob/);
  assert.match(serverSource, /requestLocalRetryJob\(store, jobId, \{[\s\S]*payload: retryPayload/);
  assert.equal((serverSource.match(/resetProviderTaskId:\s*reservationAction === 'reserve'/g) || []).length, 2);
});

test('job deletion checks pending reservations in mysql and local modes before removing records', () => {
  assert.match(
    serverSource,
    /deleteJobById\(lockedPool,[\s\S]{0,500}hasPendingReservation:[\s\S]{0,400}hasDbProcessedCreditReservation/
  );
  assert.match(
    serverSource,
    /const resolveLocalDeletionAction[\s\S]{0,240}resolveJobDeletionAction\(candidate,[\s\S]{0,240}getLocalCreditReservationState/
  );
});

test('submission-unknown jobs expose admin-only audited bind release and actual settlement', () => {
  assert.match(serverSource, /submission-resolution/);
  assert.match(
    serverSource,
    /taskPlatformSubmissionResolutionMatch[\s\S]{0,180}req\.method === 'POST'[\s\S]{0,180}requireDbAdmin/
  );
  assert.match(serverSource, /resolveSubmissionUnknownJob\(\{[\s\S]{0,500}releaseDbAccountCredits\(connection/);
  assert.match(serverSource, /action: 'submission_unknown_resolved'/);
  assert.match(serverSource, /reason: 'admin_submission_resolution'/);
  assert.match(serverSource, /reason: 'admin_submission_settlement'/);
  assert.match(serverSource, /actualCreditsConsumed/);
  assert.match(serverSource, /verificationNote/);
  assert.match(serverSource, /settleDbAccountCredits\(connection/);
  assert.match(serverSource, /resolution\.action === 'bind'[\s\S]{0,180}mirrorDbJobToTemporalIfEnabled/);
  assert.match(serverSource, /localRequireAdmin[\s\S]{0,600}resolveLocalSubmissionUnknownJob/);
  assert.match(serverSource, /releaseLocalAccountCredits[\s\S]{0,400}admin_submission_resolution/);
  assert.match(serverSource, /settleLocalAccountCredits[\s\S]{0,500}admin_submission_settlement/);
});
