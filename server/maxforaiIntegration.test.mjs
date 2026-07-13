import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { estimateCreditReservation } from './accountCredits.mjs';
import { resolveJobSubmissionPolicy } from './jobSubmissionPolicy.mjs';
import { buildPublicSystemConfig } from './jobRuntime.mjs';
import { executeProviderJob, getProviderConfigStatus } from './providerGateway.mjs';

const kieAiServiceSource = readFileSync(new URL('../src/services/kieAiService.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('MaxForAI image jobs are authorized with zero automatic retries', () => {
  const policy = resolveJobSubmissionPolicy({
    taskType: 'kie_image',
    provider: 'maxforai',
    payload: { model: 'maxforai-image-2-relay' },
  });
  assert.equal(policy.provider, 'maxforai');
  assert.equal(policy.maxCreateRetries, 0);
  assert.throws(
    () => resolveJobSubmissionPolicy({ taskType: 'kie_chat', provider: 'maxforai' }),
    (error) => error?.code === 'job_provider_not_allowed',
  );
});

test('MaxForAI jobs and agent image requests reserve zero legacy credits', () => {
  assert.equal(estimateCreditReservation({
    taskType: 'kie_image',
    provider: 'maxforai',
    payload: { model: 'maxforai-image-2-relay', outputCount: 5 },
  }), 0);
  assert.equal(estimateCreditReservation({
    taskType: 'agent_image',
    provider: 'kie',
    payload: { model: 'maxforai-image-2-relay', outputCount: 1 },
  }), 0);
  assert.match(serverSource, /reserveDbAgentImageCredits[\s\S]*model[\s\S]*estimateCreditReservation/);
  assert.match(serverSource, /reserveLocalAgentImageCredits[\s\S]*model[\s\S]*estimateCreditReservation/);
});

test('public config publishes MaxForAI readiness and only the relay Agent Center model without secrets', () => {
  const config = buildPublicSystemConfig({
    MAXFORAI_API_KEY: 'private-test-key',
    MEIAO_PUBLIC_BASE_URL: 'https://meiao.test',
  });
  assert.deepEqual(config.providers.maxforai, { configured: true });
  assert.deepEqual(
    config.agentModels.image.filter((item) => item.provider === 'maxforai').map((item) => item.id),
    ['maxforai-image-2-relay'],
  );
  assert.doesNotMatch(JSON.stringify(config), /private-test-key/);
  assert.equal(getProviderConfigStatus({ MAXFORAI_API_KEY: 'private-test-key' }).maxforai, true);
});

test('provider gateway routes a MaxForAI site model to its synchronous paid endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ url: 'https://cdn.test/maxforai.png' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const output = await executeProviderJob({
      taskType: 'kie_image',
      provider: 'maxforai',
      payload: {
        model: 'maxforai-image-2-relay',
        prompt: '中文产品海报',
        aspectRatio: '1:1',
        resolution: '1K',
      },
    }, {
      MAXFORAI_API_KEY: 'private-test-key',
      MAXFORAI_BASE_URL: 'https://maxforai.test/v1',
    }, new AbortController().signal);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://maxforai.test/v1/images/generations');
    assert.equal(output.result.imageUrl, 'https://cdn.test/maxforai.png');
    assert.equal(output.result.provider, 'maxforai');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('frontend image submission preserves MaxForAI ids, raw resolution, provider and zero retry budget', () => {
  assert.match(kieAiServiceSource, /isMaxForAiImageModel/);
  assert.match(kieAiServiceSource, /provider: isMaxForAiModel \? 'maxforai' : 'kie'/);
  assert.match(kieAiServiceSource, /maxRetries: isMaxForAiModel \? 0 : 2/);
  assert.match(kieAiServiceSource, /const allowAutoRecover = !isMaxForAiModel/);
});

test('all job workers persist inline image results before durable completion', () => {
  assert.match(serverSource, /persistInlineImageResult/);
  assert.match(
    serverSource,
    /const persistJobOutputAssetsIfEnabled = async \(job, output\) => \{[\s\S]*persistInlineImageResult\(/,
  );
  assert.equal(
    (serverSource.match(/return persistJobOutputAssetsIfEnabled\(job, output\);/g) || []).length,
    4,
  );
});
