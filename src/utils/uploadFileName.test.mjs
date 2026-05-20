import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureUploadFileName, inferExtensionFromMimeType } from './uploadFileName.mjs';

test('inferExtensionFromMimeType maps common image and video mime types to stable file extensions', () => {
  assert.equal(inferExtensionFromMimeType('image/png'), '.png');
  assert.equal(inferExtensionFromMimeType('image/jpeg'), '.jpg');
  assert.equal(inferExtensionFromMimeType('image/webp'), '.webp');
  assert.equal(inferExtensionFromMimeType('video/mp4'), '.mp4');
  assert.equal(inferExtensionFromMimeType('video/quicktime'), '.mov');
});

test('ensureUploadFileName appends a mime-derived extension when the source file name has no suffix', () => {
  assert.equal(ensureUploadFileName('pet-spray-upload', 'image/png'), 'pet-spray-upload.png');
  assert.equal(ensureUploadFileName('storyboard-frame', 'image/jpeg'), 'storyboard-frame.jpg');
  assert.equal(ensureUploadFileName('clip', 'video/mp4'), 'clip.mp4');
});

test('ensureUploadFileName preserves an existing extension', () => {
  assert.equal(ensureUploadFileName('already-good.webp', 'image/png'), 'already-good.webp');
  assert.equal(ensureUploadFileName('hero.image.final.jpg', 'image/png'), 'hero.image.final.jpg');
});

test('ensureUploadFileName leaves unknown mime types unchanged when no extension can be inferred', () => {
  assert.equal(ensureUploadFileName('mystery-upload', 'application/octet-stream'), 'mystery-upload');
});
