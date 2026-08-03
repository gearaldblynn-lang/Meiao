import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogoReplaceQualityEvidenceBlobs } from './logoReplaceQualityEvidence.mjs';

test('quality evidence sheets magnify identity, before, and after for every region', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const canvases = [];

  globalThis.window = {
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    localStorage: { getItem: () => 'session-token' },
  };
  globalThis.fetch = async () => ({
    ok: true,
    blob: async () => new Blob(['image'], { type: 'image/png' }),
  });
  globalThis.createImageBitmap = async () => ({ width: 800, height: 800, close() {} });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const calls = [];
      const canvas = {
        width: 0,
        height: 0,
        calls,
        getContext() {
          return {
            drawImage(...args) { calls.push(['drawImage', ...args]); },
            fillRect(...args) { calls.push(['fillRect', ...args]); },
            fillText(...args) { calls.push(['fillText', ...args]); },
            strokeRect(...args) { calls.push(['strokeRect', ...args]); },
            save() {},
            restore() {},
            set fillStyle(value) {},
            set strokeStyle(value) {},
            set lineWidth(value) {},
            set font(value) {},
            set textAlign(value) {},
            set textBaseline(value) {},
            set imageSmoothingEnabled(value) {},
            set imageSmoothingQuality(value) {},
          };
        },
        toBlob(callback) {
          callback(new Blob(['quality-evidence'], { type: 'image/png' }));
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };

  try {
    const results = await createLogoReplaceQualityEvidenceBlobs({
      sourceUrl: 'http://localhost:3000/source.png',
      resultUrl: 'http://localhost:3000/result.png',
      identityReferenceUrls: [
        'http://localhost:3000/logo-1.png',
        'http://localhost:3000/logo-2.png',
      ],
      regionRects: [
        { regionId: 'r1', regionIndex: 1, xRatio: 0.2, yRatio: 0.25, widthRatio: 0.08, heightRatio: 0.07 },
        { regionId: 'r2', regionIndex: 2, xRatio: 0.4, yRatio: 0.5, widthRatio: 0.08, heightRatio: 0.07 },
      ],
    });

    assert.equal(results.length, 2);
    assert.deepEqual(results.map((item) => [item.regionId, item.regionIndex]), [['r1', 1], ['r2', 2]]);
    assert.ok(results.every((item) => item.blob instanceof Blob));
    assert.ok(results.every((item) => item.width >= 1200 && item.height >= 500));
    assert.equal(canvases.length, 2);

    for (const [index, canvas] of canvases.entries()) {
      const labels = canvas.calls
        .filter(([name]) => name === 'fillText')
        .map(([, text]) => String(text));
      assert.ok(labels.some((label) => label.includes(`R${index + 1}`)));
      assert.ok(labels.some((label) => label.includes('IDENTITY')));
      assert.ok(labels.some((label) => label.includes('BEFORE')));
      assert.ok(labels.some((label) => label.includes('AFTER')));
      assert.equal(canvas.calls.filter(([name]) => name === 'drawImage').length, 3);
      assert.ok(canvas.calls.filter(([name]) => name === 'strokeRect').length >= 2);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
