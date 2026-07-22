import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getManagedImageMaxBytes,
  inspectManagedImageMultipartPrefix,
  resolveManagedImageUpload,
  validateManagedImageUpload,
} from './managedImageValidation.mjs';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const jpeg = Buffer.from('ffd8ffe000104a4649460001', 'hex');
const webp = Buffer.from('52494646100000005745425056503820', 'hex');

test('managed image upload accepts supported MIME values only when the file signature matches', () => {
  assert.equal(validateManagedImageUpload({ fileBuffer: png, mimeType: 'image/png' }).detectedMimeType, 'image/png');
  assert.equal(validateManagedImageUpload({ fileBuffer: jpeg, mimeType: 'image/jpeg' }).detectedMimeType, 'image/jpeg');
  assert.equal(validateManagedImageUpload({ fileBuffer: webp, mimeType: 'image/webp' }).detectedMimeType, 'image/webp');
  assert.throws(
    () => validateManagedImageUpload({ fileBuffer: Buffer.from('not-an-image'), mimeType: 'image/png' }),
    (error) => error?.code === 'managed_image_signature_invalid' && error?.statusCode === 400,
  );
  assert.throws(
    () => validateManagedImageUpload({ fileBuffer: jpeg, mimeType: 'image/png' }),
    (error) => error?.code === 'managed_image_mime_mismatch' && error?.statusCode === 400,
  );
});

test('managed image resolution trusts supported image bytes over a conflicting browser image MIME', () => {
  assert.deepEqual(
    resolveManagedImageUpload({ fileBuffer: webp, mimeType: 'image/jpeg' }),
    {
      isImage: true,
      mimeType: 'image/webp',
      detectedMimeType: 'image/webp',
      declaredMimeType: 'image/jpeg',
      mimeTypeNormalized: true,
    },
  );
});

test('managed image upload enforces an env-configurable byte limit', () => {
  assert.equal(getManagedImageMaxBytes({ MEIAO_MANAGED_IMAGE_MAX_BYTES: '12' }), 1024 * 1024);
  assert.throws(
    () => validateManagedImageUpload({
      fileBuffer: Buffer.concat([png, Buffer.alloc(1024 * 1024)]),
      mimeType: 'image/png',
      env: { MEIAO_MANAGED_IMAGE_MAX_BYTES: String(1024 * 1024) },
    }),
    (error) => error?.code === 'managed_image_too_large' && error?.statusCode === 413,
  );
});

const multipartContentType = 'multipart/form-data; boundary=test-boundary';
const buildMultipartFilePrefix = ({ mimeType, fileBuffer }) => Buffer.concat([
  Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="upload.bin"\r\nContent-Type: ${mimeType}\r\n\r\n`, 'latin1'),
  fileBuffer,
]);

test('multipart prefix inspection chooses image limits from declared MIME or real magic bytes', () => {
  const declaredImage = inspectManagedImageMultipartPrefix(buildMultipartFilePrefix({
    mimeType: 'image/png',
    fileBuffer: Buffer.from('not-yet-complete'),
  }), { contentType: multipartContentType });
  assert.equal(declaredImage.complete, true);
  assert.equal(declaredImage.isImage, true);

  const disguisedImage = inspectManagedImageMultipartPrefix(buildMultipartFilePrefix({
    mimeType: 'application/octet-stream',
    fileBuffer: png,
  }), { contentType: multipartContentType });
  assert.equal(disguisedImage.complete, true);
  assert.equal(disguisedImage.isImage, true);
  assert.equal(disguisedImage.detectedMimeType, 'image/png');

  const video = inspectManagedImageMultipartPrefix(buildMultipartFilePrefix({
    mimeType: 'video/mp4',
    fileBuffer: Buffer.from('000000186674797069736f6d', 'hex'),
  }), { contentType: multipartContentType });
  assert.equal(video.complete, true);
  assert.equal(video.isImage, false);
});

test('multipart prefix inspection ignores fake file headers inside a preceding text field', () => {
  const hostilePrefix = Buffer.concat([
    Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="module"\r\n\r\n', 'latin1'),
    Buffer.from('buyer_show\r\nContent-Disposition: form-data; name="file"; filename="fake.mp4"\r\nContent-Type: video/mp4\r\n\r\nfake', 'latin1'),
    Buffer.from('\r\n--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="real.bin"\r\nContent-Type: application/octet-stream\r\n\r\n', 'latin1'),
    png,
  ]);
  const inspected = inspectManagedImageMultipartPrefix(hostilePrefix, { contentType: multipartContentType });
  assert.equal(inspected.complete, true);
  assert.equal(inspected.isImage, true);
  assert.equal(inspected.detectedMimeType, 'image/png');
});
