import test from 'node:test';
import assert from 'node:assert/strict';

import { runBuiltinMediaTool } from './smartFactoryMediaToolRunner.mjs';

test('builtin image tool submits normalized provider job without exposing credentials', async () => {
  const jobs = [];
  const messages = await runBuiltinMediaTool({
    executorRef: 'media.generate_image',
    args: {
      prompt: '生成一张白底商品图',
      input_image_urls: ['https://asset.test/a.png', 'https://asset.test/a.png'],
      aspect_ratio: '1:1',
    },
    tool: { modelProvider: 'kie', model: 'gpt-image-2' },
    env: { KIE_API_KEY: 'sk-secret' },
    executeProvider: async (job) => {
      jobs.push(job);
      return {
        providerTaskId: 'task-img-1',
        result: { imageUrl: 'https://result.test/image.png', status: 'success' },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].taskType, 'kie_image');
  assert.equal(jobs[0].provider, 'kie');
  assert.equal(jobs[0].payload.prompt, '生成一张白底商品图');
  assert.equal(jobs[0].payload.model, 'gpt-image-2');
  assert.deepEqual(jobs[0].payload.imageUrls, ['https://asset.test/a.png']);
  assert.equal(jobs[0].payload.aspectRatio, '1:1');
  assert.equal(JSON.stringify(jobs).includes('sk-secret'), false);
  assert.equal(messages[0].type, 'link');
  assert.equal(messages[0].message.text, 'https://result.test/image.png');
});

test('builtin video tool maps veo model to existing video provider job', async () => {
  const jobs = [];
  const messages = await runBuiltinMediaTool({
    executorRef: 'media.generate_video',
    args: {
      prompt: '用商品图生成 5 秒展示视频',
      image_urls: ['https://asset.test/product.png'],
      aspect_ratio: '9:16',
      duration: 8,
    },
    tool: { modelProvider: 'kie', model: 'veo3_fast' },
    executeProvider: async (job) => {
      jobs.push(job);
      return {
        providerTaskId: 'task-video-1',
        result: { videoUrl: 'https://result.test/video.mp4', status: 'submitted' },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].taskType, 'kie_veo');
  assert.equal(jobs[0].provider, 'kie');
  assert.equal(jobs[0].payload.script.description, '用商品图生成 5 秒展示视频');
  assert.deepEqual(jobs[0].payload.imageUrls, ['https://asset.test/product.png']);
  assert.equal(jobs[0].payload.aspectRatio, '9:16');
  assert.equal(messages[0].type, 'link');
  assert.equal(messages[0].message.text, 'https://result.test/video.mp4');
});

test('builtin video tool maps seedance fast model to kie seedance provider job', async () => {
  const jobs = [];
  const messages = await runBuiltinMediaTool({
    executorRef: 'media.generate_video',
    args: {
      prompt: '用商品图生成 Seedance 快速视频',
      image_urls: ['https://asset.test/product.png'],
      aspect_ratio: '16:9',
      duration: 6,
    },
    tool: { modelProvider: 'kie', model: 'bytedance/seedance-2-fast' },
    executeProvider: async (job) => {
      jobs.push(job);
      return {
        providerTaskId: 'task-seedance-fast-1',
        result: { videoUrl: 'https://result.test/seedance-fast.mp4', status: 'submitted' },
      };
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].taskType, 'kie_seedance_video');
  assert.equal(jobs[0].provider, 'kie');
  assert.equal(jobs[0].payload.prompt, '用商品图生成 Seedance 快速视频');
  assert.deepEqual(jobs[0].payload.imageUrls, ['https://asset.test/product.png']);
  assert.equal(jobs[0].payload.duration, 6);
  assert.equal(jobs[0].payload.aspectRatio, '16:9');
  assert.equal(jobs[0].payload.resolution, '720p');
  assert.equal(messages[0].type, 'link');
  assert.equal(messages[0].message.text, 'https://result.test/seedance-fast.mp4');
});
