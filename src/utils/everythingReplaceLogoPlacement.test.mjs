import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOGO_PLACEMENT_RATIOS,
  createEverythingReplaceLogoPlacementGuide,
  createDefaultLogoPlacement,
  resolveNearestLogoPlacementRatio,
  resolveLogoPlacementRect,
  updateLogoPlacementTemplate,
} from './everythingReplaceLogoPlacement.mjs';

test('everything replace logo placement uses ratio templates and short-edge offsets', () => {
  assert.deepEqual(LOGO_PLACEMENT_RATIOS.map((item) => item.ratio), ['1:1', '3:4', '4:3', '9:16', '16:9']);

  const placement = createDefaultLogoPlacement({ width: 1000, height: 1000, logoRatio: 2 });
  const updated = updateLogoPlacementTemplate(placement, '1:1', {
    x: 820,
    y: 80,
    width: 120,
    height: 60,
    canvasWidth: 1000,
    canvasHeight: 1000,
  });

  const square = resolveLogoPlacementRect(updated, {
    ratio: '1:1',
    canvasWidth: 1000,
    canvasHeight: 1000,
    logoRatio: 2,
  });
  assert.equal(Math.round(square.x), 820);
  assert.equal(Math.round(square.y), 80);
  assert.equal(Math.round(square.width), 120);

  const vertical = resolveLogoPlacementRect(updated, {
    ratio: '9:16',
    canvasWidth: 900,
    canvasHeight: 1600,
    logoRatio: 2,
  });
  assert.equal(Math.round(vertical.x), 738);
  assert.equal(Math.round(vertical.y), 72);
  assert.equal(Math.round(vertical.width), 108);
});

test('everything replace logo placement matches the nearest supported ratio', () => {
  assert.equal(resolveNearestLogoPlacementRatio({ width: 1000, height: 1000 }), '1:1');
  assert.equal(resolveNearestLogoPlacementRatio({ width: 900, height: 1600 }), '9:16');
  assert.equal(resolveNearestLogoPlacementRatio({ width: 1600, height: 900 }), '16:9');
  assert.equal(resolveNearestLogoPlacementRatio({ width: 1024, height: 1365 }), '3:4');
});

test('everything replace logo placement guide uses a neutral mask instead of loading the reference background', async () => {
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
    if (safeUrl.includes('reference.png')) {
      throw new Error('reference image should not be loaded into logo placement guide');
    }
    if (safeUrl.startsWith('/api/assets/download-proxy?url=')) {
      return { ok: true, blob: async () => new Blob(['proxy-image'], { type: 'image/png' }) };
    }
    if (safeUrl.startsWith('/api/assets/file/')) {
      return { ok: true, blob: async () => new Blob(['local-image'], { type: 'image/png' }) };
    }
    throw new Error('CORS blocked');
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
    const result = await createEverythingReplaceLogoPlacementGuide({
      referenceUrl: 'https://example-cdn.invalid/reference.png',
      logoUrl: 'https://example-cdn.invalid/logo.png',
      placement: createDefaultLogoPlacement({ width: 1000, height: 1000, logoRatio: 2 }),
      referenceWidth: 1000,
      referenceHeight: 1000,
      logoRatio: 2,
    });

    assert.equal(result.ratio, '1:1');
    assert.ok(result.blob instanceof Blob);
    assert.ok(requestedUrls.some((url) => url.startsWith('/api/assets/download-proxy?url=')));
    assert.ok(!requestedUrls.some((url) => url.includes('reference.png')));
    assert.ok(requestedOptions.some((options) => options.credentials === 'include'));
    assert.ok(requestedOptions.some((options) => options.headers?.Authorization === 'Bearer session-token'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
