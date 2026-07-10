import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLogoOverlayItem,
  createGuardedMultiLogoReplaceResultBlob,
  expandRect,
  pickGuardedLogoReplacePixel,
  scrubLogoResidualPixels,
} from './logoReplaceGuard.mjs';

test('expands the edit rect modestly and clamps to image bounds', () => {
  assert.deepEqual(expandRect({
    rect: { x: 90, y: 80, width: 20, height: 10 },
    width: 120,
    height: 100,
    paddingRatio: 0.2,
  }), {
    x: 86,
    y: 76,
    width: 28,
    height: 18,
  });
});

test('uses the exact selected region by default so unselected pixels stay unchanged', () => {
  assert.deepEqual(expandRect({
    rect: { x: 90, y: 80, width: 20, height: 10 },
    width: 120,
    height: 100,
  }), {
    x: 90,
    y: 80,
    width: 20,
    height: 10,
  });
});

test('keeps original pixels outside the selected logo edit rect', () => {
  const protectedRect = { x: 2, y: 1, width: 2, height: 2 };
  const original = [10, 20, 30, 255];
  const generated = [200, 210, 220, 255];

  assert.deepEqual(pickGuardedLogoReplacePixel({ x: 0, y: 0, protectedRect, original, generated }), original);
  assert.deepEqual(pickGuardedLogoReplacePixel({ x: 2, y: 1, protectedRect, original, generated }), generated);
});

test('normalizes one exact logo overlay from preview logo rect', () => {
  const item = computeLogoOverlayItem({
    logoUrl: 'logo-1.png',
    logoRect: { x: 10, y: 20, width: 30, height: 12 },
  });

  assert.deepEqual(item, { logoUrl: 'logo-1.png', rect: { x: 10, y: 20, width: 30, height: 12 } });
});

test('rejects exact logo overlay without a bound logo', () => {
  const item = computeLogoOverlayItem({
    logoUrl: '',
    logoRect: { x: 10, y: 20, width: 30, height: 12 },
  });

  assert.equal(item, null);
});

test('scales preview logo overlay ratios back to the original image dimensions', () => {
  const item = computeLogoOverlayItem({
    logoUrl: 'logo-1.png',
    logoRect: { xRatio: 0.25, yRatio: 0.2, widthRatio: 0.1, heightRatio: 0.05 },
    dimensions: { width: 3000, height: 2000 },
  });

  assert.deepEqual(item, { logoUrl: 'logo-1.png', rect: { x: 750, y: 400, width: 300, height: 100 } });
});

test('scrubs bright old-logo residuals inside the selected cleanup rect', () => {
  const imageData = {
    width: 6,
    height: 4,
    data: new Uint8ClampedArray(6 * 4 * 4),
  };
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 20;
    imageData.data[index + 1] = 22;
    imageData.data[index + 2] = 24;
    imageData.data[index + 3] = 255;
  }
  const residualOffset = (2 * imageData.width + 3) * 4;
  imageData.data[residualOffset] = 245;
  imageData.data[residualOffset + 1] = 245;
  imageData.data[residualOffset + 2] = 245;

  const changed = scrubLogoResidualPixels({
    imageData,
    rect: { x: 2, y: 1, width: 3, height: 2 },
  });

  assert.equal(changed, 1);
  assert.deepEqual(Array.from(imageData.data.slice(residualOffset, residualOffset + 4)), [20, 22, 24, 255]);
  const backgroundOffset = (1 * imageData.width + 2) * 4;
  assert.deepEqual(Array.from(imageData.data.slice(backgroundOffset, backgroundOffset + 4)), [20, 22, 24, 255]);
});

test('can expand the residual scrub area for single-logo edge leftovers', () => {
  const imageData = {
    width: 8,
    height: 5,
    data: new Uint8ClampedArray(8 * 5 * 4),
  };
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 42;
    imageData.data[index + 1] = 45;
    imageData.data[index + 2] = 43;
    imageData.data[index + 3] = 255;
  }
  const edgeResidualOffset = (2 * imageData.width + 5) * 4;
  imageData.data[edgeResidualOffset] = 238;
  imageData.data[edgeResidualOffset + 1] = 238;
  imageData.data[edgeResidualOffset + 2] = 238;

  const changedWithoutPadding = scrubLogoResidualPixels({
    imageData,
    rect: { x: 2, y: 1, width: 3, height: 2 },
  });

  assert.equal(changedWithoutPadding, 0);

  const changedWithPadding = scrubLogoResidualPixels({
    imageData,
    rect: { x: 2, y: 1, width: 3, height: 2 },
    paddingRatio: 0.34,
  });

  assert.equal(changedWithPadding, 1);
  assert.deepEqual(Array.from(imageData.data.slice(edgeResidualOffset, edgeResidualOffset + 4)), [42, 45, 43, 255]);
});

test('draws the exact uploaded transparent logo overlay without adding a local backing block', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const fillCalls = [];
  const clipCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            getImageData() {
              return { width: 100, height: 80, data: new Uint8ClampedArray(100 * 80 * 4).fill(255) };
            },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect(...args) { clipCalls.push({ type: 'rect', args }); },
            clip() { clipCalls.push({ type: 'clip' }); },
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-with-old-logo.png',
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'uploaded-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    assert.equal(fillCalls.length, 0);
    assert.ok(clipCalls.some((call) => call.type === 'rect' && call.args[0] === 10 && call.args[1] === 16 && call.args[2] === 30 && call.args[3] === 8));
    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-with-old-logo.png').length, 1);
    assert.ok(drawCalls.some((call) => (
      call.image.url === 'uploaded-logo.png'
      && call.args[0] === 15
      && call.args[1] === 18
      && call.args[2] === 20
      && call.args[3] === 4
    )));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('clips generated cleanup base to detected old-logo bounds without adding a local backing block', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const clipCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 120,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect(...args) { clipCalls.push({ type: 'rect', args }); },
            clip() { clipCalls.push({ type: 'clip' }); },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-base.png',
      items: [{
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
        logoOverlayUrl: 'uploaded-logo.png',
        logoOverlayRect: { xRatio: 44 / 120, yRatio: 29 / 80, widthRatio: 45 / 120, heightRatio: 11 / 80 },
        cleanupRect: { xRatio: 50 / 120, yRatio: 26 / 80, widthRatio: 32 / 120, heightRatio: 16 / 80 },
      }],
      originalWidth: 120,
      originalHeight: 80,
    });

    assert.equal(fillCalls.length, 0);
    assert.ok(clipCalls.some((call) => call.type === 'rect' && call.args[0] === 50 && call.args[1] === 26 && call.args[2] === 32 && call.args[3] === 16));
    assert.ok(!clipCalls.some((call) => call.type === 'rect' && call.args[0] === 44 && call.args[1] === 26 && call.args[2] === 45 && call.args[3] === 16));
    assert.ok(!clipCalls.some((call) => call.type === 'rect' && call.args[0] === 40 && call.args[1] === 20 && call.args[2] === 60 && call.args[3] === 30));
    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-clean-base.png').length, 1);
    assert.ok(drawCalls.some((call) => call.image.url === 'uploaded-logo.png'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('clips generated cleanup base to detected old-logo bounds when the new logo is scaled down', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const clipCalls = [];
  const drawCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 120,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect(...args) { clipCalls.push({ type: 'rect', args }); },
            clip() { clipCalls.push({ type: 'clip' }); },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
            set globalAlpha(value) { this.__globalAlpha = value; },
            get globalAlpha() { return this.__globalAlpha || 1; },
            set filter(value) { this.__filter = value; },
            get filter() { return this.__filter || 'none'; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-base.png',
      items: [{
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
        logoOverlayUrl: 'scaled-uploaded-logo.png',
        logoOverlayRect: { xRatio: 58 / 120, yRatio: 32 / 80, widthRatio: 16 / 120, heightRatio: 4 / 80 },
        cleanupRect: { xRatio: 50 / 120, yRatio: 26 / 80, widthRatio: 32 / 120, heightRatio: 16 / 80 },
      }],
      originalWidth: 120,
      originalHeight: 80,
    });

    assert.equal(fillCalls.length, 0);
    assert.ok(clipCalls.some((call) => call.type === 'rect' && call.args[0] === 50 && call.args[1] === 26 && call.args[2] === 32 && call.args[3] === 16));
    assert.ok(!clipCalls.some((call) => call.type === 'rect' && call.args[0] === 40 && call.args[1] === 20 && call.args[2] === 60 && call.args[3] === 30));
    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-clean-base.png').length, 1);
    assert.ok(drawCalls.some((call) => (
      call.image.url === 'scaled-uploaded-logo.png'
      && call.args[0] === 58
      && call.args[1] === 32
      && call.args[2] === 16
      && call.args[3] === 4
    )));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('does not paste generated product pixels when replacing with a scaled logo overlay', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 120,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            getImageData(_x, _y, width, height) {
              return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(24) };
            },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-changed-product.png',
      items: [{
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
        logoOverlayUrl: 'scaled-uploaded-logo.png',
        logoOverlayRect: { xRatio: 58 / 120, yRatio: 32 / 80, widthRatio: 16 / 120, heightRatio: 4 / 80 },
        cleanupRect: { xRatio: 50 / 120, yRatio: 26 / 80, widthRatio: 32 / 120, heightRatio: 16 / 80 },
      }],
      originalWidth: 120,
      originalHeight: 80,
    });

    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-changed-product.png').length, 1);
    assert.equal(fillCalls.length, 0);
    assert.ok(drawCalls.some((call) => (
      call.image.url === 'scaled-uploaded-logo.png'
      && call.args[0] === 58
      && call.args[1] === 32
      && call.args[2] === 16
      && call.args[3] === 4
    )));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('uses detected old-logo bounds as cleanup base without painting a logo backing block', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const clipCalls = [];
  const drawCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 120,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect(...args) { clipCalls.push({ type: 'rect', args }); },
            clip() { clipCalls.push({ type: 'clip' }); },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-cleaned-selected-region.png',
      items: [{
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
        logoOverlayUrl: 'cropped-uploaded-logo.png',
        logoOverlayRect: { xRatio: 52 / 120, yRatio: 31 / 80, widthRatio: 28 / 120, heightRatio: 7 / 80 },
        cleanupRect: { xRatio: 50 / 120, yRatio: 26 / 80, widthRatio: 32 / 120, heightRatio: 16 / 80 },
      }],
      originalWidth: 120,
      originalHeight: 80,
    });

    assert.equal(fillCalls.length, 0);
    assert.ok(clipCalls.some((call) => call.type === 'rect' && call.args[0] === 50 && call.args[1] === 26 && call.args[2] === 32 && call.args[3] === 16));
    assert.ok(!clipCalls.some((call) => call.type === 'rect' && call.args[0] === 40 && call.args[1] === 20 && call.args[2] === 60 && call.args[3] === 30));
    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-cleaned-selected-region.png').length, 1);
    assert.ok(drawCalls.some((call) => (
      call.image.url === 'cropped-uploaded-logo.png'
      && call.args[0] === 52
      && call.args[1] === 31
      && call.args[2] === 28
      && call.args[3] === 7
    )));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('does not add a local rectangular backing block when drawing an exact logo overlay', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            getImageData() {
              const width = 100;
              const height = 80;
              const data = new Uint8ClampedArray(width * height * 4);
              for (let index = 0; index < data.length; index += 4) {
                data[index] = 24;
                data[index + 1] = 26;
                data[index + 2] = 28;
                data[index + 3] = 255;
              }
              return { width, height, data };
            },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-with-rectangular-patch.png',
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'cropped-uploaded-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-with-rectangular-patch.png').length, 1);
    assert.equal(fillCalls.length, 0);
    assert.ok(drawCalls.some((call) => call.image.url === 'cropped-uploaded-logo.png'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('draws the uploaded logo exactly once without changing its appearance', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const alphaChanges = [];
  const filterChanges = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
            set globalAlpha(value) { alphaChanges.push(value); },
            get globalAlpha() { return 1; },
            set filter(value) { filterChanges.push(value); },
            get filter() { return 'none'; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-base.png',
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'uploaded-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    const uploadedLogoDraws = drawCalls.filter((call) => call.image.url === 'uploaded-logo.png');
    assert.equal(uploadedLogoDraws.length, 1);
    assert.deepEqual(uploadedLogoDraws[0].args, [15, 18, 20, 4]);
    assert.deepEqual(alphaChanges, []);
    assert.deepEqual(filterChanges, []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('can skip generated cleanup pixels so single logo overlays do not inherit a rectangular patch', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            fillRect(...args) { fillCalls.push(args); },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-dark-rectangle-patch.png',
      useGeneratedCleanupBase: false,
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'uploaded-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    assert.equal(fillCalls.length, 0);
    assert.equal(drawCalls.filter((call) => call.image.url === 'original.png').length, 1);
    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-dark-rectangle-patch.png').length, 0);
    assert.equal(drawCalls.filter((call) => call.image.url === 'uploaded-logo.png').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('can apply generated cleanup only through the old logo content mask without a rectangular patch', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const putImageDataCalls = [];
  const drawCalls = [];

  const makeImageData = (width, height, fill) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
      data[index] = fill[0];
      data[index + 1] = fill[1];
      data[index + 2] = fill[2];
      data[index + 3] = fill[3];
    }
    return { width, height, data };
  };
  const setPixel = (imageData, x, y, rgba) => {
    const offset = (y * imageData.width + x) * 4;
    imageData.data[offset] = rgba[0];
    imageData.data[offset + 1] = rgba[1];
    imageData.data[offset + 2] = rgba[2];
    imageData.data[offset + 3] = rgba[3];
  };

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      let canvasRole = '';
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) {
              canvasRole = image.url;
              drawCalls.push({ image, args });
            },
            getImageData(_x, _y, width, height) {
              const imageData = makeImageData(width, height, canvasRole === 'generated-clean-fabric.png' ? [23, 24, 25, 255] : [22, 23, 24, 255]);
              if (canvasRole !== 'generated-clean-fabric.png') {
                setPixel(imageData, 2, 1, [245, 245, 245, 255]);
                setPixel(imageData, 3, 1, [245, 245, 245, 255]);
                setPixel(imageData, 2, 2, [245, 245, 245, 255]);
                setPixel(imageData, 3, 2, [245, 245, 245, 255]);
              }
              return imageData;
            },
            putImageData(imageData, x, y) { putImageDataCalls.push({ imageData, x, y }); },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-fabric.png',
      cleanupMode: 'content_mask',
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'uploaded-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
        cleanupRect: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.08, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    assert.equal(drawCalls.filter((call) => call.image.url === 'uploaded-logo.png').length, 1);
    assert.equal(putImageDataCalls.length, 1);
    const output = putImageDataCalls[0].imageData;
    assert.deepEqual(Array.from(output.data.slice((1 * output.width + 2) * 4, (1 * output.width + 2) * 4 + 4)), [23, 24, 25, 255]);
    assert.deepEqual(Array.from(output.data.slice((0 * output.width + 0) * 4, (0 * output.width + 0) * 4 + 4)), [22, 23, 24, 255]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('can blend a white logo overlay into dark fabric with softening controls', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const alphaChanges = [];
  const filterChanges = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
            set globalAlpha(value) { alphaChanges.push(value); },
            get globalAlpha() { return 1; },
            set filter(value) { filterChanges.push(value); },
            get filter() { return 'none'; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-base.png',
      overlayBlendMode: 'fabric_blend',
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'white-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    const logoDraws = drawCalls.filter((call) => call.image.url === 'white-logo.png');
    assert.equal(logoDraws.length, 1);
    assert.ok(alphaChanges.some((value) => value > 0.8 && value < 1));
    assert.ok(filterChanges.some((value) => /brightness\(.+?\)/.test(value) && /blur\(.+?px\)/.test(value)));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('auto blend only softens logo overlays on dark selected regions', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const alphaChanges = [];
  const filterChanges = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            getImageData(_x, _y, width, height) {
              const data = new Uint8ClampedArray(width * height * 4);
              for (let index = 0; index < data.length; index += 4) {
                data[index] = _x < 20 ? 245 : 16;
                data[index + 1] = _x < 20 ? 245 : 16;
                data[index + 2] = _x < 20 ? 245 : 16;
                data[index + 3] = 255;
              }
              return { width, height, data };
            },
            save() {},
            restore() {},
            beginPath() {},
            rect() {},
            clip() {},
            set globalAlpha(value) { alphaChanges.push({ image: drawCalls.at(-1)?.image?.url || '', value }); },
            get globalAlpha() { return 1; },
            set filter(value) { filterChanges.push({ image: drawCalls.at(-1)?.image?.url || '', value }); },
            get filter() { return 'none'; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-base.png',
      overlayBlendMode: 'auto',
      items: [
        {
          region: { xRatio: 0.02, yRatio: 0.04, widthRatio: 0.12, heightRatio: 0.08 },
          logoOverlayUrl: 'blue-corner-logo.png',
          logoOverlayRect: { xRatio: 0.02, yRatio: 0.04, widthRatio: 0.12, heightRatio: 0.08 },
        },
        {
          region: { xRatio: 0.45, yRatio: 0.32, widthRatio: 0.12, heightRatio: 0.06 },
          logoOverlayUrl: 'white-fabric-logo.png',
          logoOverlayRect: { xRatio: 0.45, yRatio: 0.32, widthRatio: 0.12, heightRatio: 0.06 },
        },
      ],
      originalWidth: 100,
      originalHeight: 80,
    });

    assert.equal(drawCalls.filter((call) => call.image.url === 'blue-corner-logo.png').length, 1);
    assert.equal(drawCalls.filter((call) => call.image.url === 'white-fabric-logo.png').length, 1);
    assert.equal(alphaChanges.length, 1);
    assert.ok(alphaChanges[0].value > 0.8 && alphaChanges[0].value < 1);
    assert.equal(filterChanges.length, 1);
    assert.match(filterChanges[0].value, /brightness\(.+?\)/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('uses original product pixels with local old-logo cleanup before exact transparent logo overlay', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const drawCalls = [];
  const clipCalls = [];
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: 100,
    height: 80,
    url: blob.url,
  });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(image, ...args) { drawCalls.push({ image, args }); },
            getImageData() {
              return { width: 100, height: 80, data: new Uint8ClampedArray(100 * 80 * 4).fill(255) };
            },
            fillRect() {},
            save() {},
            restore() {},
            beginPath() {},
            rect(...args) { clipCalls.push({ type: 'rect', args }); },
            clip() { clipCalls.push({ type: 'clip' }); },
            fillRect(...args) { fillCalls.push({ fillStyle: this.__fillStyle, args }); },
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['result'], { type: 'image/png' })); },
      };
    },
  };

  try {
    await createGuardedMultiLogoReplaceResultBlob({
      originalUrl: 'original.png',
      generatedUrl: 'generated-clean-base.png',
      items: [{
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
        logoOverlayUrl: 'uploaded-logo.png',
        logoOverlayRect: { xRatio: 0.15, yRatio: 0.225, widthRatio: 0.2, heightRatio: 0.05 },
      }],
      originalWidth: 100,
      originalHeight: 80,
    });

    assert.equal(fillCalls.length, 0);
    assert.ok(clipCalls.some((call) => call.type === 'rect' && call.args[0] === 10 && call.args[1] === 16 && call.args[2] === 30 && call.args[3] === 8));
    assert.equal(drawCalls.filter((call) => call.image.url === 'generated-clean-base.png').length, 1);
    assert.ok(drawCalls.some((call) => call.image.url === 'uploaded-logo.png'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});
