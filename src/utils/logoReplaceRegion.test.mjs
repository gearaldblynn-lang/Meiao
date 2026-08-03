import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logoReplaceRegionToRect,
  normalizeLogoReplaceRegion,
  normalizeLogoReplaceRegions,
  rectToLogoReplaceRegion,
} from './logoReplaceRegion.mjs';

test('logo replace region stores one selected old-logo area', () => {
  const region = rectToLogoReplaceRegion({
    regionId: 'old-logo-region',
    regionIndex: 1,
    x: 120,
    y: 80,
    width: 240,
    height: 120,
    canvasWidth: 1200,
    canvasHeight: 800,
  });

  assert.deepEqual(region, {
    version: 1,
    source: 'manual',
    regionId: 'old-logo-region',
    regionIndex: 1,
    xRatio: 0.1,
    yRatio: 0.1,
    widthRatio: 0.2,
    heightRatio: 0.15,
  });
  assert.deepEqual(logoReplaceRegionToRect(region, { width: 1200, height: 800 }), {
    x: 120,
    y: 80,
    width: 240,
    height: 120,
  });
});

test('logo replace region rejects empty rectangles', () => {
  assert.equal(normalizeLogoReplaceRegion({ xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0.2 }), null);
});

test('logo replace regions preserve multiple old-logo areas with selected logos', () => {
  const regions = normalizeLogoReplaceRegions([
    {
      regionId: 'mask-logo',
      regionIndex: 2,
      xRatio: 0.2,
      yRatio: 0.3,
      widthRatio: 0.1,
      heightRatio: 0.08,
      logoId: 'logo-b',
      logoIndex: 2,
      replacementRequirement: '沿布料褶皱自然变形',
    },
    {
      regionId: 'hat-logo',
      regionIndex: 1,
      xRatio: 0.4,
      yRatio: 0.1,
      widthRatio: 0.08,
      heightRatio: 0.04,
      logoId: 'logo-a',
      logoIndex: 1,
      replacementRequirement: '保持刺绣针脚质感',
    },
  ]);

  assert.deepEqual(regions.map((region) => ({
    regionId: region.regionId,
    regionIndex: region.regionIndex,
    logoId: region.logoId,
    logoIndex: region.logoIndex,
    replacementRequirement: region.replacementRequirement,
  })), [
    {
      regionId: 'hat-logo',
      regionIndex: 1,
      logoId: 'logo-a',
      logoIndex: 1,
      replacementRequirement: '保持刺绣针脚质感',
    },
    {
      regionId: 'mask-logo',
      regionIndex: 2,
      logoId: 'logo-b',
      logoIndex: 2,
      replacementRequirement: '沿布料褶皱自然变形',
    },
  ]);
});

test('logo replace regions upgrade legacy single region when array is empty', () => {
  const legacy = normalizeLogoReplaceRegion({
    xRatio: 0.1,
    yRatio: 0.2,
    widthRatio: 0.3,
    heightRatio: 0.1,
  });

  assert.deepEqual(normalizeLogoReplaceRegions([], legacy), [legacy]);
});
