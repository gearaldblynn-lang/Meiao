import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchImageBlobWithProxy } from './browserImageLoader.mjs';

test('local managed asset URLs use the authenticated same-origin route', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const calls = [];

  globalThis.window = {
    location: {
      href: 'http://127.0.0.1:3001/',
      origin: 'http://127.0.0.1:3001',
    },
    localStorage: {
      getItem: (key) => key === 'MEIAO_INTERNAL_SESSION_TOKEN' ? 'session-token' : '',
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    };
  };

  try {
    const blob = await fetchImageBlobWithProxy(
      'http://127.0.0.1:3100/api/assets/file/result-asset/kie_image.jpg',
      'Download',
    );

    assert.equal(blob.type, 'image/png');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/assets/file/result-asset/kie_image.jpg');
    assert.equal(calls[0].options.credentials, 'include');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer session-token');
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});
