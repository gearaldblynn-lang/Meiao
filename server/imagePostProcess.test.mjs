import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import {
  buildImageOutputTransformFromJob,
  transformImageOutputBuffer,
} from './imagePostProcess.mjs';

test('buildImageOutputTransformFromJob uses custom translation dimensions and max file size', () => {
  const transform = buildImageOutputTransformFromJob({
    module: 'translation',
    taskType: 'kie_image',
    payload: {
      resolutionMode: 'custom',
      aspectRatio: '4:3',
      targetWidth: 800,
      targetHeight: 600,
      maxFileSize: 1.5,
    },
  });

  assert.deepEqual(transform, {
    width: 800,
    height: 600,
    maxFileSize: 1.5,
  });
});

test('buildImageOutputTransformFromJob uses original finalSize when provided', () => {
  const transform = buildImageOutputTransformFromJob({
    module: 'translation',
    taskType: 'kie_image',
    payload: {
      resolutionMode: 'original',
      finalSize: { width: 1024, height: 1536 },
      targetWidth: 800,
      targetHeight: 800,
      maxFileSize: 2,
    },
  });

  assert.deepEqual(transform, {
    width: 1024,
    height: 1536,
    maxFileSize: 2,
    preserveAspectRatio: true,
  });
});

test('translation original output preserves provider geometry instead of non-uniform stretching', async () => {
  const input = await sharp({
    create: {
      width: 899,
      height: 1750,
      channels: 3,
      background: '#f7f3ed',
    },
  }).png().toBuffer();

  const output = await transformImageOutputBuffer(input, {
    width: 312,
    height: 840,
    maxFileSize: 2,
    preserveAspectRatio: true,
  });

  assert.equal(output.width, 899);
  assert.equal(output.height, 1750);
  assert.equal(output.transformSkippedReason, 'aspect_ratio_mismatch');
});

test('translation original output may resize when provider and target aspect ratios match', async () => {
  const input = await sharp({
    create: {
      width: 624,
      height: 1680,
      channels: 3,
      background: '#f7f3ed',
    },
  }).png().toBuffer();

  const output = await transformImageOutputBuffer(input, {
    width: 312,
    height: 840,
    maxFileSize: 2,
    preserveAspectRatio: true,
  });

  assert.equal(output.width, 312);
  assert.equal(output.height, 840);
  assert.equal(output.transformSkippedReason, undefined);
});

test('translation original output validates EXIF-oriented dimensions after auto-orient', async () => {
  const input = await sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: '#f7f3ed',
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

  const output = await transformImageOutputBuffer(input, {
    width: 10,
    height: 20,
    preserveAspectRatio: true,
  });

  assert.equal(output.width, 10);
  assert.equal(output.height, 20);
  assert.equal(output.transformSkippedReason, undefined);
  assert.equal(output.sourceWidth, 20);
  assert.equal(output.sourceHeight, 40);
});

test('transformImageOutputBuffer resizes output and keeps jpeg under max file size', async () => {
  const input = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: '#4f8cff',
    },
  }).png().toBuffer();

  const output = await transformImageOutputBuffer(input, {
    width: 160,
    height: 90,
    maxFileSize: 0.02,
  });

  const metadata = await sharp(output.buffer).metadata();
  assert.equal(metadata.width, 160);
  assert.equal(metadata.height, 90);
  assert.equal(output.mimeType, 'image/jpeg');
  assert.ok(output.buffer.length <= 0.02 * 1024 * 1024);
});
