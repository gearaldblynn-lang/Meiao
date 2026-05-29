import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getUserVisibleTaskId } from './kieTaskUtils.mjs';

const kieAiSource = readFileSync(new URL('./kieAiService.ts', import.meta.url), 'utf8');
const internalApiSource = readFileSync(new URL('./internalApi.ts', import.meta.url), 'utf8');

test('getUserVisibleTaskId only returns upstream provider task ids', () => {
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
    ''
  );
});

test('kieAiService keeps internal backend ids out of visible task ids before upstream submission', () => {
  assert.match(kieAiSource, /const timeoutJob = await fetchInternalJob\(jobId\)\.catch\(\(\) => null\)/);
  assert.match(kieAiSource, /const fallbackTaskId = notifiedProviderTaskId \|\| getUserVisibleTaskId\(timeoutJob\?\.job\)/);
  assert.match(kieAiSource, /taskId: fallbackTaskId/);
  assert.match(kieAiSource, /backendJobId: jobId/);
  assert.doesNotMatch(kieAiSource, /taskId:\s*getUserVisibleTaskId\(finalJob\)/);
  assert.doesNotMatch(kieAiSource, /\|\|\s*job\?\.id/);
});

test('kieAiService can resume waiting on an internal job id before falling back to provider recovery', () => {
  assert.match(
    kieAiSource,
    /const existingJob = await fetchInternalJob\(taskId\)\.catch\(\(\) => null\);[\s\S]*if \(existingJob\?\.job\) \{[\s\S]*waitForJobResult\(existingJob\.job\.id, signal, KIE_RECOVER_TIMEOUT, false, Boolean\(apiConfig\.kieApiKey\)\);[\s\S]*\} else \{[\s\S]*recoverKieProviderTask\(taskId, signal, isVideo, Boolean\(apiConfig\.kieApiKey\)\);[\s\S]*\}/,
  );
});

test('kieAiService gives image generation a longer timeout budget for slow cloud runs', () => {
  assert.match(kieAiSource, /'gpt-image-2': 10 \* 60_000/);
  assert.match(kieAiSource, /const KIE_IMAGE_DEFAULT_TIMEOUT = 10 \* 60_000/);
  assert.match(kieAiSource, /const KIE_RECOVER_TIMEOUT = 4 \* 60_000/);
});

test('kieAiService auto-recovers recoverable kie polling failures when provider task id is available', () => {
  assert.match(
    kieAiSource,
    /const KIE_AUTO_RECOVER_ERROR_CODES = new Set\(\[[\s\S]*'provider_internal_error'[\s\S]*'provider_network_error'[\s\S]*'provider_timeout'[\s\S]*'service_restarted'[\s\S]*'job_timeout'[\s\S]*\]\)/,
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

test('kieAiService treats restart-reconciled provider tasks as recoverable instead of final failures', () => {
  assert.match(
    kieAiSource,
    /if \(errorCode && KIE_AUTO_RECOVER_ERROR_CODES\.has\(String\(errorCode\)\)\) return true;/,
  );
  assert.match(kieAiSource, /'service_restarted'/);
  assert.match(kieAiSource, /'job_timeout'/);
  assert.match(kieAiSource, /网络连接失败/);
});

test('kieAiService only treats timeout-like failures as recoverable when provider task id exists', () => {
  assert.match(
    kieAiSource,
    /export const isRecoverableKieTaskResult = \(taskId\?: string, errorMessage\?: string, errorCode\?: string\) => \{\s*if \(!String\(taskId \|\| ''\)\.trim\(\)\) return false;/s,
  );
});

test('kieAiService preserves the notified provider task id when polling throws a transient error', () => {
  assert.match(kieAiSource, /const fallbackTaskId = notifiedProviderTaskId \|\| getUserVisibleTaskId\(timeoutJob\?\.job\)/);
  assert.match(kieAiSource, /taskId: fallbackTaskId/);
  assert.match(kieAiSource, /taskId: notifiedProviderTaskId/);
  assert.doesNotMatch(kieAiSource, /getUserVisibleTaskId\(timeoutJob\?\.job\)[\s\S]{0,120}\|\|\s*timeoutJob\?\.job\?\.id/);
});

test('internal job polling ignores transient read failures and keeps waiting for terminal state', () => {
  assert.match(internalApiSource, /const isTransientJobPollError = \(error: unknown\) => \{/);
  assert.match(internalApiSource, /error\.code === 'network_error'/);
  assert.match(internalApiSource, /error\.code === 'timeout'/);
  assert.match(internalApiSource, /error\.code === 'server_error'/);
  assert.match(
    internalApiSource,
    /try \{[\s\S]*const \{ job \} = await fetchInternalJob\(jobId\);[\s\S]*lastPollError = null;[\s\S]*\} catch \(error\) \{[\s\S]*if \(!isTransientJobPollError\(error\)\) \{[\s\S]*throw error;[\s\S]*\}[\s\S]*lastPollError = error;/,
  );
});

test('kieAiService keeps submitted provider tasks generating on frontend polling exceptions', () => {
  assert.match(
    kieAiSource,
    /if \(notifiedProviderTaskId\) \{[\s\S]*taskId: notifiedProviderTaskId[\s\S]*status: 'generating'[\s\S]*任务已提交云端，结果待同步/s,
  );
});

test('kieAiService does not log cloud-submitted image tasks as failed while they are still syncing', () => {
  assert.match(kieAiSource, /const logStatus = result\.status === 'success'[\s\S]*result\.status === 'generating'[\s\S]*\? 'started'/);
  assert.match(kieAiSource, /result\.status === 'generating' \? '图像任务已提交云端' : '图像任务失败'/);
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

test('kieAiService appends the GPT Image 2 cleanup suffix only for GPT Image 2 image tasks', () => {
  assert.match(
    kieAiSource,
    /const finalPrompt = customPrompt \|\| buildKieAiPrompt\(moduleConfig, isRatioMatch, isRemoveText, sourceImageContext, subMode\);[\s\S]*const promptWithCleanupSuffix = moduleConfig\.model === 'gpt-image-2'/s,
  );
  assert.match(
    kieAiSource,
    /const GPT_IMAGE_2_CLEANUP_SUFFIX = '要求：画面干净通透，材质完整自然，纹理平滑统一。禁止高频纹理，颜色过渡要平滑柔和，禁止过度锐化、色斑、噪点、破碎图案、伪影和畸变。';/,
  );
  assert.match(
    kieAiSource,
    /const promptWithCleanupSuffix = moduleConfig\.model === 'gpt-image-2'[\s\S]*\?\s*`\$\{finalPrompt\}\\n\\n\$\{GPT_IMAGE_2_CLEANUP_SUFFIX\}`[\s\S]*:\s*finalPrompt;/s,
  );
});

test('kieAiService de-duplicates normalized model input image urls before submitting', () => {
  assert.match(kieAiSource, /const seen = new Set<string>\(\);/);
  assert.match(kieAiSource, /if \(seen\.has\(url\)\) return false;/);
  assert.match(kieAiSource, /seen\.add\(url\);/);
});

test('kieAiService translation prompt preserves product and packaging text from translation', () => {
  assert.match(
    kieAiSource,
    /专业级处理图像中的文案翻译，同时保持产品主体或包装和画面主题不变。/,
  );
  assert.match(
    kieAiSource,
    /仅保留产品\/包装表面的字符不变（存在产品情况下，禁止翻译原产品以及包装上的内容）。/,
  );
});
