import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneProductRestoreAnalysisAttempts,
  cloneProductRestoreAnalysisAttemptsForMutation,
  createProductRestoreAnalysisAttempt,
  getProductRestoreAnalysisCreditSummary,
  getProductRestoreTotalKnownCredits,
  mergeProductRestoreAnalysisAttempts,
} from './productRestoreAnalysisCredits.ts';

const invalidAttempt = {
  jobId: 'analysis-invalid-1',
  providerTaskId: 'provider-invalid-1',
  model: 'vision-model-a',
  status: 'invalid',
  errorCode: 'product_restore_analysis_invalid',
  timestamp: 100,
  creditsConsumed: 3,
};

const successfulAttempt = {
  jobId: 'analysis-success-2',
  providerTaskId: 'provider-success-2',
  model: 'vision-model-b',
  status: 'succeeded',
  timestamp: 200,
  creditsConsumed: 5,
};

test('invalid known usage followed by manual success remains additive and sums each job once', () => {
  const attempts = mergeProductRestoreAnalysisAttempts(
    [invalidAttempt],
    [successfulAttempt],
  );

  assert.deepEqual(attempts.map((attempt) => attempt.jobId), [
    'analysis-invalid-1',
    'analysis-success-2',
  ]);
  assert.deepEqual(getProductRestoreAnalysisCreditSummary({
    productRestoreAnalysisAttempts: [...attempts, { ...invalidAttempt, timestamp: 999 }],
  }), { present: true, value: 8 });
});

test('replayed persistence callback updates one stable job without double counting credits', () => {
  const replay = {
    ...invalidAttempt,
    providerTaskId: 'provider-invalid-1',
    timestamp: 999,
  };
  const attempts = mergeProductRestoreAnalysisAttempts(
    [invalidAttempt],
    [replay, invalidAttempt],
  );

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].timestamp, 100, 'the first durable ordering timestamp remains stable');
  assert.deepEqual(getProductRestoreAnalysisCreditSummary({
    productRestoreAnalysisAttempts: attempts,
  }), { present: true, value: 3 });
});

test('deep clone preserves attempt order, explicit zero, and missing optional usage through hydration', () => {
  const source = [
    { ...invalidAttempt, creditsConsumed: 0 },
    {
      jobId: 'analysis-unknown-2',
      status: 'failed',
      errorCode: 'provider_failed',
      timestamp: 200,
    },
  ];
  const cloned = cloneProductRestoreAnalysisAttempts(source);

  assert.notEqual(cloned, source);
  assert.notEqual(cloned[0], source[0]);
  assert.deepEqual(cloned.map((attempt) => attempt.jobId), [
    'analysis-invalid-1',
    'analysis-unknown-2',
  ]);
  assert.equal(Object.hasOwn(cloned[0], 'creditsConsumed'), true);
  assert.equal(cloned[0].creditsConsumed, 0);
  assert.equal(Object.hasOwn(cloned[1], 'creditsConsumed'), false);
  assert.deepEqual(getProductRestoreAnalysisCreditSummary({
    productRestoreAnalysisAttempts: cloned,
  }), { present: true, value: 0 });

  cloned[0].model = 'mutated';
  assert.equal(source[0].model, 'vision-model-a');
});

test('legacy context remains a compatibility fallback only when the attempt ledger is absent', () => {
  assert.deepEqual(getProductRestoreAnalysisCreditSummary({
    productRestore: { analysisCreditsConsumed: 4 },
  }), { present: true, value: 4 });
  assert.deepEqual(getProductRestoreAnalysisCreditSummary({
    productRestoreAnalysisAttempts: [{
      jobId: 'analysis-unknown',
      status: 'failed',
      timestamp: 1,
    }],
    productRestore: { analysisCreditsConsumed: 4 },
  }), { present: false, value: 0 });
});

test('mutating a historical project promotes its legacy analysis charge into the additive ledger', () => {
  const attempts = cloneProductRestoreAnalysisAttemptsForMutation({
    productRestore: {
      analysisJobId: 'legacy-analysis-1',
      analysisProviderTaskId: 'legacy-provider-1',
      analysisModel: 'legacy-vision-model',
      analysisCreditsConsumed: 4,
      createdAt: 123,
    },
  });

  assert.deepEqual(attempts, [{
    jobId: 'legacy-analysis-1',
    providerTaskId: 'legacy-provider-1',
    model: 'legacy-vision-model',
    status: 'succeeded',
    timestamp: 123,
    creditsConsumed: 4,
  }]);
});

test('malformed credit values remain unknown while numeric zero remains explicitly known', () => {
  const malformedValues = [false, true, [], {}, '   ', Number.NaN, -1];
  for (const creditsConsumed of malformedValues) {
    const attempt = createProductRestoreAnalysisAttempt({
      jobId: `malformed-${String(creditsConsumed)}`,
      status: 'succeeded',
      timestamp: 1,
      creditsConsumed,
    });
    assert.equal(Object.hasOwn(attempt, 'creditsConsumed'), false);
    assert.deepEqual(getProductRestoreAnalysisCreditSummary({
      productRestoreAnalysisAttempts: [attempt],
    }), { present: false, value: 0 });
    assert.deepEqual(getProductRestoreTotalKnownCredits({
      generationContext: { productRestoreAnalysisAttempts: [] },
      imageCredits: [creditsConsumed],
    }), { present: false, analysis: 0, images: 0, total: 0 });
  }

  for (const creditsConsumed of [0, '0', 0.5, '0.5']) {
    const attempt = createProductRestoreAnalysisAttempt({
      jobId: `known-${String(creditsConsumed)}`,
      status: 'succeeded',
      timestamp: 1,
      creditsConsumed,
    });
    assert.equal(Object.hasOwn(attempt, 'creditsConsumed'), true);
    assert.equal(attempt.creditsConsumed, Number(creditsConsumed));
  }
});
