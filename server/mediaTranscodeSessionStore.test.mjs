import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMediaTranscodeSessionStore } from './mediaTranscodeSessionStore.mjs';

const videoProbe = {
  kind: 'video',
  durationSeconds: 8,
  formatNames: ['mov'],
  videoCodec: 'hevc',
  audioCodec: 'aac',
  width: 1080,
  height: 1920,
  frameRate: 30,
  sizeBytes: 1024,
  hasAudio: true,
};

test('a temporary session is owner-only and expires by TTL', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  t.after(async () => { await createMediaTranscodeSessionStore({ rootDir }).destroy(); });
  let now = 1_000;
  const store = createMediaTranscodeSessionStore({
    rootDir,
    ttlMs: 10_000,
    clock: { now: () => now },
  });
  const created = await store.create({
    userId: 'u1',
    kind: 'video',
    fileName: 'source.mov',
    fileBuffer: Buffer.from('source'),
    probe: videoProbe,
  });

  await assert.rejects(
    () => store.getOwned(created.id, 'u2'),
    (error) => error?.code === 'media_session_forbidden',
  );
  now = 12_000;
  assert.deepEqual(await store.cleanupExpired(), { removed: 1 });
  assert.equal(await store.count(), 0);
});

test('session sidecars sanitize names and never persist the source path', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  const store = createMediaTranscodeSessionStore({ rootDir });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1',
    kind: 'audio',
    fileName: '../../private voice.wav',
    fileBuffer: Buffer.from('source'),
    probe: null,
  });
  const sidecar = JSON.parse(await readFile(join(rootDir, created.id, 'session.json'), 'utf8'));

  assert.equal(sidecar.fileName, 'private voice.wav');
  assert.equal('sourcePath' in sidecar, false);
  assert.equal(await readFile(created.sourcePath, 'utf8'), 'source');
});

test('session sidecars persist and hydrate the trusted media profile', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  const store = createMediaTranscodeSessionStore({ rootDir });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1',
    kind: 'video',
    profile: 'subtitle_removal',
    fileName: 'subtitle-source.mp4',
    fileBuffer: Buffer.from('source'),
    probe: videoProbe,
  });
  const sidecar = JSON.parse(await readFile(join(rootDir, created.id, 'session.json'), 'utf8'));

  assert.equal(sidecar.profile, 'subtitle_removal');
  assert.equal((await store.getOwned(created.id, 'u1')).profile, 'subtitle_removal');
  await assert.rejects(
    () => store.create({
      userId: 'u1', kind: 'video', profile: 'body_override', fileName: 'bad.mp4', fileBuffer: Buffer.from('x'),
    }),
    (error) => error?.code === 'media_profile_unsupported',
  );
});

test('voiceover sessions persist only the server-owned video profile', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  const store = createMediaTranscodeSessionStore({ rootDir });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1',
    kind: 'video',
    profile: 'voiceover_translation',
    fileName: 'voiceover-source.mp4',
    fileBuffer: Buffer.from('source'),
    probe: videoProbe,
  });

  assert.equal(created.profile, 'voiceover_translation');
  assert.equal((await store.getOwned(created.id, 'u1')).profile, 'voiceover_translation');
  await assert.rejects(
    () => store.create({
      userId: 'u1', kind: 'audio', profile: 'voiceover_translation', fileName: 'voice.mp3', fileBuffer: Buffer.from('x'),
    }),
    (error) => error?.code === 'media_kind_unsupported',
  );
});

test('session probe and conversion state updates are atomic and owner-checked', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  const store = createMediaTranscodeSessionStore({ rootDir });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1', kind: 'video', fileName: 'a.mov', fileBuffer: Buffer.from('x'), probe: null,
  });
  const withProbe = await store.updateProbe(created.id, 'u1', videoProbe);
  const converting = await store.markConverting(created.id, 'u1');

  assert.equal(withProbe.probe.videoCodec, 'hevc');
  assert.equal(converting.state, 'converting');
  await assert.rejects(
    () => store.updateProbe(created.id, 'u2', videoProbe),
    (error) => error?.code === 'media_session_forbidden',
  );
});

test('store rejects unsafe IDs and enforces its environment-sized capacity', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  const store = createMediaTranscodeSessionStore({ rootDir, maxSessions: 1 });
  t.after(async () => { await store.destroy(); });
  await store.create({ userId: 'u1', kind: 'audio', fileName: 'a.wav', fileBuffer: Buffer.from('x') });

  await assert.rejects(
    () => store.getOwned('../escape', 'u1'),
    (error) => error?.code === 'media_session_invalid_id',
  );
  await assert.rejects(
    () => store.create({ userId: 'u1', kind: 'audio', fileName: 'b.wav', fileBuffer: Buffer.from('x') }),
    (error) => error?.code === 'media_session_capacity_reached',
  );
});

test('remove deletes only the UUID child directory', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-store-'));
  const store = createMediaTranscodeSessionStore({ rootDir });
  t.after(async () => { await store.destroy(); });
  const created = await store.create({
    userId: 'u1', kind: 'audio', fileName: 'a.wav', fileBuffer: Buffer.from('x'),
  });
  assert.equal(await store.remove(created.id), true);
  await assert.rejects(() => stat(join(rootDir, created.id)), (error) => error?.code === 'ENOENT');
  assert.equal(await store.remove(created.id), false);
});
