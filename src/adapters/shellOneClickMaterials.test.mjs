import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOneClickPlanGenerationMaterials,
  buildShellImageInputUrls,
} from './shellOneClickMaterials.mjs';

const material = (type, url) => ({
  id: `${type}-${url}`,
  type,
  url,
  remoteUrl: url,
  fileName: `${type}.png`,
});

test('first image plan generation keeps only the current replication reference', () => {
  const materials = {
    product: [material('product', 'https://example.com/product-1.png'), material('product', 'https://example.com/product-2.png')],
    styleRef: [
      material('styleRef', 'https://example.com/ref-1.png'),
      material('styleRef', 'https://example.com/ref-2.png'),
      material('styleRef', 'https://example.com/ref-3.png'),
    ],
    logo: [material('logo', 'https://example.com/logo.png')],
  };

  const next = buildOneClickPlanGenerationMaterials({
    baseMaterials: materials,
    plan: { id: 'plan-2', sourceReferenceUrl: 'https://example.com/ref-2.png' },
    subFeature: 'first_image',
  });

  assert.deepEqual(next.product.map((item) => item.remoteUrl), [
    'https://example.com/product-1.png',
    'https://example.com/product-2.png',
  ]);
  assert.deepEqual(next.styleRef.map((item) => item.remoteUrl), ['https://example.com/ref-2.png']);
  assert.deepEqual(next.logo.map((item) => item.remoteUrl), ['https://example.com/logo.png']);
});

test('first image provider input urls exclude other style references', () => {
  const imageUrls = buildShellImageInputUrls({
    module: 'one_click',
    subFeature: 'first_image',
    materials: {
      product: [material('product', 'https://example.com/product.png')],
      styleRef: [
        material('styleRef', 'https://example.com/ref-1.png'),
        material('styleRef', 'https://example.com/ref-2.png'),
        material('styleRef', 'https://example.com/ref-3.png'),
      ],
    },
    taskMetadata: {
      sourceReferenceUrl: 'https://example.com/ref-2.png',
    },
  });

  assert.deepEqual(imageUrls, [
    'https://example.com/product.png',
    'https://example.com/ref-2.png',
  ]);
});

test('detail page set replication generation keeps only the current page reference', () => {
  const materials = {
    product: [material('product', 'https://example.com/product.png')],
    styleRef: [
      material('styleRef', 'https://example.com/detail-ref-1.png'),
      material('styleRef', 'https://example.com/detail-ref-2.png'),
      material('styleRef', 'https://example.com/detail-ref-3.png'),
    ],
    logo: [material('logo', 'https://example.com/logo.png')],
  };

  const next = buildOneClickPlanGenerationMaterials({
    baseMaterials: materials,
    plan: { id: 'detail-plan-2', sourceReferenceUrl: 'https://example.com/detail-ref-2.png' },
    subFeature: 'detail_page',
  });

  assert.deepEqual(next.styleRef.map((item) => item.remoteUrl), ['https://example.com/detail-ref-2.png']);

  const imageUrls = buildShellImageInputUrls({
    module: 'one_click',
    subFeature: 'detail_page',
    materials: next,
    taskMetadata: {
      sourceReferenceUrl: 'https://example.com/detail-ref-2.png',
    },
  });

  assert.deepEqual(imageUrls, [
    'https://example.com/product.png',
    'https://example.com/detail-ref-2.png',
    'https://example.com/logo.png',
  ]);
});

test('one click edit provider input urls include only product assets and generated baseline', () => {
  const imageUrls = buildShellImageInputUrls({
    module: 'one_click',
    subFeature: 'main_image',
    materials: {
      product: [material('product', 'https://example.com/product.png')],
      gift: [material('gift', 'https://example.com/gift.png')],
      logo: [material('logo', 'https://example.com/logo.png')],
      reference: [material('reference', 'https://example.com/extra-reference.png')],
    },
    taskMetadata: {
      sourceResultUrl: 'https://example.com/generated.png',
      editInstruction: '把背景换成浅灰色',
    },
  });

  assert.deepEqual(imageUrls, [
    'https://example.com/product.png',
    'https://example.com/gift.png',
    'https://example.com/generated.png',
  ]);
});
