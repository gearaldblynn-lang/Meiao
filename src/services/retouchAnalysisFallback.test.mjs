import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRetouchAnalysisFallback,
  shouldUseRetouchAnalysisFallback,
} from './retouchAnalysisFallback.mjs';

test('retouch analysis falls back only for terminal provider failures', () => {
  const fallbackCodes = [
    'provider_submission_unknown',
    'provider_network_error',
    'provider_timeout',
    'provider_internal_error',
    'provider_bad_response',
    'provider_refusal',
    'provider_rate_limited',
    'provider_request_limit',
    'provider_auth_invalid',
    'provider_credit_insufficient',
  ];
  for (const code of fallbackCodes) {
    assert.equal(
      shouldUseRetouchAnalysisFallback({ code, message: 'provider failed' }),
      true,
      `${code} should use the deterministic retouch fallback`,
    );
  }

  const blockingErrors = [
    { code: 'request_cancelled', message: '任务已取消' },
    { code: 'job_timeout', message: '结果待同步' },
    { code: 'task_not_found', message: '任务不存在' },
    { code: 'provider_bad_request', message: '输入不合法' },
    { code: 'validation_error', message: '素材无效' },
    { code: '', message: 'INTERRUPTED' },
    { code: '', message: 'Cannot read properties of undefined' },
  ];
  for (const error of blockingErrors) {
    assert.equal(
      shouldUseRetouchAnalysisFallback(error),
      false,
      `${error.code || error.message} must not be hidden by fallback`,
    );
  }
});

test('original-image fallback preserves the existing scene and product identity', () => {
  const prompt = buildRetouchAnalysisFallback({ mode: 'original', hasReference: false });

  assert.match(prompt, /preserve the exact product identity/i);
  assert.match(prompt, /logo/i);
  assert.match(prompt, /label text/i);
  assert.match(prompt, /existing background/i);
  assert.match(prompt, /camera angle/i);
  assert.match(prompt, /do not add/i);
  assert.doesNotMatch(prompt, /reference image/i);
});

test('white-background fallback requests a pure white result without changing product details', () => {
  const prompt = buildRetouchAnalysisFallback({ mode: 'white_bg', hasReference: true });

  assert.match(prompt, /pure white background/i);
  assert.match(prompt, /80%-90%/i);
  assert.match(prompt, /preserve the exact product identity/i);
  assert.match(prompt, /reference image/i);
});
