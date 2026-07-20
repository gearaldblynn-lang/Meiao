import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIDEO_MATERIAL_MENTION_PARAM,
  buildVideoMaterialMentionCandidates,
  compileVideoMaterialMentions,
  findVideoMaterialMentionQuery,
  insertVideoMaterialMention,
  parseVideoMaterialMentionBindings,
  upsertVideoMaterialMentionBinding,
} from './videoMaterialMentions.mjs';

const image = (id, fileName = id + '.png') => ({
  id,
  type: 'product',
  url: 'https://cdn.test/' + fileName,
  fileName,
});

test('uses a dedicated form parameter for material mention bindings', () => {
  assert.equal(VIDEO_MATERIAL_MENTION_PARAM, 'videoMaterialMentionBindings');
});

test('parses only bounded valid bindings and removes label or material duplicates', () => {
  const parsed = parseVideoMaterialMentionBindings(JSON.stringify([
    { label: '@图片1', materialId: 'product-1', kind: 'image', sourceType: 'product' },
    { label: '@图片1', materialId: 'product-2', kind: 'image', sourceType: 'product' },
    { label: '@图片2', materialId: 'product-1', kind: 'image', sourceType: 'product' },
    { label: '@视频1', materialId: 'video-1', kind: 'video', sourceType: 'referenceVideo' },
    { label: '@音频1', materialId: 'bad-kind', kind: 'image', sourceType: 'audio' },
    { label: '@图片3', materialId: '', kind: 'image', sourceType: 'scene' },
  ]));

  assert.deepEqual(parsed, [
    { label: '@图片1', materialId: 'product-1', kind: 'image', sourceType: 'product' },
    { label: '@视频1', materialId: 'video-1', kind: 'video', sourceType: 'referenceVideo' },
  ]);
  assert.deepEqual(parseVideoMaterialMentionBindings('{broken'), []);
  assert.equal(parseVideoMaterialMentionBindings(Array.from({ length: 40 }, (_, index) => ({
    label: '@图片' + (index + 1),
    materialId: 'image-' + (index + 1),
    kind: 'image',
    sourceType: 'product',
  }))).length, 32);
});

test('builds current-task candidates with modality-local labels and preserves stable bindings', () => {
  const candidates = buildVideoMaterialMentionCandidates({
    product: [image('product-1', '主图.png')],
    scene: [{ ...image('scene-1', '场景.png'), type: 'scene' }],
    referenceVideo: [{ id: 'video-1', type: 'referenceVideo', url: 'https://cdn.test/demo.mp4', fileName: '运镜.mp4' }],
    audio: [{ id: 'audio-1', type: 'audio', url: 'https://cdn.test/music.mp3', fileName: '音乐.mp3' }],
    logo: [image('ignored-logo')],
  }, [
    { label: '@图片3', materialId: 'scene-1', kind: 'image', sourceType: 'scene' },
  ]);

  assert.deepEqual(candidates.map(({ label, materialId, kind, sourceType }) => ({ label, materialId, kind, sourceType })), [
    { label: '@图片1', materialId: 'product-1', kind: 'image', sourceType: 'product' },
    { label: '@图片3', materialId: 'scene-1', kind: 'image', sourceType: 'scene' },
    { label: '@视频1', materialId: 'video-1', kind: 'video', sourceType: 'referenceVideo' },
    { label: '@音频1', materialId: 'audio-1', kind: 'audio', sourceType: 'audio' },
  ]);
});

test('reuses a binding for the same material and never reassigns an occupied label', () => {
  const initial = [
    { label: '@图片1', materialId: 'product-1', kind: 'image', sourceType: 'product' },
  ];
  assert.deepEqual(upsertVideoMaterialMentionBinding(initial, {
    label: '@图片2', materialId: 'product-1', kind: 'image', sourceType: 'product',
  }), initial);
  assert.deepEqual(upsertVideoMaterialMentionBinding(initial, {
    label: '@图片1', materialId: 'scene-1', kind: 'image', sourceType: 'scene',
  }), [
    ...initial,
    { label: '@图片2', materialId: 'scene-1', kind: 'image', sourceType: 'scene' },
  ]);
});

test('finds an active at-query at the caret and inserts the selected mention', () => {
  assert.deepEqual(findVideoMaterialMentionQuery('参考 @场景', 6), {
    start: 3,
    end: 6,
    query: '场景',
  });
  assert.equal(findVideoMaterialMentionQuery('参考 @场景 运镜', 9), null);

  assert.deepEqual(insertVideoMaterialMention({
    prompt: '参考 @场景 运镜',
    start: 3,
    end: 6,
    label: '@图片2',
  }), {
    prompt: '参考 @图片2 运镜',
    caret: 7,
  });
});

test('compiles stable bindings against the exact provider snapshot and keeps manual mentions unchanged', () => {
  const result = compileVideoMaterialMentions({
    prompt: '主体 @图片3，运镜 @视频2，手动 @音频2',
    materials: {
      product: [image('new-product')],
      scene: [{ ...image('scene-1'), type: 'scene' }],
      referenceVideo: [{ id: 'video-1' }],
    },
    references: [
      { materialId: 'new-product', kind: 'image', sourceType: 'product', providerOrdinal: 1 },
      { materialId: 'scene-1', kind: 'image', sourceType: 'scene', providerOrdinal: 2 },
      { materialId: 'video-1', kind: 'video', sourceType: 'referenceVideo', providerOrdinal: 1 },
    ],
    bindings: [
      { label: '@图片3', materialId: 'scene-1', kind: 'image', sourceType: 'scene' },
      { label: '@视频2', materialId: 'video-1', kind: 'video', sourceType: 'referenceVideo' },
    ],
  });

  assert.equal(result.compiledPrompt, '主体 @图片2，运镜 @视频1，手动 @音频2');
  assert.deepEqual(result.manifest, [
    {
      label: '@图片3', materialId: 'scene-1', kind: 'image', sourceType: 'scene',
      providerOrdinal: 2, providerLabel: '@图片2',
    },
    {
      label: '@视频2', materialId: 'video-1', kind: 'video', sourceType: 'referenceVideo',
      providerOrdinal: 1, providerLabel: '@视频1',
    },
  ]);
});

test('compiles swapped mention labels in a single pass without cascading replacements', () => {
  const result = compileVideoMaterialMentions({
    prompt: '@图片1 跟随 @图片2',
    materials: { product: [image('first'), image('second')] },
    references: [
      { materialId: 'second', kind: 'image', sourceType: 'product', providerOrdinal: 1 },
      { materialId: 'first', kind: 'image', sourceType: 'product', providerOrdinal: 2 },
    ],
    bindings: [
      { label: '@图片1', materialId: 'first', kind: 'image', sourceType: 'product' },
      { label: '@图片2', materialId: 'second', kind: 'image', sourceType: 'product' },
    ],
  });
  assert.equal(result.compiledPrompt, '@图片2 跟随 @图片1');
});

test('rejects deleted and unresolved bound materials before provider submission', () => {
  assert.throws(() => compileVideoMaterialMentions({
    prompt: '@视频1 的运镜',
    materials: { referenceVideo: [] },
    references: [],
    bindings: [{ label: '@视频1', materialId: 'gone', kind: 'video', sourceType: 'referenceVideo' }],
  }), /@视频1 对应素材已移除/);

  assert.throws(() => compileVideoMaterialMentions({
    prompt: '混合 @音频1',
    materials: { audio: [{ id: 'audio-uploading', fileName: '上传中.wav' }] },
    references: [],
    bindings: [{ label: '@音频1', materialId: 'audio-uploading', kind: 'audio', sourceType: 'audio' }],
  }), /@音频1 对应素材尚未准备完成/);
});
