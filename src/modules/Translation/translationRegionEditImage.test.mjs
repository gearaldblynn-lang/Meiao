import test from 'node:test';
import assert from 'node:assert/strict';

import * as translationRegionEditImage from './translationRegionEditImage.mjs';

const {
  compositeTranslationRegionEdit,
  createTranslationRegionGuide,
} = translationRegionEditImage;

const pixel = (...rgba) => rgba;

const solidPixels = (width, height, rgba) => new Uint8ClampedArray(
  Array.from({ length: width * height }, () => rgba).flat(),
);

const paintRect = (pixels, imageWidth, rect, rgba) => {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * imageWidth + x) * 4;
      pixels.set(rgba, offset);
    }
  }
  return pixels;
};

const createImage = (width, height, pixels = solidPixels(width, height, pixel(0, 0, 0, 255))) => ({
  naturalWidth: width,
  naturalHeight: height,
  pixels,
  close() {},
});

const createCanvasEnvironment = ({ contextAvailable = true, exportBlob = true } = {}) => {
  const canvases = [];

  const createCanvas = () => {
    const calls = {
      drawImage: [],
      fillRect: [],
      strokeRect: [],
      fillText: [],
    };
    let pixels = new Uint8ClampedArray();
    const canvas = {
      width: 0,
      height: 0,
      calls,
      getContext(type) {
        assert.equal(type, '2d');
        if (!contextAvailable) return null;
        const ensurePixels = () => {
          const length = canvas.width * canvas.height * 4;
          if (pixels.length !== length) pixels = new Uint8ClampedArray(length);
        };
        let fillStyle;
        let strokeStyle;
        return {
          drawImage(image, ...args) {
            calls.drawImage.push([image, ...args]);
            ensurePixels();
            const sourcePixels = image.pixels || image.__getPixels?.();
            if (sourcePixels && image.naturalWidth === canvas.width && image.naturalHeight === canvas.height) {
              pixels.set(sourcePixels);
            }
          },
          getImageData() {
            ensurePixels();
            return { data: new Uint8ClampedArray(pixels), width: canvas.width, height: canvas.height };
          },
          putImageData(imageData) {
            ensurePixels();
            pixels.set(imageData.data);
          },
          fillRect(...args) { calls.fillRect.push({ args, fillStyle }); },
          strokeRect(...args) { calls.strokeRect.push({ args, strokeStyle }); },
          fillText(...args) { calls.fillText.push({ args, fillStyle }); },
          save() {},
          restore() {},
          setLineDash() {},
          set fillStyle(value) { fillStyle = value; },
          set strokeStyle(value) { strokeStyle = value; },
          set lineWidth(value) {},
          set font(value) {},
          set textAlign(value) {},
          set textBaseline(value) {},
        };
      },
      toBlob(callback, type) {
        assert.equal(type, 'image/png');
        callback(exportBlob ? new Blob(['png'], { type: 'image/png' }) : null);
      },
      __getPixels() {
        return new Uint8ClampedArray(pixels);
      },
    };
    canvases.push(canvas);
    return canvas;
  };

  return {
    canvases,
    install() {
      const originalDocument = globalThis.document;
      globalThis.document = {
        createElement(tag) {
          assert.equal(tag, 'canvas');
          return createCanvas();
        },
      };
      return () => { globalThis.document = originalDocument; };
    },
  };
};

const region = (overrides = {}) => ({
  id: 'region-1',
  xRatio: 0.1,
  yRatio: 0.2,
  widthRatio: 0.3,
  heightRatio: 0.4,
  instruction: 'Change this area',
  ...overrides,
});

test('region guide draws the natural-size image, indexed colors, and labels 1/2 as PNG', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const image = createImage(100, 80);

  try {
    const result = await createTranslationRegionGuide({
      imageUrl: 'source.png',
      regions: [region(), region({ id: 'region-2', xRatio: 0.5, yRatio: 0.1 })],
      loadImage: async (url) => {
        assert.equal(url, 'source.png');
        return image;
      },
    });

    const canvas = env.canvases[0];
    assert.ok(result.blob instanceof Blob);
    assert.equal(result.blob.type, 'image/png');
    assert.deepEqual({ width: result.width, height: result.height }, { width: 100, height: 80 });
    assert.deepEqual(canvas.calls.drawImage[0], [image, 0, 0, 100, 80]);
    assert.deepEqual(canvas.calls.strokeRect.map((call) => call.strokeStyle), ['#2563eb', '#d97706']);
    assert.deepEqual(canvas.calls.fillRect.map((call) => call.fillStyle), ['#2563eb', '#d97706']);
    assert.deepEqual(canvas.calls.fillText.map((call) => call.args[0]), ['1', '2']);
    assert.deepEqual(canvas.calls.fillText.map((call) => call.fillStyle), ['#ffffff', '#ffffff']);
  } finally {
    restore();
  }
});

test('region guide converts normalized coordinates to exact image pixels', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();

  try {
    await createTranslationRegionGuide({
      imageUrl: 'source.png',
      regions: [region({ xRatio: 0.125, yRatio: 0.25, widthRatio: 0.375, heightRatio: 0.5 })],
      loadImage: async () => createImage(80, 40),
    });

    assert.deepEqual(env.canvases[0].calls.strokeRect[0].args, [10, 10, 30, 20]);
  } finally {
    restore();
  }
});

test('region guide keeps deletion content visible and only draws its border and number badge', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();

  try {
    await createTranslationRegionGuide({
      imageUrl: 'source.png',
      regions: [
        region({
          xRatio: 0.25,
          yRatio: 0.25,
          widthRatio: 0.5,
          heightRatio: 0.25,
          instruction: '删除框内文案',
        }),
      ],
      loadImage: async () => createImage(200, 100),
    });

    const canvas = env.canvases[0];
    assert.equal(canvas.calls.fillRect.length, 1, 'only the number badge should be filled');
    assert.deepEqual(canvas.calls.strokeRect[0].args, [50, 25, 100, 25]);
    assert.equal(canvas.calls.fillRect[0].fillStyle, '#2563eb');
  } finally {
    restore();
  }
});

test('region guide does not apply an erase fill to combined replacement instructions', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();

  try {
    await createTranslationRegionGuide({
      imageUrl: 'source.png',
      regions: [
        region({
          xRatio: 0.25,
          yRatio: 0.25,
          widthRatio: 0.5,
          heightRatio: 0.25,
          instruction: '删除旧文案并替换为“NEW COPY”',
        }),
      ],
      loadImage: async () => createImage(200, 100),
    });

    const canvas = env.canvases[0];
    assert.equal(canvas.calls.fillRect.length, 1, 'only the number badge should be filled');
    assert.equal(canvas.calls.fillRect[0].fillStyle, '#2563eb');
  } finally {
    restore();
  }
});

test('region guide renders on the requested fixed target canvas', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();

  try {
    const guide = await createTranslationRegionGuide({
      imageUrl: 'source.png',
      targetWidth: 1200,
      targetHeight: 1600,
      regions: [region()],
      loadImage: async () => createImage(600, 800),
    });

    assert.deepEqual({ width: guide.width, height: guide.height }, { width: 1200, height: 1600 });
    assert.deepEqual(env.canvases[0].calls.drawImage[0].slice(1), [0, 0, 1200, 1600]);
    assert.deepEqual(env.canvases[0].calls.strokeRect[0].args, [120, 320, 360, 640]);
  } finally {
    restore();
  }
});

test('protected composite forwards its lifecycle signal and stops after scope cancellation', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const controller = new AbortController();
  const loadCalls = [];

  try {
    await assert.rejects(compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region()],
      signal: controller.signal,
      loadImage: async (url, signal) => {
        loadCalls.push({ url, signal });
        if (url === 'source.png') controller.abort('account scope changed');
        return createImage(4, 4);
      },
    }), (error) => error?.name === 'AbortError');

    assert.deepEqual(loadCalls, [{ url: 'source.png', signal: controller.signal }]);
  } finally {
    restore();
  }
});

test('protected composite renders on the requested fixed target canvas', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();

  try {
    const output = await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      targetWidth: 1200,
      targetHeight: 1600,
      regions: [region()],
      loadImage: async (url) => url === 'source.png'
        ? createImage(600, 800)
        : createImage(1024, 1024),
    });

    assert.deepEqual({ width: output.width, height: output.height }, { width: 1200, height: 1600 });
    assert.deepEqual(env.canvases[0].calls.drawImage[0].slice(1), [0, 0, 1200, 1600]);
    assert.deepEqual(env.canvases[1].calls.drawImage[0].slice(1), [0, 0, 1200, 1600]);
    assert.equal(translationRegionEditImage.__getTranslationRegionEditMaskStatsForTest().canvasPixels, 1200 * 1600);
  } finally {
    restore();
  }
});

test('hard composite changes only the middle 2x2 and preserves all 12 outside pixels exactly', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourceColor = pixel(10, 20, 30, 255);
  const generatedColor = pixel(200, 150, 100, 255);
  const source = createImage(4, 4, solidPixels(4, 4, sourceColor));
  const generated = createImage(4, 4, solidPixels(4, 4, generatedColor));

  try {
    const result = await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({ xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.5 })],
      featherRatio: 0,
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    assert.deepEqual({ width: result.width, height: result.height }, { width: 4, height: 4 });
    const output = env.canvases[0].__getPixels();
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const offset = (y * 4 + x) * 4;
        const actual = Array.from(output.slice(offset, offset + 4));
        const inside = x >= 1 && x < 3 && y >= 1 && y < 3;
        assert.deepEqual(actual, inside ? generatedColor : sourceColor, `pixel ${x},${y}`);
      }
    }
    assert.deepEqual(env.canvases[0].calls.drawImage[0], [source, 0, 0, 4, 4]);
  } finally {
    restore();
  }
});

test('delete-region composite rejects unchanged generated pixels instead of saving a no-op result', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const source = createImage(4, 4, solidPixels(4, 4, pixel(30, 40, 50, 255)));
  const generated = createImage(4, 4, solidPixels(4, 4, pixel(30, 40, 50, 255)));

  try {
    await assert.rejects(
      compositeTranslationRegionEdit({
        sourceUrl: 'source.png',
        generatedUrl: 'generated.png',
        regions: [region({
          xRatio: 0.25,
          yRatio: 0.25,
          widthRatio: 0.5,
          heightRatio: 0.5,
          instruction: '删除区域内的内容',
        })],
        featherRatio: 0,
        loadImage: async (url) => url === 'source.png' ? source : generated,
      }),
      /删除类区域.*未产生明显变化/,
    );
  } finally {
    restore();
  }
});

test('delete-region composite accepts tiny but real changes instead of failing small edits', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourceColor = pixel(30, 40, 50, 255);
  const generatedPixels = solidPixels(100, 100, sourceColor);
  paintRect(generatedPixels, 100, { x: 50, y: 50, width: 1, height: 1 }, pixel(220, 180, 120, 255));
  const source = createImage(100, 100, solidPixels(100, 100, sourceColor));
  const generated = createImage(100, 100, generatedPixels);

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({
        xRatio: 0.1,
        yRatio: 0.1,
        widthRatio: 0.8,
        heightRatio: 0.8,
        instruction: '删除区域内的一小处残留内容',
      })],
      featherRatio: 0,
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    const output = env.canvases[0].__getPixels();
    const changedOffset = (50 * 100 + 50) * 4;
    assert.deepEqual(
      Array.from(output.slice(changedOffset, changedOffset + 4)),
      [220, 180, 120, 255],
      'a tiny valid edit must still be composited and saved',
    );
  } finally {
    restore();
  }
});

test('text replacement composites model-generated text without drawing front-end copy', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const source = createImage(100, 60, solidPixels(100, 60, pixel(30, 40, 50, 255)));
  const generated = createImage(100, 60, solidPixels(100, 60, pixel(240, 230, 220, 255)));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({
        xRatio: 0.1,
        yRatio: 0.1,
        widthRatio: 0.8,
        heightRatio: 0.4,
        instruction: '文案改为“순수한 블랙페퍼”，变成两行，颜色改为红色',
      })],
      featherRatio: 0,
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    assert.equal(env.canvases[0].calls.fillText.length, 0);
    assert.deepEqual(
      Array.from(env.canvases[0].__getPixels().slice((10 * 100 + 10) * 4, (10 * 100 + 10) * 4 + 4)),
      [240, 230, 220, 255],
    );
  } finally {
    restore();
  }
});

test('text replacement leaves model-rendered text acceptance to the generated result', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourcePixels = solidPixels(40, 20, pixel(246, 238, 228, 255));
  const generatedPixels = solidPixels(40, 20, pixel(232, 226, 218, 255));
  paintRect(sourcePixels, 40, { x: 6, y: 8, width: 28, height: 4 }, pixel(15, 18, 24, 255));
  paintRect(generatedPixels, 40, { x: 6, y: 8, width: 28, height: 4 }, pixel(18, 20, 25, 255));
  const source = createImage(40, 20, sourcePixels);
  const generated = createImage(40, 20, generatedPixels);

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({
        xRatio: 0.1,
        yRatio: 0.2,
        widthRatio: 0.8,
        heightRatio: 0.6,
        instruction: '文案改为“보기 좋은 모양”',
      })],
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    assert.equal(env.canvases[0].calls.fillText.length, 0);
  } finally {
    restore();
  }
});

test('text replacement accepts model-generated dark copy inside the selected region', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourcePixels = solidPixels(40, 20, pixel(246, 238, 228, 255));
  const generatedPixels = solidPixels(40, 20, pixel(232, 226, 218, 255));
  paintRect(generatedPixels, 40, { x: 6, y: 8, width: 28, height: 4 }, pixel(18, 20, 25, 255));
  const source = createImage(40, 20, sourcePixels);
  const generated = createImage(40, 20, generatedPixels);

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({
        xRatio: 0.1,
        yRatio: 0.2,
        widthRatio: 0.8,
        heightRatio: 0.6,
        instruction: '文案改为“보기 좋은 모양”',
      })],
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    assert.equal(env.canvases[0].calls.fillText.length, 0);
  } finally {
    restore();
  }
});

test('text replacement composites cleanup with a hard mask to avoid old glyph edge blending', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourceColor = pixel(20, 40, 60, 255);
  const generatedColor = pixel(220, 140, 100, 255);
  const source = createImage(40, 40, solidPixels(40, 40, sourceColor));
  const generated = createImage(40, 40, solidPixels(40, 40, generatedColor));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({
        xRatio: 0.2,
        yRatio: 0.2,
        widthRatio: 0.625,
        heightRatio: 0.625,
        instruction: '文案改为“보기 좋은 모양”',
      })],
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    const output = env.canvases[0].__getPixels();
    const colorAt = (x, y) => Array.from(output.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
    assert.deepEqual(colorAt(8, 20), generatedColor, 'text cleanup must not feather old glyph edge pixels back in');
  } finally {
    restore();
  }
});

test('erase content stays inside the selected region, uses a hard mask, and draws no front-end text', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourceColor = pixel(20, 40, 60, 255);
  const generatedColor = pixel(220, 140, 100, 255);
  const source = createImage(40, 40, solidPixels(40, 40, sourceColor));
  const generated = createImage(40, 40, solidPixels(40, 40, generatedColor));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({
        xRatio: 0.2,
        yRatio: 0.2,
        widthRatio: 0.625,
        heightRatio: 0.625,
        instruction: '清除此区域的文案内容和图标',
      })],
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    const output = env.canvases[0].__getPixels();
    const colorAt = (x, y) => Array.from(output.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
    assert.deepEqual(colorAt(7, 20), sourceColor, 'pixels immediately outside the selected region stay source-exact');
    assert.deepEqual(colorAt(8, 20), generatedColor, 'erase cleanup must not feather old edge pixels back in');
    assert.deepEqual(colorAt(32, 20), generatedColor, 'the final selected pixel uses generated cleanup');
    assert.deepEqual(colorAt(33, 20), sourceColor, 'the selected region must not expand past its right edge');

    for (let y = 8; y < 33; y += 1) {
      for (let x = 8; x < 33; x += 1) {
        assert.deepEqual(colorAt(x, y), generatedColor, `erase region pixel ${x},${y} must not receive front-end text`);
      }
    }
  } finally {
    restore();
  }
});

test('target canvas dimensions must be supplied together and be positive finite numbers', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();

  try {
    await assert.rejects(
      createTranslationRegionGuide({
        imageUrl: 'source.png',
        targetWidth: 1200,
        regions: [region()],
        loadImage: async () => createImage(600, 800),
      }),
      /target.*dimensions/i,
    );
    await assert.rejects(
      compositeTranslationRegionEdit({
        sourceUrl: 'source.png',
        generatedUrl: 'generated.png',
        targetHeight: 1600,
        regions: [region()],
        loadImage: async () => createImage(600, 800),
      }),
      /target.*dimensions/i,
    );
    await assert.rejects(
      createTranslationRegionGuide({
        imageUrl: 'source.png',
        targetWidth: 0.5,
        targetHeight: 1600,
        regions: [region()],
        loadImage: async () => createImage(600, 800),
      }),
      /target.*dimensions/i,
    );
    await assert.rejects(
      compositeTranslationRegionEdit({
        sourceUrl: 'source.png',
        generatedUrl: 'generated.png',
        targetWidth: 0,
        targetHeight: 1600,
        regions: [region()],
        loadImage: async () => createImage(600, 800),
      }),
      /target.*dimensions/i,
    );
  } finally {
    restore();
  }
});

test('composite uses the union of multiple regions', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const source = createImage(4, 4, solidPixels(4, 4, pixel(0, 0, 0, 255)));
  const generated = createImage(4, 4, solidPixels(4, 4, pixel(255, 255, 255, 255)));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [
        region({ xRatio: 0, yRatio: 0, widthRatio: 0.25, heightRatio: 0.25 }),
        region({ id: 'region-2', xRatio: 0.75, yRatio: 0.75, widthRatio: 0.25, heightRatio: 0.25 }),
      ],
      featherRatio: 0,
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    const output = env.canvases[0].__getPixels();
    const redAt = (x, y) => output[(y * 4 + x) * 4];
    assert.equal(redAt(0, 0), 255);
    assert.equal(redAt(3, 3), 255);
    assert.equal(redAt(1, 1), 0);
    assert.equal(redAt(2, 2), 0);
  } finally {
    restore();
  }
});

test('large canvases allocate and scan feather masks only inside tight disconnected component bounds', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const width = 1000;
  const height = 800;
  const source = createImage(width, height, solidPixels(width, height, pixel(0, 0, 0, 255)));
  const generated = createImage(width, height, solidPixels(width, height, pixel(255, 255, 255, 255)));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [
        region({ xRatio: 0.1, yRatio: 0.1, widthRatio: 0.02, heightRatio: 0.025 }),
        region({ id: 'region-2', xRatio: 0.8, yRatio: 0.7, widthRatio: 0.02, heightRatio: 0.025 }),
      ],
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    const output = env.canvases[0].__getPixels();
    const colorAt = (x, y) => Array.from(output.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    assert.deepEqual(colorAt(110, 90), [255, 255, 255, 255], 'first disconnected region center is generated');
    assert.deepEqual(colorAt(810, 570), [255, 255, 255, 255], 'second disconnected region center is generated');
    assert.deepEqual(colorAt(500, 400), [0, 0, 0, 255], 'pixels between disconnected regions stay source-exact');

    assert.equal(typeof translationRegionEditImage.__getTranslationRegionEditMaskStatsForTest, 'function');
    const stats = translationRegionEditImage.__getTranslationRegionEditMaskStatsForTest();
    assert.equal(stats.canvasPixels, width * height);
    assert.equal(stats.totalBufferPixels, 1352, 'two 26x26 local masks replace one 1000x800 mask');
    assert.equal(stats.totalBufferBytes, 12168, 'local union, feather-width, and distance arrays total 9 bytes per local pixel');
    assert.equal(stats.totalScannedPixels, 1352);
    assert.ok(stats.totalBufferPixels < stats.canvasPixels * 0.01, 'mask buffers must stay below 1% of the full canvas');
    assert.ok(stats.totalScannedPixels < stats.canvasPixels * 0.01, 'mask scans must stay below 1% of the full canvas');
    assert.equal(stats.componentCount, 2, 'disconnected regions must be processed independently');
    assert.ok(stats.components.every((component) => component.width <= 30 && component.height <= 30));
  } finally {
    restore();
  }
});

test('default feathering preserves outside pixels, blends inner edges, and keeps the center generated', async () => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourceColor = pixel(20, 40, 60, 255);
  const generatedColor = pixel(220, 140, 100, 255);
  const source = createImage(40, 40, solidPixels(40, 40, sourceColor));
  const generated = createImage(40, 40, solidPixels(40, 40, generatedColor));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions: [region({ xRatio: 0.2, yRatio: 0.2, widthRatio: 0.625, heightRatio: 0.625 })],
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });

    const output = env.canvases[0].__getPixels();
    const colorAt = (x, y) => Array.from(output.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        if (x >= 8 && x < 33 && y >= 8 && y < 33) continue;
        const offset = (y * 40 + x) * 4;
        assert.deepEqual(Array.from(output.slice(offset, offset + 4)), sourceColor, `outside pixel ${x},${y}`);
      }
    }
    assert.deepEqual(colorAt(8, 20), [70, 65, 70, 255], 'the first pixel center inside the left edge is feathered');
    assert.notDeepEqual(colorAt(8, 20), sourceColor);
    assert.notDeepEqual(colorAt(8, 20), generatedColor);
    assert.deepEqual(colorAt(20, 20), generatedColor, 'the region center uses the generated image');
  } finally {
    restore();
  }
});

const runUnionFeatherCase = async (regions) => {
  const env = createCanvasEnvironment();
  const restore = env.install();
  const sourceColor = pixel(20, 40, 60, 255);
  const generatedColor = pixel(220, 140, 100, 255);
  const source = createImage(60, 40, solidPixels(60, 40, sourceColor));
  const generated = createImage(60, 40, solidPixels(60, 40, generatedColor));

  try {
    await compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'generated.png',
      regions,
      loadImage: async (url) => url === 'source.png' ? source : generated,
    });
    const output = env.canvases[0].__getPixels();
    return {
      sourceColor,
      generatedColor,
      colorAt: (x, y) => Array.from(output.slice((y * 60 + x) * 4, (y * 60 + x) * 4 + 4)),
    };
  } finally {
    restore();
  }
};

test('default feather treats touching rectangles as one union without a common-boundary seam', async () => {
  const result = await runUnionFeatherCase([
    region({ xRatio: 10 / 60, yRatio: 0.2, widthRatio: 20 / 60, heightRatio: 0.6 }),
    region({ id: 'region-2', xRatio: 30 / 60, yRatio: 0.2, widthRatio: 20 / 60, heightRatio: 0.6 }),
  ]);

  assert.deepEqual(result.colorAt(9, 20), result.sourceColor, 'outside the union stays source-exact');
  assert.notDeepEqual(result.colorAt(10, 20), result.sourceColor, 'the union outer edge is feathered inward');
  assert.notDeepEqual(result.colorAt(10, 20), result.generatedColor, 'the union outer edge remains a blend');
  assert.deepEqual(result.colorAt(29, 20), result.generatedColor, 'left pixel at the shared edge is generated');
  assert.deepEqual(result.colorAt(30, 20), result.generatedColor, 'right pixel at the shared edge is generated');
});

test('default feather treats overlapping rectangles as one union without an overlap seam', async () => {
  const result = await runUnionFeatherCase([
    region({ xRatio: 10 / 60, yRatio: 0.2, widthRatio: 22 / 60, heightRatio: 0.6 }),
    region({ id: 'region-2', xRatio: 30 / 60, yRatio: 0.2, widthRatio: 20 / 60, heightRatio: 0.6 }),
  ]);

  assert.deepEqual(result.colorAt(9, 20), result.sourceColor, 'outside the overlapping union stays source-exact');
  assert.deepEqual(result.colorAt(30, 20), result.generatedColor, 'first overlap pixel is generated');
  assert.deepEqual(result.colorAt(31, 20), result.generatedColor, 'second overlap pixel is generated');
});

test('default loader retries a blocked cross-origin download through the authenticated asset proxy', async () => {
  const env = createCanvasEnvironment();
  const restoreCanvas = env.install();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const requests = [];
  const sourceUrl = 'https://cdn.example.invalid/source.png';

  globalThis.window = {
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    localStorage: { getItem: (key) => key === 'MEIAO_INTERNAL_SESSION_TOKEN' ? 'session-token' : '' },
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url) === sourceUrl) throw new TypeError('CORS blocked');
    if (String(url).startsWith('/api/assets/download-proxy?url=')) {
      return { ok: true, blob: async () => new Blob(['proxy-image'], { type: 'image/png' }) };
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  globalThis.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });

  try {
    await createTranslationRegionGuide({ imageUrl: sourceUrl, regions: [region()] });

    assert.deepEqual(requests.map(({ url }) => url), [
      sourceUrl,
      `/api/assets/download-proxy?url=${encodeURIComponent(sourceUrl)}`,
    ]);
    assert.equal(requests[0].options.cache, 'no-cache');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[1].options.credentials, 'include');
    assert.equal(requests[0].options.headers, undefined, 'cross-origin direct fetch must not receive the internal token');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer session-token');
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    restoreCanvas();
  }
});

test('default loader sends the session token on a same-origin direct download', async () => {
  const env = createCanvasEnvironment();
  const restoreCanvas = env.install();
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const requests = [];

  globalThis.window = {
    location: { href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
    localStorage: { getItem: (key) => key === 'MEIAO_INTERNAL_SESSION_TOKEN' ? 'session-token' : '' },
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return { ok: true, blob: async () => new Blob(['same-origin-image'], { type: 'image/png' }) };
  };
  globalThis.createImageBitmap = async () => ({ width: 10, height: 10, close() {} });

  try {
    await createTranslationRegionGuide({ imageUrl: '/source.png', regions: [region()] });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/source.png');
    assert.equal(requests[0].options.credentials, 'include');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer session-token');
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    restoreCanvas();
  }
});

test('default loader falls back from createImageBitmap and revokes object URLs on load and error', async () => {
  const env = createCanvasEnvironment();
  const restoreCanvas = env.install();
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
  const createdUrls = [];
  const revokedUrls = [];
  let decodeMode = 'load';

  globalThis.fetch = async () => ({
    ok: true,
    blob: async () => new Blob(['image'], { type: 'image/png' }),
  });
  globalThis.createImageBitmap = async () => { throw new Error('bitmap decoder rejected'); };
  globalThis.URL.createObjectURL = () => {
    const url = `blob:test-${createdUrls.length + 1}`;
    createdUrls.push(url);
    return url;
  };
  globalThis.URL.revokeObjectURL = (url) => { revokedUrls.push(url); };
  globalThis.Image = class MockImage {
    constructor() {
      this.naturalWidth = 10;
      this.naturalHeight = 10;
    }

    set src(value) {
      this.currentSrc = value;
      queueMicrotask(() => decodeMode === 'load' ? this.onload?.() : this.onerror?.());
    }
  };

  try {
    await createTranslationRegionGuide({ imageUrl: '/source.png', regions: [region()] });
    assert.deepEqual(revokedUrls, ['blob:test-1'], 'onload revokes its object URL');

    decodeMode = 'error';
    await assert.rejects(
      createTranslationRegionGuide({ imageUrl: '/bad.png', regions: [region()] }),
      /load failed/i,
    );
    assert.deepEqual(createdUrls, ['blob:test-1', 'blob:test-2']);
    assert.deepEqual(revokedUrls, ['blob:test-1', 'blob:test-2'], 'onerror also revokes its object URL');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.Image = originalImage;
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    restoreCanvas();
  }
});

test('image loading failures reject instead of returning an unprotected URL', async () => {
  const error = new Error('network unavailable');

  await assert.rejects(
    createTranslationRegionGuide({ imageUrl: 'bad.png', regions: [region()], loadImage: async () => { throw error; } }),
    /network unavailable/,
  );
  await assert.rejects(
    compositeTranslationRegionEdit({
      sourceUrl: 'source.png',
      generatedUrl: 'bad.png',
      regions: [region()],
      loadImage: async (url) => {
        if (url === 'source.png') return createImage(4, 4);
        throw error;
      },
    }),
    /network unavailable/,
  );
});

test('invalid source or generated image dimensions reject explicitly', async () => {
  await assert.rejects(
    createTranslationRegionGuide({ imageUrl: 'bad.png', regions: [region()], loadImage: async () => createImage(0, 10) }),
    /dimensions/i,
  );
  await assert.rejects(
    compositeTranslationRegionEdit({
      sourceUrl: 'source.png', generatedUrl: 'bad.png', regions: [region()],
      loadImage: async (url) => url === 'source.png' ? createImage(4, 4) : createImage(0, 4),
    }),
    /dimensions/i,
  );
});

test('missing 2D context rejects explicitly', async () => {
  const env = createCanvasEnvironment({ contextAvailable: false });
  const restore = env.install();

  try {
    await assert.rejects(
      createTranslationRegionGuide({ imageUrl: 'source.png', regions: [region()], loadImage: async () => createImage(4, 4) }),
      /2d context/i,
    );
    await assert.rejects(
      compositeTranslationRegionEdit({
        sourceUrl: 'source.png', generatedUrl: 'generated.png', regions: [region()],
        loadImage: async () => createImage(4, 4),
      }),
      /2d context/i,
    );
  } finally {
    restore();
  }
});

test('PNG export failure rejects explicitly for guides and protected composites', async () => {
  const env = createCanvasEnvironment({ exportBlob: false });
  const restore = env.install();

  try {
    await assert.rejects(
      createTranslationRegionGuide({ imageUrl: 'source.png', regions: [region()], loadImage: async () => createImage(4, 4) }),
      /png export/i,
    );
    await assert.rejects(
      compositeTranslationRegionEdit({
        sourceUrl: 'source.png', generatedUrl: 'generated.png', regions: [region()],
        loadImage: async () => createImage(4, 4),
      }),
      /png export/i,
    );
  } finally {
    restore();
  }
});
