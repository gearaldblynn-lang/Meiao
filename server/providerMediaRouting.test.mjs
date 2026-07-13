import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isVideoMediaUrl,
  shouldUploadGeminiMediaUrlForStableMime,
} from './providerMediaRouting.mjs';

test('isVideoMediaUrl recognizes supported video paths before query strings', () => {
  assert.equal(isVideoMediaUrl('https://cdn.example.test/a/clip.mp4?token=1'), true);
  assert.equal(isVideoMediaUrl('https://cdn.example.test/a/clip.MOV'), true);
  assert.equal(isVideoMediaUrl('https://cdn.example.test/a/clip.webm'), true);
  assert.equal(isVideoMediaUrl('https://cdn.example.test/a/image.jpg'), false);
  assert.equal(isVideoMediaUrl(''), false);
});

test('shouldUploadGeminiMediaUrlForStableMime only selects unstable provider media without known extensions', () => {
  assert.equal(
    shouldUploadGeminiMediaUrlForStableMime('https://tempfile.redpandaai.co/kieai/30590/mayo-storage/product/ref_IMG_8536_JPG'),
    true
  );
  assert.equal(
    shouldUploadGeminiMediaUrlForStableMime('https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/reference.jpg'),
    false
  );
  assert.equal(
    shouldUploadGeminiMediaUrlForStableMime('/api/assets/file/asset-1/source'),
    false
  );
  assert.equal(
    shouldUploadGeminiMediaUrlForStableMime('https://cdn.example.test/reference.bin'),
    false
  );
});
