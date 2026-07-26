import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { createMediaTranscodeApi } from './mediaTranscodeApi.mjs';
import { createMediaTranscodeService, runMediaProcess } from './mediaTranscodeService.mjs';
import { createMediaTranscodeSessionStore } from './mediaTranscodeSessionStore.mjs';

const require = createRequire(import.meta.url);

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
  width: 720, height: 1280, frameRate: 30, sizeBytes: 2_000_000, hasAudio: true, containerBrand: 'isom', fastStart: true,
};

function createFakeStore(sessionOverride = {}) {
  const ownedSession = { ...session, ...sessionOverride };
  let state = ownedSession.state;
  const calls = { create: [], updateProbe: [], claimConversion: [], beginPersisting: [], requestCancel: [], remove: [] };
  return {
    calls,
    async create(input) { calls.create.push(input); return { ...ownedSession, profile: input.profile, probe: input.probe || null, state }; },
    async updateProbe(id, userId, probe) { calls.updateProbe.push({ id, userId, probe }); state = 'ready'; return { ...ownedSession, probe, state }; },
    async getOwned(id, userId) {
      if (id !== ownedSession.id || userId !== ownedSession.userId) throw Object.assign(new Error('forbidden'), { code: 'media_session_forbidden' });
      return { ...ownedSession, state };
    },
    async claimConversion(id, userId) {
      calls.claimConversion.push({ id, userId });
      if (state === 'cancelled') throw Object.assign(new Error('cancelled'), { code: 'media_transcode_cancelled' });
      if (state !== 'ready') throw Object.assign(new Error('busy'), { code: 'media_session_busy' });
      state = 'converting';
      return { ...ownedSession, state };
    },
    async beginPersisting(id, userId) {
      calls.beginPersisting.push({ id, userId });
      if (state === 'cancelled') throw Object.assign(new Error('cancelled'), { code: 'media_transcode_cancelled' });
      if (state !== 'converting') throw Object.assign(new Error('busy'), { code: 'media_session_busy' });
      state = 'persisting';
      return { ...ownedSession, state };
    },
    async requestCancel(id, userId) {
      calls.requestCancel.push({ id, userId });
      const current = await this.getOwned(id, userId);
      if (state === 'persisting') return { cancelled: false, remove: false, session: current };
      state = 'cancelled';
      return { cancelled: true, remove: current.state === 'ready' || current.state === 'probing', session: { ...current, state } };
    },
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

test('voiceover session rejects an audio-less server probe before upload completion', async () => {
  const audioLessProbe = { ...canonicalProbe, hasAudio: false, audioCodec: null };
  const store = createFakeStore();
  const api = createMediaTranscodeApi({
    store,
    service: { probe: async () => audioLessProbe },
    persistAsset: async () => {},
  });

  await assert.rejects(
    () => api.createSession({
      userId: 'u1', kind: 'video', profile: 'voiceover_translation', fileName: 'silent.mp4', fileBuffer: Buffer.from('source'),
    }),
    (error) => error?.code === 'media_audio_track_required',
  );
  assert.equal(store.calls.updateProbe.length, 0);
  assert.deepEqual(store.calls.remove, [session.id]);
});

test('compatible whole voiceover source takes the owner-checked managed no-op path', async () => {
  const voiceoverProbe = {
    ...canonicalProbe,
    kind: 'video',
    durationSeconds: 1800,
    width: 1080,
    height: 1920,
    pixelFormat: 'yuv420p',
    hasAudio: true,
    containerBrand: 'isom',
    fastStart: true,
  };
  const store = createFakeStore({
    profile: 'voiceover_translation',
    fileName: 'voiceover.mp4',
    probe: voiceoverProbe,
  });
  let transcodeCalls = 0;
  const api = createMediaTranscodeApi({
    store,
    service: { transcode: async () => { transcodeCalls += 1; } },
    readSource: async () => Buffer.from('already-compatible'),
    persistAsset: async () => ({ assetId: 'asset-voiceover', fileUrl: '/api/assets/asset-voiceover' }),
  });

  const result = await api.convertSession({
    userId: 'u1', sessionId: session.id, startSeconds: 0, endSeconds: 1800, module: 'video',
  });

  assert.equal(transcodeCalls, 0);
  assert.equal(result.transcoded, false);
  assert.equal(result.profile, 'voiceover_translation');
  assert.equal(result.durationSeconds, 1800);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
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

const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('timed out waiting for media operation');
};

const createRealSessionStore = async (t, probe = session.probe) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-api-'));
  const store = createMediaTranscodeSessionStore({ rootDir });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1', kind: 'video', fileName: 'source.mov', fileBuffer: Buffer.from('source'), probe,
  });
  return { store, created };
};

test('two concurrent conversions claim one ready session and persist once', async (t) => {
  const { store, created } = await createRealSessionStore(t);
  let releaseTranscode;
  let transcodeCalls = 0;
  let persisted = 0;
  const gate = new Promise((resolve) => { releaseTranscode = resolve; });
  const api = createMediaTranscodeApi({
    store,
    service: {
      transcode: async () => {
        transcodeCalls += 1;
        await gate;
        return { fileBuffer: Buffer.from('canonical'), metadata: canonicalProbe, mimeType: 'video/mp4' };
      },
    },
    persistAsset: async () => {
      persisted += 1;
      return { assetId: `asset-${persisted}`, fileUrl: `/api/assets/asset-${persisted}` };
    },
  });

  const first = api.convertSession({ userId: 'u1', sessionId: created.id, startSeconds: 1, endSeconds: 6 });
  await waitFor(() => transcodeCalls === 1);
  const second = api.convertSession({ userId: 'u1', sessionId: created.id, startSeconds: 1, endSeconds: 6 });
  second.catch(() => {});
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(transcodeCalls, 1);
  } finally {
    releaseTranscode();
    await Promise.allSettled([first, second]);
  }

  await first;
  await assert.rejects(second, (error) => error?.code === 'media_session_busy');
  assert.equal(persisted, 1);
});

test('cancel wins while a conversion is in progress and prevents persistence', async (t) => {
  const { store, created } = await createRealSessionStore(t);
  let releaseTranscode;
  let started = false;
  let persisted = 0;
  const gate = new Promise((resolve) => { releaseTranscode = resolve; });
  const api = createMediaTranscodeApi({
    store,
    service: {
      transcode: async () => {
        started = true;
        await gate;
        return { fileBuffer: Buffer.from('canonical'), metadata: canonicalProbe, mimeType: 'video/mp4' };
      },
      cancel: async () => false,
    },
    persistAsset: async () => {
      persisted += 1;
      return { assetId: 'asset-cancelled', fileUrl: '/api/assets/asset-cancelled' };
    },
  });

  const conversion = api.convertSession({ userId: 'u1', sessionId: created.id, startSeconds: 1, endSeconds: 6 });
  await waitFor(() => started);
  const cancellation = await api.cancelSession({ userId: 'u1', sessionId: created.id });
  releaseTranscode();

  assert.deepEqual(cancellation, { cancelled: true });
  await assert.rejects(conversion, (error) => error?.code === 'media_transcode_cancelled');
  assert.equal(persisted, 0);
  await assert.rejects(
    () => store.getOwned(created.id, 'u1'),
    (error) => error?.code === 'media_session_not_found',
  );
});

test('an aged active conversion remains cancellable through the service', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-api-'));
  let now = 1_000;
  const store = createMediaTranscodeSessionStore({ rootDir, ttlMs: 100, clock: { now: () => now } });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1', kind: 'video', fileName: 'source.mov', fileBuffer: Buffer.from('source'), probe: session.probe,
  });
  let started = false;
  let cancelCalls = 0;
  let releaseTranscode;
  const gate = new Promise((resolve) => { releaseTranscode = resolve; });
  const api = createMediaTranscodeApi({
    store,
    service: {
      transcode: async () => {
        started = true;
        await gate;
        return { fileBuffer: Buffer.from('canonical'), metadata: canonicalProbe, mimeType: 'video/mp4' };
      },
      cancel: async () => { cancelCalls += 1; return true; },
    },
    persistAsset: async () => { throw new Error('must not persist'); },
  });

  const conversion = api.convertSession({ userId: 'u1', sessionId: created.id, startSeconds: 1, endSeconds: 6 });
  await waitFor(() => started);
  now = 10_000;
  assert.deepEqual(await api.cancelSession({ userId: 'u1', sessionId: created.id }), { cancelled: true });
  assert.equal(cancelCalls, 1);
  releaseTranscode();
  await assert.rejects(conversion, (error) => error?.code === 'media_transcode_cancelled');
});

test('a genuine MOV voiceover source is transcoded instead of being relabelled as MP4', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-voiceover-mov-'));
  const movPath = join(rootDir, 'source.mov');
  const store = createMediaTranscodeSessionStore({ rootDir: join(rootDir, 'sessions') });
  const ffmpegPath = require('ffmpeg-static');
  t.after(async () => { await store.destroy(); await rm(rootDir, { recursive: true, force: true }); });
  await runMediaProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:size=360x640:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '3', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    movPath,
  ], { timeoutMs: 60_000 });
  const api = createMediaTranscodeApi({
    store,
    service: createMediaTranscodeService({ env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1' } }),
    persistAsset: async (input) => ({ assetId: 'asset-mov', fileUrl: '/api/assets/asset-mov', input }),
  });
  const source = await readFile(movPath);
  const created = await api.createSession({
    userId: 'u1', kind: 'video', profile: 'voiceover_translation', fileName: 'source.mov', fileBuffer: source,
  });
  const result = await api.convertSession({
    userId: 'u1', sessionId: created.sessionId, startSeconds: 0, endSeconds: created.durationSeconds,
  });

  assert.equal(created.compatibleSource, false);
  assert.equal(result.transcoded, true);
  assert.equal(result.mimeType, 'video/mp4');
});

test('a faststart H.264/AAC MP4 voiceover source takes the managed no-op path', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-voiceover-mp4-'));
  const mp4Path = join(rootDir, 'source.mp4');
  const store = createMediaTranscodeSessionStore({ rootDir: join(rootDir, 'sessions') });
  const ffmpegPath = require('ffmpeg-static');
  t.after(async () => { await store.destroy(); await rm(rootDir, { recursive: true, force: true }); });
  await runMediaProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:size=360x640:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '3', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-movflags', '+faststart',
    mp4Path,
  ], { timeoutMs: 60_000 });
  let transcodeCalls = 0;
  const api = createMediaTranscodeApi({
    store,
    service: {
      ...createMediaTranscodeService({ env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1' } }),
      transcode: async () => { transcodeCalls += 1; },
    },
    persistAsset: async () => ({ assetId: 'asset-mp4', fileUrl: '/api/assets/asset-mp4' }),
  });
  const created = await api.createSession({
    userId: 'u1', kind: 'video', profile: 'voiceover_translation', fileName: 'source.mp4', fileBuffer: await readFile(mp4Path),
  });
  const result = await api.convertSession({
    userId: 'u1', sessionId: created.sessionId, startSeconds: 0, endSeconds: created.durationSeconds,
  });

  assert.equal(created.compatibleSource, true);
  assert.equal(result.transcoded, false);
  assert.equal(transcodeCalls, 0);
});
