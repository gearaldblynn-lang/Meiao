import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pollKieTask,
  probeKieTaskOnce,
} from './providerKieTask.mjs';

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('probeKieTaskOnce reads a submitted task once and preserves providerTaskId', async () => {
  const requests = [];
  const result = await probeKieTaskOnce('kie-task-1', {
    kieApiKey: 'test-key',
    fetchWithTimeout: async (url, init) => {
      requests.push({ url: String(url), init });
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/image.png'] }),
          creditsConsumed: 2,
          usage: { credits: 2 },
          model: 'nano-banana-2',
        },
      });
    },
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/v1\/jobs\/recordInfo\?taskId=kie-task-1$/);
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key');
  assert.equal(result.providerTaskId, 'kie-task-1');
  assert.equal(result.providerStatus, 'success');
  assert.equal(result.result.imageUrl, 'https://cdn.test/image.png');
  assert.equal(result.result.creditsConsumed, 2);
  assert.deepEqual(result.result.usage, { credits: 2 });
  assert.equal(result.result.providerModel, 'nano-banana-2');
});

test('probeKieTaskOnce returns an exclusive videoUrl for completed video tasks', async () => {
  const result = await probeKieTaskOnce('kie-video-task', {
    kieApiKey: 'test-key',
    isVideo: true,
    fetchWithTimeout: async () => createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/video.mp4'] }),
        model: 'bytedance/seedance-2-fast',
      },
    }),
  });

  assert.equal(result.result.videoUrl, 'https://cdn.test/video.mp4');
  assert.equal(Object.hasOwn(result.result, 'imageUrl'), false);
});

test('probeKieTaskOnce returns pending state without long polling', async () => {
  let calls = 0;
  const result = await probeKieTaskOnce('kie-task-pending', {
    kieApiKey: 'test-key',
    fetchWithTimeout: async () => {
      calls += 1;
      return createJsonResponse({ code: 200, data: { state: 'running' } });
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.providerTaskId, 'kie-task-pending');
  assert.equal(result.providerStage, 'polling');
  assert.equal(result.providerStatus, 'running');
  assert.deepEqual(result.result, {
    taskId: 'kie-task-pending',
    providerTaskId: 'kie-task-pending',
    status: 'running',
  });
});

test('pollKieTask tolerates warmup not-found responses before success', async () => {
  const waits = [];
  const responses = [
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/recovered.png'] }),
      },
    }),
  ];
  const result = await pollKieTask('kie-task-warmup', {
    kieApiKey: 'test-key',
    fetchWithTimeout: async () => responses.shift(),
    wait: async (ms) => waits.push(ms),
  });

  assert.deepEqual(waits, [4000]);
  assert.equal(result.providerTaskId, 'kie-task-warmup');
  assert.equal(result.result.imageUrl, 'https://cdn.test/recovered.png');
});

test('pollKieTask attaches providerTaskId to terminal provider failures', async () => {
  await assert.rejects(
    () => pollKieTask('kie-task-failed', {
      kieApiKey: 'test-key',
      fetchWithTimeout: async () => createJsonResponse({
        code: 200,
        data: {
          state: 'fail',
          failMsg: 'bad input',
        },
      }),
    }),
    (error) => error?.code === 'provider_bad_request'
      && error?.providerTaskId === 'kie-task-failed'
      && error?.providerStatus === 'failed'
      && /bad input/.test(error.message)
  );
});
