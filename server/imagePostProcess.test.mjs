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
  });
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
