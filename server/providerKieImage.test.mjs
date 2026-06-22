import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKieImageTaskRequestBody,
  runKieImageJob,
} from './providerKieImage.mjs';

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const createDeps = (overrides = {}) => ({
  kieApiKey: 'test-key',
  createTaskUrl: 'https://api.kie.ai/api/v1/jobs/createTask',
  fetchWithTimeout: async () => createJsonResponse({ code: 200, data: { taskId: 'kie-task-1' } }),
  pollKieTask: async (taskId) => ({
    providerTaskId: taskId,
    providerStage: 'completed',
    providerStatus: 'success',
    result: {
      taskId,
      providerTaskId: taskId,
      imageUrl: 'https://cdn.test/result.png',
      status: 'success',
    },
  }),
  wait: async () => {},
  resolveGenerationMediaUrl: async (url) => `resolved:${url}`,
  ...overrides,
});

test('buildKieImageTaskRequestBody preserves GPT Image 2 image edit payload shape', () => {
  const requestBody = buildKieImageTaskRequestBody({
    payload: {
      model: 'gpt-image-2',
      prompt: 'replace background',
      imageUrls: ['https://cdn.test/source.png'],
      aspectRatio: '1:1',
      resolution: '2K',
    },
    imageUrls: ['https://cdn.test/source.png'],
    prompt: 'replace background',
  });

  assert.equal(requestBody.model, 'gpt-image-2-image-to-image');
  assert.deepEqual(requestBody.input.input_urls, ['https://cdn.test/source.png']);
  assert.equal(requestBody.input.prompt, 'replace background');
  assert.equal(requestBody.input.aspect_ratio, '1:1');
  assert.equal(requestBody.input.resolution, '2K');
  assert.equal('image_input' in requestBody.input, false);
});

test('runKieImageJob resolves duplicate input and prompt media URLs once', async () => {
  const resolved = [];
  let createTaskBody = null;
  await runKieImageJob({
    payload: {
      model: 'gpt-image-2',
      prompt: 'use /api/assets/file/a.png and /api/assets/file/a.png',
      imageUrls: ['/api/assets/file/a.png', '/api/assets/file/a.png'],
      aspectRatio: 'auto',
    },
    signal: new AbortController().signal,
    options: {},
    deps: createDeps({
      resolveGenerationMediaUrl: async (url) => {
        resolved.push(url);
        return `https://public.test${url}`;
      },
      fetchWithTimeout: async (_url, init) => {
        createTaskBody = JSON.parse(init.body);
        return createJsonResponse({ code: 200, data: { taskId: 'kie-task-1' } });
      },
    }),
  });

  assert.deepEqual(resolved, ['/api/assets/file/a.png']);
  assert.deepEqual(createTaskBody.input.input_urls, [
    'https://public.test/api/assets/file/a.png',
    'https://public.test/api/assets/file/a.png',
  ]);
  assert.match(createTaskBody.input.prompt, /https:\/\/public\.test\/api\/assets\/file\/a\.png/);
});

test('runKieImageJob notifies provider task id before polling completes', async () => {
  const events = [];
  await runKieImageJob({
    payload: { model: 'nano-banana-2', prompt: 'test', imageUrls: [] },
    signal: new AbortController().signal,
    options: {
      onProviderTaskId: async (taskId) => events.push(`notify:${taskId}`),
    },
    deps: createDeps({
      pollKieTask: async (taskId) => {
        events.push(`poll:${taskId}`);
        return {
          providerTaskId: taskId,
          providerStage: 'completed',
          providerStatus: 'success',
          result: { imageUrl: 'https://cdn.test/result.png' },
        };
      },
    }),
  });

  assert.deepEqual(events, ['notify:kie-task-1', 'poll:kie-task-1']);
});

test('runKieImageJob attaches provider task id when polling fails', async () => {
  await assert.rejects(
    () => runKieImageJob({
      payload: { model: 'nano-banana-2', prompt: 'test', imageUrls: [] },
      signal: new AbortController().signal,
      options: {},
      deps: createDeps({
        pollKieTask: async () => {
          const error = new Error('bad input');
          error.code = 'provider_bad_request';
          throw error;
        },
      }),
    }),
    (error) => error?.code === 'provider_bad_request'
      && error?.providerTaskId === 'kie-task-1'
      && /bad input/.test(error.message)
  );
});
