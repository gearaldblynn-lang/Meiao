import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTranslationInitialCanvasSize } from './translationRegionEditSize.mjs';

test('uses original image size for main original mode', () => {
  assert.deepEqual(resolveTranslationInitialCanvasSize({
    subFeature: 'main',
    snapshot: { resolutionMode: 'original' },
    originalWidth: 1200,
    originalHeight: 1600,
  }), { width: 1200, height: 1600, source: 'original' });
});

test('uses custom target size for main custom mode', () => {
  assert.deepEqual(resolveTranslationInitialCanvasSize({
    subFeature: 'main',
    snapshot: { resolutionMode: 'custom', targetWidth: 1000, targetHeight: 1000 },
    originalWidth: 1200,
    originalHeight: 1600,
  }), { width: 1000, height: 1000, source: 'custom' });
});

test('derives detail custom height from target width and original aspect ratio', () => {
  assert.deepEqual(resolveTranslationInitialCanvasSize({
    subFeature: 'detail',
    snapshot: { resolutionMode: 'custom', targetWidth: 900 },
    originalWidth: 1200,
    originalHeight: 2400,
  }), { width: 900, height: 1800, source: 'custom' });
});

test('uses v1 fallback size for detail adaptive mode', () => {
  assert.deepEqual(resolveTranslationInitialCanvasSize({
    subFeature: 'detail',
    snapshot: { resolutionMode: 'adaptive' },
    fallbackWidth: 1024,
    fallbackHeight: 1536,
  }), { width: 1024, height: 1536, source: 'v1' });
});

test('prefers valid persisted canvas size over snapshot modes', () => {
  assert.deepEqual(resolveTranslationInitialCanvasSize({
    subFeature: 'main',
    snapshot: { resolutionMode: 'original' },
    persistedWidth: 777,
    persistedHeight: 888,
    originalWidth: 1200,
    originalHeight: 1600,
  }), { width: 777, height: 888, source: 'persisted' });
});

test('rejects zero, negative, and non-finite dimensions', () => {
  assert.equal(resolveTranslationInitialCanvasSize({
    subFeature: 'main',
    snapshot: { resolutionMode: 'original' },
    originalWidth: 0,
    originalHeight: 1600,
  }), null);

  assert.equal(resolveTranslationInitialCanvasSize({
    subFeature: 'main',
    snapshot: { resolutionMode: 'custom', targetWidth: -1000, targetHeight: 1000 },
  }), null);

  assert.equal(resolveTranslationInitialCanvasSize({
    subFeature: 'detail',
    snapshot: { resolutionMode: 'custom', targetWidth: Number.POSITIVE_INFINITY },
    originalWidth: 1200,
    originalHeight: 2400,
  }), null);
});

test('rejects unsupported remove_text sub-feature inputs', () => {
  assert.equal(resolveTranslationInitialCanvasSize({
    subFeature: 'remove_text',
    snapshot: { resolutionMode: 'original' },
    originalWidth: 1200,
    originalHeight: 1600,
  }), null);
});
