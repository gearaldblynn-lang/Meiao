import assert from 'node:assert/strict';
import test from 'node:test';

import { uploadGeminiVideoToCos } from './tencentCosVideoStore.mjs';

const createEnv = (overrides = {}) => ({
  MEIAO_COS_SECRET_ID: 'secret-id',
  MEIAO_COS_SECRET_KEY: 'secret-key',
  MEIAO_COS_BUCKET: 'meiao-gemini-video-test-20260714-1406860462',
  MEIAO_COS_REGION: 'ap-guangzhou',
  MEIAO_COS_SIGNED_URL_TTL_SECONDS: '7200',
  ...overrides,
});

test('uploadGeminiVideoToCos uploads a hash-keyed private object and returns a signed GET url', async () => {
  const calls = [];
  const fakeClient = {
    putObject(params, callback) {
      calls.push({ method: 'putObject', params });
      callback(null, { ETag: 'etag' });
    },
    getObjectUrl(params, callback) {
      calls.push({ method: 'getObjectUrl', params });
      callback(null, {
        Url: `https://${params.Bucket}.cos.${params.Region}.myqcloud.com/${params.Key}?q-signature=redacted`,
      });
    },
  };

  const url = await uploadGeminiVideoToCos(
    {
      fileBuffer: Buffer.from('complete-video-bytes'),
      fileName: '参考视频.mp4',
      mimeType: 'video/mp4',
    },
    createEnv(),
    new AbortController().signal,
    { createClient: () => fakeClient },
  );

  assert.match(url, /^https:\/\/meiao-gemini-video-test-20260714-1406860462\.cos\.ap-guangzhou\.myqcloud\.com\//);
  assert.match(url, /q-signature=redacted/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'putObject');
  assert.equal(calls[0].params.ContentType, 'video/mp4');
  assert.match(calls[0].params.Key, /^gemini-video\/[a-f0-9]{64}\/reference\.mp4$/);
  assert.deepEqual(calls[0].params.Body, Buffer.from('complete-video-bytes'));
  assert.equal(calls[1].method, 'getObjectUrl');
  assert.equal(calls[1].params.Sign, true);
  assert.equal(calls[1].params.Expires, 7200);
});

test('uploadGeminiVideoToCos fails closed when private COS credentials are incomplete', async () => {
  await assert.rejects(
    () => uploadGeminiVideoToCos(
      { fileBuffer: Buffer.from('video'), fileName: 'video.mp4', mimeType: 'video/mp4' },
      createEnv({ MEIAO_COS_SECRET_KEY: '' }),
      new AbortController().signal,
      { createClient: () => { throw new Error('client must not be created'); } },
    ),
    (error) => error?.code === 'provider_config_error'
      && /MEIAO_COS_SECRET_KEY/.test(String(error?.message || '')),
  );
});

test('uploadGeminiVideoToCos stops before upload when the request is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => uploadGeminiVideoToCos(
      { fileBuffer: Buffer.from('video'), fileName: 'video.mp4', mimeType: 'video/mp4' },
      createEnv(),
      controller.signal,
      { createClient: () => { throw new Error('client must not be created'); } },
    ),
    (error) => error?.code === 'request_cancelled',
  );
});

test('uploadGeminiVideoToCos rejects a non-HTTPS signed read url', async () => {
  const fakeClient = {
    putObject(params, callback) {
      callback(null, { ETag: 'etag' });
    },
    getObjectUrl(params, callback) {
      callback(null, { Url: `http://${params.Bucket}.cos.${params.Region}.myqcloud.com/${params.Key}` });
    },
  };

  await assert.rejects(
    () => uploadGeminiVideoToCos(
      { fileBuffer: Buffer.from('video'), fileName: 'video.mp4', mimeType: 'video/mp4' },
      createEnv(),
      new AbortController().signal,
      { createClient: () => fakeClient },
    ),
    (error) => error?.code === 'provider_bad_response'
      && /HTTPS/.test(String(error?.message || '')),
  );
});
