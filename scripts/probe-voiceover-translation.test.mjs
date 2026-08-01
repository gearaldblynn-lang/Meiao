import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseVoiceoverProbeArgs,
  redactVoiceoverProbeText,
  runVoiceoverProbe,
} from './probe-voiceover-translation.mjs';

const readyLocal = Object.freeze({
  ready: true,
  pythonReady: true,
  modelReady: true,
  ffmpegReady: true,
});

const canonicalVoiceoverCheckpoint = ({ removeText = false, ...overrides } = {}) => {
  const segment = {
    id: 'segment-1',
    startMs: 0,
    endMs: 800,
    sourceText: '源文',
    targetText: 'Translation',
  };
  return {
    version: 1,
    stage: 'result_persisted',
    baseVideoAssetId: 'asset-base',
    originalAudioAssetId: 'asset-original-audio',
    vocalAssetId: 'asset-vocals',
    backgroundAssetId: 'asset-background',
    analysisEvidenceVersion: 1,
    alignmentVersion: 1,
    analysisAttempt: 0,
    ...(removeText ? {
      subtitleRemoval: {
        childJobId: 'voiceover-child-golden-safe',
        providerTaskId: 'golden-provider-never-print',
        resultAssetId: 'asset-golden-result',
        attempt: 0,
        status: 'succeeded',
      },
    } : {}),
    analysis: {
      sourceLanguage: 'cmn',
      speakerCount: 1,
      voiceProfile: {
        pitch: 'medium',
        brightness: 'balanced',
        energy: 'balanced',
        pace: 'natural',
        accentDescription: 'clear',
      },
      segments: [{ ...segment }],
    },
    translation: {
      targetLanguage: 'en',
      mode: 'natural',
      selectedVoiceName: 'Charon',
      segments: [{ ...segment }],
    },
    ttsGroups: [{
      index: 0,
      attempt: 0,
      childJobId: 'voiceover-child-tts-safe',
      providerTaskId: 'tts-provider-never-print',
      assetId: 'asset-tts-safe',
      status: 'succeeded',
      startMs: 0,
      endMs: 800,
      actualDurationMs: 780,
      atempo: 1,
    }],
    alignedAudioAssetId: 'asset-aligned-audio',
    finalAssetId: 'managed-final',
    ...overrides,
  };
};

test('direct CLI loads server env files without overriding or leaking their values', async (t) => {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-probe-env-'));
  t.after(() => rm(workingDirectory, { recursive: true, force: true }));
  await writeFile(path.join(workingDirectory, '.env.server'), [
    'MEIAO_VOICEOVER_TRANSLATION_ENABLED=1',
    'KIE_API_KEY=server-kie-secret-never-print',
  ].join('\n'));
  await writeFile(path.join(workingDirectory, '.env.local'), [
    'MEIAO_VOICEOVER_TRANSLATION_ENABLED=0',
    'KIE_API_KEY=local-kie-secret-never-print',
  ].join('\n'));
  const childEnv = { ...process.env };
  delete childEnv.MEIAO_VOICEOVER_TRANSLATION_ENABLED;
  delete childEnv.KIE_API_KEY;
  delete childEnv.MEIAO_KIE_API_KEY;
  const scriptPath = fileURLToPath(new URL('./probe-voiceover-translation.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, '--readiness'], {
    cwd: workingDirectory,
    env: childEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.enabled, true);
  assert.equal(output.kieConfigured, true);
  assert.doesNotMatch(result.stdout, /server-kie-secret|local-kie-secret|meiao-voiceover-probe-env/);
  assert.equal(result.stderr, '');
});

test('direct CLI never accepts persisted live confirmation', async (t) => {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-probe-confirm-'));
  t.after(() => rm(workingDirectory, { recursive: true, force: true }));
  await writeFile(path.join(workingDirectory, '.env.server'), [
    'MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1',
  ].join('\n'));
  const childEnv = { ...process.env };
  delete childEnv.MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED;
  delete childEnv.MEIAO_VOICEOVER_PROBE_BASE_URL;
  delete childEnv.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN;
  const scriptPath = fileURLToPath(new URL('./probe-voiceover-translation.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
    '--remove-text',
  ], {
    cwd: workingDirectory,
    env: childEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /Golden/);
  assert.match(result.stderr, /MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1/);
  assert.doesNotMatch(result.stderr, /SESSION_TOKEN|BASE_URL/);
  assert.equal(result.stdout, '');
});

test('direct CLI never accepts a persisted remote session token', async (t) => {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-probe-session-'));
  t.after(() => rm(workingDirectory, { recursive: true, force: true }));
  await writeFile(path.join(workingDirectory, '.env.server'), [
    'MEIAO_VOICEOVER_PROBE_SESSION_TOKEN=server-session-must-be-ignored',
  ].join('\n'));
  await writeFile(path.join(workingDirectory, '.env.local'), [
    'MEIAO_VOICEOVER_PROBE_SESSION_TOKEN=local-session-must-be-ignored',
  ].join('\n'));
  const childEnv = { ...process.env };
  delete childEnv.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN;
  delete childEnv.MEIAO_VOICEOVER_PROBE_BASE_URL;
  const scriptPath = fileURLToPath(new URL('./probe-voiceover-translation.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--resume-parent-job-id', 'parent-job-safe',
  ], {
    cwd: workingDirectory,
    env: childEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /MEIAO_VOICEOVER_PROBE_SESSION_TOKEN/);
  assert.doesNotMatch(result.stderr, /server-session|local-session/);
  assert.equal(result.stdout, '');
});

const probeDeps = ({
  env = {},
  readiness = readyLocal,
  fixtureResult,
  parentResult,
  childResult,
  liveResult,
} = {}) => {
  const calls = {
    providerCreate: 0,
    fixture: 0,
    parentQuery: 0,
    childQuery: 0,
    health: 0,
    finalVerify: 0,
  };
  return {
    env: {
      MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
      KIE_API_KEY: 'kie-secret-never-print',
      ...env,
    },
    calls,
    checkReadiness: async () => readiness,
    runFixtureProbe: async () => {
      calls.fixture += 1;
      return fixtureResult || {
        inputH264Aac: true,
        separationReady: true,
        vocalOnlyAnalysisMedia: true,
        alignmentReady: true,
        narrationOnlyMixReady: true,
        outputH264Aac: true,
        durationWithinTolerance: true,
        ftypPresent: true,
        rangeReadable: true,
      };
    },
    queryParentJob: async () => {
      calls.parentQuery += 1;
      return parentResult || { found: true, status: 'running' };
    },
    queryChildTask: async (childJobId) => {
      calls.childQuery += 1;
      return childResult || {
        found: true,
        childJobId,
        parentJobId: 'parent-job-1',
        childKey: 'tts:0:attempt:0',
        taskType: 'kie_tts',
        provider: 'kie',
        status: 'submitted',
      };
    },
    fetchHealth: async () => {
      calls.health += 1;
      return {
        ok: true,
        voiceoverTranslation: {
          enabled: true,
          ready: true,
          pythonReady: true,
          modelReady: true,
          ffmpegReady: true,
          separationConcurrency: 1,
        },
        subtitleRemoval: { enabled: true, configured: true },
      };
    },
    createProviderTask: async (request) => {
      calls.providerCreate += 1;
      return liveResult || {
        job: {
          id: 'parent-job-safe',
          status: 'succeeded',
          result: {
            voiceoverCheckpoint: canonicalVoiceoverCheckpoint(),
            finalAssetId: 'managed-final',
            videoUrl: '/api/assets/file/managed-final?accessKey=never-print',
          },
        },
        request,
      };
    },
    verifyFinalResult: async () => {
      calls.finalVerify += 1;
      return {
        managedAsset: true,
        h264: true,
        aac: true,
        rangeReadable: true,
        ftypPresent: true,
        durationMs: 1_000,
      };
    },
    queryLiveJob: async () => {
      throw new Error('completed live fixture must not poll');
    },
    sleep: async () => {},
  };
};

test('default and readiness modes cannot create provider tasks', async () => {
  for (const args of [[], ['--readiness']]) {
    const deps = probeDeps();
    const result = await runVoiceoverProbe(args, deps);
    assert.equal(result.exitCode, 0);
    assert.equal(deps.calls.providerCreate, 0);
    assert.equal(deps.calls.fixture, 0);
    assert.equal(deps.calls.parentQuery, 0);
    assert.equal(deps.calls.childQuery, 0);
  }
});

test('readiness prints the fixed boolean and numeric schema only', async () => {
  const deps = probeDeps({
    env: {
      MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
      KIE_API_KEY: 'kie-secret-never-print',
      GOLDEN_SUBTITLE_API_TOKEN: '',
      MEIAO_VOICEOVER_SEPARATION_PYTHON: '/Users/private/venv/bin/python',
      MEIAO_VOICEOVER_DEMUCS_MODEL_DIR: '/Users/private/models',
    },
    readiness: {
      ready: false,
      pythonReady: true,
      modelReady: false,
      ffmpegReady: true,
      code: 'must-not-print',
      localPath: '/Users/private/models',
    },
  });
  const result = await runVoiceoverProbe(['--readiness'], deps);
  const output = JSON.parse(result.stdout);

  assert.deepEqual(Object.keys(output), [
    'enabled',
    'ready',
    'pythonReady',
    'modelReady',
    'ffmpegReady',
    'separationConcurrency',
    'kieConfigured',
    'goldenConfigured',
  ]);
  for (const key of [
    'enabled',
    'ready',
    'pythonReady',
    'modelReady',
    'ffmpegReady',
    'kieConfigured',
    'goldenConfigured',
  ]) assert.equal(typeof output[key], 'boolean', key);
  assert.equal(typeof output.separationConcurrency, 'number');
  assert.equal(output.ready, false);
  assert.equal(output.goldenConfigured, false);
  assert.doesNotMatch(result.stdout, /\/Users|private\/models|must-not-print/i);
});

test('fixture mode is absolute-path local-only and cannot create provider tasks', async () => {
  const invalidDeps = probeDeps();
  const invalid = await runVoiceoverProbe(['--fixture-path', 'relative.mp4'], invalidDeps);
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalidDeps.calls.providerCreate, 0);

  const deps = probeDeps();
  const result = await runVoiceoverProbe(['--fixture-path', '/tmp/owned-fixture.mp4'], deps);
  assert.equal(result.exitCode, 0);
  assert.equal(deps.calls.fixture, 1);
  assert.equal(deps.calls.providerCreate, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'fixture');
  assert.equal(output.providerCreateCalls, 0);
  assert.equal(output.outputH264Aac, true);
  assert.equal(output.rangeReadable, true);
  assert.doesNotMatch(result.stdout, /owned-fixture|\/tmp\//);
});

test('parent and authoritative child resume modes are query-only and never submit or create', async () => {
  const parentDeps = probeDeps({
    env: {
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    },
  });
  const parent = await runVoiceoverProbe(
    ['--resume-parent-job-id', 'parent-job-1'],
    parentDeps,
  );
  assert.equal(parent.exitCode, 0);
  assert.equal(parentDeps.calls.providerCreate, 0);
  assert.equal(parentDeps.calls.parentQuery, 1);
  assert.doesNotMatch(parent.stdout, /session-secret/);

  const childDeps = probeDeps({
    env: {
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    },
  });
  const child = await runVoiceoverProbe(
    ['--resume-child-task-id', 'voiceover-child-safe'],
    childDeps,
  );
  assert.equal(child.exitCode, 0);
  assert.equal(childDeps.calls.providerCreate, 0);
  assert.equal(childDeps.calls.childQuery, 1);
  assert.equal(JSON.parse(child.stdout).childJobId, 'voiceover-child-safe');
  assert.doesNotMatch(child.stdout, /providerTaskId|session-secret/);
});

test('child resume reads the authoritative child by internal ID and ignores stale parent evidence', async () => {
  const childJobId = 'voiceover-child-authoritative';
  const deps = probeDeps({
    env: {
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    },
    parentResult: {
      found: true,
      status: 'running',
      job: {
        id: 'parent-job-1',
        result: {
          voiceoverCheckpoint: {
            ttsGroups: [{ childJobId, status: 'submitted' }],
          },
        },
      },
    },
  });
  delete deps.queryChildTask;
  deps.fetchImpl = async (url, init = {}) => {
    assert.equal(String(url), `https://meiao.test/api/jobs/${childJobId}`);
    assert.equal(init.method || 'GET', 'GET');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        job: {
          id: childJobId,
          module: 'video',
          taskType: 'kie_tts',
          provider: 'kie',
          status: 'succeeded',
          providerTaskId: 'provider-task-never-print',
          payload: {
            executionOwner: 'parent',
            parentJobId: 'parent-job-1',
            childKey: 'tts:0:attempt:1',
            clientSubmissionKey: 'voiceover-child:parent-job-1:tts:0:attempt:1',
          },
          result: {
            transcript: 'never print child provider output',
          },
        },
      }),
    };
  };

  const result = await runVoiceoverProbe(['--resume-child-task-id', childJobId], deps);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    mode: 'resume-child',
    found: true,
    childJobId,
    parentJobId: 'parent-job-1',
    childKey: 'tts:0:attempt:1',
    taskType: 'kie_tts',
    provider: 'kie',
    status: 'succeeded',
    providerCreateCalls: 0,
  });
  assert.equal(deps.calls.parentQuery, 0);
  assert.equal(deps.calls.providerCreate, 0);
  assert.doesNotMatch(result.stdout, /provider-task-never-print|transcript|never print/);
});

test('child resume rejects an authenticated job that is not a valid parent-owned child', async () => {
  const deps = probeDeps({
    env: {
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    },
  });
  delete deps.queryChildTask;
  deps.fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      job: {
        id: 'not-a-child-job',
        module: 'video',
        taskType: 'voiceover_translate_video',
        provider: 'internal',
        status: 'succeeded',
        payload: { executionOwner: 'browser' },
      },
    }),
  });

  const result = await runVoiceoverProbe(
    ['--resume-child-task-id', 'not-a-child-job'],
    deps,
  );
  assert.equal(result.exitCode, 1);
  assert.equal(deps.calls.providerCreate, 0);
  assert.equal(result.stdout, '');
});

test('live mode requires explicit confirmation and reports the extra Golden charge first', async () => {
  const deps = probeDeps({ env: {} });
  const result = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'asset-1',
    '--target-language', 'en',
    '--remove-text',
  ], deps);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Golden/);
  assert.match(result.stderr, /MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1/);
  assert.doesNotMatch(result.stderr, /parentJobId|childJobIds/);
  assert.equal(deps.calls.health, 0);
  assert.equal(deps.calls.providerCreate, 0);
});

test('confirmed live mode creates exactly once with only the explicitly supplied managed asset', async () => {
  const deps = probeDeps({
    env: {
      MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    },
  });
  let request;
  const createProviderTask = deps.createProviderTask;
  deps.createProviderTask = async (value) => {
    request = value;
    return createProviderTask(value);
  };
  const result = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
  ], deps);

  assert.equal(result.exitCode, 0);
  assert.equal(deps.calls.health, 1);
  assert.equal(deps.calls.providerCreate, 1);
  assert.equal(deps.calls.finalVerify, 1);
  assert.equal(request?.payload?.sourceAssetId, 'owned-managed-asset');
  assert.equal(request?.payload?.targetLanguage, 'en');
  assert.equal(request?.payload?.removeText, false);
  assert.equal('sourceUrl' in request.payload, false);
  assert.equal(JSON.parse(result.stdout).parentJobCreated, true);
  assert.equal(JSON.parse(result.stdout).finalH264, true);
  assert.equal(JSON.parse(result.stdout).finalAac, true);
  assert.equal(JSON.parse(result.stdout).rangeReadable, true);
  assert.equal(JSON.parse(result.stdout).parentJobId, 'parent-job-safe');
  assert.equal(JSON.parse(result.stdout).finalCheckpointStage, 'result_persisted');
  assert.equal(JSON.parse(result.stdout).analysisAttempt, 0);
  assert.deepEqual(JSON.parse(result.stdout).childJobIds, ['voiceover-child-tts-safe']);
  assert.doesNotMatch(result.stdout, /provider-task-never-print|providerTaskId|accessKey|never-print|kie-secret|session-secret/);
});

test('successful live evidence contains only bounded internal checkpoint identities and status counts', async () => {
  const deps = probeDeps({
    env: {
      MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
      MEIAO_VOICEOVER_GROUP_GAP_MS: '0',
    },
    liveResult: {
      job: {
        id: 'parent-job-evidence',
        status: 'succeeded',
        result: {
          voiceoverCheckpoint: canonicalVoiceoverCheckpoint({
            removeText: true,
            analysisAttempt: 3,
            analysis: {
              ...canonicalVoiceoverCheckpoint().analysis,
              segments: [{
                id: 'segment-1',
                startMs: 0,
                endMs: 400,
                sourceText: '第一段',
                targetText: 'First.',
              }, {
                id: 'segment-2',
                startMs: 500,
                endMs: 800,
                sourceText: '第二段',
                targetText: 'Second.',
              }],
            },
            translation: {
              ...canonicalVoiceoverCheckpoint().translation,
              segments: [{
                id: 'segment-1',
                startMs: 0,
                endMs: 400,
                sourceText: '第一段',
                targetText: 'First.',
              }, {
                id: 'segment-2',
                startMs: 500,
                endMs: 800,
                sourceText: '第二段',
                targetText: 'Second.',
              }],
            },
            ttsGroups: [{
              index: 0,
              attempt: 0,
              childJobId: 'voiceover-child-tts-0',
              providerTaskId: 'tts-provider-zero-never-print',
              assetId: 'asset-tts-zero',
              status: 'succeeded',
              startMs: 0,
              endMs: 400,
            }, {
              index: 1,
              attempt: 0,
              childJobId: 'voiceover-child-tts-1',
              providerTaskId: 'tts-provider-one-never-print',
              assetId: 'asset-tts-one',
              status: 'succeeded',
              startMs: 500,
              endMs: 800,
            }],
          }),
          finalAssetId: 'managed-final',
          videoUrl: '/api/assets/file/managed-final?accessKey=never-print',
          transcript: 'translated words never print',
          providerResponse: { raw: 'never print provider body' },
        },
      },
    },
  });
  const result = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
    '--remove-text',
  ], deps);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(deps.calls.providerCreate, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.parentJobId, 'parent-job-evidence');
  assert.equal(output.finalCheckpointStage, 'result_persisted');
  assert.equal(output.analysisAttempt, 3);
  assert.deepEqual(output.childJobIds, [
    'voiceover-child-golden-safe',
    'voiceover-child-tts-0',
    'voiceover-child-tts-1',
  ]);
  assert.deepEqual(output.ttsSummary, {
    total: 2,
    queued: 0,
    submitted: 0,
    succeeded: 2,
    failed: 0,
    unknown: 0,
  });
  assert.deepEqual(output.goldenSummary, { present: true, status: 'succeeded' });
  assert.doesNotMatch(
    result.stdout,
    /providerTaskId|golden-provider|tts-provider|translated words|provider body|accessKey|session-secret/,
  );
});

test('succeeded live jobs fail closed unless the authoritative final checkpoint is canonical and complete', async () => {
  const liveEnv = {
    MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
    MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
    MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
  };
  const baseTtsGroup = canonicalVoiceoverCheckpoint().ttsGroups[0];
  const missingAnalysisAttempt = canonicalVoiceoverCheckpoint();
  delete missingAnalysisAttempt.analysisAttempt;
  const cases = [{
    name: 'no checkpoint',
    removeText: false,
    result: {
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'result-level-only stage and final asset',
    removeText: false,
    result: {
      voiceoverStage: 'result_persisted',
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'malformed checkpoint',
    removeText: false,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint({ unexpectedField: 'must-fail' }),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'checkpoint final asset mismatch',
    removeText: false,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint({ finalAssetId: 'managed-other' }),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'missing analysis attempt index',
    removeText: false,
    result: {
      voiceoverCheckpoint: missingAnalysisAttempt,
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'negative analysis attempt index',
    removeText: false,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint({ analysisAttempt: -1 }),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'latest TTS attempt submitted',
    removeText: false,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint({
        ttsGroups: [
          baseTtsGroup,
          {
            ...baseTtsGroup,
            attempt: 1,
            childJobId: 'voiceover-child-tts-latest',
            providerTaskId: 'tts-provider-latest-never-print',
            assetId: undefined,
            status: 'submitted',
          },
        ],
      }),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'failed Golden child',
    removeText: true,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint({
        removeText: true,
        subtitleRemoval: {
          childJobId: 'voiceover-child-golden-failed',
          providerTaskId: 'golden-provider-never-print',
          resultAssetId: 'asset-golden-result',
          attempt: 0,
          status: 'failed',
        },
      }),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'removeText false with Golden checkpoint',
    removeText: false,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint({ removeText: true }),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }, {
    name: 'removeText true without Golden checkpoint',
    removeText: true,
    result: {
      voiceoverCheckpoint: canonicalVoiceoverCheckpoint(),
      finalAssetId: 'managed-final',
      videoUrl: '/api/assets/file/managed-final',
    },
  }];

  for (const item of cases) {
    const deps = probeDeps({
      env: liveEnv,
      liveResult: {
        job: {
          id: `parent-${item.name.replaceAll(' ', '-').replaceAll(/[^\w-]/gu, '')}`,
          status: 'succeeded',
          result: item.result,
        },
      },
    });
    const result = await runVoiceoverProbe([
      '--live',
      '--source-asset-id', 'owned-managed-asset',
      '--target-language', 'en',
      ...(item.removeText ? ['--remove-text'] : []),
    ], deps);

    assert.equal(result.exitCode, 1, item.name);
    assert.equal(deps.calls.providerCreate, 1, item.name);
    assert.equal(JSON.parse(result.stderr).parentJobId.startsWith('parent-'), true, item.name);
    assert.doesNotMatch(result.stderr, /providerTaskId|provider-never-print|provider-latest/, item.name);
  }

  const invalidDuration = probeDeps({ env: liveEnv });
  invalidDuration.verifyFinalResult = async () => {
    invalidDuration.calls.finalVerify += 1;
    return {
      managedAsset: true,
      h264: true,
      aac: true,
      rangeReadable: true,
      ftypPresent: true,
      durationMs: 0,
    };
  };
  const invalidDurationResult = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
  ], invalidDuration);
  assert.equal(invalidDurationResult.exitCode, 1);
  assert.equal(invalidDuration.calls.providerCreate, 1);
  assert.equal(JSON.parse(invalidDurationResult.stderr).parentJobId, 'parent-job-safe');
});

test('succeeded live jobs require durable TTS groups to match the production logical plan', async () => {
  const plannedSegments = [{
    id: 'segment-1',
    startMs: 0,
    endMs: 400,
    sourceText: '第一段',
    targetText: 'First.',
  }, {
    id: 'segment-2',
    startMs: 500,
    endMs: 800,
    sourceText: '第二段',
    targetText: 'Second.',
  }];
  const base = canonicalVoiceoverCheckpoint();
  const plannedCheckpoint = canonicalVoiceoverCheckpoint({
    analysisAttempt: 1,
    analysis: {
      ...base.analysis,
      segments: structuredClone(plannedSegments),
    },
    translation: {
      ...base.translation,
      segments: structuredClone(plannedSegments),
    },
    ttsGroups: [{
      ...base.ttsGroups[0],
      index: 0,
      childJobId: 'voiceover-child-tts-0',
      providerTaskId: 'provider-tts-0-never-print',
      assetId: 'asset-tts-0',
      startMs: 0,
      endMs: 400,
    }, {
      ...base.ttsGroups[0],
      index: 1,
      childJobId: 'voiceover-child-tts-1',
      providerTaskId: 'provider-tts-1-never-print',
      assetId: 'asset-tts-1',
      startMs: 500,
      endMs: 800,
    }],
  });
  const [group0, group1] = plannedCheckpoint.ttsGroups;
  const cases = [{
    name: 'missing planned group',
    checkpoint: {
      ...plannedCheckpoint,
      ttsGroups: [group0],
    },
  }, {
    name: 'sparse high group index',
    checkpoint: {
      ...plannedCheckpoint,
      ttsGroups: [group0, { ...group1, index: 99 }],
    },
  }, {
    name: 'extra logical group',
    checkpoint: {
      ...plannedCheckpoint,
      ttsGroups: [
        group0,
        group1,
        {
          ...group1,
          index: 2,
          childJobId: 'voiceover-child-tts-extra',
          providerTaskId: 'provider-tts-extra-never-print',
          assetId: 'asset-tts-extra',
        },
      ],
    },
  }, {
    name: 'wrong planned timing',
    checkpoint: {
      ...plannedCheckpoint,
      ttsGroups: [group0, { ...group1, startMs: 550 }],
    },
  }, {
    name: 'translation text drift',
    checkpoint: {
      ...plannedCheckpoint,
      translation: {
        ...plannedCheckpoint.translation,
        segments: plannedCheckpoint.translation.segments.map((segment, index) => (
          index === 1 ? { ...segment, targetText: 'Wrong text.' } : segment
        )),
      },
    },
  }, {
    name: 'automatic voice drift',
    checkpoint: {
      ...plannedCheckpoint,
      translation: {
        ...plannedCheckpoint.translation,
        selectedVoiceName: 'Kore',
      },
    },
  }];

  for (const item of cases) {
    const deps = probeDeps({
      env: {
        MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
        MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
        MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
        MEIAO_VOICEOVER_GROUP_GAP_MS: '0',
        ...item.env,
      },
      liveResult: {
        job: {
          id: `parent-plan-${item.name.replaceAll(' ', '-')}`,
          status: 'succeeded',
          result: {
            voiceoverCheckpoint: item.checkpoint,
            finalAssetId: 'managed-final',
            videoUrl: '/api/assets/file/managed-final',
          },
        },
      },
    });
    const result = await runVoiceoverProbe([
      '--live',
      '--source-asset-id', 'owned-managed-asset',
      '--target-language', 'en',
    ], deps);

    assert.equal(result.exitCode, 1, item.name);
    assert.equal(deps.calls.providerCreate, 1, item.name);
    assert.equal(JSON.parse(result.stderr).parentJobId.startsWith('parent-plan-'), true);
    assert.doesNotMatch(
      result.stderr,
      /providerTaskId|provider-tts-|First\.|Second\.|Wrong text|第一段|第二段/,
      item.name,
    );
  }

  const stableWindowPlan = probeDeps({
    env: {
      MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
      MEIAO_VOICEOVER_GROUP_GAP_MS: '800',
    },
    liveResult: {
      job: {
        id: 'parent-plan-stable-windows',
        status: 'succeeded',
        result: {
          voiceoverCheckpoint: plannedCheckpoint,
          finalAssetId: 'managed-final',
          videoUrl: '/api/assets/file/managed-final',
        },
      },
    },
  });
  const stableResult = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
  ], stableWindowPlan);
  assert.equal(stableResult.exitCode, 0);
});

test('post-create timeout and terminal failure preserve safe parent recovery evidence without recreating', async () => {
  const liveEnv = {
    MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
    MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
    MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    MEIAO_VOICEOVER_PROBE_TIMEOUT_MS: '60000',
  };
  const runningJob = {
    id: 'parent-job-timeout',
    status: 'running',
    result: {
      voiceoverCheckpoint: {
        stage: 'tts_generating',
        analysisAttempt: 2,
        ttsGroups: [{
          childJobId: 'voiceover-child-running',
          providerTaskId: 'provider-task-never-print',
          status: 'submitted',
        }],
      },
    },
  };
  const timeoutDeps = probeDeps({ env: liveEnv, liveResult: { job: runningJob } });
  const nowValues = [0, 60001];
  timeoutDeps.now = () => nowValues.shift() ?? 60001;
  const timeout = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
  ], timeoutDeps);

  assert.equal(timeout.exitCode, 1);
  assert.equal(timeoutDeps.calls.providerCreate, 1);
  const timeoutEvidence = JSON.parse(timeout.stderr);
  assert.equal(timeoutEvidence.parentJobId, 'parent-job-timeout');
  assert.equal(timeoutEvidence.finalCheckpointStage, 'tts_generating');
  assert.deepEqual(timeoutEvidence.childJobIds, ['voiceover-child-running']);
  assert.equal(timeoutEvidence.ttsSummary.submitted, 1);
  assert.match(timeoutEvidence.message, /超时/);
  assert.doesNotMatch(timeout.stderr, /provider-task-never-print|providerTaskId|session-secret/);

  const failedDeps = probeDeps({
    env: liveEnv,
    liveResult: {
      job: {
        id: 'parent-job-failed',
        status: 'failed',
        result: {
          voiceoverCheckpoint: {
            stage: 'subtitle_removal',
            analysisAttempt: 0,
            subtitleRemoval: {
              childJobId: 'voiceover-child-golden-failed',
              providerTaskId: 'golden-provider-never-print',
              status: 'failed',
            },
          },
        },
      },
    },
  });
  const failed = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
    '--remove-text',
  ], failedDeps);
  assert.equal(failed.exitCode, 1);
  assert.equal(failedDeps.calls.providerCreate, 1);
  const failedEvidence = JSON.parse(failed.stderr);
  assert.equal(failedEvidence.parentJobId, 'parent-job-failed');
  assert.equal(failedEvidence.finalCheckpointStage, 'subtitle_removal');
  assert.deepEqual(failedEvidence.goldenSummary, { present: true, status: 'failed' });
  assert.doesNotMatch(failed.stderr, /golden-provider-never-print|providerTaskId|session-secret/);
});

test('live success fails closed without a canonical final asset or verified H.264 AAC Range evidence', async () => {
  const liveEnv = {
    MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED: '1',
    MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
    MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
  };
  const missingAsset = probeDeps({
    env: liveEnv,
    liveResult: {
      job: {
        id: 'parent-job-safe',
        status: 'succeeded',
        result: { voiceoverStage: 'result_persisted' },
      },
    },
  });
  const missingAssetResult = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
  ], missingAsset);
  assert.equal(missingAssetResult.exitCode, 1);
  assert.equal(missingAsset.calls.providerCreate, 1);
  assert.equal(missingAsset.calls.finalVerify, 0);
  assert.equal(JSON.parse(missingAssetResult.stderr).parentJobId, 'parent-job-safe');

  const invalidMedia = probeDeps({ env: liveEnv });
  invalidMedia.verifyFinalResult = async () => {
    invalidMedia.calls.finalVerify += 1;
    return {
      managedAsset: true,
      h264: true,
      aac: false,
      rangeReadable: true,
      ftypPresent: true,
      durationMs: 1_000,
    };
  };
  const invalidMediaResult = await runVoiceoverProbe([
    '--live',
    '--source-asset-id', 'owned-managed-asset',
    '--target-language', 'en',
  ], invalidMedia);
  assert.equal(invalidMediaResult.exitCode, 1);
  assert.equal(invalidMedia.calls.providerCreate, 1);
  assert.equal(invalidMedia.calls.finalVerify, 1);
  assert.equal(JSON.parse(invalidMediaResult.stderr).parentJobId, 'parent-job-safe');
  assert.equal(JSON.parse(invalidMediaResult.stderr).finalCheckpointStage, 'result_persisted');
});

test('ambiguous modes, missing values, and unknown arguments fail closed before side effects', async () => {
  for (const args of [
    ['--readiness', '--fixture-path', '/tmp/fixture.mp4'],
    ['--live', '--source-asset-id', 'asset-1', '--target-language', 'en', '--resume-parent-job-id', 'parent-1'],
    ['--fixture-path'],
    ['--unknown'],
  ]) {
    const deps = probeDeps();
    const result = await runVoiceoverProbe(args, deps);
    assert.equal(result.exitCode, 2, args.join(' '));
    assert.equal(deps.calls.providerCreate, 0, args.join(' '));
    assert.equal(deps.calls.fixture, 0, args.join(' '));
    assert.equal(deps.calls.parentQuery + deps.calls.childQuery, 0, args.join(' '));
  }
  assert.throws(
    () => parseVoiceoverProbeArgs(['--readiness', '--readiness']),
    /重复|只能选择/,
  );
});

test('stdout and stderr redaction removes secrets, Bearer values, URL query/hash, transcripts, provider bodies, task IDs, and local paths', async () => {
  const secret = 'super-secret-session';
  for (const rawSensitiveSection of [
    [
      'transcript:',
      '{',
      '  "segments": ["confidential multiline words"]',
      '}',
      'arbitrary continuation must also disappear',
    ].join('\n'),
    [
      'provider response:',
      '{',
      '  "taskId": "provider-multiline-secret"',
      '}',
      'arbitrary next-line provider text',
    ].join('\n'),
    [
      'provider body:',
      'first continuation line',
      'second continuation line',
    ].join('\n'),
  ]) {
    assert.equal(
      redactVoiceoverProbeText(rawSensitiveSection, [secret]),
      '[redacted-sensitive-output]',
    );
  }

  const raw = [
    `Bearer ${secret}`,
    `https://example.test/result.mp4?signature=${secret}#fragment`,
    `providerTaskId=provider-task-secret`,
    `/Users/private/models/mdx`,
    `/opt/meiao/voiceover/models/mdx`,
    `/tmp/voiceover-private/file.wav`,
  ].join('\n');
  const redacted = redactVoiceoverProbeText(raw, [secret]);
  for (const forbidden of [
    secret,
    'signature=',
    '#fragment',
    'provider-task-secret',
    '/Users/private',
    '/opt/meiao',
    '/tmp/voiceover-private',
  ]) assert.equal(redacted.includes(forbidden), false, forbidden);

  const deps = probeDeps({
    env: {
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: secret,
    },
  });
  deps.queryParentJob = async () => {
    throw new Error(`provider response:\n${raw}\narbitrary continuation`);
  };
  const result = await runVoiceoverProbe(['--resume-parent-job-id', 'parent-sensitive'], deps);
  assert.equal(result.exitCode, 1);
  for (const forbidden of [secret, 'signature=', 'arbitrary continuation', 'provider-task-secret', '/Users/private']) {
    assert.equal(result.stderr.includes(forbidden), false, forbidden);
  }
});

test('every voiceover runbook records probe bounds and ephemeral live credentials', async () => {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  for (const relativePath of [
    '.env.server.example',
    'docs/project-overview.md',
    'docs/tencent-cloud-deploy.md',
    'docs/release-and-handoff.md',
    '项目交接上下文.md',
  ]) {
    const source = await readFile(path.join(projectRoot, relativePath), 'utf8');
    for (const requiredText of [
      'MEIAO_VOICEOVER_PROBE_BASE_URL',
      'MEIAO_VOICEOVER_PROBE_SESSION_TOKEN',
      'MEIAO_VOICEOVER_PROBE_POLL_INTERVAL_MS',
      'MEIAO_VOICEOVER_PROBE_TIMEOUT_MS',
      'MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED',
      '4000',
      '500',
      '30000',
      '2400000',
      '60000',
      '7200000',
    ]) {
      assert.equal(source.includes(requiredText), true, `${relativePath}: ${requiredText}`);
    }
  }
});
