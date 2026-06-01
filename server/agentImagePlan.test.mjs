import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractAgentImageUrlsFromText,
  resolveAgentImagePlanInputUrlDetails,
  resolveAgentImagePlanInputUrls,
  shouldRequireAgentImageInput,
} from './agentImagePlan.mjs';

test('agent image plans recover selected references when edit analysis returns empty input urls', () => {
  const refs = [
    { index: 1, label: '图1', url: 'http://111.229.66.247/api/assets/file/a/gray.png' },
    { index: 2, label: '图2', url: 'http://111.229.66.247/api/assets/file/b/white.png' },
    { index: 3, label: '图3', url: 'http://111.229.66.247/api/assets/file/c/pink.png' },
  ];

  const resolved = resolveAgentImagePlanInputUrls({
    parsed: {
      taskType: 'image_edit',
      inputImageUrls: [],
      imageReferences: [],
      prompt: [
        '输入图顺序说明（必须严格按下列顺序理解）',
        '图1：URL=https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/gpt-image-2.png',
        '图2：URL=https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/white.png',
        '图3：URL=https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/pink.png',
        '分别对图1、图2、图3进行文案替换，其他不变。',
      ].join('\n'),
    },
    normalizedRefs: refs,
    imageCapability: { maxInputImages: 3 },
    currentMessage: '分别对图1、图2、图3进行文案替换，其他不变。',
  });

  assert.deepEqual(resolved, refs.map((item) => item.url));
});

test('agent image plans do not force old references for prompt-only image requests', () => {
  const resolved = resolveAgentImagePlanInputUrls({
    parsed: {
      taskType: 'new_image',
      inputImageUrls: [],
      prompt: '生成一张全新的赛博风商品海报。',
    },
    normalizedRefs: [
      { index: 1, label: '图1', url: 'http://111.229.66.247/api/assets/file/old/result.png' },
    ],
    imageCapability: { maxInputImages: 1 },
    currentMessage: '生成一张全新的赛博风商品海报。',
  });

  assert.deepEqual(resolved, []);
});

test('agent image plan text url extraction ignores punctuation around urls', () => {
  assert.deepEqual(
    extractAgentImageUrlsFromText('图1：URL=https://example.com/a.png，图2：(https://example.com/b.jpg)。'),
    ['https://example.com/a.png', 'https://example.com/b.jpg'],
  );
});

test('agent image plans map indexed references back when analysis returns provider temporary urls', () => {
  const refs = [
    { index: 1, label: '图1', url: 'http://111.229.66.247/api/assets/file/a/humidifier.png' },
  ];

  const details = resolveAgentImagePlanInputUrlDetails({
    parsed: {
      taskType: 'image_to_image',
      inputImageUrls: ['https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/gpt-image-2.png'],
      imageReferences: [{ index: 1, type: 'character_reference' }],
      prompt: '基于图1进行修改，保持整体构图不变。',
    },
    normalizedRefs: refs,
    imageCapability: { maxInputImages: 1 },
    currentMessage: '把图1的文字改掉，其他不变。',
  });

  assert.deepEqual(details.urls, [refs[0].url]);
  assert.equal(details.source, 'analysis_image_references');
  assert.equal(details.recovered, false);
});

test('agent image plans recover selected references when analysis returns only unusable provider urls', () => {
  const refs = [
    { index: 1, label: '图1', url: 'http://111.229.66.247/api/assets/file/a/humidifier.png' },
  ];

  const details = resolveAgentImagePlanInputUrlDetails({
    parsed: {
      taskType: 'image_refinement',
      inputImageUrls: ['https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/gpt-image-2.png'],
      imageReferences: [],
      prompt: '基于图1优化背景，保留产品和文字不变。',
    },
    normalizedRefs: refs,
    imageCapability: { maxInputImages: 1 },
    currentMessage: '基于图1优化背景，保留产品和文字不变。',
  });

  assert.deepEqual(details.urls, [refs[0].url]);
  assert.equal(details.source, 'recovered_selected_references_from_unusable_analysis_input');
  assert.equal(details.recovered, true);
});

test('agent image plans require input for image edit and reference instructions', () => {
  assert.equal(shouldRequireAgentImageInput({
    parsed: { taskType: 'image_to_image', prompt: '生成一张图' },
    currentMessage: '',
  }), true);
  assert.equal(shouldRequireAgentImageInput({
    parsed: { taskType: 'new_image', prompt: '基于图1修改文字，其他保持不变' },
    currentMessage: '',
  }), true);
  assert.equal(shouldRequireAgentImageInput({
    parsed: { taskType: 'new_image', prompt: '生成一张全新的海报' },
    currentMessage: '',
  }), false);
});
