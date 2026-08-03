import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogoReplaceRegionGuideBlob } from './logoReplacePreview.mjs';

test('logo region guide draws numbered frames without loading or compositing logo assets', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const drawCalls = [];

  globalThis.window = {
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    localStorage: { getItem: () => 'session-token' },
  };
  globalThis.fetch = async () => ({
    ok: true,
    blob: async () => new Blob(['reference'], { type: 'image/png' }),
  });
  globalThis.createImageBitmap = async () => ({ width: 1000, height: 1000, close() {} });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(...args) { drawCalls.push(['drawImage', ...args]); },
            fillRect(...args) { drawCalls.push(['fillRect', ...args]); },
            fillText(...args) { drawCalls.push(['fillText', ...args]); },
            save() {},
            restore() {},
            setLineDash() {},
            strokeRect(...args) { drawCalls.push(['strokeRect', ...args]); },
            measureText() { return { width: 20 }; },
            set globalAlpha(value) {},
            set fillStyle(value) {},
            set strokeStyle(value) {},
            set lineWidth(value) {},
            set font(value) {},
            set textAlign(value) {},
            set textBaseline(value) {},
          };
        },
        toBlob(callback) {
          callback(new Blob(['guide'], { type: 'image/png' }));
        },
      };
    },
  };

  try {
    const result = await createLogoReplaceRegionGuideBlob({
      referenceUrl: 'http://localhost:3000/reference.png',
      regions: [
        { regionId: 'r1', regionIndex: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
        { regionId: 'r2', regionIndex: 2, xRatio: 0.6, yRatio: 0.7, widthRatio: 0.15, heightRatio: 0.08 },
      ],
      referenceWidth: 1000,
      referenceHeight: 1000,
    });

    assert.ok(result.blob instanceof Blob);
    assert.equal(result.rects.length, 2);
    assert.equal(drawCalls.filter(([name]) => name === 'drawImage').length, 1);
    assert.deepEqual(drawCalls.filter(([name]) => name === 'fillText').map(([, text]) => text), ['R1', 'R2']);

    drawCalls.length = 0;
    await createLogoReplaceRegionGuideBlob({
      referenceUrl: 'http://localhost:3000/reference.png',
      regions: [
        { regionId: 'p1', regionIndex: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.1 },
        { regionId: 'p2', regionIndex: 2, xRatio: 0.6, yRatio: 0.7, widthRatio: 0.15, heightRatio: 0.08 },
      ],
      referenceWidth: 1000,
      referenceHeight: 1000,
      labelPrefix: 'P',
    });
    assert.deepEqual(drawCalls.filter(([name]) => name === 'fillText').map(([, text]) => text), ['P1', 'P2']);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
