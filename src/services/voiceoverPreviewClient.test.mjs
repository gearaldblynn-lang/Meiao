import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requestVoiceoverPreview,
  waitForVoiceoverPreview,
} from './voiceoverPreviewClient.ts';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('voice preview creation is an explicit authenticated POST', async (t) => {
  const previousLocalStorage = globalThis.localStorage;
  const requests = [];
  globalThis.localStorage = {
    getItem: (key) => key === 'MEIAO_INTERNAL_SESSION_TOKEN' ? 'session-token' : '',
  };
  t.after(() => {
    globalThis.localStorage = previousLocalStorage;
  });

  const result = await requestVoiceoverPreview({
    targetLanguage: 'cmn',
    voiceName: 'Kore',
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        preview: {
          previewId: 'voice-preview-1',
          status: 'processing',
          voiceName: 'Kore',
          targetLanguage: 'cmn',
        },
      }, 202);
    },
  });

  assert.equal(result.status, 'processing');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/voiceover/voice-previews');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    targetLanguage: 'cmn',
    voiceName: 'Kore',
  });
});

test('voice preview polling reuses the preview id until managed audio is ready', async () => {
  const statuses = [
    { previewId: 'voice-preview-1', status: 'processing', voiceName: 'Kore', targetLanguage: 'cmn' },
    {
      previewId: 'voice-preview-1',
      status: 'ready',
      voiceName: 'Kore',
      targetLanguage: 'cmn',
      audioUrl: '/api/assets/file/preview.wav',
    },
  ];
  const requests = [];
  const result = await waitForVoiceoverPreview('voice-preview-1', {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ preview: statuses.shift() });
    },
    sleep: async () => {},
    pollIntervalMs: 1,
    maxAttempts: 3,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.audioUrl, '/api/assets/file/preview.wav');
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.init.method === 'GET'), true);
  assert.equal(
    requests.every((request) => request.url === '/api/voiceover/voice-previews/voice-preview-1'),
    true,
  );
});

test('voice preview surfaces terminal provider failures without resubmitting', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    waitForVoiceoverPreview('voice-preview-2', {
      fetchImpl: async () => {
        fetchCalls += 1;
        return jsonResponse({
          preview: {
            previewId: 'voice-preview-2',
            status: 'failed',
            voiceName: 'Puck',
            targetLanguage: 'en',
            message: 'KIE 余额不足，暂时无法生成试听',
          },
        });
      },
      sleep: async () => {},
      pollIntervalMs: 1,
      maxAttempts: 3,
    }),
    (error) => error?.code === 'voiceover_preview_failed'
      && error?.message === 'KIE 余额不足，暂时无法生成试听',
  );
  assert.equal(fetchCalls, 1);
});
