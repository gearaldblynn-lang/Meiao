import test from 'node:test';
import assert from 'node:assert/strict';

import { findReusableJobSubmission, selectJobsWithinConcurrencyLimits } from './jobManager.mjs';

const createJob = (id, userId, priority = 0, status = 'queued') => ({
  id,
  userId,
  status,
  priority,
  createdAt: Number(id.replace(/\D/g, '')) || 0,
});

test('selectJobsWithinConcurrencyLimits respects global and per-user limits', () => {
  const selected = selectJobsWithinConcurrencyLimits({
    jobs: [
      createJob('job-1', 'user-a', 10),
      createJob('job-2', 'user-a', 9),
      createJob('job-3', 'user-b', 8),
      createJob('job-4', 'user-c', 7),
    ],
    availableSlots: 3,
    activeJobUserIds: ['user-c'],
    getUserConcurrency: (userId) => (userId === 'user-a' ? 1 : userId === 'user-c' ? 1 : 2),
  });

  assert.deepEqual(selected.map((job) => job.id), ['job-1', 'job-3']);
});

test('selectJobsWithinConcurrencyLimits falls back to default concurrency of 5', () => {
  const selected = selectJobsWithinConcurrencyLimits({
    jobs: [
      createJob('job-1', 'user-a', 10),
      createJob('job-2', 'user-a', 9),
      createJob('job-3', 'user-a', 8),
      createJob('job-4', 'user-a', 7),
      createJob('job-5', 'user-a', 6),
      createJob('job-6', 'user-a', 5),
    ],
    availableSlots: 6,
    activeJobUserIds: [],
    getUserConcurrency: () => undefined,
  });

  assert.equal(selected.length, 5);
  assert.deepEqual(selected.map((job) => job.id), ['job-1', 'job-2', 'job-3', 'job-4', 'job-5']);
});

test('findReusableJobSubmission reuses the newest matching active job in the dedupe window', () => {
  const matched = findReusableJobSubmission({
    jobs: [
      {
        id: 'job-old',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'queued',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 1000,
      },
      {
        id: 'job-new',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'running',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 2000,
      },
      {
        id: 'job-other',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'running',
        payload: { imageUrls: ['other-url'], prompt: 'same prompt' },
        createdAt: 3000,
      },
    ],
    userId: 'user-a',
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
    createdAfter: 1500,
  });

  assert.equal(matched?.id, 'job-new');
});

test('findReusableJobSubmission ignores finished or stale jobs', () => {
  const matched = findReusableJobSubmission({
    jobs: [
      {
        id: 'job-finished',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'succeeded',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 5000,
      },
      {
        id: 'job-stale',
        userId: 'user-a',
        module: 'translation',
        taskType: 'kie_image',
        provider: 'kie',
        status: 'queued',
        payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
        createdAt: 1000,
      },
    ],
    userId: 'user-a',
    module: 'translation',
    taskType: 'kie_image',
    provider: 'kie',
    payload: { imageUrls: ['same-url'], prompt: 'same prompt' },
    createdAfter: 3000,
  });

  assert.equal(matched, null);
});
