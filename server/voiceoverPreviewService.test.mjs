import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createVoiceoverPreviewService } from './voiceoverPreviewService.mjs';

const createFixture = async (overrides = {}) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'meiao-voice-preview-'));
  const calls = [];
  const service = createVoiceoverPreviewService({
    rootDir,
    env: { KIE_API_KEY: 'test-key', MEIAO_VOICEOVER_ENABLED: '1' },
    executeProviderJob: async (job, _env, _signal, options) => {
      calls.push(job);
      await options.onProviderTaskId('preview-provider-1');
      return {
        providerTaskId: 'preview-provider-1',
        result: { audioUrl: 'https://provider.example/preview.wav' },
      };
    },
    persistAudio: async ({ remoteUrl }) => `/api/assets/file/cached-preview/${path.basename(remoteUrl)}`,
    ...overrides,
  });
  return {
    rootDir,
    calls,
    service,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  };
};

const waitUntil = async (predicate, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('preview service did not settle');
};

const waitForPersistedStatus = async (rootDir, previewId, expectedStatus) => (
  waitUntil(async () => {
    const raw = JSON.parse(await readFile(path.join(rootDir, 'registry.json'), 'utf8'));
    return raw.records?.find((record) => (
      record.previewId === previewId && record.status === expectedStatus
    ));
  })
);

test('one explicit preview request creates one provider task and reuses the persisted audio across languages', async (t) => {
  let nowMs = 1_000_000;
  const fixture = await createFixture({ now: () => nowMs });
  t.after(fixture.cleanup);

  const first = await fixture.service.request({
    userId: 'user-1',
    targetLanguage: 'cmn',
    voiceName: 'Kore',
  });
  assert.equal(first.status, 'processing');

  const ready = await waitUntil(async () => {
    const current = await fixture.service.get({
      userId: 'user-1',
      previewId: first.previewId,
    });
    return current.status === 'ready' ? current : null;
  });
  assert.equal(ready.audioUrl, '/api/assets/file/cached-preview/preview.wav');
  assert.equal(fixture.calls.length, 1);

  nowMs += 365 * 24 * 60 * 60 * 1_000;
  const cached = await fixture.service.request({
    userId: 'user-1',
    targetLanguage: 'en',
    voiceName: 'Kore',
  });
  assert.equal(cached.status, 'ready');
  assert.equal(cached.previewId, first.previewId);
  assert.equal(fixture.calls.length, 1);
});

test('legacy language-scoped previews are reused by voice without another provider call', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'meiao-voice-preview-legacy-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    records: [{
      userId: 'legacy-user',
      previewId: 'voice-preview-legacy-english',
      status: 'ready',
      voiceName: 'Puck',
      targetLanguage: 'en',
      audioUrl: '/api/assets/file/legacy-puck.wav',
      readyAt: 1_000,
      updatedAt: 1_000,
    }],
  }), 'utf8');
  const calls = [];
  const service = createVoiceoverPreviewService({
    rootDir,
    executeProviderJob: async (job) => {
      calls.push(job);
      throw new Error('legacy preview must not resubmit');
    },
    persistAudio: async () => {
      throw new Error('legacy preview must not persist again');
    },
  });

  const reused = await service.request({
    userId: 'legacy-user',
    targetLanguage: 'cmn',
    voiceName: 'Puck',
  });

  assert.equal(reused.status, 'ready');
  assert.equal(reused.previewId, 'voice-preview-legacy-english');
  assert.equal(reused.audioUrl, '/api/assets/file/legacy-puck.wav');
  assert.equal(calls.length, 0);
});

test('legacy unknown previews block a new cross-language paid submission', async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'meiao-voice-preview-legacy-unknown-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    records: [{
      userId: 'legacy-user',
      previewId: 'voice-preview-legacy-unknown',
      status: 'unknown',
      voiceName: 'Puck',
      targetLanguage: 'en',
      providerTaskId: 'provider-submission-unknown',
      message: '上游提交状态未知',
      createdAt: 1_000,
      updatedAt: 1_000,
    }],
  }), 'utf8');
  const calls = [];
  const service = createVoiceoverPreviewService({
    rootDir,
    executeProviderJob: async (job) => {
      calls.push(job);
      throw new Error('unknown legacy preview must not resubmit');
    },
    persistAudio: async () => {
      throw new Error('unknown legacy preview must not persist');
    },
  });

  const protectedResult = await service.request({
    userId: 'legacy-user',
    targetLanguage: 'cmn',
    voiceName: 'Puck',
  });

  assert.equal(protectedResult.status, 'unknown');
  assert.equal(protectedResult.previewId, 'voice-preview-legacy-unknown');
  assert.equal(calls.length, 0);
});

test('a reused persisted preview is re-pinned before its URL is returned', async (t) => {
  const pinned = [];
  const fixture = await createFixture({
    ensureAudioPersistent: async (record) => {
      pinned.push(record);
    },
  });
  t.after(fixture.cleanup);

  const first = await fixture.service.request({
    userId: 'user-persistent',
    targetLanguage: 'en',
    voiceName: 'Kore',
  });
  await waitUntil(async () => {
    const current = await fixture.service.get({
      userId: 'user-persistent',
      previewId: first.previewId,
    });
    return current.status === 'ready';
  });
  pinned.length = 0;

  const reused = await fixture.service.request({
    userId: 'user-persistent',
    targetLanguage: 'en',
    voiceName: 'Kore',
  });
  assert.equal(reused.status, 'ready');
  assert.deepEqual(pinned, [{
    userId: 'user-persistent',
    previewId: reused.previewId,
    voiceName: 'Kore',
    targetLanguage: 'en',
    audioUrl: '/api/assets/file/cached-preview/preview.wav',
  }]);
  assert.equal(fixture.calls.length, 1);
});

test('cross-language clicks while a preview is processing do not submit twice', async (t) => {
  let releaseProvider;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const fixture = await createFixture({
    executeProviderJob: async (job, _env, _signal, options) => {
      fixture.calls.push(job);
      await options.onProviderTaskId('preview-provider-pending');
      await providerGate;
      return {
        providerTaskId: 'preview-provider-pending',
        result: { audioUrl: 'https://provider.example/pending.wav' },
      };
    },
  });
  t.after(fixture.cleanup);

  const input = { userId: 'user-1', targetLanguage: 'en', voiceName: 'Puck' };
  const [first, duplicate] = await Promise.all([
    fixture.service.request(input),
    fixture.service.request({ ...input, targetLanguage: 'cmn' }),
  ]);
  assert.equal(first.previewId, duplicate.previewId);
  assert.equal(first.status, 'processing');
  assert.equal(duplicate.status, 'processing');
  assert.equal(fixture.calls.length, 1);
  releaseProvider();
  await waitForPersistedStatus(fixture.rootDir, first.previewId, 'ready');
});

test('persisted previews remain isolated to the account that generated them', async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const first = await fixture.service.request({
    userId: 'account-a',
    targetLanguage: 'en',
    voiceName: 'Puck',
  });
  await waitUntil(async () => {
    const current = await fixture.service.get({
      userId: 'account-a',
      previewId: first.previewId,
    });
    return current.status === 'ready';
  });

  const second = await fixture.service.request({
    userId: 'account-b',
    targetLanguage: 'cmn',
    voiceName: 'Puck',
  });
  assert.equal(second.status, 'processing');
  assert.notEqual(second.previewId, first.previewId);
  assert.equal(fixture.calls.length, 2);
  await waitForPersistedStatus(fixture.rootDir, second.previewId, 'ready');
});

test('provider task id is checkpointed before polling result completion', async (t) => {
  let releaseProvider;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const fixture = await createFixture({
    executeProviderJob: async (_job, _env, _signal, options) => {
      await options.onProviderTaskId('preview-provider-checkpoint');
      await providerGate;
      return {
        providerTaskId: 'preview-provider-checkpoint',
        result: { audioUrl: 'https://provider.example/checkpoint.wav' },
      };
    },
  });
  t.after(fixture.cleanup);

  const requested = await fixture.service.request({
    userId: 'user-2',
    targetLanguage: 'ja',
    voiceName: 'Aoede',
  });
  await waitUntil(async () => {
    const raw = JSON.parse(await readFile(path.join(fixture.rootDir, 'registry.json'), 'utf8'));
    return raw.records?.[0]?.providerTaskId === 'preview-provider-checkpoint';
  });
  releaseProvider();
  await waitForPersistedStatus(fixture.rootDir, requested.previewId, 'ready');
});

test('preview validates catalog values before any paid provider call', async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  await assert.rejects(
    fixture.service.request({
      userId: 'user-1',
      targetLanguage: 'not-a-language',
      voiceName: 'Kore',
    }),
    (error) => error?.code === 'voiceover_preview_invalid',
  );
  await assert.rejects(
    fixture.service.request({
      userId: 'user-1',
      targetLanguage: 'cmn',
      voiceName: 'not-a-voice',
    }),
    (error) => error?.code === 'voiceover_preview_invalid',
  );
  assert.equal(fixture.calls.length, 0);
});
