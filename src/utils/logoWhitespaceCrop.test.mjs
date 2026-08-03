import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWhitespaceCroppedLogoBlob,
  expandLogoCropRectWithPadding,
  findDarkBackgroundLightContentBounds,
  findNonTransparentBounds,
  findOpaqueWhiteTrimBounds,
  transparentizeDarkLogoBacking,
  transparentizeFlatLogoBackground,
  transparentizeOpaqueLogoBackingPlate,
} from './logoWhitespaceCrop.mjs';

const withMockedLogoCropRuntime = async ({ width, height, imageData, fetchImpl }, callback) => {
  const originalFetch = globalThis.fetch;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const outputCanvases = [];

  globalThis.fetch = fetchImpl || (async (url) => ({ ok: true, blob: async () => ({ url }) }));
  globalThis.createImageBitmap = async () => ({ width, height });
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              return imageData;
            },
          };
        },
        toBlob(callbackToBlob) {
          callbackToBlob(new Blob(['cropped'], { type: 'image/png' }));
        },
      };
      outputCanvases.push(canvas);
      return canvas;
    },
  };

  try {
    return await callback({ outputCanvases });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
};

test('finds non-transparent bounds for logo content with transparent padding', () => {
  const width = 6;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  setPixel(2, 1, [255, 0, 0, 255]);
  setPixel(4, 3, [255, 0, 0, 255]);

  assert.deepEqual(findNonTransparentBounds({ data, width, height }, 8), {
    x: 2,
    y: 1,
    width: 3,
    height: 3,
  });
});

test('finds content bounds by trimming opaque white padding', () => {
  const width = 5;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  setPixel(1, 1, [20, 30, 40, 255]);
  setPixel(3, 2, [20, 30, 40, 255]);

  assert.deepEqual(findOpaqueWhiteTrimBounds({ data, width, height }), {
    x: 1,
    y: 1,
    width: 3,
    height: 2,
  });
});

test('finds light logo content inside a dark opaque background', () => {
  const width = 7;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 28;
    data[index + 1] = 30;
    data[index + 2] = 32;
    data[index + 3] = 255;
  }
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  setPixel(3, 1, [245, 245, 245, 255]);
  setPixel(4, 2, [245, 245, 245, 255]);
  setPixel(2, 3, [245, 245, 245, 255]);

  assert.deepEqual(findDarkBackgroundLightContentBounds({ data, width, height }), {
    x: 2,
    y: 1,
    width: 3,
    height: 3,
  });
});

test('does not trim normal multicolor opaque logos as dark background assets', () => {
  const width = 5;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  const colors = [
    [30, 30, 30, 255],
    [180, 60, 40, 255],
    [50, 120, 220, 255],
    [230, 190, 40, 255],
  ];
  for (let index = 0; index < data.length; index += 4) {
    const color = colors[(index / 4) % colors.length];
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3];
  }

  assert.equal(findDarkBackgroundLightContentBounds({ data, width, height }), null);
});

test('makes a flat dark logo background transparent while preserving light logo content', () => {
  const width = 5;
  const height = 4;
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
      setPixel(x, y, [42, 44, 46, 255]);
    }
  }
  setPixel(2, 1, [245, 245, 245, 255]);
  setPixel(3, 2, [245, 245, 245, 255]);

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(1 * width + 2) * 4 + 3], 255);
});

test('removes an oversized flat dark logo backing plate from sparse light logo art', () => {
  const width = 20;
  const height = 10;
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
      setPixel(x, y, [18, 18, 18, 255]);
    }
  }
  [[7, 3], [8, 3], [9, 3], [10, 3], [8, 4], [9, 4], [7, 6], [8, 6], [9, 6], [10, 6]].forEach(([x, y]) => {
    setPixel(x, y, [245, 245, 245, 255]);
  });

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(3 * width + 7) * 4 + 3], 255);
});

test('removes a subtle flat gray backing plate from white logo art', () => {
  const width = 24;
  const height = 12;
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
      setPixel(x, y, [82, 84, 86, 255]);
    }
  }
  for (let y = 4; y < 8; y += 1) {
    for (let x = 8; x < 17; x += 1) {
      setPixel(x, y, [238, 238, 238, 255]);
    }
  }

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(5 * width + 10) * 4 + 3], 255);
});

test('removes a lightly noisy gray backing plate from white logo art', () => {
  const width = 24;
  const height = 12;
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
      const noise = ((x * 7 + y * 11) % 17) - 8;
      setPixel(x, y, [82 + noise, 84 + noise, 86 + noise, 255]);
    }
  }
  for (let y = 4; y < 8; y += 1) {
    for (let x = 8; x < 17; x += 1) {
      setPixel(x, y, [238, 238, 238, 255]);
    }
  }

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(5 * width + 10) * 4 + 3], 255);
});

test('removes a lightly noisy white backing plate from dark and blue logo art', () => {
  const width = 32;
  const height = 18;
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
      const noise = ((x * 11 + y * 13) % 45) - 22;
      setPixel(x, y, [
        Math.max(210, Math.min(255, 238 + noise)),
        Math.max(210, Math.min(255, 239 + noise)),
        Math.max(210, Math.min(255, 241 + noise)),
        255,
      ]);
    }
  }
  for (let y = 5; y < 13; y += 1) {
    for (let x = 5; x < 10; x += 1) {
      setPixel(x, y, [12, 12, 12, 255]);
    }
  }
  for (let y = 7; y < 11; y += 1) {
    for (let x = 12; x < 25; x += 1) {
      setPixel(x, y, [32, 76, 148, 255]);
    }
  }

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(6 * width + 6) * 4 + 3], 255);
  assert.equal(result.imageData.data[(8 * width + 16) * 4 + 3], 255);
});

test('removes a compressed black backing plate from white logo art', () => {
  const width = 36;
  const height = 18;
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
      const noise = ((x * 13 + y * 17) % 49) - 24;
      const base = 24 + Math.round((x / width) * 14);
      setPixel(x, y, [
        Math.max(0, Math.min(70, base + noise)),
        Math.max(0, Math.min(70, base + noise + 1)),
        Math.max(0, Math.min(70, base + noise + 2)),
        255,
      ]);
    }
  }
  for (let y = 6; y < 11; y += 1) {
    for (let x = 9; x < 27; x += 1) {
      const antialias = (x + y) % 4 === 0 ? 196 : 238;
      setPixel(x, y, [antialias, antialias, antialias, 255]);
    }
  }

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(8 * width + 14) * 4 + 3], 255);
});

test('removes an internal black label plate behind white logo art', () => {
  const width = 48;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  for (let y = 6; y < 17; y += 1) {
    for (let x = 8; x < 38; x += 1) {
      const noise = ((x * 5 + y * 7) % 19) - 9;
      const base = 18 + Math.round((x - 8) / 30 * 10);
      setPixel(x, y, [
        Math.max(0, Math.min(48, base + noise)),
        Math.max(0, Math.min(48, base + noise + 1)),
        Math.max(0, Math.min(48, base + noise + 2)),
        255,
      ]);
    }
  }
  for (let y = 10; y < 14; y += 1) {
    for (let x = 16; x < 31; x += 1) {
      const antialias = (x + y) % 5 === 0 ? 188 : 242;
      setPixel(x, y, [antialias, antialias, antialias, 255]);
    }
  }

  const result = transparentizeDarkLogoBacking({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(8 * width + 8) * 4 + 3], 0);
  assert.equal(result.imageData.data[(12 * width + 20) * 4 + 3], 255);
});

test('removes an internal white backing plate behind dark and colored logo art', () => {
  const width = 48;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  for (let y = 6; y < 18; y += 1) {
    for (let x = 8; x < 40; x += 1) {
      setPixel(x, y, [246, 247, 248, 255]);
    }
  }
  for (let y = 10; y < 14; y += 1) {
    for (let x = 14; x < 23; x += 1) {
      setPixel(x, y, [16, 16, 18, 255]);
    }
    for (let x = 26; x < 34; x += 1) {
      setPixel(x, y, [24, 92, 180, 255]);
    }
  }

  const result = transparentizeOpaqueLogoBackingPlate({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(6 * width + 8) * 4 + 3], 0);
  assert.equal(result.imageData.data[(11 * width + 16) * 4 + 3], 255);
  assert.equal(result.imageData.data[(11 * width + 28) * 4 + 3], 255);
});

test('preserves disconnected logo pixels that match the flat backing color', () => {
  const width = 9;
  const height = 7;
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
      setPixel(x, y, [82, 84, 86, 255]);
    }
  }
  for (let y = 2; y <= 4; y += 1) {
    for (let x = 3; x <= 5; x += 1) {
      setPixel(x, y, [242, 242, 242, 255]);
    }
  }
  setPixel(4, 3, [82, 84, 86, 255]);

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, true);
  assert.equal(result.imageData.data[(0 * width + 0) * 4 + 3], 0);
  assert.equal(result.imageData.data[(2 * width + 4) * 4 + 3], 255);
  assert.equal(result.imageData.data[(3 * width + 4) * 4 + 3], 255);
});

test('does not transparentize normal multicolor logo artwork', () => {
  const width = 5;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  const colors = [
    [30, 30, 30, 255],
    [180, 60, 40, 255],
    [50, 120, 220, 255],
    [230, 190, 40, 255],
  ];
  for (let index = 0; index < data.length; index += 4) {
    const color = colors[(index / 4) % colors.length];
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = color[3];
  }

  const result = transparentizeFlatLogoBackground({ data, width, height });

  assert.equal(result.changed, false);
  assert.deepEqual(Array.from(result.imageData.data), Array.from(data));
});


test('adds a small safe padding around cropped logo content', () => {
  assert.deepEqual(expandLogoCropRectWithPadding({
    rect: { x: 20, y: 15, width: 60, height: 30 },
    width: 100,
    height: 80,
    paddingRatio: 0.06,
  }), {
    x: 16,
    y: 11,
    width: 68,
    height: 38,
  });
});

test('clamps logo crop padding to the source canvas', () => {
  assert.deepEqual(expandLogoCropRectWithPadding({
    rect: { x: 1, y: 2, width: 18, height: 12 },
    width: 20,
    height: 16,
    paddingRatio: 0.1,
  }), {
    x: 0,
    y: 0,
    width: 20,
    height: 16,
  });
});

test('crops large transparent padding around an uploaded logo before placement', async () => {
  const width = 800;
  const height = 800;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 330; y < 464; y += 1) {
    for (let x = 296; x < 511; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }

  await withMockedLogoCropRuntime({
    width,
    height,
    imageData: { data, width, height },
  }, async ({ outputCanvases }) => {
    const result = await createWhitespaceCroppedLogoBlob('https://cdn.example/logo-with-padding.png');

    assert.deepEqual(result.cropRect || result.rect, {
      x: 283,
      y: 317,
      width: 241,
      height: 160,
    });
    assert.deepEqual(result.visibleContentRect, {
      x: 296,
      y: 330,
      width: 215,
      height: 134,
    });
    assert.equal(outputCanvases.at(-1).width, 241);
    assert.equal(outputCanvases.at(-1).height, 160);
  });
});

test('crops against transparentized flat gray backing so only logo artwork is exported', async () => {
  const width = 240;
  const height = 120;
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
      setPixel(x, y, [74, 76, 78, 255]);
    }
  }
  for (let y = 45; y < 64; y += 1) {
    for (let x = 82; x < 158; x += 1) {
      setPixel(x, y, [242, 242, 242, 255]);
    }
  }
  for (let y = 67; y < 75; y += 1) {
    for (let x = 98; x < 142; x += 1) {
      setPixel(x, y, [242, 242, 242, 255]);
    }
  }

  await withMockedLogoCropRuntime({
    width,
    height,
    imageData: { data, width, height },
  }, async ({ outputCanvases }) => {
    const result = await createWhitespaceCroppedLogoBlob('https://cdn.example/logo-gray-backing.png');

    assert.deepEqual(result.cropRect || result.rect, {
      x: 77,
      y: 40,
      width: 86,
      height: 40,
    });
    assert.equal(outputCanvases.at(-1).width, 86);
    assert.equal(outputCanvases.at(-1).height, 40);
  });
});

test('crops against an internal opaque backing plate so the exported logo has no rectangle', async () => {
  const width = 240;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  for (let y = 24; y < 96; y += 1) {
    for (let x = 36; x < 204; x += 1) {
      setPixel(x, y, [246, 247, 248, 255]);
    }
  }
  for (let y = 52; y < 68; y += 1) {
    for (let x = 92; x < 122; x += 1) {
      setPixel(x, y, [16, 16, 18, 255]);
    }
    for (let x = 130; x < 154; x += 1) {
      setPixel(x, y, [24, 92, 180, 255]);
    }
  }

  await withMockedLogoCropRuntime({
    width,
    height,
    imageData: { data, width, height },
  }, async ({ outputCanvases }) => {
    const result = await createWhitespaceCroppedLogoBlob('https://cdn.example/logo-internal-plate.png');

    assert.deepEqual(result.cropRect || result.rect, {
      x: 88,
      y: 48,
      width: 70,
      height: 24,
    });
    assert.equal(outputCanvases.at(-1).width, 70);
    assert.equal(outputCanvases.at(-1).height, 24);
  });
});

test('identity-reference crop keeps backing-plate pixels while trimming only outer canvas', async () => {
  const width = 240;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, rgba) => {
    const offset = (y * width + x) * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  };

  for (let y = 24; y < 96; y += 1) {
    for (let x = 36; x < 204; x += 1) {
      setPixel(x, y, [246, 247, 248, 255]);
    }
  }
  for (let y = 52; y < 68; y += 1) {
    for (let x = 92; x < 154; x += 1) {
      setPixel(x, y, [16, 16, 18, 255]);
    }
  }

  await withMockedLogoCropRuntime({
    width,
    height,
    imageData: { data, width, height },
  }, async ({ outputCanvases }) => {
    const result = await createWhitespaceCroppedLogoBlob(
      'https://cdn.example/logo-with-backing.png',
      { preserveBackingPlate: true },
    );

    assert.deepEqual(result.cropRect || result.rect, {
      x: 26,
      y: 14,
      width: 188,
      height: 92,
    });
    assert.deepEqual(result.visibleContentRect, {
      x: 36,
      y: 24,
      width: 168,
      height: 72,
    });
    assert.equal(outputCanvases.at(-1).width, 188);
    assert.equal(outputCanvases.at(-1).height, 92);
  });
});

test('downloads remote logo through proxy when direct cross-origin fetch fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const requestedUrls = [];

  globalThis.window = {
    location: { href: 'http://localhost:5173/app' },
    localStorage: { getItem: () => 'session-token' },
  };
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url).startsWith('https://cdn.example/logo.png')) {
      throw new TypeError('CORS blocked');
    }
    if (String(url).startsWith('/api/assets/download-proxy?url=')) {
      return { ok: true, blob: async () => ({ url }) };
    }
    return { ok: false, status: 404, blob: async () => ({ url }) };
  };
  globalThis.createImageBitmap = async () => ({ width: 4, height: 4 });
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
              const data = new Uint8ClampedArray(4 * 4 * 4);
              for (let i = 0; i < data.length; i += 4) {
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                data[i + 3] = 0;
              }
              const setPixel = (x, y) => {
                const offset = (y * 4 + x) * 4;
                data[offset] = 255;
                data[offset + 1] = 255;
                data[offset + 2] = 255;
                data[offset + 3] = 255;
              };
              setPixel(1, 1);
              setPixel(2, 2);
              return { data, width: 4, height: 4 };
            },
          };
        },
        toBlob(callback) { callback(new Blob(['cropped'], { type: 'image/png' })); },
      };
    },
  };

  try {
    const result = await createWhitespaceCroppedLogoBlob('https://cdn.example/logo.png');
    assert.ok(result.blob);
    assert.ok(requestedUrls.includes('https://cdn.example/logo.png'));
    assert.ok(requestedUrls.some((url) => url.startsWith('/api/assets/download-proxy?url=')));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
  }
});
