import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';

import {
  getVirtualModelImageTargetBytes,
  optimizeVirtualModelImage,
  shouldOptimizeVirtualModelImageModule,
} from './virtualModelImageCompression.mjs';

test('virtual model image target uses an env-backed conservative 3 MiB default', () => {
  assert.equal(getVirtualModelImageTargetBytes({}), 3 * 1024 * 1024);
  assert.equal(getVirtualModelImageTargetBytes({ MEIAO_VIRTUAL_MODEL_IMAGE_TARGET_BYTES: '1' }), 1024 * 1024);
  assert.equal(
    getVirtualModelImageTargetBytes({ MEIAO_VIRTUAL_MODEL_IMAGE_TARGET_BYTES: String(50 * 1024 * 1024) }),
    20 * 1024 * 1024,
  );
});

test('only virtual model runtime upload modules enter the focused optimizer', () => {
  assert.equal(shouldOptimizeVirtualModelImageModule('virtual_model'), true);
  assert.equal(shouldOptimizeVirtualModelImageModule('virtual_model_generation'), true);
  assert.equal(shouldOptimizeVirtualModelImageModule('everything_replace'), false);
  assert.equal(shouldOptimizeVirtualModelImageModule('translation'), false);
});

test('virtual model optimizer source cannot use dimension-changing transforms', () => {
  const source = readFileSync(new URL('./virtualModelImageCompression.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.(?:resize|rotate|extract)\s*\(/);
});

test('invalid virtual model images fail with a stable client error', async () => {
  await assert.rejects(
    optimizeVirtualModelImage({
      fileBuffer: Buffer.from('not-an-image'),
      mimeType: 'image/png',
      fileName: 'invalid.png',
    }),
    (error) => error?.code === 'virtual_model_image_invalid' && error?.statusCode === 400,
  );
});

test('small virtual model images stay byte-for-byte identical', async () => {
  const input = await sharp({
    create: {
      width: 200,
      height: 300,
      channels: 3,
      background: '#f3ede4',
    },
  }).jpeg({ quality: 92 }).withMetadata({ density: 300 }).toBuffer();

  const output = await optimizeVirtualModelImage({
    fileBuffer: input,
    mimeType: 'image/jpeg',
    fileName: 'small-model.jpg',
    targetBytes: 1024 * 1024,
  });

  assert.equal(output.compressed, false);
  assert.equal(output.fileBuffer.equals(input), true);
  assert.equal(output.sourceBytes, input.length);
  assert.equal(output.outputBytes, input.length);
  assert.equal(output.width, 200);
  assert.equal(output.height, 300);
  assert.equal(output.density, 300);
});

test('large JPEG is conservatively recompressed without changing pixel dimensions or DPI', async () => {
  const width = 1600;
  const height = 1200;
  const input = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 100 }).withMetadata({ density: 300 }).toBuffer();

  const output = await optimizeVirtualModelImage({
    fileBuffer: input,
    mimeType: 'image/jpeg',
    fileName: 'ai-model.jpg',
    targetBytes: 1024 * 1024,
  });
  const metadata = await sharp(output.fileBuffer).metadata();

  assert.equal(output.compressed, true);
  assert.ok(output.outputBytes < output.sourceBytes);
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.density, 300);
  assert.equal(output.width, width);
  assert.equal(output.height, height);
  assert.equal(output.density, 300);
  assert.equal(output.mimeType, 'image/jpeg');
  assert.match(output.fileName, /\.jpg$/);
});

test('large transparent PNG keeps dimensions, DPI and alpha while reducing bytes', async () => {
  const width = 1200;
  const height = 900;
  const rgb = randomBytes(width * height * 3);
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = rgb[pixel * 3];
    rgba[pixel * 4 + 1] = rgb[pixel * 3 + 1];
    rgba[pixel * 4 + 2] = rgb[pixel * 3 + 2];
    rgba[pixel * 4 + 3] = 180;
  }
  const input = await sharp(rgba, {
    raw: { width, height, channels: 4 },
  }).png().withMetadata({ density: 240 }).toBuffer();

  const output = await optimizeVirtualModelImage({
    fileBuffer: input,
    mimeType: 'image/png',
    fileName: 'transparent-ai-model.png',
    targetBytes: 1024 * 1024,
  });
  const metadata = await sharp(output.fileBuffer).metadata();

  assert.equal(output.compressed, true);
  assert.ok(output.outputBytes < output.sourceBytes);
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
  assert.equal(metadata.density, 240);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(output.width, width);
  assert.equal(output.height, height);
  assert.equal(output.density, 240);
  assert.ok(['image/png', 'image/webp'].includes(output.mimeType));
  assert.match(output.fileName, output.mimeType === 'image/png' ? /\.png$/ : /\.webp$/);
});
