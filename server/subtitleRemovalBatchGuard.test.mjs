import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertSubtitleRemovalRetryAllowed,
  assertSubtitleRemovalBatchSubmissionAllowed,
  assertSubmissionKnownBeforeRetry,
  buildSubtitleRemovalUserGuardSubmission,
} from './subtitleRemovalBatchGuard.mjs';

const request = (overrides = {}) => ({
  batchId: 'batch-a',
  shellProjectId: 'batch-a',
  shellResultId: 'batch-a-result-0',
  batchIndex: 0,
  batchCount: 2,
  clientSubmissionKey: 'subtitle-key-0',
  ...overrides,
});

const job = (overrides = {}) => ({
  id: 'job-0',
  userId: 'user-a',
  taskType: 'subtitle_remove_video',
  status: 'queued',
  payload: request(),
  ...overrides,
});

test('subtitle batch guard is stable per user across different caller supplied batch ids', () => {
  assert.deepEqual(buildSubtitleRemovalUserGuardSubmission('user-a'), {
    userId: 'user-a',
    module: 'video',
    taskType: 'subtitle_remove_batch_guard',
    provider: 'internal',
    payload: { clientSubmissionKey: 'subtitle_remove_active:user-a' },
  });
});

test('same batch index cannot be submitted with a different idempotency key', () => {
  assert.throws(
    () => assertSubtitleRemovalBatchSubmissionAllowed({
      jobs: [job()],
      userId: 'user-a',
      payload: request({ clientSubmissionKey: 'different-key' }),
      batchMaxItems: 10,
    }),
    (error) => error?.code === 'job_subtitle_batch_index_conflict' && error?.statusCode === 409,
  );
});

test('exact idempotent replay remains allowed even when active subtitle limit is full', () => {
  const activeJobs = Array.from({ length: 2 }, (_, index) => job({
    id: `job-${index}`,
    payload: request({
      batchId: index === 0 ? 'batch-a' : 'batch-b',
      shellProjectId: index === 0 ? 'batch-a' : 'batch-b',
      shellResultId: `result-${index}`,
      batchIndex: 0,
      batchCount: 1,
      clientSubmissionKey: `key-${index}`,
    }),
  }));

  assert.doesNotThrow(() => assertSubtitleRemovalBatchSubmissionAllowed({
    jobs: activeJobs,
    userId: 'user-a',
    payload: activeJobs[0].payload,
    batchMaxItems: 2,
  }));
});

test('active user limit prevents bypassing max items with many one-item batches', () => {
  const activeJobs = Array.from({ length: 2 }, (_, index) => job({
    id: `job-${index}`,
    payload: request({
      batchId: `batch-${index}`,
      shellProjectId: `batch-${index}`,
      shellResultId: `result-${index}`,
      batchIndex: 0,
      batchCount: 1,
      clientSubmissionKey: `key-${index}`,
    }),
  }));

  assert.throws(
    () => assertSubtitleRemovalBatchSubmissionAllowed({
      jobs: activeJobs,
      userId: 'user-a',
      payload: request({
        batchId: 'batch-c',
        shellProjectId: 'batch-c',
        batchCount: 1,
        clientSubmissionKey: 'key-c',
      }),
      batchMaxItems: 2,
    }),
    (error) => error?.code === 'job_subtitle_active_limit_reached' && error?.statusCode === 409,
  );
});

test('unknown provider submissions cannot be retried through the server boundary', () => {
  assert.throws(
    () => assertSubmissionKnownBeforeRetry({ errorCode: 'provider_submission_unknown' }),
    (error) => error?.code === 'job_submission_unknown_retry_blocked' && error?.statusCode === 409,
  );
  assert.doesNotThrow(() => assertSubmissionKnownBeforeRetry({ errorCode: 'provider_submission_released' }));
});

test('subtitle retry cannot exceed the same active user ceiling as new submissions', () => {
  assert.throws(
    () => assertSubtitleRemovalRetryAllowed({ activeCount: 10, batchMaxItems: 10 }),
    (error) => error?.code === 'job_subtitle_active_limit_reached' && error?.statusCode === 409,
  );
  assert.doesNotThrow(() => assertSubtitleRemovalRetryAllowed({ activeCount: 9, batchMaxItems: 10 }));
});

test('retry routes explicitly use retry policy so historical jobs do not need batch metadata', () => {
  const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const retryCalls = serverSource.match(/resolveAuthorizedJobSubmissionPolicy\(user, job, \{ submissionOperation: 'retry' \}\)/g) || [];
  assert.equal(retryCalls.length, 2);
});

test('mysql and local creation paths both enforce the subtitle aggregate guard', () => {
  const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /buildSubtitleRemovalUserGuardSubmission\(user\.id\)/);
  assert.match(serverSource, /createSerializedJobSubmissionOnConnection\(\{ connection, \.\.\.submissionOptions \}\)/);
  assert.equal((serverSource.match(/assertSubtitleRemovalBatchSubmissionAllowed\(\{/g) || []).length, 2);
  assert.equal((serverSource.match(/assertSubmissionKnownBeforeRetry\(/g) || []).length, 2);
  assert.equal((serverSource.match(/assertSubtitleRemovalRetryAllowed\(\{/g) || []).length, 2);
});
