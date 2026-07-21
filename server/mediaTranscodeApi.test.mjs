import test from 'node:test';
import assert from 'node:assert/strict';

import { createMediaTranscodeApi } from './mediaTranscodeApi.mjs';

const session = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: 'u1',
  kind: 'video',
  profile: 'seedance_reference',
  fileName: 'source.mov',
  sourcePath: '/tmp/session/source',
  state: 'ready',
  probe: {
    kind: 'video', durationSeconds: 8, formatNames: ['mov'], videoCodec: 'hevc', audioCodec: 'aac',
    width: 1080, height: 1920, frameRate: 30, sizeBytes: 1_024_000, hasAudio: true,
  },
};

const canonicalProbe = {
  kind: 'video', durationSeconds: 5, formatNames: ['mov', 'mp4'], videoCodec: 'h264', audioCodec: 'aac',
  width: 720, height: 1280, frameRate: 30, sizeBytes: 2_000_000, hasAudio: true,
};

function createFakeStore(sessionOverride = {}) {
  const ownedSession = { ...session, ...sessionOverride };
  const calls = { create: [], updateProbe: [], markConverting: [], remove: [] };
  return {
    calls,
    async create(input) { calls.create.push(input); return { ...ownedSession, profile: input.profile, probe: input.probe || null }; },
    async updateProbe(id, userId, probe) { calls.updateProbe.push({ id, userId, probe }); return { ...ownedSession, probe }; },
    async getOwned(id, userId) {
      if (id !== ownedSession.id || userId !== ownedSession.userId) throw Object.assign(new Error('forbidden'), { code: 'media_session_forbidden' });
      return { ...ownedSession };
    },
    async markConverting(id, userId) { calls.markConverting.push({ id, userId }); return { ...ownedSession, state: 'converting' }; },
    async remove(id) { calls.remove.push(id); return true; },
    async count() { return 1; },
  };
}

test('session creation probes the temporary source and does not persist an asset', async () => {
  const store = createFakeStore();
  const service = { probe: async () => session.probe };
  let persisted = 0;
  const api = createMediaTranscodeApi({
    store,
    service,
    persistAsset: async () => { persisted += 1; },
  });
  const result = await api.createSession({
    userId: 'u1', kind: 'video', profile: 'subtitle_removal', fileName: 'source.mov', fileBuffer: Buffer.from('source'),
  });

  assert.equal(result.durationSeconds, 8);
  assert.equal(result.videoCodec, 'hevc');
  assert.equal(store.calls.updateProbe.length, 1);
  assert.equal(store.calls.create[0].profile, 'subtitle_removal');
  assert.equal(persisted, 0);
});

test('session creation tells the client when the whole source already matches Seedance', async () => {
  const compatibleProbe = { ...canonicalProbe, kind: 'video', pixelFormat: 'yuv420p' };
  const store = createFakeStore({ probe: compatibleProbe });
  const api = createMediaTranscodeApi({
    store,
    service: { probe: async () => compatibleProbe },
    persistAsset: async () => {},
  });

  const result = await api.createSession({
    userId: 'u1', kind: 'video', fileName: 'source.mp4', fileBuffer: Buffer.from('source'),
  });

  assert.equal(result.compatibleSource, true);
});

test('conversion persists only the validated canonical output and removes the session', async () => {
  const store = createFakeStore();
  const persisted = [];
  const service = {
    transcode: async () => ({
      fileBuffer: Buffer.from('canonical'), metadata: canonicalProbe, fileName: 'converted.mp4', mimeType: 'video/mp4',
    }),
  };
  const api = createMediaTranscodeApi({
    store,
    service,
    persistAsset: async (input) => {
      persisted.push(input);
      return { assetId: 'asset-1', url: '/api/assets/asset-1' };
    },
  });
  const result = await api.convertSession({
    userId: 'u1', sessionId: session.id, startSeconds: 1, endSeconds: 6, module: 'video',
  });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].mimeType, 'video/mp4');
  assert.equal(persisted[0].fileBuffer.toString(), 'canonical');
  assert.equal(result.durationSeconds, 5);
  assert.equal(result.url, '/api/assets/asset-1');
  assert.deepEqual(store.calls.remove, [session.id]);
});

test('compatible subtitle source is persisted without FFmpeg and reports the fast path', async () => {
  const compatibleProbe = {
    ...canonicalProbe,
    durationSeconds: 30,
    width: 1080,
    height: 1920,
    pixelFormat: 'yuv420p',
  };
  const store = createFakeStore({
    profile: 'subtitle_removal',
    fileName: 'source.mp4',
    probe: compatibleProbe,
  });
  let transcodeCalls = 0;
  const persisted = [];
  const api = createMediaTranscodeApi({
    store,
    service: { transcode: async () => { transcodeCalls += 1; } },
    readSource: async () => Buffer.from('original-h264'),
    persistAsset: async (input) => {
      persisted.push(input);
      return { assetId: 'asset-fast', fileUrl: '/api/assets/asset-fast' };
    },
  });
  const result = await api.convertSession({
    userId: 'u1',
    sessionId: session.id,
    startSeconds: 0,
    endSeconds: 30,
    profile: 'seedance_reference',
  });

  assert.equal(transcodeCalls, 0);
  assert.equal(persisted[0].fileBuffer.toString(), 'original-h264');
  assert.equal(result.transcoded, false);
  assert.equal(result.profile, 'subtitle_removal');
  assert.deepEqual(store.calls.remove, [session.id]);
});

test('compatible whole Seedance source is persisted without redundant FFmpeg conversion', async () => {
  const store = createFakeStore({
    fileName: 'source.mp4',
    probe: { ...canonicalProbe, kind: 'video', pixelFormat: 'yuv420p' },
  });
  let transcodeCalls = 0;
  const api = createMediaTranscodeApi({
    store,
    service: { transcode: async () => { transcodeCalls += 1; } },
    readSource: async () => Buffer.from('already-compatible'),
    persistAsset: async () => ({ assetId: 'asset-fast', fileUrl: '/api/assets/asset-fast' }),
  });

  const result = await api.convertSession({
    userId: 'u1', sessionId: session.id, startSeconds: 0, endSeconds: 5, module: 'video',
  });

  assert.equal(transcodeCalls, 0);
  assert.equal(result.transcoded, false);
  assert.equal(result.profile, 'seedance_reference');
  assert.deepEqual(store.calls.remove, [session.id]);
});

test('compatible short MP3 is persisted directly with the correct audio MIME type', async () => {
  const audioProbe = {
    kind: 'audio', durationSeconds: 13, formatNames: ['mp3'], audioCodec: 'mp3',
    sizeBytes: 300_000, hasAudio: true,
  };
  const store = createFakeStore({ kind: 'audio', fileName: 'recording.mp3', probe: audioProbe });
  let transcodeCalls = 0;
  const persisted = [];
  const api = createMediaTranscodeApi({
    store,
    service: { transcode: async () => { transcodeCalls += 1; } },
    readSource: async () => Buffer.from('mp3-source'),
    persistAsset: async (input) => {
      persisted.push(input);
      return { assetId: 'asset-audio', fileUrl: '/api/assets/asset-audio' };
    },
  });

  const result = await api.convertSession({
    userId: 'u1', sessionId: session.id, startSeconds: 0, endSeconds: 13, module: 'video',
  });

  assert.equal(transcodeCalls, 0);
  assert.equal(result.transcoded, false);
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(persisted[0].mimeType, 'audio/mpeg');
});

test('incompatible subtitle MOV invokes FFmpeg with the stored profile', async () => {
  const store = createFakeStore({ profile: 'subtitle_removal' });
  const transcodeCalls = [];
  const api = createMediaTranscodeApi({
    store,
    service: {
      transcode: async (input) => {
        transcodeCalls.push(input);
        return {
          fileBuffer: Buffer.from('converted'),
          metadata: { ...canonicalProbe, pixelFormat: 'yuv420p' },
          mimeType: 'video/mp4',
        };
      },
    },
    readSource: async () => Buffer.from('unused'),
    persistAsset: async () => ({ assetId: 'asset-converted', fileUrl: '/api/assets/asset-converted' }),
  });
  const result = await api.convertSession({
    userId: 'u1', sessionId: session.id, startSeconds: 0, endSeconds: 8,
  });

  assert.equal(transcodeCalls.length, 1);
  assert.equal(transcodeCalls[0].profile, 'subtitle_removal');
  assert.equal(result.transcoded, true);
});

test('failed conversion never persists and logs only non-sensitive failure metadata', async () => {
  const store = createFakeStore();
  const logs = [];
  let persisted = 0;
  const api = createMediaTranscodeApi({
    store,
    service: { transcode: async () => { throw Object.assign(new Error('boom'), { code: 'media_process_failed' }); } },
    persistAsset: async () => { persisted += 1; },
    log: (entry) => logs.push(entry),
  });

  await assert.rejects(
    () => api.convertSession({ userId: 'u1', sessionId: session.id, startSeconds: 1, endSeconds: 6, module: 'video' }),
    (error) => error?.code === 'media_process_failed',
  );
  assert.equal(persisted, 0);
  assert.equal(logs.at(-1).action, 'media_transcode_failed');
  assert.equal(JSON.stringify(logs).includes('/tmp/session/source'), false);
  assert.deepEqual(store.calls.remove, [session.id]);
});

test('cancel is owner-checked, aborts active work, and removes temporary files', async () => {
  const store = createFakeStore();
  const cancelled = [];
  const api = createMediaTranscodeApi({
    store,
    service: { cancel: async (id) => { cancelled.push(id); return true; } },
    persistAsset: async () => {},
  });
  assert.deepEqual(await api.cancelSession({ userId: 'u1', sessionId: session.id }), { cancelled: true });
  assert.deepEqual(cancelled, [session.id]);
  assert.deepEqual(store.calls.remove, [session.id]);
});
