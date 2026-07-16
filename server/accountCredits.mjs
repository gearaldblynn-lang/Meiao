import { randomBytes } from 'node:crypto';

import { isDefinitiveProviderTaskFailure, isRetryableErrorCode } from './jobRuntime.mjs';
import { resolveMaxForAiImageModelId } from '../src/utils/maxforaiImageModels.mjs';

export const CREDIT_LIMIT_MODES = {
  UNLIMITED: 'unlimited',
  LIMITED: 'limited',
};

const CREDIT_SCALE = 100;
const DEFAULT_IMAGE_CREDIT_ESTIMATE = 3;
const DEFAULT_CHAT_CREDIT_ESTIMATE = 1;
const DEFAULT_VIDEO_CREDIT_ESTIMATE = 5;
const CREDIT_RESERVATION_PAYLOAD_KEY = '__creditReservation';

const now = () => Date.now();

const toCreditAmount = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * CREDIT_SCALE) / CREDIT_SCALE;
};

const toPositiveCreditAmount = (value, fallback = 0) => {
  const amount = toCreditAmount(value, fallback);
  return amount > 0 ? amount : fallback;
};

const clampCredit = (value) => Math.max(0, toCreditAmount(value, 0));

const createLedgerId = () => randomBytes(12).toString('hex');

export const normalizeCreditAccount = (user = {}) => {
  const creditLimitMode = user.creditLimitMode === CREDIT_LIMIT_MODES.LIMITED
    ? CREDIT_LIMIT_MODES.LIMITED
    : CREDIT_LIMIT_MODES.UNLIMITED;

  return {
    ...user,
    creditLimitMode,
    creditBalance: clampCredit(user.creditBalance),
    creditReserved: clampCredit(user.creditReserved),
    creditConsumed: clampCredit(user.creditConsumed),
  };
};

export const getCreditAvailable = (user = {}) => {
  const account = normalizeCreditAccount(user);
  if (account.creditLimitMode !== CREDIT_LIMIT_MODES.LIMITED) {
    return Number.POSITIVE_INFINITY;
  }
  return clampCredit(account.creditBalance - account.creditReserved);
};

export const createCreditInsufficientError = ({ required, available }) => {
  const requiredCredits = toCreditAmount(required);
  const availableCredits = toCreditAmount(available);
  const error = new Error(`积分不足：需要 ${requiredCredits} 积分，当前可用 ${availableCredits} 积分。`);
  error.code = 'account_credit_insufficient';
  error.statusCode = 402;
  error.requiredCredits = requiredCredits;
  error.availableCredits = availableCredits;
  return error;
};

const getPayloadCountHint = (payload = {}) => {
  const candidates = [
    payload.outputCount,
    payload.imageCount,
    payload.count,
    payload.quantity,
    payload.batchCount,
    payload.resultCount,
  ];

  for (const candidate of candidates) {
    const parsed = Number.parseInt(String(candidate ?? ''), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  if (Array.isArray(payload.tasks) && payload.tasks.length > 0) return payload.tasks.length;
  if (Array.isArray(payload.prompts) && payload.prompts.length > 0) return payload.prompts.length;
  if (Array.isArray(payload.items) && payload.items.length > 0) return payload.items.length;
  return 1;
};

export const estimateCreditReservation = ({ taskType = '', provider = '', payload = {} } = {}) => {
  const normalizedTaskType = String(taskType || '').toLowerCase();
  const normalizedProvider = String(provider || '').toLowerCase();
  if (!normalizedTaskType || normalizedTaskType === 'upload_asset' || normalizedProvider === 'internal') return 0;
  const selectedImageModel = payload.model || payload.selectedImageModel || payload.multimodalModel || '';
  if (normalizedProvider === 'maxforai' || resolveMaxForAiImageModelId(selectedImageModel)) return 0;

  if (
    normalizedTaskType.includes('image')
    || normalizedTaskType.includes('gpt_image')
    || normalizedTaskType.includes('agent_image')
    || normalizedProvider.includes('apiports')
  ) {
    return toCreditAmount(getPayloadCountHint(payload) * DEFAULT_IMAGE_CREDIT_ESTIMATE);
  }

  if (normalizedTaskType.includes('video') || normalizedProvider.includes('veo')) {
    return DEFAULT_VIDEO_CREDIT_ESTIMATE;
  }

  if (normalizedTaskType.includes('chat') || normalizedTaskType.includes('analysis') || normalizedTaskType.includes('planning')) {
    return DEFAULT_CHAT_CREDIT_ESTIMATE;
  }

  return DEFAULT_CHAT_CREDIT_ESTIMATE;
};

const ensureLocalLedger = (store) => {
  if (!Array.isArray(store.accountCreditLedger)) {
    store.accountCreditLedger = [];
  }
  return store.accountCreditLedger;
};

const findLocalUser = (store, userId) => {
  if (!Array.isArray(store.users)) return null;
  const index = store.users.findIndex((user) => String(user?.id || '') === String(userId || ''));
  if (index < 0) return null;
  const normalized = normalizeCreditAccount(store.users[index]);
  store.users[index] = normalized;
  return normalized;
};

const appendLedgerEntry = (store, user, {
  action,
  amount,
  jobId = '',
  requestId = '',
  module = '',
  taskType = '',
  provider = '',
  reason = '',
  reservationId = '',
  id: sourceReservationId = '',
  meta = null,
}) => {
  const ledgerId = createLedgerId();
  const entry = {
    id: ledgerId,
    reservationId: String(reservationId || sourceReservationId || (action === 'reserve' ? ledgerId : '')),
    userId: user.id,
    jobId: String(jobId || ''),
    requestId: String(requestId || ''),
    module: String(module || ''),
    taskType: String(taskType || ''),
    provider: String(provider || ''),
    action,
    amount: toCreditAmount(amount),
    balanceAfter: toCreditAmount(user.creditBalance),
    reservedAfter: toCreditAmount(user.creditReserved),
    reason: String(reason || ''),
    meta: meta && typeof meta === 'object' ? meta : null,
    createdAt: now(),
  };
  ensureLocalLedger(store).push(entry);
  return entry;
};

const hasProcessedLocalReservation = (store, reservation) => {
  const reservationId = String(reservation?.id || '').trim();
  if (!reservationId) return false;
  return ensureLocalLedger(store).some((entry) => (
    String(entry?.reservationId || entry?.id || '').trim() === reservationId
    && ['settle', 'release'].includes(String(entry?.action || ''))
  ));
};

export const getLocalCreditReservationState = (store, reservation) => {
  const reservationId = String(reservation?.id || '').trim();
  if (!reservationId) return 'none';
  return hasProcessedLocalReservation(store, reservation) ? 'processed' : 'pending';
};

export const shouldReleaseJobCreditReservation = ({
  job,
  error,
  retryWaiting = false,
  aborted = false,
} = {}) => {
  if (retryWaiting) return false;
  const errorCode = String(error?.code || job?.errorCode || '').trim();
  if (errorCode === 'provider_submission_unknown') return false;
  const providerTaskId = String(error?.providerTaskId || job?.providerTaskId || '').trim();
  if (providerTaskId && !isDefinitiveProviderTaskFailure({
    errorCode,
    providerStatus: error?.providerStatus,
  })) {
    return false;
  }
  return true;
};

export const getJobCreditRetryReservationAction = ({
  job,
  reservationProcessed = false,
  providerTaskRecoverable = true,
} = {}) => {
  const reservation = getCreditReservationFromJob(job);
  if (!reservation || reservationProcessed) return 'reserve';
  if (!String(job?.providerTaskId || '').trim()) return 'block';
  if (!providerTaskRecoverable) return 'block';
  const errorCode = String(job?.errorCode || '').trim();
  const hasDefinitiveProviderFailure = Boolean(
    errorCode
    && errorCode !== 'request_cancelled'
    && !isRetryableErrorCode(errorCode)
  );
  return hasDefinitiveProviderFailure ? 'block' : 'reuse';
};

export const reserveLocalAccountCredits = (store, userId, context = {}) => {
  const user = findLocalUser(store, userId);
  if (!user) return null;
  if (user.creditLimitMode !== CREDIT_LIMIT_MODES.LIMITED) return null;

  const amount = toPositiveCreditAmount(context.amount, 0);
  if (amount <= 0) return null;

  const available = getCreditAvailable(user);
  if (available < amount) {
    throw createCreditInsufficientError({ required: amount, available });
  }

  user.creditReserved = toCreditAmount(user.creditReserved + amount);
  const entry = appendLedgerEntry(store, user, {
    ...context,
    action: 'reserve',
    amount,
    reason: context.reason || 'reserve',
  });

  return {
    id: entry.reservationId || entry.id,
    userId: user.id,
    amount,
    module: String(context.module || ''),
    taskType: String(context.taskType || ''),
    provider: String(context.provider || ''),
    jobId: String(context.jobId || ''),
    requestId: String(context.requestId || ''),
  };
};

const normalizeReservation = (reservation) => {
  if (!reservation || typeof reservation !== 'object') return null;
  const amount = toPositiveCreditAmount(reservation.amount, 0);
  if (amount <= 0) return null;
  return {
    ...reservation,
    amount,
    userId: String(reservation.userId || ''),
  };
};

const getResultCreditsConsumed = (result) => {
  const source = result && typeof result === 'object' && 'result' in result ? result.result : result;
  const direct = source?.creditsConsumed;
  const nested = source?.usage?.credits ?? source?.usage?.creditsConsumed;
  const parsed = Number(direct ?? nested);
  return Number.isFinite(parsed) && parsed >= 0 ? toCreditAmount(parsed) : undefined;
};

export const settleLocalAccountCredits = (store, reservation, context = {}) => {
  const safeReservation = normalizeReservation(reservation);
  if (!safeReservation) return null;
  if (hasProcessedLocalReservation(store, safeReservation)) return { alreadyProcessed: true };
  const user = findLocalUser(store, safeReservation.userId);
  if (!user) return null;

  const providerCredits = getResultCreditsConsumed(context.result);
  const settledAmount = providerCredits === undefined ? safeReservation.amount : providerCredits;
  const reservedRelease = Math.min(user.creditReserved, safeReservation.amount);
  const overageAmount = Math.max(0, toCreditAmount(settledAmount - safeReservation.amount));

  user.creditReserved = toCreditAmount(user.creditReserved - reservedRelease);
  user.creditBalance = clampCredit(user.creditBalance - settledAmount);
  user.creditConsumed = toCreditAmount(user.creditConsumed + settledAmount);

  appendLedgerEntry(store, user, {
    ...safeReservation,
    ...context,
    action: 'settle',
    amount: settledAmount,
    reason: context.reason || 'settle',
    meta: {
      ...(context.meta && typeof context.meta === 'object' ? context.meta : {}),
      reservedAmount: safeReservation.amount,
      overageAmount,
      source: providerCredits === undefined ? 'estimate' : 'provider',
    },
  });

  return {
    settledAmount,
    releasedAmount: reservedRelease,
    overageAmount,
    source: providerCredits === undefined ? 'estimate' : 'provider',
  };
};

export const releaseLocalAccountCredits = (store, reservation, context = {}) => {
  const safeReservation = normalizeReservation(reservation);
  if (!safeReservation) return null;
  if (hasProcessedLocalReservation(store, safeReservation)) return { alreadyProcessed: true };
  const user = findLocalUser(store, safeReservation.userId);
  if (!user) return null;

  const releasedAmount = Math.min(user.creditReserved, safeReservation.amount);
  user.creditReserved = toCreditAmount(user.creditReserved - releasedAmount);

  appendLedgerEntry(store, user, {
    ...safeReservation,
    ...context,
    action: 'release',
    amount: releasedAmount,
    reason: context.reason || 'release',
  });

  return { releasedAmount };
};

export const attachCreditReservationToJobPayload = (jobPayload, reservation) => {
  if (!reservation) return jobPayload;
  return {
    ...jobPayload,
    payload: {
      ...(jobPayload?.payload && typeof jobPayload.payload === 'object' ? jobPayload.payload : {}),
      [CREDIT_RESERVATION_PAYLOAD_KEY]: reservation,
    },
  };
};

export const getCreditReservationFromPayload = (payload) => {
  const reservation = payload?.[CREDIT_RESERVATION_PAYLOAD_KEY];
  return normalizeReservation(reservation);
};

export const getCreditReservationFromJob = (job) => getCreditReservationFromPayload(job?.payload);

export const stripCreditReservationFromPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || !(CREDIT_RESERVATION_PAYLOAD_KEY in payload)) {
    return payload && typeof payload === 'object' ? payload : {};
  }
  const { [CREDIT_RESERVATION_PAYLOAD_KEY]: _creditReservation, ...rest } = payload;
  return rest;
};
