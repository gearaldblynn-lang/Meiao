import test from 'node:test';
import assert from 'node:assert/strict';

import * as maxForAiProvider from './providerMaxForAiImage.mjs';

const {
  buildMaxForAiImageRequestBody,
  runMaxForAiImageJob,
} = maxForAiProvider;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('builds the documented text generation body with relay model and mapped size', () => {
  assert.deepEqual(buildMaxForAiImageRequestBody({
    payload: {
      model: 'maxforai-image-2-relay',
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
    response_format: 'url',
  });
});

test('exports a response normalizer for URL and base64 result contracts', () => {
  assert.equal(typeof maxForAiProvider.extractMaxForAiImageResult, 'function');
});

test('text generation submits one paid POST and returns the generated URL', async () => {
  const calls = [];
  const result = await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-relay',
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
    response_format: 'url',
  });
  assert.deepEqual(calls[0][5], { idempotent: false, maxRetries: 0 });
  assert.equal(result.result.imageUrl, 'https://cdn.test/result.png');
  assert.equal(result.result.providerResponseFormat, 'url');
  assert.equal(result.result.provider, 'maxforai');
  assert.equal(result.result.providerModel, 'gpt-image-2');
  assert.equal(result.providerStage, 'completed');
});

test('image edit downloads public references and submits up to 16 multipart image files', async () => {
  const sourceUrls = Array.from({ length: 18 }, (_, index) => `https://cdn.test/${index}.png`);
  const calls = [];
  const downloadCalls = [];
  await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-relay',
      prompt: '保持主体，改成科技海报',
      aspectRatio: '3:4',
      resolution: '2K',
      imageUrls: [sourceUrls[0], ...sourceUrls, sourceUrls[1]],
    },
    env: { MAXFORAI_API_KEY: 'test-key' },
    deps: {
      downloadRemoteProviderMediaUrl: async (url) => {
        downloadCalls.push(url);
        const index = sourceUrls.indexOf(url);
        return {
          fileName: `${index}.png`,
          mimeType: 'image/png',
          fileBuffer: Buffer.from(`png-${index}`),
        };
      },
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        return jsonResponse({ data: [{ url: 'https://cdn.test/edit.png' }] });
      },
    },
  });

  assert.deepEqual(downloadCalls, sourceUrls.slice(0, 16));
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/images\/edits$/);
  assert.ok(calls[0][1].body instanceof FormData);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-key');
  assert.equal(calls[0][1].headers['Content-Type'], undefined);
  assert.equal(calls[0][1].body.get('model'), 'gpt-image-2');
  assert.equal(calls[0][1].body.get('prompt'), '保持主体，改成科技海报');
  assert.equal(calls[0][1].body.get('size'), '1536x2048');
  assert.equal(calls[0][1].body.get('n'), '1');
  assert.equal(calls[0][1].body.get('response_format'), 'url');
  const imageFiles = calls[0][1].body.getAll('image');
  assert.equal(imageFiles.length, 16);
  assert.equal(imageFiles[0].name, '0.png');
  assert.equal(imageFiles[15].name, '15.png');
});

test('successful base64 response becomes a validated internal image data URL', async () => {
  const result = await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-relay',
      prompt: '蓝色马克杯',
      aspectRatio: '1:1',
      resolution: '1K',
    },
    env: { MAXFORAI_API_KEY: 'test-key' },
    deps: {
      fetchWithTimeout: async () => jsonResponse({
        created: 1781187443,
        data: [{ b64_json: 'aGVsbG8=' }],
      }),
    },
  });

  assert.equal(result.result.imageUrl, 'data:image/png;base64,aGVsbG8=');
  assert.equal(result.result.providerResponseFormat, 'b64_json');
  assert.equal(result.result.providerModel, 'gpt-image-2');
});

test('successful response without URL or base64 reports field names without values', async () => {
  await assert.rejects(
    () => runMaxForAiImageJob({
      payload: {
        model: 'maxforai-image-2-relay',
        prompt: '蓝色马克杯',
      },
      env: { MAXFORAI_API_KEY: 'test-key' },
      deps: {
        fetchWithTimeout: async () => jsonResponse({
          created: 1781187443,
          data: [{ revised_prompt: 'secret prompt value' }],
        }),
      },
    }),
    (error) => (
      error?.code === 'provider_bad_response'
      && error?.providerStage === 'provider_response'
      && /created,data/.test(error?.message || '')
      && /revised_prompt/.test(error?.message || '')
      && !/secret prompt value/.test(error?.message || '')
    ),
  );
});

test('downloads internal image material and attaches it directly to the paid edit POST', async () => {
  const calls = [];
  const downloadCalls = [];
  await runMaxForAiImageJob({
    payload: {
      model: 'maxforai-image-2-relay',
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
        return jsonResponse({ data: [{ url: 'https://cdn.test/edit.png' }] });
      },
    },
  });

  assert.deepEqual(downloadCalls, ['/api/assets/file/reference.png']);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /\/images\/edits$/);
  assert.ok(calls[0][1].body instanceof FormData);
  const [imageFile] = calls[0][1].body.getAll('image');
  assert.equal(imageFile.name, 'reference.png');
  assert.equal(imageFile.type, 'image/png');
});

test('asset preparation failure prevents the paid generation POST', async () => {
  let paidPostCount = 0;
  await assert.rejects(
    () => runMaxForAiImageJob({
      payload: {
        model: 'maxforai-image-2-relay',
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
        model: 'maxforai-image-2-relay',
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

test('paid response body disconnect is also marked submission unknown without retry', async () => {
  let paidPostCount = 0;
  await assert.rejects(
    () => runMaxForAiImageJob({
      payload: {
        model: 'maxforai-image-2-relay',
        prompt: '专业海报',
      },
      env: { MAXFORAI_API_KEY: 'test-key' },
      deps: {
        fetchWithTimeout: async () => {
          paidPostCount += 1;
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw Object.assign(new Error('response body disconnected'), { code: 'provider_network_error' });
            },
          };
        },
      },
    }),
    (error) => error?.code === 'provider_submission_unknown' && error?.submissionUnknown === true,
  );
  assert.equal(paidPostCount, 1);
});
