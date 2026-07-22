import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCosImageObjectKey,
  createTencentCosImageReadUrl,
  deleteTencentCosImage,
  headTencentCosImage,
  putTencentCosImage,
} from './tencentCosImageStore.mjs';

const createEnv = (overrides = {}) => ({
  MEIAO_IMAGE_COS_SECRET_ID: 'image-secret-id',
  MEIAO_IMAGE_COS_SECRET_KEY: 'image-secret-key',
  MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
  MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
  MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS: '300',
  MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS: '10800',
  MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS: '3',
  MEIAO_IMAGE_COS_UPLOAD_TIMEOUT_MS: '5000',
  MEIAO_IMAGE_COS_UPLOAD_RETRY_BASE_MS: '10',
  MEIAO_IMAGE_COS_OPERATION_TIMEOUT_MS: '100',
  ...overrides,
});
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG_BYTES = Buffer.from('ffd8ffe000104a4649460001', 'hex');

test('buildCosImageObjectKey keeps untrusted values inside the managed image prefix', () => {
  const key = buildCosImageObjectKey({
    userId: '../../users/root',
    assetType: '../source',
    assetId: 'asset_01JZ8Q4FW6H8N0X7T8V9K2M3P4',
    fileName: '../../客户主图?.PNG',
    mimeType: 'image/png',
  });

  assert.match(
    key,
    /^managed-images\/users\/[a-f0-9]{32}\/source\/asset_01JZ8Q4FW6H8N0X7T8V9K2M3P4\/image\.png$/,
  );
  assert.doesNotMatch(key, /\.\.|root|客户|\\/);
});

test('buildCosImageObjectKey uses the trusted MIME extension instead of a conflicting client filename', () => {
  const key = buildCosImageObjectKey({
    userId: 'user-1',
    assetType: 'source',
    assetId: 'asset-1',
    fileName: 'catalog.jpg',
    mimeType: 'image/webp',
  });

  assert.match(key, /\/catalog\.webp$/);
});

test('putTencentCosImage retries the same object key and returns sanitized metadata', async () => {
  const calls = [];
  const sleeps = [];
  const fakeClient = {
    putObject(params, callback) {
      calls.push(params);
      if (calls.length < 3) {
        callback(Object.assign(new Error('socket reset with secret image-secret-key'), {
          code: 'ECONNRESET',
        }));
        return;
      }
      callback(null, { ETag: '"etag-3"' });
    },
  };

  const result = await putTencentCosImage(
    {
      storageKey: 'managed-images/users/abc/source/asset-id/image.png',
      fileBuffer: PNG_BYTES,
      mimeType: 'image/png',
    },
    createEnv(),
    new AbortController().signal,
    {
      createClient: () => fakeClient,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    },
  );

  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((entry) => entry.Key)).size, 1);
  assert.equal(calls[0].ContentType, 'image/png');
  assert.deepEqual(calls[0].Body, PNG_BYTES);
  assert.deepEqual(sleeps, [10, 20]);
  assert.deepEqual(result, {
    bucket: 'meiao-managed-images-1406860462',
    region: 'ap-guangzhou',
    storageKey: 'managed-images/users/abc/source/asset-id/image.png',
    etag: 'etag-3',
  });
});

test('putTencentCosImage fails closed after the configured retry limit', async () => {
  let attempts = 0;
  let localFallbackCalls = 0;
  const fakeClient = {
    putObject(_params, callback) {
      attempts += 1;
      callback(Object.assign(new Error('network unavailable'), { code: 'ETIMEDOUT' }));
    },
  };

  await assert.rejects(
    () => putTencentCosImage(
      {
        storageKey: 'managed-images/users/abc/source/asset-id/image.jpg',
        fileBuffer: JPEG_BYTES,
        mimeType: 'image/jpeg',
      },
      createEnv({ MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS: '2' }),
      null,
      {
        createClient: () => fakeClient,
        sleep: async () => {},
        persistLocalFallback: () => { localFallbackCalls += 1; },
      },
    ),
    (error) => error?.code === 'managed_image_upload_failed'
      && error?.providerStage === 'asset_upload'
      && !String(error?.message || '').includes('image-secret-key'),
  );

  assert.equal(attempts, 2);
  assert.equal(localFallbackCalls, 0);
});

test('putTencentCosImage cancels the underlying COS task before a timeout releases the caller', async () => {
  const taskIds = [];
  const cancelled = [];
  const lateCallbacks = [];
  const fakeClient = {
    putObject(params, callback) {
      const taskId = `upload-task-${taskIds.length + 1}`;
      taskIds.push(taskId);
      params.onTaskReady?.(taskId);
      lateCallbacks.push(callback);
    },
    cancelTask(taskId) {
      cancelled.push(taskId);
    },
  };

  await assert.rejects(
    () => putTencentCosImage(
      {
        storageKey: 'managed-images/users/abc/source/asset-id/image.jpg',
        fileBuffer: JPEG_BYTES,
        mimeType: 'image/jpeg',
      },
      createEnv({ MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS: '1' }),
      null,
      {
        createClient: () => fakeClient,
        uploadTimeoutMs: 20,
      },
    ),
    (error) => error?.code === 'managed_image_upload_failed'
      && error?.upstreamCode === 'ETIMEDOUT',
  );

  assert.deepEqual(taskIds, ['upload-task-1']);
  assert.deepEqual(cancelled, ['upload-task-1']);
  lateCallbacks[0]?.(null, { ETag: 'late-success-must-be-ignored' });
});

test('image COS configuration is independent from the video COS configuration', async () => {
  await assert.rejects(
    () => putTencentCosImage(
      {
        storageKey: 'managed-images/users/abc/source/asset-id/image.png',
        fileBuffer: PNG_BYTES,
        mimeType: 'image/png',
      },
      {
        MEIAO_COS_SECRET_ID: 'video-secret-id',
        MEIAO_COS_SECRET_KEY: 'video-secret-key',
        MEIAO_COS_BUCKET: 'video-bucket-1406860462',
        MEIAO_COS_REGION: 'ap-guangzhou',
      },
      null,
      { createClient: () => { throw new Error('client must not be created'); } },
    ),
    (error) => error?.code === 'provider_config_error'
      && /MEIAO_IMAGE_COS_SECRET_ID/.test(String(error?.message || ''))
      && !String(error?.message || '').includes('video-secret'),
  );
});

test('createTencentCosImageReadUrl uses separate browser and provider TTL values', async () => {
  const calls = [];
  const fakeClient = {
    getObjectUrl(params, callback) {
      calls.push(params);
      callback(null, {
        Url: `https://${params.Bucket}.cos.${params.Region}.myqcloud.com/${params.Key}?q-signature=test`,
      });
    },
  };
  const options = { createClient: () => fakeClient };
  const key = 'managed-images/users/abc/source/asset-id/image.webp';

  const browserUrl = await createTencentCosImageReadUrl(key, 'browser', createEnv(), options);
  const providerUrl = await createTencentCosImageReadUrl(key, 'provider', createEnv(), options);

  assert.match(browserUrl, /^https:/);
  assert.match(providerUrl, /^https:/);
  assert.deepEqual(calls.map((entry) => entry.Expires), [300, 10800]);
  assert.ok(calls.every((entry) => entry.Sign === true && entry.Method === 'GET'));
});

test('headTencentCosImage returns a missing result for a missing object', async () => {
  const fakeClient = {
    headObject(_params, callback) {
      callback(Object.assign(new Error('not found'), { statusCode: 404, code: 'NoSuchKey' }));
    },
  };

  const result = await headTencentCosImage(
    'managed-images/users/abc/source/asset-id/image.webp',
    createEnv(),
    { createClient: () => fakeClient },
  );

  assert.deepEqual(result, { exists: false });
});

test('deleteTencentCosImage treats an already missing object as idempotent success', async () => {
  const fakeClient = {
    deleteObject(_params, callback) {
      callback(Object.assign(new Error('not found'), { statusCode: 404, code: 'NoSuchKey' }));
    },
  };

  const result = await deleteTencentCosImage(
    'managed-images/users/abc/source/asset-id/image.webp',
    createEnv(),
    { createClient: () => fakeClient },
  );

  assert.deepEqual(result, { deleted: true, missing: true });
});

test('COS sign head and delete operations fail within the configured timeout', async () => {
  const neverCallbackClient = {
    getObjectUrl() {},
    headObject() {},
    deleteObject() {},
  };
  const options = { createClient: () => neverCallbackClient };
  const env = createEnv({ MEIAO_IMAGE_COS_OPERATION_TIMEOUT_MS: '20' });
  const key = 'managed-images/users/abc/source/asset-id/image.webp';

  await assert.rejects(
    () => createTencentCosImageReadUrl(key, 'browser', env, options),
    (error) => error?.code === 'managed_image_sign_failed' && error?.retryable === true,
  );
  await assert.rejects(
    () => headTencentCosImage(key, env, options),
    (error) => error?.code === 'managed_image_head_failed' && error?.retryable === true,
  );
  await assert.rejects(
    () => deleteTencentCosImage(key, env, options),
    (error) => error?.code === 'managed_image_delete_failed' && error?.retryable === true,
  );
});

test('COS client construction errors are sanitized before leaving the storage boundary', async () => {
  const leaked = 'image-secret-key';
  await assert.rejects(
    () => headTencentCosImage(
      'managed-images/users/abc/source/asset-id/image.webp',
      createEnv(),
      { createClient: () => { throw new Error(`invalid credential ${leaked}`); } },
    ),
    (error) => error?.code === 'provider_config_error'
      && error?.providerStatus === 'config_error'
      && !String(error?.message || '').includes(leaked),
  );
});
