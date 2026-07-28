import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  VOICEOVER_PREVIEW_LANGUAGE,
  VOICEOVER_PREVIEW_LIBRARY_VERSION,
  VOICEOVER_PREVIEW_SAMPLE_TEXT,
  createEmptyVoiceoverPreviewManifest,
  detectVoiceoverPreviewAudio,
  loadVoiceoverPreviewLibrary,
  validateVoiceoverPreviewManifest,
  writeVoiceoverPreviewJsonAtomic,
} from './voiceoverPreviewLibrary.mjs';
import {
  VOICEOVER_TTS_MODEL,
  VOICEOVER_VOICES,
} from '../src/utils/voiceoverCatalog.mjs';

const makeAudio = (format = 'mp3') => {
  const bytes = Buffer.alloc(256, 0x22);
  if (format === 'mp3') bytes.set(Buffer.from('ID3'));
  if (format === 'wav') {
    bytes.set(Buffer.from('RIFF'), 0);
    bytes.set(Buffer.from('WAVE'), 8);
  }
  if (format === 'ogg') bytes.set(Buffer.from('OggS'));
  if (format === 'webm') bytes.set(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (format === 'm4a') bytes.set(Buffer.from('ftyp'), 4);
  return bytes;
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const createLibraryFixture = async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), 'voiceover-preview-library-'));
  const libraryDir = path.join(publicDir, 'voiceover-previews');
  await mkdir(libraryDir, { recursive: true });
  const voices = [];
  for (const voice of VOICEOVER_VOICES) {
    const file = `${voice.name}.mp3`;
    const bytes = makeAudio('mp3');
    await writeFile(path.join(libraryDir, file), bytes);
    voices.push({
      name: voice.name,
      file,
      contentType: 'audio/mpeg',
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  const manifest = {
    ...createEmptyVoiceoverPreviewManifest(),
    voices,
  };
  await writeFile(
    path.join(libraryDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return { publicDir, libraryDir, manifest };
};

test('empty manifest pins the deployable system contract', () => {
  assert.deepEqual(createEmptyVoiceoverPreviewManifest(), {
    version: VOICEOVER_PREVIEW_LIBRARY_VERSION,
    model: VOICEOVER_TTS_MODEL,
    language: VOICEOVER_PREVIEW_LANGUAGE,
    sampleText: VOICEOVER_PREVIEW_SAMPLE_TEXT,
    voices: [],
  });
  assert.equal(VOICEOVER_PREVIEW_LANGUAGE, 'cmn');
  assert.equal(VOICEOVER_PREVIEW_SAMPLE_TEXT, '你好，这是一段口播音色试听。');
});

test('audio detection uses magic bytes and rejects non-audio payloads', () => {
  assert.deepEqual(detectVoiceoverPreviewAudio(makeAudio('mp3'), 'application/octet-stream'), {
    extension: 'mp3',
    contentType: 'audio/mpeg',
  });
  assert.deepEqual(detectVoiceoverPreviewAudio(makeAudio('wav'), 'audio/x-wav'), {
    extension: 'wav',
    contentType: 'audio/wav',
  });
  assert.deepEqual(detectVoiceoverPreviewAudio(makeAudio('ogg'), 'audio/ogg'), {
    extension: 'ogg',
    contentType: 'audio/ogg',
  });
  assert.deepEqual(detectVoiceoverPreviewAudio(makeAudio('webm'), 'audio/webm'), {
    extension: 'webm',
    contentType: 'audio/webm',
  });
  assert.deepEqual(detectVoiceoverPreviewAudio(makeAudio('m4a'), 'audio/mp4'), {
    extension: 'm4a',
    contentType: 'audio/mp4',
  });
  assert.throws(
    () => detectVoiceoverPreviewAudio(Buffer.from('<html>provider error</html>'), 'text/html'),
    (error) => error?.code === 'voiceover_preview_audio_invalid',
  );
});

test('complete manifest maps all catalog voices to deployable static urls', async () => {
  const fixture = await createLibraryFixture();
  try {
    const result = validateVoiceoverPreviewManifest({
      manifest: fixture.manifest,
      libraryDir: fixture.libraryDir,
    });
    assert.equal(result.total, 30);
    assert.equal(result.ready, 30);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    assert.equal(
      result.previewUrlsByVoice.Zephyr,
      '/voiceover-previews/Zephyr.mp3',
    );
    assert.equal(
      result.previewUrlsByVoice.Sulafat,
      '/voiceover-previews/Sulafat.mp3',
    );
    assert.equal(JSON.stringify(result).includes(fixture.publicDir), false);

    const loaded = loadVoiceoverPreviewLibrary({ publicDir: fixture.publicDir });
    assert.equal(loaded.ready, 30);
    assert.equal(loaded.previewUrlsByVoice.Puck, '/voiceover-previews/Puck.mp3');
  } finally {
    await rm(fixture.publicDir, { recursive: true, force: true });
  }
});

test('manifest rejects catalog drift, duplicate voices and unsafe file names', async () => {
  const fixture = await createLibraryFixture();
  try {
    const cases = [
      {
        mutate: (manifest) => manifest.voices.pop(),
        code: 'voiceover_preview_catalog_mismatch',
      },
      {
        mutate: (manifest) => manifest.voices.push({ ...manifest.voices[0] }),
        code: 'voiceover_preview_catalog_mismatch',
      },
      {
        mutate: (manifest) => { manifest.voices[0].name = 'UnknownVoice'; },
        code: 'voiceover_preview_catalog_mismatch',
      },
      {
        mutate: (manifest) => { manifest.voices[0].file = '../Zephyr.mp3'; },
        code: 'voiceover_preview_file_unsafe',
      },
    ];
    for (const { mutate, code } of cases) {
      const manifest = structuredClone(fixture.manifest);
      mutate(manifest);
      const result = validateVoiceoverPreviewManifest({
        manifest,
        libraryDir: fixture.libraryDir,
      });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.code === code), code);
      assert.equal(JSON.stringify(result).includes(fixture.publicDir), false);
    }
  } finally {
    await rm(fixture.publicDir, { recursive: true, force: true });
  }
});

test('one corrupt file is excluded without exposing paths or disabling valid voices', async () => {
  const fixture = await createLibraryFixture();
  try {
    const zephyr = fixture.manifest.voices.find((voice) => voice.name === 'Zephyr');
    zephyr.sha256 = '0'.repeat(64);
    const result = validateVoiceoverPreviewManifest({
      manifest: fixture.manifest,
      libraryDir: fixture.libraryDir,
    });
    assert.equal(result.valid, false);
    assert.equal(result.ready, 29);
    assert.equal(result.previewUrlsByVoice.Zephyr, undefined);
    assert.equal(result.previewUrlsByVoice.Puck, '/voiceover-previews/Puck.mp3');
    assert.deepEqual(result.errors, [{
      code: 'voiceover_preview_file_hash_mismatch',
      voiceName: 'Zephyr',
    }]);
    assert.equal(JSON.stringify(result).includes(fixture.publicDir), false);
  } finally {
    await rm(fixture.publicDir, { recursive: true, force: true });
  }
});

test('missing or unreadable manifest degrades to an empty library', async () => {
  const publicDir = await mkdtemp(path.join(tmpdir(), 'voiceover-preview-missing-'));
  try {
    assert.deepEqual(loadVoiceoverPreviewLibrary({ publicDir }), {
      valid: false,
      total: 30,
      ready: 0,
      previewUrlsByVoice: {},
      errors: [{ code: 'voiceover_preview_manifest_missing' }],
    });
    await mkdir(path.join(publicDir, 'voiceover-previews'), { recursive: true });
    await writeFile(path.join(publicDir, 'voiceover-previews', 'manifest.json'), '{');
    assert.deepEqual(loadVoiceoverPreviewLibrary({ publicDir }), {
      valid: false,
      total: 30,
      ready: 0,
      previewUrlsByVoice: {},
      errors: [{ code: 'voiceover_preview_manifest_invalid' }],
    });
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});

test('json writes are atomic and end with a newline', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'voiceover-preview-json-'));
  try {
    const filePath = path.join(rootDir, 'state.json');
    await writeVoiceoverPreviewJsonAtomic(filePath, { ok: true });
    assert.equal(await readFile(filePath, 'utf8'), '{\n  "ok": true\n}\n');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
