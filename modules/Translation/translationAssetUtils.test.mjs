import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getClientSafeAssetUrl,
  getExecutionSourceUrl,
} from './translationAssetUtils.mjs';

test('getExecutionSourceUrl prefers persisted sourceUrl for regenerated files', () => {
  assert.equal(
    getExecutionSourceUrl({
      sourceUrl: 'http://111.229.66.247:3100/api/assets/file/abc/source.jpg',
      sourcePreviewUrl: 'data:image/png;base64,xxx',
    }),
    'http://111.229.66.247:3100/api/assets/file/abc/source.jpg'
  );
});

test('getExecutionSourceUrl falls back to remote preview url when sourceUrl is absent', () => {
  assert.equal(
    getExecutionSourceUrl({
      sourcePreviewUrl: 'https://cdn.example.com/source.png',
    }),
    'https://cdn.example.com/source.png'
  );
});

test('getClientSafeAssetUrl strips origin for managed internal asset urls', () => {
  assert.equal(
    getClientSafeAssetUrl('http://111.229.66.247:3100/api/assets/file/abc/source.jpg'),
    '/api/assets/file/abc/source.jpg'
  );
});

test('getClientSafeAssetUrl keeps non-managed urls unchanged', () => {
  assert.equal(
    getClientSafeAssetUrl('https://example.com/file.png'),
    'https://example.com/file.png'
  );
});
