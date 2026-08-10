import assert from 'node:assert/strict';
import test from 'node:test';

import { persistManagedRemoteJobOutput, prepareKieTtsOutputForPersistence } from './jobOutputAssetPersistence.mjs';

test('kie tts audio persistence retries the same provider URL and returns only a managed result after persistence', async () => {
  const remoteUrl = 'https://provider.example/group-0.wav';
  const calls = [];
  const job = {
    id: 'tts-child-1', userId: 'user-1', module: 'video', provider: 'kie', taskType: 'kie_tts',
    payload: { parentJobId: 'voiceover-parent-1' },
  };
  const input = { audioUrl: remoteUrl };
  let attempt = 0;
  const persistRemoteAsset = async (options) => {
    calls.push(options);
    attempt += 1;
    if (attempt === 1) throw Object.assign(new Error('download failed'), { code: 'provider_network_error' });
    return { id: 'managed-audio-1', publicUrl: '/api/assets/file/managed-audio-1/group-0.wav', mimeType: 'audio/wav' };
  };

  await assert.rejects(
    persistManagedRemoteJobOutput({ job, result: input, publicBaseUrl: 'https://meiao.example.com', persistRemoteAsset, now: () => 1_700_000_000_000 }),
    (error) => error?.code === 'provider_network_error',
  );
  const persisted = await persistManagedRemoteJobOutput({ job, result: input, publicBaseUrl: 'https://meiao.example.com', persistRemoteAsset, now: () => 1_700_000_000_000 });

  assert.deepEqual(calls.map((item) => item.remoteUrl), [remoteUrl, remoteUrl]);
  assert.equal(calls[1].jobId, 'voiceover-parent-1');
  assert.equal(calls[1].assetType, 'intermediate');
  assert.equal(calls[1].expiresAt, 1_700_259_200_000);
  assert.equal(persisted.audioUrl, '/api/assets/file/managed-audio-1/group-0.wav');
  assert.equal(persisted.audioUrlAssetId, 'managed-audio-1');
  assert.equal('audioUrlRemoteUrl' in persisted, false);
  assert.equal(input.audioUrl, remoteUrl);
});

test('kie tts output fails closed without a parent job before persistence', async () => {
  let calls = 0;
  await assert.rejects(
    persistManagedRemoteJobOutput({
      job: { id: 'tts-child-1', userId: 'user-1', module: 'video', provider: 'kie', taskType: 'kie_tts', payload: {} },
      result: { audioUrl: 'https://provider.example/group-0.mp3' },
      publicBaseUrl: 'https://meiao.example.com',
      persistRemoteAsset: async () => { calls += 1; },
    }),
    (error) => error?.code === 'voiceover_parent_job_missing',
  );
  assert.equal(calls, 0);
});

test('kie tts output rejects an invalid parent job before persistence', async () => {
  let calls = 0;
  await assert.rejects(
    persistManagedRemoteJobOutput({
      job: {
        id: 'tts-child-1', userId: 'user-1', module: 'video', provider: 'kie', taskType: 'kie_tts',
        payload: { parentJobId: 'not a valid job id' },
      },
      result: { audioUrl: 'https://provider.example/group-0.mp3' },
      publicBaseUrl: 'https://meiao.example.com',
      persistRemoteAsset: async () => { calls += 1; },
    }),
    (error) => error?.code === 'voiceover_parent_job_missing',
  );
  assert.equal(calls, 0);
});

test('kie tts external audio fails closed without a persistent public base', () => {
  assert.throws(
    () => prepareKieTtsOutputForPersistence({
      job: { taskType: 'kie_tts', payload: { parentJobId: 'voiceover-parent-1' } },
      result: { audioUrl: 'https://provider.example/group-0.mp3' },
      publicBaseUrl: '',
    }),
    (error) => error?.code === 'managed_asset_public_base_unavailable',
  );
});

test('kie tts managed audio may pass without a public base but never retains a remote URL leak', () => {
  const prepared = prepareKieTtsOutputForPersistence({
    job: { taskType: 'kie_tts', payload: { parentJobId: 'voiceover-parent-1' } },
    result: {
      audioUrl: '/api/assets/file/managed-audio-1/group-0.wav',
      audioUrlRemoteUrl: 'https://provider.example/group-0.wav',
    },
    publicBaseUrl: '',
  });
  assert.equal(prepared.audioUrl, '/api/assets/file/managed-audio-1/group-0.wav');
  assert.equal('audioUrlRemoteUrl' in prepared, false);
});

test('video and file remote outputs retain existing managed URL and remote URL behavior', async () => {
  const result = await persistManagedRemoteJobOutput({
    job: { id: 'job-1', userId: 'user-1', module: 'video', provider: 'kie', taskType: 'video' },
    result: { videoUrl: 'https://provider.example/output.mp4', fileUrl: 'https://provider.example/output.bin' },
    publicBaseUrl: 'https://meiao.example.com',
    persistRemoteAsset: async ({ remoteUrl }) => ({ id: remoteUrl.endsWith('.mp4') ? 'video-1' : 'file-1', publicUrl: `/api/assets/file/${remoteUrl.endsWith('.mp4') ? 'video-1' : 'file-1'}/out` }),
  });
  assert.equal(result.videoUrl, '/api/assets/file/video-1/out');
  assert.equal(result.videoUrlRemoteUrl, 'https://provider.example/output.mp4');
  assert.equal(result.fileUrl, '/api/assets/file/file-1/out');
  assert.equal(result.fileUrlRemoteUrl, 'https://provider.example/output.bin');
});
