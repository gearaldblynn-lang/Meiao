import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildVoiceoverPreviewProviderJob,
  generateVoiceoverPreviewLibrary,
  keepVoiceoverPreviewProcessAlive,
} from './generate-voiceover-preview-library.mjs';
import {
  VOICEOVER_PREVIEW_LANGUAGE,
  VOICEOVER_PREVIEW_SAMPLE_TEXT,
  createEmptyVoiceoverPreviewManifest,
} from '../server/voiceoverPreviewLibrary.mjs';
import { VOICEOVER_VOICES } from '../src/utils/voiceoverCatalog.mjs';

const mp3Bytes = () => {
  const bytes = Buffer.alloc(256, 0x11);
  bytes.set(Buffer.from('ID3'));
  return bytes;
};

const createFixture = async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'voiceover-preview-generator-'));
  await mkdir(path.join(rootDir, 'public', 'voiceover-previews'), { recursive: true });
  await mkdir(path.join(rootDir, 'server', 'data'), { recursive: true });
  return rootDir;
};

const fakeAudioResponse = (bytes = mp3Bytes()) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'audio/mpeg' }),
  arrayBuffer: async () => bytes,
});

test('provider jobs use the catalog index and one neutral Mandarin sample', () => {
  const job = buildVoiceoverPreviewProviderJob(VOICEOVER_VOICES[3], 3, 'existing-task');
  assert.equal(job.id, 'system-voice-preview-Kore');
  assert.equal(job.provider, 'kie');
  assert.equal(job.taskType, 'kie_tts');
  assert.equal(job.providerTaskId, 'existing-task');
  assert.deepEqual(job.payload, {
    executionOwner: 'parent',
    parentJobId: 'system-voice-preview-library-v1',
    childKey: 'tts:3:attempt:0',
    groupIndex: 3,
    targetLanguage: VOICEOVER_PREVIEW_LANGUAGE,
    voiceName: 'Kore',
    dialogueTurns: [{
      speaker: 'Speaker 1',
      text: VOICEOVER_PREVIEW_SAMPLE_TEXT,
    }],
    temperature: 0.7,
    scene: 'A clean studio recording for a short Mandarin voice preview.',
    sampleContext: 'One narrator speaks the same neutral sentence so listeners can compare timbre.',
  });
});

test('missing confirmation fails before a paid provider task is created', async () => {
  const rootDir = await createFixture();
  let providerCalls = 0;
  try {
    await assert.rejects(
      generateVoiceoverPreviewLibrary({
        rootDir,
        env: {},
        catalog: VOICEOVER_VOICES.slice(0, 1),
        deps: {
          executeProviderJob: async () => {
            providerCalls += 1;
          },
        },
      }),
      (error) => error?.code === 'voiceover_preview_generation_confirmation_required'
        && error?.remaining === 1,
    );
    assert.equal(providerCalls, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('a valid existing file is skipped without calling the provider', async () => {
  const rootDir = await createFixture();
  const libraryDir = path.join(rootDir, 'public', 'voiceover-previews');
  const bytes = mp3Bytes();
  await writeFile(path.join(libraryDir, 'Zephyr.mp3'), bytes);
  const { createHash } = await import('node:crypto');
  await writeFile(
    path.join(libraryDir, 'manifest.json'),
    `${JSON.stringify({
      ...createEmptyVoiceoverPreviewManifest(),
      voices: [{
        name: 'Zephyr',
        file: 'Zephyr.mp3',
        contentType: 'audio/mpeg',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }],
    }, null, 2)}\n`,
  );
  let providerCalls = 0;
  try {
    const result = await generateVoiceoverPreviewLibrary({
      rootDir,
      env: {},
      catalog: VOICEOVER_VOICES.slice(0, 1),
      deps: {
        executeProviderJob: async () => {
          providerCalls += 1;
        },
      },
    });
    assert.equal(providerCalls, 0);
    assert.deepEqual(result, { ready: 1, total: 1, generated: 0, skipped: 1 });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('an existing provider task id is queried, downloaded and committed without create', async () => {
  const rootDir = await createFixture();
  const ledgerPath = path.join(rootDir, 'server', 'data', 'voiceover-preview-library-ledger.json');
  await writeFile(ledgerPath, `${JSON.stringify({
    version: 1,
    voices: {
      Zephyr: {
        status: 'processing',
        providerTaskId: 'resume-task-1',
      },
    },
  }, null, 2)}\n`);
  const jobs = [];
  try {
    const result = await generateVoiceoverPreviewLibrary({
      rootDir,
      env: {},
      catalog: VOICEOVER_VOICES.slice(0, 1),
      deps: {
        executeProviderJob: async (job) => {
          jobs.push(job);
          return {
            providerTaskId: job.providerTaskId,
            result: { audioUrl: 'https://provider.example/Zephyr' },
          };
        },
        fetchImpl: async () => fakeAudioResponse(),
      },
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].providerTaskId, 'resume-task-1');
    assert.deepEqual(result, { ready: 1, total: 1, generated: 1, skipped: 0 });
    const manifest = JSON.parse(await readFile(
      path.join(rootDir, 'public', 'voiceover-previews', 'manifest.json'),
      'utf8',
    ));
    assert.deepEqual(manifest.voices.map(({ name, file, contentType, bytes }) => ({
      name,
      file,
      contentType,
      bytes,
    })), [{
      name: 'Zephyr',
      file: 'Zephyr.mp3',
      contentType: 'audio/mpeg',
      bytes: 256,
    }]);
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    assert.equal(ledger.voices.Zephyr.status, 'ready');
    assert.equal(ledger.voices.Zephyr.providerTaskId, 'resume-task-1');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('new task checkpoints provider id before audio download and is resumable', async () => {
  const rootDir = await createFixture();
  const ledgerPath = path.join(rootDir, 'server', 'data', 'voiceover-preview-library-ledger.json');
  let checkpointSeenBeforeFetch = false;
  try {
    await generateVoiceoverPreviewLibrary({
      rootDir,
      env: { MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM: '1' },
      catalog: VOICEOVER_VOICES.slice(0, 1),
      deps: {
        executeProviderJob: async (_job, _env, _signal, options) => {
          await options.onProviderTaskId('new-task-1');
          return {
            providerTaskId: 'new-task-1',
            result: { audioUrl: 'https://provider.example/Zephyr' },
          };
        },
        fetchImpl: async () => {
          const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
          checkpointSeenBeforeFetch = ledger.voices.Zephyr.providerTaskId === 'new-task-1';
          return fakeAudioResponse();
        },
      },
    });
    assert.equal(checkpointSeenBeforeFetch, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('unknown submissions are persisted and never automatically resubmitted', async () => {
  const rootDir = await createFixture();
  let providerCalls = 0;
  const executeProviderJob = async () => {
    providerCalls += 1;
    throw Object.assign(new Error('submit response lost'), {
      code: 'provider_submission_unknown',
    });
  };
  try {
    await assert.rejects(
      generateVoiceoverPreviewLibrary({
        rootDir,
        env: { MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM: '1' },
        catalog: VOICEOVER_VOICES.slice(0, 1),
        deps: { executeProviderJob },
      }),
      (error) => error?.code === 'provider_submission_unknown',
    );
    assert.equal(providerCalls, 1);
    const ledgerPath = path.join(rootDir, 'server', 'data', 'voiceover-preview-library-ledger.json');
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
    assert.equal(ledger.voices.Zephyr.status, 'unknown');

    await assert.rejects(
      generateVoiceoverPreviewLibrary({
        rootDir,
        env: { MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM: '1' },
        catalog: VOICEOVER_VOICES.slice(0, 1),
        deps: { executeProviderJob },
      }),
      (error) => error?.code === 'voiceover_preview_submission_unknown',
    );
    assert.equal(providerCalls, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('all catalog voices are processed in catalog order', async () => {
  const rootDir = await createFixture();
  const voiceNames = [];
  try {
    const result = await generateVoiceoverPreviewLibrary({
      rootDir,
      env: {
        MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM: '1',
        MEIAO_VOICE_PREVIEW_LIBRARY_CONCURRENCY: '1',
      },
      deps: {
        executeProviderJob: async (job, _env, _signal, options) => {
          voiceNames.push(job.payload.voiceName);
          await options.onProviderTaskId(`task-${job.payload.groupIndex}`);
          return {
            providerTaskId: `task-${job.payload.groupIndex}`,
            result: { audioUrl: `https://provider.example/${job.payload.voiceName}` },
          };
        },
        fetchImpl: async () => fakeAudioResponse(),
      },
    });
    assert.deepEqual(voiceNames, VOICEOVER_VOICES.map((voice) => voice.name));
    assert.deepEqual(result, { ready: 30, total: 30, generated: 30, skipped: 0 });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('the CLI keeps Node alive while provider polling only has unref timers', async () => {
  const handles = [];
  const cleared = [];
  let finishTask;
  const task = new Promise((resolve) => {
    finishTask = resolve;
  });
  const running = keepVoiceoverPreviewProcessAlive(
    () => task,
    {
      setIntervalImpl: (callback, milliseconds) => {
        const handle = { callback, milliseconds };
        handles.push(handle);
        return handle;
      },
      clearIntervalImpl: (handle) => cleared.push(handle),
    },
  );

  assert.equal(handles.length, 1);
  assert.equal(handles[0].milliseconds, 60_000);
  assert.deepEqual(cleared, []);
  finishTask('done');
  assert.equal(await running, 'done');
  assert.deepEqual(cleared, handles);
});
