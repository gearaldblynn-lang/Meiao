import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCornerBadgeRegionToMaterials,
  createCornerBadgeRegionGuide,
  normalizeCornerBadgeRegion,
  rectToCornerBadgeRegion,
} from './cornerBadgeRegion.mjs';

test('corner badge region normalizes and applies only to other materials', () => {
  const region = rectToCornerBadgeRegion({
    x: 800,
    y: 40,
    width: 160,
    height: 90,
    canvasWidth: 1000,
    canvasHeight: 1000,
  });

  assert.deepEqual(region, {
    version: 1,
    source: 'manual',
    xRatio: 0.8,
    yRatio: 0.04,
    widthRatio: 0.16,
    heightRatio: 0.09,
  });

  const materials = {
    styleRef: [
      { id: 'source', cornerBadgeRegion: region },
      { id: 'other' },
    ],
  };

  const next = applyCornerBadgeRegionToMaterials(materials, region, 'source');
  assert.equal(next.styleRef[0].cornerBadgeRegion, region);
  assert.deepEqual(next.styleRef[1].cornerBadgeRegion, {
    ...region,
    source: 'applied_to_all',
  });
});

test('corner badge region preserves selected logo binding', () => {
  const region = normalizeCornerBadgeRegion({
    version: 1,
    source: 'manual',
    xRatio: 0.7,
    yRatio: 0.05,
    widthRatio: 0.2,
    heightRatio: 0.1,
    logoId: 'badge-logo-2',
    logoIndex: 2,
  });

  assert.deepEqual(region, {
    version: 1,
    source: 'manual',
    xRatio: 0.7,
    yRatio: 0.05,
    widthRatio: 0.2,
    heightRatio: 0.1,
    logoId: 'badge-logo-2',
    logoIndex: 2,
  });
});

test('applying corner badge region to all copies geometry without overwriting logo binding', () => {
  const sourceRegion = normalizeCornerBadgeRegion({
    xRatio: 0.7,
    yRatio: 0.05,
    widthRatio: 0.2,
    heightRatio: 0.1,
    logoId: 'badge-logo-2',
    logoIndex: 2,
  });
  const materials = {
    styleRef: [
      { id: 'source', cornerBadgeRegion: sourceRegion },
      {
        id: 'other',
        cornerBadgeRegion: {
          version: 1,
          source: 'manual',
          xRatio: 0.1,
          yRatio: 0.1,
          widthRatio: 0.12,
          heightRatio: 0.08,
          logoId: 'badge-logo-1',
          logoIndex: 1,
        },
      },
    ],
  };

  const next = applyCornerBadgeRegionToMaterials(materials, sourceRegion, 'source');

  assert.deepEqual(next.styleRef[1].cornerBadgeRegion, {
    version: 1,
    source: 'applied_to_all',
    xRatio: 0.7,
    yRatio: 0.05,
    widthRatio: 0.2,
    heightRatio: 0.1,
    logoId: 'badge-logo-1',
    logoIndex: 1,
  });
});

test('corner badge guide uses the asset download proxy when direct remote fetch is blocked', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const requestedUrls = [];
  const requestedOptions = [];
  globalThis.window = {
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    localStorage: { getItem: () => 'session-token' },
  };
  globalThis.fetch = async (url, options) => {
    const safeUrl = String(url);
    requestedUrls.push(safeUrl);
    requestedOptions.push(options || {});
    if (safeUrl.startsWith('/api/assets/download-proxy?url=')) {
      return { ok: true, blob: async () => new Blob(['proxy-image'], { type: 'image/png' }) };
    }
    if (safeUrl === 'https://example-cdn.invalid/reference.png') {
      throw new Error('CORS blocked');
    }
    throw new Error('unexpected fetch');
  };
  globalThis.createImageBitmap = async () => ({ width: 1000, height: 1000, close() {} });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            fillRect() {},
            save() {},
            restore() {},
            setLineDash() {},
            strokeRect() {},
            set globalAlpha(value) {},
            set fillStyle(value) {},
            set strokeStyle(value) {},
            set lineWidth(value) {},
          };
        },
        toBlob(callback) {
          callback(new Blob(['guide'], { type: 'image/png' }));
        },
      };
    },
  };

  try {
    const result = await createCornerBadgeRegionGuide({
      referenceUrl: 'https://example-cdn.invalid/reference.png',
      region: normalizeCornerBadgeRegion({
        xRatio: 0.72,
        yRatio: 0.05,
        widthRatio: 0.2,
        heightRatio: 0.1,
      }),
      referenceWidth: 1000,
      referenceHeight: 1000,
    });

    assert.ok(result.blob instanceof Blob);
    assert.ok(requestedUrls.some((url) => url.startsWith('/api/assets/download-proxy?url=')));
    assert.ok(requestedOptions.some((options) => options.credentials === 'include'));
    assert.ok(requestedOptions.some((options) => options.headers?.Authorization === 'Bearer session-token'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
