import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deriveTranslationExecutionPlan, deriveTranslationExportSize, getStoredSourceDimensions } from './translationProcessingUtils.mjs';

test('deriveTranslationExecutionPlan keeps detail mode on auto ratio like legacy flow', () => {
  const config = {
    aspectRatio: '1:1',
    resolutionMode: 'custom',
    targetWidth: 750,
    targetHeight: 0,
  };

  const plan = deriveTranslationExecutionPlan({
    config,
    subMode: 'detail',
  });

  assert.equal(plan.effectiveConfig.aspectRatio, 'auto');
  assert.equal(plan.isRatioMatch, true);
});

test('deriveTranslationExecutionPlan keeps main mode explicit ratio validation behavior', () => {
  const config = {
    aspectRatio: '1:1',
    resolutionMode: 'custom',
    targetWidth: 800,
    targetHeight: 800,
  };

  const plan = deriveTranslationExecutionPlan({
    config,
    subMode: 'main',
  });

  assert.equal(plan.effectiveConfig.aspectRatio, '1:1');
  assert.equal(plan.isRatioMatch, false);
});

test('deriveTranslationExportSize uses source ratio for detail custom export like legacy flow', () => {
  const size = deriveTranslationExportSize({
    config: {
      resolutionMode: 'custom',
      targetWidth: 750,
      targetHeight: 0,
    },
    subMode: 'detail',
    sourceDimensions: {
      width: 1000,
      height: 2000,
      ratio: 0.5,
    },
    generatedDimensions: {
      width: 1024,
      height: 1024,
      ratio: 1,
    },
  });

  assert.deepEqual(size, {
    targetWidth: 750,
    targetHeight: 1500,
  });
});

test('deriveTranslationExportSize keeps main mode custom width and height exactly as configured', () => {
  const size = deriveTranslationExportSize({
    config: {
      resolutionMode: 'custom',
      targetWidth: 800,
      targetHeight: 1200,
    },
    subMode: 'main',
    sourceDimensions: {
      width: 1000,
      height: 2000,
      ratio: 0.5,
    },
    generatedDimensions: {
      width: 1024,
      height: 1024,
      ratio: 1,
    },
  });

  assert.deepEqual(size, {
    targetWidth: 800,
    targetHeight: 1200,
  });
});

test('getStoredSourceDimensions restores persisted original image dimensions for cloud recovery flow', () => {
  const dimensions = getStoredSourceDimensions({
    originalWidth: 1000,
    originalHeight: 2000,
  });

  assert.deepEqual(dimensions, {
    width: 1000,
    height: 2000,
    ratio: 0.5,
  });
});

test('getStoredSourceDimensions returns null when persisted source dimensions are incomplete', () => {
  assert.equal(getStoredSourceDimensions({ originalWidth: 0, originalHeight: 2000 }), null);
  assert.equal(getStoredSourceDimensions({ originalWidth: 1000 }), null);
});

test('kieAi prompt gates source ratio constraint to main mode only', () => {
  const source = readFileSync(new URL('../../services/kieAiService.ts', import.meta.url), 'utf8');

  assert.match(
    source,
    /if\s*\(\s*isRatioMatch\s*&&\s*sourceImageContext\s*&&\s*subMode\s*===\s*['"]main['"]\s*\)/,
    'source ratio prompt block should only run for main mode'
  );
});

test('remove text custom export uses configured width and proportional height', () => {
  const size = deriveTranslationExportSize({
    config: {
      resolutionMode: 'custom',
      targetWidth: 900,
      targetHeight: 0,
    },
    subMode: 'remove_text',
    sourceDimensions: {
      width: 1000,
      height: 2000,
      ratio: 0.5,
    },
    generatedDimensions: {
      width: 1024,
      height: 1024,
      ratio: 1,
    },
  });

  assert.deepEqual(size, {
    targetWidth: 900,
    targetHeight: 1800,
  });
});

test('remove text original export matches source dimensions', () => {
  const size = deriveTranslationExportSize({
    config: {
      resolutionMode: 'original',
      targetWidth: 0,
      targetHeight: 0,
    },
    subMode: 'remove_text',
    sourceDimensions: {
      width: 1000,
      height: 2000,
      ratio: 0.5,
    },
    generatedDimensions: {
      width: 1024,
      height: 1024,
      ratio: 1,
    },
  });

  assert.deepEqual(size, {
    targetWidth: 1000,
    targetHeight: 2000,
  });
});
