import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyManagedAssetAccessKey } from './managedAssetAccessKey.mjs';
import { resolveManagedAssetReadUrl } from './managedAssetReadResolver.mjs';
import {
  __testOnly_clearManagedAssetUploadCache,
  assertRemoteProviderMediaUrlAllowed,
  convertInlineDataUrlToKieFileUrl,
  convertManagedAssetUrlToKieFileUrl,
  readRemoteMediaBufferWithLimit,
  resolveGeminiVideoMediaMode,
  resolveProviderChatMediaUrl,
  resolveProviderGeminiChatMediaUrl,
  resolveProviderGenerationMediaUrl,
  uploadAssetViaKieWithFallback,
} from './providerAssetTransfer.mjs';

const createResponse = (body, headers = {}) => new Response(body, { status: 200, headers });

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const waitForAbortableResult = (promise, signal) => new Promise((resolve, reject) => {
  let settled = false;
  const settle = (callback, value) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener?.('abort', onAbort);
    callback(value);
  };
  const onAbort = () => {
    const error = new Error('任务已取消');
    error.code = 'request_cancelled';
    settle(reject, error);
  };

  if (signal?.aborted) {
    onAbort();
    return;
  }
  signal?.addEventListener?.('abort', onAbort, { once: true });
  promise.then(
    (value) => settle(resolve, value),
    (error) => settle(reject, error)
  );
});

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

test('generation and chat stage authenticated internal assets instead of exposing the loopback capability', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const calls = [];
  const managedAssetUrl = 'https://meiaoyuntai.com/api/assets/file/model-asset/front.jpg';
  const stagedUrl = 'https://tempfile.redpandaai.co/kieai/mayo-storage/internal/front.jpg';
  const env = {
    MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'managed-asset-provider-test-secret',
    MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
    MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
    PORT: '3100',
  };
  const deps = {
    resolveManagedAssetReadUrl: async (value, options) => {
      calls.push(['resolve', value, options.purpose]);
      return resolveManagedAssetReadUrl(value, {
        ...options,
        env,
        getAsset: async () => ({
          id: 'model-asset',
          userId: 'model-admin',
          module: 'virtual_model',
          provider: 'internal',
          storageStatus: 'active',
          storageKey: 'model-admin/source/front.jpg',
          publicUrl: managedAssetUrl,
          deletedAt: null,
        }),
        authorizedSharedAssetIds: new Set(['model-asset']),
      });
    },
    fetchWithTimeout: async (value) => {
      const providerReadUrl = new URL(value);
      calls.push([
        'fetch',
        providerReadUrl.origin,
        providerReadUrl.pathname,
        verifyManagedAssetAccessKey(
          providerReadUrl.searchParams.get('asset_key'),
          { assetId: 'model-asset', userId: 'model-admin' },
          env,
        ),
      ]);
      return createResponse(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        'content-type': 'image/jpeg',
      });
    },
    uploadAssetViaKieWithFallback: async (payload) => {
      calls.push(['upload', payload.mimeType, payload.fileBuffer.length]);
      return { result: { fileUrl: stagedUrl } };
    },
  };
  const resolved = await resolveProviderGenerationMediaUrl(managedAssetUrl, { env, deps });

  assert.equal(resolved, stagedUrl);
  __testOnly_clearManagedAssetUploadCache();
  assert.equal(
    await resolveProviderChatMediaUrl(managedAssetUrl, { env, deps }),
    stagedUrl,
  );
  assert.equal(calls.filter(([kind]) => kind === 'resolve').length, 4);
  assert.equal(calls.filter(([kind]) => kind === 'fetch').length, 2);
  assert.equal(calls.filter(([kind]) => kind === 'upload').length, 2);
  assert.ok(calls.some((call) => (
    call[0] === 'fetch'
    && call[1] === 'http://127.0.0.1:3100'
    && call[2] === '/api/assets/file/model-asset/front.jpg'
    && call[3] === true
  )));
  assert.ok(calls.every((call) => (
    call[0] !== 'fetch'
    || (
      call[1] === 'http://127.0.0.1:3100'
      && call[2] === '/api/assets/file/model-asset/front.jpg'
      && call[3] === true
    )
  )));
  assert.ok(calls.every((call) => call[0] !== 'upload' || (call[1] === 'image/jpeg' && call[2] === 4)));
});

test('voiceover Golden staging resolves a stable managed video identity before provider upload', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const uploads = [];
  const managedIdentity = 'managed://voiceover-source';
  const managedPublicUrl = '/api/assets/file/voiceover-source/source.mp4';
  const stagedUrl = 'https://tempfile.redpandaai.co/kieai/mayo-storage/subtitle-removal/source.mp4';
  const env = {
    MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'managed-asset-provider-test-secret',
    MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
    PORT: '3100',
  };
  const deps = {
    resolveManagedAssetReadUrl: async (value, options) => resolveManagedAssetReadUrl(value, {
      ...options,
      env,
      getAsset: async () => ({
        id: 'voiceover-source',
        userId: 'voiceover-user',
        module: 'video',
        provider: 'internal_transcode',
        storageStatus: 'active',
        storageKey: 'voiceover-user/source/source.mp4',
        publicUrl: managedPublicUrl,
        deletedAt: null,
      }),
      userId: 'voiceover-user',
    }),
    fetchWithTimeout: async (value) => {
      const providerReadUrl = new URL(value);
      assert.equal(providerReadUrl.origin, 'http://127.0.0.1:3100');
      assert.equal(providerReadUrl.pathname, managedPublicUrl);
      assert.equal(
        verifyManagedAssetAccessKey(
          providerReadUrl.searchParams.get('asset_key'),
          { assetId: 'voiceover-source', userId: 'voiceover-user' },
          env,
        ),
        true,
      );
      return createResponse(Buffer.from('voiceover-video'), {
        'content-type': 'video/mp4',
      });
    },
    uploadAssetViaKieWithFallback: async (payload) => {
      uploads.push(payload);
      return { result: { fileUrl: stagedUrl } };
    },
  };

  const resolved = await resolveProviderGenerationMediaUrl(managedIdentity, {
    env,
    deps,
    uploadPath: 'mayo-storage/subtitle-removal',
  });

  assert.equal(resolved, stagedUrl);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].mimeType, 'video/mp4');
  assert.match(uploads[0].fileName, /^source-[a-f0-9]{12}\.mp4$/u);
});

test('stable managed identities fail closed when the owner-aware resolver is missing or empty', async () => {
  for (const resolveManagedAssetReadUrl of [undefined, async () => '']) {
    __testOnly_clearManagedAssetUploadCache();
    let fetchCalls = 0;
    let uploadCalls = 0;
    const deps = {
      ...(resolveManagedAssetReadUrl ? { resolveManagedAssetReadUrl } : {}),
      fetchWithTimeout: async () => {
        fetchCalls += 1;
        return createResponse(Buffer.from('not-owned-media'), {
          'content-type': 'application/octet-stream',
        });
      },
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        return { result: { fileUrl: 'https://must-not-upload.test/source.bin' } };
      },
    };

    await assert.rejects(
      () => resolveProviderGenerationMediaUrl('managed://voiceover-source', {
        env: { MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first' },
        deps,
      }),
      (error) => error?.code === 'managed_asset_unavailable',
    );
    assert.equal(fetchCalls, 0);
    assert.equal(uploadCalls, 0);
  }
});

test('stable managed identities reject missing or mismatched stored public paths before network transfer', async () => {
  for (const publicUrl of [
    '',
    '/not-a-managed-asset/source.mp4',
    '/api/assets/file/different-asset/source.mp4',
    'managed://voiceover-source',
    '/api/assets/file/voiceover-source/../../../..',
    '/api/assets/file/voiceover-source/%2e%2e/%2e%2e/%2e%2e/%2e%2e',
    '/api/assets/file/voiceover-source/source.mp4/extra',
    '/api/assets/file/voiceover-source/',
    'https://meiao.example/api/assets/file/voiceover-source/source.mp4/../other.mp4',
  ]) {
    __testOnly_clearManagedAssetUploadCache();
    let capabilityCalls = 0;
    let fetchCalls = 0;
    let uploadCalls = 0;
    const env = {
      MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'managed-asset-provider-test-secret',
      MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
      PORT: '3100',
    };
    const deps = {
      resolveManagedAssetReadUrl: async (value, options) => resolveManagedAssetReadUrl(value, {
        ...options,
        env,
        userId: 'voiceover-user',
        appendAccessKey: (value) => {
          capabilityCalls += 1;
          return value;
        },
        getAsset: async () => ({
          id: 'voiceover-source',
          userId: 'voiceover-user',
          module: 'video',
          provider: 'internal_transcode',
          storageStatus: 'active',
          storageKey: 'voiceover-user/source/source.mp4',
          publicUrl,
          deletedAt: null,
        }),
      }),
      fetchWithTimeout: async () => {
        fetchCalls += 1;
        return createResponse(Buffer.from('not-owned-media'), {
          'content-type': 'application/octet-stream',
        });
      },
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        return { result: { fileUrl: 'https://must-not-upload.test/source.bin' } };
      },
    };

    await assert.rejects(
      () => resolveProviderGenerationMediaUrl('managed://voiceover-source', {
        env,
        deps,
      }),
      (error) => error?.code === 'managed_asset_unavailable',
    );
    assert.equal(capabilityCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(uploadCalls, 0);
  }
});

test('malformed managed identity schemes fail before resolver or provider transfer', async () => {
  for (const value of [
    'managed://asset-local?asset_key=forged',
    'managed://asset-local#fragment',
    'managed:///asset-local',
    'managed:asset-local',
  ]) {
    let resolverCalls = 0;
    let fetchCalls = 0;
    let uploadCalls = 0;
    await assert.rejects(
      () => resolveProviderGenerationMediaUrl(value, {
        env: { MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first' },
        deps: {
          resolveManagedAssetReadUrl: async () => {
            resolverCalls += 1;
            return 'https://must-not-resolve.test/source.mp4';
          },
          fetchWithTimeout: async () => {
            fetchCalls += 1;
            return createResponse(Buffer.from('must-not-fetch'));
          },
          uploadAssetViaKieWithFallback: async () => {
            uploadCalls += 1;
            return { result: { fileUrl: 'https://must-not-upload.test/source.mp4' } };
          },
        },
      }),
      (error) => error?.code === 'managed_asset_unavailable',
    );
    assert.equal(resolverCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(uploadCalls, 0);
  }
});

test('managed COS images are staged for generation while chat can use a fresh signed read URL', async () => {
  const calls = [];
  const signedUrl = 'https://meiao-managed-images-1406860462.cos.ap-guangzhou.myqcloud.com/managed-images/users/abc/source/asset/image.png?q-signature=fresh';
  const stagedUrl = 'https://file.kie.ai/mayo-storage/internal/asset-image.png';
  const env = {
    MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
    MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
  };
  const deps = {
    resolveManagedAssetReadUrl: async (value, options) => {
      calls.push(['resolve', value, options.purpose]);
      return signedUrl;
    },
    fetchWithTimeout: async (value) => {
      calls.push(['fetch', value]);
      return {
        ok: true,
        headers: { get: (name) => name === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => Buffer.from('cos-image'),
      };
    },
    uploadAssetViaKieWithFallback: async (payload) => {
      calls.push(['upload', payload.mimeType, payload.fileBuffer.toString()]);
      return { result: { fileUrl: stagedUrl } };
    },
  };

  assert.equal(
    await resolveProviderGenerationMediaUrl('/api/assets/file/asset/image.png', {
      env,
      deps,
    }),
    stagedUrl,
  );
  assert.equal(
    await resolveProviderChatMediaUrl('/api/assets/file/asset/image.png', {
      env,
      deps,
    }),
    signedUrl,
  );
  assert.equal(calls.filter(([kind]) => kind === 'fetch').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'upload').length, 1);
  assert.ok(calls.some((call) => call[0] === 'fetch' && call[1] === signedUrl));
});

test('managed Gemini video is copied to private COS and resolved as a signed URL', async () => {
  const uploads = [];
  const signedCosUrl = 'https://meiao-gemini-video-test-20260714-1406860462.cos.ap-guangzhou.myqcloud.com/gemini-video/hash/source.mp4?q-signature=signed';
  const resolved = await resolveProviderGeminiChatMediaUrl('/api/assets/file/video/source.mp4', {
    env: {
      MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
      MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
    },
    deps: {
      fetchWithTimeout: async () => createResponse('complete-video', {
        'content-type': 'video/mp4',
        'content-length': '14',
      }),
      uploadGeminiVideoToCos: async (payload) => {
        uploads.push(payload);
        return signedCosUrl;
      },
      uploadAssetViaKieWithFallback: async () => {
        throw new Error('Gemini video must never be staged through KIE');
      },
    },
  });

  assert.equal(resolved, signedCosUrl);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].fileName, 'source.mp4');
  assert.equal(uploads[0].mimeType, 'video/mp4');
  assert.deepEqual(uploads[0].fileBuffer, Buffer.from('complete-video'));
});

test('Gemini managed video can be staged through KIE before the paid model request', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const uploads = [];
  const stagedUrl = 'https://tempfile.redpandaai.co/kieai/mayo-storage/gemini-video/source.mp4';
  const resolved = await resolveProviderGeminiChatMediaUrl('/api/assets/file/video/source.mp4', {
    env: {
      MEIAO_GEMINI_VIDEO_MEDIA_MODE: 'kie-stage',
    },
    deps: {
      fetchWithTimeout: async () => createResponse('complete-video', {
        'content-type': 'video/mp4',
        'content-length': '14',
      }),
      uploadGeminiVideoToCos: async () => {
        throw new Error('KIE staging mode must not upload Gemini video to COS');
      },
      uploadAssetViaKieWithFallback: async (payload) => {
        uploads.push(payload);
        return { result: { fileUrl: stagedUrl } };
      },
    },
  });

  assert.equal(resolveGeminiVideoMediaMode({}), 'cos-direct');
  assert.equal(resolveGeminiVideoMediaMode({
    MEIAO_GEMINI_VIDEO_MEDIA_MODE: 'kie-stage',
  }), 'kie-stage');
  assert.equal(resolved, stagedUrl);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].mimeType, 'video/mp4');
  assert.equal(uploads[0].uploadPath, 'mayo-storage/gemini-video');
  assert.deepEqual(uploads[0].fileBuffer, Buffer.from('complete-video'));
});

test('external COS video URLs pass directly to Gemini without KIE staging', async () => {
  const signedCosUrl = 'https://meiao-gemini-video-test-20260714-1406860462.cos.ap-guangzhou.myqcloud.com/gemini-video/hash/source.mp4?q-signature=signed';
  const resolved = await resolveProviderGeminiChatMediaUrl(signedCosUrl, {
    env: {},
    deps: {
      fetchWithTimeout: async () => {
        throw new Error('external COS video must not be downloaded by the gateway');
      },
      uploadAssetViaKieWithFallback: async () => {
        throw new Error('external COS video must not be uploaded to KIE');
      },
    },
  });

  assert.equal(resolved, signedCosUrl);
});

test('forced media mode still routes managed Gemini video through COS and never KIE', async () => {
  const cosUploads = [];
  const resolved = await resolveProviderGeminiChatMediaUrl('/api/assets/file/video/forced.mp4', {
    env: {
      MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
      MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
    },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('video-bytes', {
        'content-type': 'video/mp4',
        'content-length': '11',
      }),
      uploadGeminiVideoToCos: async (payload) => {
        cosUploads.push(payload);
        return 'https://cos.test/gemini-video/forced.mp4?q-signature=signed';
      },
      uploadAssetViaKieWithFallback: async () => {
        throw new Error('Gemini video must never be staged through KIE');
      },
    },
  });

  assert.equal(resolved, 'https://cos.test/gemini-video/forced.mp4?q-signature=signed');
  assert.equal(cosUploads.length, 1);
  assert.equal(cosUploads[0].fileName, 'forced.mp4');
});

test('managed upload cache is isolated by provider upload destination', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const uploads = [];
  const baseOptions = {
    env: { MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com' },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('video-bytes', { 'content-type': 'video/mp4' }),
      uploadAssetViaKieWithFallback: async (payload) => {
        uploads.push(payload.uploadPath);
        return { result: { fileUrl: `https://kie.test/${payload.uploadPath}/source.mp4` } };
      },
    },
  };

  const [first, duplicate] = await Promise.all([
    convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-route/source.mp4', {
      ...baseOptions,
      uploadPath: 'openrouter-chat',
    }),
    convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-route/source.mp4', {
      ...baseOptions,
      uploadPath: 'openrouter-chat',
    }),
  ]);
  const internal = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-route/source.mp4', {
    ...baseOptions,
    uploadPath: 'mayo-storage/internal',
  });

  assert.equal(first, 'https://kie.test/openrouter-chat/source.mp4');
  assert.equal(duplicate, first);
  assert.equal(internal, 'https://kie.test/mayo-storage/internal/source.mp4');
  assert.deepEqual(uploads, ['openrouter-chat', 'mayo-storage/internal']);
});

test('unknown managed asset modes fail closed to KIE upload with a public HTTPS origin', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let uploadCalls = 0;
  const resolved = await resolveProviderGenerationMediaUrl('/api/assets/file/a/mode-typo.png', {
    env: {
      MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
      MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-frist',
    },
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        return { result: { fileUrl: 'https://kie.test/mode-typo.png' } };
      },
    },
  });

  assert.equal(resolved, 'https://kie.test/mode-typo.png');
  assert.equal(uploadCalls, 1);
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

test('cancelling one caller does not cancel its shared forced managed asset upload', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const uploadStarted = createDeferred();
  const uploadResult = createDeferred();
  const firstController = new AbortController();
  const secondController = new AbortController();
  let sharedSignal = null;
  let uploadCalls = 0;
  const options = {
    env: { MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000' },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async (_payload, uploadOptions) => {
        uploadCalls += 1;
        sharedSignal = uploadOptions.signal;
        uploadStarted.resolve();
        return waitForAbortableResult(uploadResult.promise, sharedSignal);
      },
    },
  };

  const first = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-cancel-one/source.png', {
    ...options,
    signal: firstController.signal,
  });
  const second = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-cancel-one/source.png', {
    ...options,
    signal: secondController.signal,
  });
  second.catch(() => {});
  await uploadStarted.promise;

  firstController.abort();
  await assert.rejects(first, (error) => error?.code === 'request_cancelled');
  assert.equal(sharedSignal.aborted, false);

  uploadResult.resolve({ result: { fileUrl: 'https://kie.test/shared-success.png' } });
  assert.equal(await second, 'https://kie.test/shared-success.png');
  assert.equal(uploadCalls, 1);
});

test('cancelling all callers aborts the shared transfer and removes its cache entry', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const uploadStarted = createDeferred();
  const neverCompletes = createDeferred();
  const firstController = new AbortController();
  const secondController = new AbortController();
  let firstSharedSignal = null;
  let uploadCalls = 0;
  const options = {
    env: { MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000' },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async (_payload, uploadOptions) => {
        uploadCalls += 1;
        if (uploadCalls > 1) {
          return { result: { fileUrl: 'https://kie.test/fresh-after-cancel.png' } };
        }
        firstSharedSignal = uploadOptions.signal;
        uploadStarted.resolve();
        return waitForAbortableResult(neverCompletes.promise, firstSharedSignal);
      },
    },
  };

  const first = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-cancel-all/source.png', {
    ...options,
    signal: firstController.signal,
  });
  const second = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-cancel-all/source.png', {
    ...options,
    signal: secondController.signal,
  });
  second.catch(() => {});
  await uploadStarted.promise;

  firstController.abort();
  await assert.rejects(first, (error) => error?.code === 'request_cancelled');
  assert.equal(firstSharedSignal.aborted, false);

  const secondRejection = assert.rejects(second, (error) => error?.code === 'request_cancelled');
  secondController.abort();
  await secondRejection;
  assert.equal(firstSharedSignal.aborted, true);

  const recovered = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-cancel-all/source.png', options);
  assert.equal(recovered, 'https://kie.test/fresh-after-cancel.png');
  assert.equal(uploadCalls, 2);
});

test('capacity eviction keeps pending transfers reusable', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const uploadAStarted = createDeferred();
  const uploadBStarted = createDeferred();
  const uploadAResult = createDeferred();
  const uploadBResult = createDeferred();
  const uploadCalls = { a: 0, b: 0 };
  const options = {
    env: {
      MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000',
      MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES: '1',
    },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async (payload) => {
        const asset = payload.fileName.startsWith('a-') ? 'a' : 'b';
        uploadCalls[asset] += 1;
        if (asset === 'a') {
          uploadAStarted.resolve();
          return uploadAResult.promise;
        }
        uploadBStarted.resolve();
        return uploadBResult.promise;
      },
    },
  };

  const firstA = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-capacity/a.png', options);
  await uploadAStarted.promise;
  const firstB = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-capacity/b.png', options);
  await uploadBStarted.promise;
  const secondA = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-capacity/a.png', options);

  uploadAResult.resolve({ result: { fileUrl: 'https://kie.test/a.png' } });
  uploadBResult.resolve({ result: { fileUrl: 'https://kie.test/b.png' } });
  assert.deepEqual(await Promise.all([firstA, firstB, secondA]), [
    'https://kie.test/a.png',
    'https://kie.test/b.png',
    'https://kie.test/a.png',
  ]);
  assert.equal(uploadCalls.a, 1);
  assert.equal(uploadCalls.b, 1);
});

test('forced managed asset uploads reuse the existing key when the cache is at capacity', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let downloadCalls = 0;
  let uploadCalls = 0;
  const options = {
    env: {
      MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000',
      MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES: '1',
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
        return { result: { fileUrl: 'https://kie.test/cache-capacity.png' } };
      },
    },
  };

  const [first, second] = await Promise.all([
    convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-capacity/source.png', options),
    convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-capacity/source.png', options),
  ]);

  assert.equal(first, 'https://kie.test/cache-capacity.png');
  assert.equal(second, 'https://kie.test/cache-capacity.png');
  assert.equal(downloadCalls, 1);
  assert.equal(uploadCalls, 1);
});

test('cache pressure does not evict an in-flight managed asset upload', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let uploadCalls = 0;
  let releaseFirstUpload;
  const firstUploadStarted = new Promise((resolve) => {
    releaseFirstUpload = resolve;
  });
  let signalFirstUploadStarted;
  const firstUploadReady = new Promise((resolve) => {
    signalFirstUploadStarted = resolve;
  });
  const options = {
    env: {
      MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000',
      MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES: '1',
    },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        if (uploadCalls === 1) {
          signalFirstUploadStarted();
          await firstUploadStarted;
        }
        return { result: { fileUrl: `https://kie.test/cache-pressure-${uploadCalls}.png` } };
      },
    },
  };

  const first = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-pressure-a/source.png', options);
  await firstUploadReady;
  await convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-pressure-b/source.png', options);
  const duplicate = convertManagedAssetUrlToKieFileUrl('/api/assets/file/cache-pressure-a/source.png', options);
  releaseFirstUpload();

  const [firstUrl, duplicateUrl] = await Promise.all([first, duplicate]);
  assert.equal(firstUrl, duplicateUrl);
  assert.equal(uploadCalls, 2);
});

test('non-forced managed asset fallback uploads reuse the successful process cache', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let downloadCalls = 0;
  let uploadCalls = 0;
  const options = {
    env: {
      MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
      MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000',
    },
    forceUpload: false,
    deps: {
      fetchWithTimeout: async () => {
        downloadCalls += 1;
        return createResponse('image-bytes', { 'content-type': 'image/png' });
      },
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        return { result: { fileUrl: 'https://kie.test/fallback-cached.png' } };
      },
    },
  };

  const first = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/fallback-cache/source.png', options);
  const second = await convertManagedAssetUrlToKieFileUrl('/api/assets/file/fallback-cache/source.png', options);

  assert.equal(first, 'https://kie.test/fallback-cached.png');
  assert.equal(second, 'https://kie.test/fallback-cached.png');
  assert.equal(downloadCalls, 1);
  assert.equal(uploadCalls, 1);
});

test('non-forced managed asset fallback rejects an empty upload URL', async () => {
  __testOnly_clearManagedAssetUploadCache();
  await assert.rejects(
    () => convertManagedAssetUrlToKieFileUrl('/api/assets/file/empty-fallback/source.png', {
      env: { MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100' },
      forceUpload: false,
      deps: {
        fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
        uploadAssetViaKieWithFallback: async () => ({ result: { fileUrl: '' } }),
      },
    }),
    (error) => error?.code === 'provider_bad_response' && error?.message === '上传成功但未返回素材地址',
  );
});

test('forced managed asset empty uploads are rejected and removed from the cache', async () => {
  __testOnly_clearManagedAssetUploadCache();
  let uploadCalls = 0;
  const options = {
    env: { MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS: '60000' },
    forceUpload: true,
    deps: {
      fetchWithTimeout: async () => createResponse('image-bytes', { 'content-type': 'image/png' }),
      uploadAssetViaKieWithFallback: async () => {
        uploadCalls += 1;
        return { result: { fileUrl: '' } };
      },
    },
  };

  await assert.rejects(
    () => convertManagedAssetUrlToKieFileUrl('/api/assets/file/empty-forced/source.png', options),
    (error) => error?.code === 'provider_bad_response' && error?.message === '上传成功但未返回素材地址'
  );
  await assert.rejects(
    () => convertManagedAssetUrlToKieFileUrl('/api/assets/file/empty-forced/source.png', options),
    (error) => error?.code === 'provider_bad_response' && error?.message === '上传成功但未返回素材地址'
  );
  assert.equal(uploadCalls, 2);
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
