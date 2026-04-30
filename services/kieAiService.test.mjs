import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getUserVisibleTaskId } from './kieTaskUtils.mjs';

const kieAiSource = readFileSync(new URL('./kieAiService.ts', import.meta.url), 'utf8');

test('getUserVisibleTaskId falls back to the internal job id when the provider task id is not available yet', () => {
  assert.equal(
    getUserVisibleTaskId({
      id: 'internal-job-1',
      providerTaskId: 'provider-task-1',
    }),
    'provider-task-1'
  );

  assert.equal(
    getUserVisibleTaskId({
      id: 'internal-job-2',
      providerTaskId: '',
    }),
    'internal-job-2'
  );
});

test('kieAiService keeps a recoverable task id when wait timeout happens before provider task id is written back', () => {
  assert.match(kieAiSource, /const timeoutJob = await fetchInternalJob\(jobId\)\.catch\(\(\) => null\)/);
  assert.match(kieAiSource, /taskId: getUserVisibleTaskId\(timeoutJob\?\.job\)/);
});

test('kieAiService can resume waiting on an internal job id before falling back to provider recovery', () => {
  assert.match(
    kieAiSource,
    /const existingJob = await fetchInternalJob\(taskId\)\.catch\(\(\) => null\);[\s\S]*if \(existingJob\?\.job\) \{[\s\S]*waitForJobResult\(existingJob\.job\.id, signal, KIE_RECOVER_TIMEOUT, false, Boolean\(apiConfig\.kieApiKey\)\);[\s\S]*\} else \{[\s\S]*recoverKieProviderTask\(taskId, signal, isVideo, Boolean\(apiConfig\.kieApiKey\)\);[\s\S]*\}/,
  );
});

test('kieAiService gives image generation a longer timeout budget for slow cloud runs', () => {
  assert.match(kieAiSource, /const KIE_IMAGE_DEFAULT_TIMEOUT = 6 \* 60_000/);
  assert.match(kieAiSource, /const KIE_RECOVER_TIMEOUT = 4 \* 60_000/);
});

test('kieAiService auto-recovers recoverable kie polling failures when provider task id is available', () => {
  assert.match(
    kieAiSource,
    /const KIE_AUTO_RECOVER_ERROR_CODES = new Set\(\['provider_internal_error', 'provider_network_error', 'provider_timeout'\]\)/,
  );
  assert.match(
    kieAiSource,
    /const shouldAutoRecoverKieJob = \(job: any\) => \{/,
  );
  assert.match(
    kieAiSource,
    /if \(allowAutoRecover && shouldAutoRecoverKieJob\(finalJob\)\) \{\s*return recoverKieProviderTask\(finalJob\.providerTaskId, signal, finalJob\.taskType === 'kie_video', kieClientConfigPresent\);/s,
  );
});

test('kieAiService only treats timeout-like failures as recoverable when provider task id exists', () => {
  assert.match(
    kieAiSource,
    /export const isRecoverableKieTaskResult = \(taskId\?: string, errorMessage\?: string, errorCode\?: string\) => \{\s*if \(!String\(taskId \|\| ''\)\.trim\(\)\) return false;/s,
  );
});

test('kieAiService explicitly excludes credit and request-limit failures from auto recovery', () => {
  assert.match(
    kieAiSource,
    /const KIE_NON_RECOVERABLE_ERROR_CODES = new Set\(\[[\s\S]*'provider_credit_insufficient'[\s\S]*'provider_request_limit'[\s\S]*'provider_bad_request'[\s\S]*\]\)/,
  );
});

test('kieAiService exposes a shared recharge prompt for KIE credit failures', () => {
  assert.match(
    kieAiSource,
    /export const getUserFacingKieErrorMessage = \(result:[\s\S]*if \(errorCode === 'provider_credit_insufficient'\) \{\s*return '当前 KIE 账户余额不足，相关生图功能暂不可用，请充值后重试。';/s,
  );
});
