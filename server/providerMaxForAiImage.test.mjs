import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMaxForAiImageRequestBody,
  runMaxForAiImageJob,
} from './providerMaxForAiImage.mjs';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('builds the documented text generation body with tier-based model and mapped size', () => {
  assert.deepEqual(buildMaxForAiImageRequestBody({
    payload: {
      model: 'maxforai-image-2-standard',
      prompt: '中文产品海报',
      aspectRatio: '16:9',
      resolution: '4K',
      quality: 'high',
      background: 'transparent',
    },
    imageUrls: [],
  }), {
    model: 'gpt-image-2',
    prompt: '中文产品海报',
    size: '3840x2160',
    n: 1,
  });
});

test('text generation submits one paid POST and returns the generated URL', async () => {
  const calls = [];
  const result = await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-standard',
      prompt: '干净的蓝白产品主图',
      aspectRatio: '1:1',
      resolution: '1K',
    },
    env: { MAXFORAI_API_KEY: 'test-key', MAXFORAI_BASE_URL: 'https://maxforai.test/v1' },
    deps: {
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        return jsonResponse({ created: 1781187443, data: [{ url: 'https://cdn.test/result.png' }] });
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://maxforai.test/v1/images/generations');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    model: 'gpt-image-2',
    prompt: '干净的蓝白产品主图',
    size: '1024x1024',
    n: 1,
  });
  assert.deepEqual(calls[0][5], { idempotent: false, maxRetries: 0 });
  assert.equal(result.result.imageUrl, 'https://cdn.test/result.png');
  assert.equal(result.result.provider, 'maxforai');
  assert.equal(result.result.providerModel, 'gpt-image-2');
  assert.equal(result.providerStage, 'completed');
});

test('image edit keeps public HTTPS references, deduplicates them, and caps input at 16', async () => {
  const sourceUrls = Array.from({ length: 18 }, (_, index) => `https://cdn.test/${index}.png`);
  const calls = [];
  await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-max',
      prompt: '保持主体，改成科技海报',
      aspectRatio: '3:2',
      resolution: '2K',
      imageUrls: [sourceUrls[0], ...sourceUrls, sourceUrls[1]],
    },
    env: { MAXFORAI_API_KEY: 'test-key' },
    deps: {
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        return jsonResponse({ data: [{ url: 'https://cdn.test/edit.png' }] });
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/images\/edits$/);
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    model: 'gpt-image-2-max',
    prompt: '保持主体，改成科技海报',
    size: '2016x1344',
    n: 1,
    images: sourceUrls.slice(0, 16).map((imageUrl) => ({ image_url: imageUrl })),
  });
});

test('uploads non-public image material before the paid edit POST', async () => {
  const calls = [];
  const downloadCalls = [];
  await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-pro',
      prompt: '专业海报',
      aspectRatio: '3:4',
      resolution: '1K',
      imageUrls: ['/api/assets/file/reference.png'],
    },
    env: { MAXFORAI_API_KEY: 'test-key' },
    deps: {
      downloadRemoteProviderMediaUrl: async (url) => {
        downloadCalls.push(url);
        return { fileName: 'reference.png', mimeType: 'image/png', fileBuffer: Buffer.from('png') };
      },
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        if (String(args[0]).endsWith('/assets')) {
          assert.ok(args[1].body instanceof FormData);
          assert.ok(args[1].body.get('file'));
          return jsonResponse({ object: 'asset', url: 'https://temp.test/reference.png' });
        }
        return jsonResponse({ data: [{ url: 'https://cdn.test/edit.png' }] });
      },
    },
  });

  assert.deepEqual(downloadCalls, ['/api/assets/file/reference.png']);
  assert.equal(calls.length, 2);
  assert.match(calls[0][0], /\/assets$/);
  assert.match(calls[1][0], /\/images\/edits$/);
  assert.deepEqual(JSON.parse(calls[1][1].body).images, [
    { image_url: 'https://temp.test/reference.png' },
  ]);
});

test('asset preparation failure prevents the paid generation POST', async () => {
  let paidPostCount = 0;
  await assert.rejects(
    () => runMaxForAiImageJob({
      payload: {
        model: 'maxforai-image-2-standard',
        prompt: '专业海报',
        imageUrls: ['/api/assets/file/missing.png'],
      },
      env: { MAXFORAI_API_KEY: 'test-key' },
      deps: {
        downloadRemoteProviderMediaUrl: async () => {
          throw Object.assign(new Error('素材不存在'), { code: 'provider_bad_request' });
        },
        fetchWithTimeout: async () => {
          paidPostCount += 1;
          return jsonResponse({ data: [{ url: 'https://cdn.test/should-not-run.png' }] });
        },
      },
    }),
    (error) => error?.providerStage === 'asset_upload'
  );
  assert.equal(paidPostCount, 0);
});

test('ambiguous paid POST transport failure is surfaced without retry', async () => {
  let paidPostCount = 0;
  await assert.rejects(
    () => runMaxForAiImageJob({
      payload: {
        model: 'maxforai-image-2-standard',
        prompt: '专业海报',
      },
      env: { MAXFORAI_API_KEY: 'test-key' },
      deps: {
        fetchWithTimeout: async () => {
          paidPostCount += 1;
          throw Object.assign(new Error('socket closed'), { code: 'provider_network_error' });
        },
      },
    }),
    (error) => (
      error?.code === 'provider_submission_unknown'
      && error?.providerStatus === 'submission_unknown'
      && error?.submissionUnknown === true
    )
  );
  assert.equal(paidPostCount, 1);
});
