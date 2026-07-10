import assert from 'node:assert/strict';
import test from 'node:test';
import {
  __testOnly_clearManagedAssetUploadCache,
  assertRemoteProviderMediaUrlAllowed,
  convertInlineDataUrlToKieFileUrl,
  convertManagedAssetUrlToKieFileUrl,
  readRemoteMediaBufferWithLimit,
  resolveProviderChatMediaUrl,
  resolveProviderGenerationMediaUrl,
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

test('generation and chat use the canonical HTTPS origin in direct-first mode', async () => {
  const env = {
    MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
    MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
  };
  const deps = {
    fetchWithTimeout: async () => {
      throw new Error('must not download');
    },
    uploadAssetViaKieWithFallback: async () => {
      throw new Error('must not upload');
    },
  };

  assert.equal(
    await resolveProviderGenerationMediaUrl('http://111.229.66.247/api/assets/file/a/source.png', { env, deps }),
    'https://meiaoyuntai.com/api/assets/file/a/source.png'
  );
  assert.equal(
    await resolveProviderChatMediaUrl('/api/assets/file/a/source.png', { env, deps }),
    'https://meiaoyuntai.com/api/assets/file/a/source.png'
  );
});

test('kie-only mode preserves forced managed asset uploads', async () => {
  let uploadCalls = 0;
  const resolved = await resolveProviderGenerationMediaUrl('/api/assets/file/a/kie-only.png', {
    env: {
      MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
      MEIAO_KIE_MANAGED_ASSET_MODE: 'kie-only',
    },
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        return { result: { fileUrl: 'https://kie.test/kie-only.png' } };
      },
    },
  });

  assert.equal(resolved, 'https://kie.test/kie-only.png');
  assert.equal(uploadCalls, 1);
});

test('convertManagedAssetUrlToKieFileUrl force uploads managed assets', async () => {
  let uploadedFileName = '';
  const uploaded = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/user/a.png', {
    env: {},
    signal: new AbortController().signal,
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async (payload) => {
        uploadedFileName = payload.fileName;
        return {
          result: {
            fileUrl: `https://kie.test/${payload.fileName}`,
          },
        };
      },
    },
  });

  assert.match(uploadedFileName, /^a-[a-f0-9]{12}\.png$/);
  assert.equal(uploaded, `https://kie.test/${uploadedFileName}`);
});

test('forced managed asset uploads reuse one in-flight successful upload', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let downloadCalls = 0;
  let uploadCalls = 0;
  const options = {
    env: {
      MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000',
      MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES: '10',
    },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => {
        downloadCalls += 1;
        return createResponse('image-bytes', { 'content-type': 'image/png' });
      },
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { result: { fileUrl: 'https://kie.test/cached.png' } };
      },
    },
  };

  const [first, second] = await Promise.all([
    convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-test/source.png', options),
    convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-test/source.png', options),
  ]);

  assert.equal(first, 'https://kie.test/cached.png');
  assert.equal(second, 'https://kie.test/cached.png');
  assert.equal(downloadCalls, 1);
  assert.equal(uploadCalls, 1);
});

test('failed managed asset uploads are not cached', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let uploadCalls = 0;
  const options = {
    env: { MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000' },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        if (uploadCalls === 1) throw new Error('temporary upload failure');
        return { result: { fileUrl: 'https://kie.test/recovered.png' } };
      },
    },
  };

  await assert.rejects(
    () => convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-failure/source.png', options),
    /temporary upload failure/
  );
  const recovered = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-failure/source.png', options);

  assert.equal(recovered, 'https://kie.test/recovered.png');
  assert.equal(uploadCalls, 2);
});

test('convertManagedAssetUrlToKieFileUrl gives same-name managed assets distinct provider filenames', async () => {
  const uploadedFileNames = [];
  const deps = {
    fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
    uploadAssetViaKieWithFallback: async (payload) => {
      uploadedFileNames.push(payload.fileName);
      return { result: { fileUrl: `https://kie.test/${payload.fileName}` } };
    },
  };

  await convertManagedAssetUrlToKieFileUrl('/api/assets/file/a/gpt-image-2.png', {
    env: {},
    forceUpload: true,
    deps,
  });
  await convertManagedAssetUrlToKieFileUrl('/api/assets/file/b/gpt-image-2.png', {
    env: {},
    forceUpload: true,
    deps,
  });

  assert.equal(uploadedFileNames.length, 2);
  assert.notEqual(uploadedFileNames[0], uploadedFileNames[1]);
  assert.match(uploadedFileNames[0], /^gpt-image-2-[a-f0-9]{12}\.png$/);
  assert.match(uploadedFileNames[1], /^gpt-image-2-[a-f0-9]{12}\.png$/);
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
