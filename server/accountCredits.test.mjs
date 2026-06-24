import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDIT_LIMIT_MODES,
  createCreditInsufficientError,
  estimateCreditReservation,
  getCreditAvailable,
  normalizeCreditAccount,
  releaseLocalAccountCredits,
  reserveLocalAccountCredits,
  settleLocalAccountCredits,
} from './accountCredits.mjs';

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
});

test('createCreditInsufficientError exposes HTTP 402 details', () => {
  const error = createCreditInsufficientError({ required: 5, available: 2 });

  assert.equal(error.code, 'account_credit_insufficient');
  assert.equal(error.statusCode, 402);
  assert.equal(error.requiredCredits, 5);
  assert.equal(error.availableCredits, 2);
  assert.match(error.message, /积分不足/);
});
