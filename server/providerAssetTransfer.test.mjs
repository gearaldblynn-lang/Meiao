import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRemoteProviderMediaUrlAllowed,
  convertInlineDataUrlToKieFileUrl,
  convertManagedAssetUrlToKieFileUrl,
  readRemoteMediaBufferWithLimit,
  uploadAssetViaKieWithFallback,
} from './providerAssetTransfer.mjs';

const createResponse = (body, headers = {}) => new Response(body, { status: 200, headers });

test('convertManagedAssetUrlToKieFileUrl prefers externally reachable managed asset URLs', async () => {
  const url = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/user/a.png', {
    env: { MEIAO_PUBLIC_BASE_URL: 'https://public.test' },
    signal: new AbortController().signal,
    deps: {
      fetchWithTimeout: async () => {
        throw new Error('should not download');
      },
      uploadAssetViaKieWithFallback: async () => {
        throw new Error('should not upload');
      },
    },
  });

  assert.equal(url, 'https://public.test/api/assets/file/user/a.png');
});

test('convertManagedAssetUrlToKieFileUrl force uploads managed assets', async () => {
  const uploaded = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/user/a.png', {
    env: {},
    signal: new AbortController().signal,
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async (payload) => ({
        result: {
          fileUrl: `https://kie.test/${payload.fileName}`,
        },
      }),
    },
  });

  assert.equal(uploaded, 'https://kie.test/a.png');
});

test('assertRemoteProviderMediaUrlAllowed rejects local and private URLs', () => {
  for (const value of ['http://localhost/a.png', 'http://127.0.0.1/a.png', 'http://192.168.1.5/a.png', 'file:///tmp/a.png']) {
    assert.throws(() => assertRemoteProviderMediaUrlAllowed(value), /远程素材/);
  }
});

test('readRemoteMediaBufferWithLimit rejects oversized content length and post-read body', async () => {
  await assert.rejects(
    () => readRemoteMediaBufferWithLimit({
      headers: { get: () => String(3) },
      arrayBuffer: async () => new ArrayBuffer(0),
    }, '远程素材', { maxBytes: 2 }),
    /远程素材过大/
  );

  await assert.rejects(
    () => readRemoteMediaBufferWithLimit(createResponse('abc'), '远程素材', { maxBytes: 2 }),
    /远程素材过大/
  );
});

test('convertInlineDataUrlToKieFileUrl uploads with inferred extension', async () => {
  const url = await convertInlineDataUrlToKieFileUrl('data:image/png;base64,aGVsbG8=', {
    env: {},
    deps: {
      uploadAssetViaKieWithFallback: async (payload) => {
        assert.equal(payload.fileName, 'inline-upload.png');
        assert.equal(payload.mimeType, 'image/png');
        return { result: { fileUrl: 'https://kie.test/inline-upload.png' } };
      },
    },
  });

  assert.equal(url, 'https://kie.test/inline-upload.png');
});

test('uploadAssetViaKieWithFallback does not fall back to base64 uploads', async () => {
  const calls = [];
  await assert.rejects(
    () => uploadAssetViaKieWithFallback({
      fileBuffer: Buffer.from('hello'),
      mimeType: 'text/plain',
      fileName: 'a.txt',
    }, {
      env: {},
      deps: {
        uploadAssetViaKieStream: async () => {
          calls.push('stream');
          const error = new Error('timeout');
          error.code = 'provider_timeout';
          throw error;
        },
        uploadAssetViaKieBase64: async () => {
          calls.push('base64');
          return { result: { fileUrl: 'https://kie.test/a.txt' } };
        },
      },
    }),
    /timeout/
  );

  assert.deepEqual(calls, ['stream']);
});
