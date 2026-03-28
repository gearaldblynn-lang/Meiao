import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFetchedImageBlob } from './imageBlobUtils.mjs';

test('normalizeFetchedImageBlob upgrades generic blob type based on png url', async () => {
  const rawBlob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'application/octet-stream' });

  const normalized = await normalizeFetchedImageBlob(rawBlob, 'https://example.com/result.png');

  assert.equal(normalized.type, 'image/png');
  assert.equal(await normalized.text(), await rawBlob.text());
});

test('normalizeFetchedImageBlob keeps explicit image mime type untouched', async () => {
  const rawBlob = new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/jpeg' });

  const normalized = await normalizeFetchedImageBlob(rawBlob, 'https://example.com/result.png');

  assert.equal(normalized, rawBlob);
  assert.equal(normalized.type, 'image/jpeg');
});

test('normalizeFetchedImageBlob prefers actual file signature over misleading url suffix', async () => {
  const webpHeader = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46,
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
  ]);
  const rawBlob = new Blob([webpHeader, Uint8Array.from([1, 2, 3])], { type: 'application/octet-stream' });

  const normalized = await normalizeFetchedImageBlob(rawBlob, 'https://example.com/result.png');

  assert.equal(normalized.type, 'image/webp');
  assert.equal(await normalized.arrayBuffer().then(buffer => buffer.byteLength), await rawBlob.arrayBuffer().then(buffer => buffer.byteLength));
});
