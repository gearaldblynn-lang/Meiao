import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAreaMatchedLogoRect,
  computeContainedLogoRect,
  findLogoContentRectInRegion,
  normalizeLogoReplacePreviewItem,
  sampleOpaqueRingColor,
} from './logoReplacePreview.mjs';

test('fits the replacement logo inside the selected region with padding', () => {
  assert.deepEqual(computeContainedLogoRect({
    regionRect: { x: 100, y: 80, width: 200, height: 100 },
    logoWidth: 400,
    logoHeight: 100,
    paddingRatio: 0.08,
  }), {
    x: 108,
    y: 107,
    width: 184,
    height: 46,
  });
});

test('fits the replacement logo to the selected old-logo bounds without stretching by default', () => {
  assert.deepEqual(computeContainedLogoRect({
    regionRect: { x: 100, y: 80, width: 200, height: 100 },
    logoWidth: 400,
    logoHeight: 100,
  }), {
    x: 100,
    y: 105,
    width: 200,
    height: 50,
  });
});

test('keeps replacement logo within old-logo visual bounds without changing aspect ratio', () => {
  assert.deepEqual(computeAreaMatchedLogoRect({
    regionRect: { x: 100, y: 80, width: 200, height: 100 },
    logoWidth: 400,
    logoHeight: 100,
  }), {
    x: 100,
    y: 105,
    width: 200,
    height: 50,
  });
});

test('samples opaque surrounding pixels outside the selected region', () => {
  const width = 6;
  const height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(x, y, [20, 30, 40, 255]);
    }
  }
  for (let y = 2; y <= 3; y += 1) {
    for (let x = 2; x <= 3; x += 1) {
      setPixel(x, y, [250, 250, 250, 255]);
    }
  }

  assert.deepEqual(sampleOpaqueRingColor({
    imageData: { data, width, height },
    rect: { x: 2, y: 2, width: 2, height: 2 },
    ringSize: 1,
  }), [20, 30, 40]);
});

test('detects the actual old logo content inside an oversized selected region', () => {
  const width = 120;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(x, y, [22, 24, 25, 255]);
    }
  }
  for (let y = 30; y < 38; y += 1) {
    for (let x = 54; x < 78; x += 1) {
      setPixel(x, y, [245, 245, 245, 255]);
    }
  }

  assert.deepEqual(findLogoContentRectInRegion({
    imageData: { data, width, height },
    regionRect: { x: 40, y: 20, width: 60, height: 30 },
  }), {
    x: 50,
    y: 26,
    width: 32,
    height: 16,
  });
});

test('normalizes one logo replacement preview item', () => {
  const item = normalizeLogoReplacePreviewItem({
    region: { regionIndex: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.1, heightRatio: 0.1 },
    logoUrl: 'logo-a.png',
  });

  assert.deepEqual({
    regionIndex: item.region.regionIndex,
    logoUrl: item.logoUrl,
  }, { regionIndex: 1, logoUrl: 'logo-a.png' });
});

test('rejects a single preview item without a bound logo', () => {
  const item = normalizeLogoReplacePreviewItem({
    region: { regionIndex: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.1, heightRatio: 0.1 },
    logoUrl: '',
  });

  assert.equal(item, null);
});

test('multi logo preview covers a selected region without drawing the new logo', async () => {
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
    width: blob.url === 'logo.png' ? 40 : 100,
    height: blob.url === 'logo.png' ? 10 : 80,
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
            fillRect(...args) { fillCalls.push(args); },
            save() {},
            restore() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
            set globalAlpha(value) { this.__globalAlpha = value; },
            get globalAlpha() { return this.__globalAlpha; },
          };
        },
        toBlob(callback) { callback(new Blob(['preview'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const { createMultiLogoReplacePreviewBlob } = await import(`./logoReplacePreview.mjs?no-overlay=${Date.now()}`);
    const preview = await createMultiLogoReplacePreviewBlob({
      referenceUrl: 'reference.png',
      items: [{
        logoUrl: 'logo.png',
        region: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
      }],
      referenceWidth: 100,
      referenceHeight: 80,
    });

    assert.ok(fillCalls.length > 0);
    assert.deepEqual(
      drawCalls.map((call) => call.image.url),
      ['reference.png'],
    );
    assert.deepEqual(preview.logoRects[0], {
      x: 10,
      y: 16,
      width: 30,
      height: 8,
      xRatio: 0.1,
      yRatio: 0.2,
      widthRatio: 0.3,
      heightRatio: 0.1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('multi logo preview sizes and positions the new logo from detected old-logo content', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: blob.url === 'logo.png' ? 40 : 120,
    height: blob.url === 'logo.png' ? 10 : 80,
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
            drawImage() {},
            getImageData() {
              const width = 120;
              const height = 80;
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 22;
                data[i + 1] = 24;
                data[i + 2] = 25;
                data[i + 3] = 255;
              }
              for (let y = 30; y < 38; y += 1) {
                for (let x = 54; x < 78; x += 1) {
                  const offset = (y * width + x) * 4;
                  data[offset] = 245;
                  data[offset + 1] = 245;
                  data[offset + 2] = 245;
                  data[offset + 3] = 255;
                }
              }
              return { width, height, data };
            },
            fillRect(...args) { fillCalls.push(args); },
            save() {},
            restore() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['preview'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const { createMultiLogoReplacePreviewBlob } = await import(`./logoReplacePreview.mjs?content-bounds=${Date.now()}`);
    const preview = await createMultiLogoReplacePreviewBlob({
      referenceUrl: 'reference.png',
      items: [{
        logoUrl: 'logo.png',
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
      }],
      referenceWidth: 120,
      referenceHeight: 80,
    });

    assert.deepEqual(fillCalls.at(-1), [50, 26, 32, 16]);
    assert.deepEqual(preview.cleanupRects[0], {
      x: 50,
      y: 26,
      width: 32,
      height: 16,
      xRatio: 50 / 120,
      yRatio: 26 / 80,
      widthRatio: 32 / 120,
      heightRatio: 16 / 80,
    });
    assert.deepEqual(preview.logoRects[0], {
      x: 50,
      y: 30,
      width: 32,
      height: 8,
      xRatio: 50 / 120,
      yRatio: 30 / 80,
      widthRatio: 32 / 120,
      heightRatio: 8 / 80,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('sizes the replacement logo from the detected old-logo content bounds', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: blob.url === 'logo.png' ? 40 : 120,
    height: blob.url === 'logo.png' ? 10 : 80,
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
            drawImage() {},
            getImageData() {
              const width = 120;
              const height = 80;
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 22;
                data[i + 1] = 24;
                data[i + 2] = 25;
                data[i + 3] = 255;
              }
              for (let y = 30; y < 38; y += 1) {
                for (let x = 54; x < 78; x += 1) {
                  const offset = (y * width + x) * 4;
                  data[offset] = 245;
                  data[offset + 1] = 245;
                  data[offset + 2] = 245;
                  data[offset + 3] = 255;
                }
              }
              return { width, height, data };
            },
            fillRect() {},
            save() {},
            restore() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['preview'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const { createMultiLogoReplacePreviewBlob } = await import(`./logoReplacePreview.mjs?half-size=${Date.now()}`);
    const preview = await createMultiLogoReplacePreviewBlob({
      referenceUrl: 'reference.png',
      items: [{
        logoUrl: 'logo.png',
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
      }],
      referenceWidth: 120,
      referenceHeight: 80,
    });

    assert.deepEqual(preview.logoRects[0], {
      x: 50,
      y: 30,
      width: 32,
      height: 8,
      xRatio: 50 / 120,
      yRatio: 30 / 80,
      widthRatio: 32 / 120,
      heightRatio: 8 / 80,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('can create a location-only preview without painting a cleanup color block', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const fillCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: blob.url === 'logo.png' ? 40 : 120,
    height: blob.url === 'logo.png' ? 10 : 80,
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
            drawImage() {},
            getImageData() {
              const width = 120;
              const height = 80;
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 82;
                data[i + 1] = 84;
                data[i + 2] = 86;
                data[i + 3] = 255;
              }
              for (let y = 30; y < 38; y += 1) {
                for (let x = 54; x < 78; x += 1) {
                  const offset = (y * width + x) * 4;
                  data[offset] = 245;
                  data[offset + 1] = 245;
                  data[offset + 2] = 245;
                  data[offset + 3] = 255;
                }
              }
              return { width, height, data };
            },
            fillRect(...args) { fillCalls.push(args); },
            save() {},
            restore() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
          };
        },
        toBlob(callback) { callback(new Blob(['preview'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const { createMultiLogoReplacePreviewBlob } = await import(`./logoReplacePreview.mjs?location-only=${Date.now()}`);
    const preview = await createMultiLogoReplacePreviewBlob({
      referenceUrl: 'reference.png',
      items: [{
        logoUrl: 'logo.png',
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
      }],
      referenceWidth: 120,
      referenceHeight: 80,
      drawCleanupFill: false,
    });

    assert.deepEqual(fillCalls, []);
    assert.deepEqual(preview.cleanupRects[0], {
      x: 50,
      y: 26,
      width: 32,
      height: 16,
      xRatio: 50 / 120,
      yRatio: 26 / 80,
      widthRatio: 32 / 120,
      heightRatio: 16 / 80,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('can use the selected box as replacement bounds while cleanup stays on detected old-logo content', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const fillCalls = [];
  const strokeCalls = [];

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: blob.url === 'logo.png' ? 80 : 120,
    height: blob.url === 'logo.png' ? 40 : 80,
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
            drawImage() {},
            getImageData() {
              const width = 120;
              const height = 80;
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 22;
                data[i + 1] = 24;
                data[i + 2] = 25;
                data[i + 3] = 255;
              }
              for (let y = 30; y < 38; y += 1) {
                for (let x = 54; x < 78; x += 1) {
                  const offset = (y * width + x) * 4;
                  data[offset] = 245;
                  data[offset + 1] = 245;
                  data[offset + 2] = 245;
                  data[offset + 3] = 255;
                }
              }
              return { width, height, data };
            },
            fillRect(...args) { fillCalls.push(args); },
            strokeRect(...args) { strokeCalls.push(args); },
            save() {},
            restore() {},
            setLineDash() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
            set strokeStyle(value) { this.__strokeStyle = value; },
            get strokeStyle() { return this.__strokeStyle; },
            set lineWidth(value) { this.__lineWidth = value; },
            get lineWidth() { return this.__lineWidth; },
          };
        },
        toBlob(callback) { callback(new Blob(['preview'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const { createMultiLogoReplacePreviewBlob } = await import(`./logoReplacePreview.mjs?selected-box=${Date.now()}`);
    const preview = await createMultiLogoReplacePreviewBlob({
      referenceUrl: 'reference.png',
      items: [{
        logoUrl: 'logo.png',
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
      }],
      referenceWidth: 120,
      referenceHeight: 80,
      useSelectedRegionAsLogoBounds: true,
      drawCleanupFill: false,
    });

    assert.deepEqual(fillCalls, []);
    assert.ok(strokeCalls.some((args) => args[0] === 40 && args[1] === 20 && args[2] === 60 && args[3] === 30));
    assert.deepEqual(preview.cleanupRects[0], {
      x: 50,
      y: 26,
      width: 32,
      height: 16,
      xRatio: 50 / 120,
      yRatio: 26 / 80,
      widthRatio: 32 / 120,
      heightRatio: 16 / 80,
    });
    assert.deepEqual(preview.logoRects[0], {
      x: 40,
      y: 20,
      width: 60,
      height: 30,
      xRatio: 40 / 120,
      yRatio: 20 / 80,
      widthRatio: 60 / 120,
      heightRatio: 30 / 80,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});

test('can use the selected box as both cleanup and replacement bounds', async () => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;

  globalThis.fetch = async (url) => ({
    ok: true,
    blob: async () => ({ url }),
  });
  globalThis.createImageBitmap = async (blob) => ({
    width: blob.url === 'logo.png' ? 80 : 120,
    height: blob.url === 'logo.png' ? 40 : 80,
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
            drawImage() {},
            getImageData() {
              const width = 120;
              const height = 80;
              const data = new Uint8ClampedArray(width * height * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 22;
                data[i + 1] = 24;
                data[i + 2] = 25;
                data[i + 3] = 255;
              }
              for (let y = 30; y < 38; y += 1) {
                for (let x = 54; x < 78; x += 1) {
                  const offset = (y * width + x) * 4;
                  data[offset] = 245;
                  data[offset + 1] = 245;
                  data[offset + 2] = 245;
                  data[offset + 3] = 255;
                }
              }
              return { width, height, data };
            },
            fillRect() {},
            strokeRect() {},
            save() {},
            restore() {},
            setLineDash() {},
            set fillStyle(value) { this.__fillStyle = value; },
            get fillStyle() { return this.__fillStyle; },
            set strokeStyle(value) { this.__strokeStyle = value; },
            get strokeStyle() { return this.__strokeStyle; },
            set lineWidth(value) { this.__lineWidth = value; },
            get lineWidth() { return this.__lineWidth; },
          };
        },
        toBlob(callback) { callback(new Blob(['preview'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const { createMultiLogoReplacePreviewBlob } = await import(`./logoReplacePreview.mjs?selected-cleanup=${Date.now()}`);
    const preview = await createMultiLogoReplacePreviewBlob({
      referenceUrl: 'reference.png',
      items: [{
        logoUrl: 'logo.png',
        region: { xRatio: 40 / 120, yRatio: 20 / 80, widthRatio: 60 / 120, heightRatio: 30 / 80 },
      }],
      referenceWidth: 120,
      referenceHeight: 80,
      useSelectedRegionAsLogoBounds: true,
      useSelectedRegionAsCleanupBounds: true,
      drawCleanupFill: false,
    });

    assert.deepEqual(preview.cleanupRects[0], {
      x: 40,
      y: 20,
      width: 60,
      height: 30,
      xRatio: 40 / 120,
      yRatio: 20 / 80,
      widthRatio: 60 / 120,
      heightRatio: 30 / 80,
    });
    assert.deepEqual(preview.logoRects[0], {
      x: 40,
      y: 20,
      width: 60,
      height: 30,
      xRatio: 40 / 120,
      yRatio: 20 / 80,
      widthRatio: 60 / 120,
      heightRatio: 30 / 80,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});
