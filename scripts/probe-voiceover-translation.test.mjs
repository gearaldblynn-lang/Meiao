import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
        duckingReady: true,
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
    queryChildTask: async () => {
      calls.childQuery += 1;
      return childResult || { found: true, status: 'submitted' };
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
            checkpoint: { stage: 'result_persisted' },
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

test('parent and child resume modes are query-only and never submit or create', async () => {
  for (const args of [
    ['--resume-parent-job-id', 'parent-job-1'],
    ['--resume-child-task-id', 'provider-child-task-1'],
  ]) {
    const deps = probeDeps({
      env: {
        MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
        MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
      },
    });
    const result = await runVoiceoverProbe(args, deps);
    assert.equal(result.exitCode, 0);
    assert.equal(deps.calls.providerCreate, 0);
    assert.equal(deps.calls.parentQuery + deps.calls.childQuery, 1);
    assert.doesNotMatch(result.stdout, /parent-job-1|provider-child-task-1|session-secret/);
  }
});

test('child resume resolves only nested durable checkpoint identities without printing them', async () => {
  for (const childTaskId of ['tts-child-1', 'tts-provider-1', 'golden-child-1', 'golden-provider-1']) {
    const deps = probeDeps({
      env: {
        MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
        MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
      },
    });
    delete deps.queryChildTask;
    deps.fetchImpl = async (url, init = {}) => {
      assert.equal(String(url), 'https://meiao.test/api/jobs?limit=100');
      assert.equal(init.method || 'GET', 'GET');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [{
            id: 'parent-job-1',
            taskType: 'voiceover_translate_video',
            provider: 'internal',
            status: 'running',
            result: {
              voiceoverCheckpoint: {
                subtitleRemoval: {
                  childJobId: 'golden-child-1',
                  providerTaskId: 'golden-provider-1',
                  status: 'submitted',
                },
                ttsGroups: [{
                  childJobId: 'tts-child-1',
                  providerTaskId: 'tts-provider-1',
                  status: 'submitted',
                }],
              },
            },
          }],
        }),
      };
    };

    const result = await runVoiceoverProbe(['--resume-child-task-id', childTaskId], deps);
    assert.equal(result.exitCode, 0, childTaskId);
    assert.equal(JSON.parse(result.stdout).found, true);
    assert.equal(deps.calls.providerCreate, 0);
    assert.equal(result.stdout.includes(childTaskId), false);
  }

  const missing = probeDeps({
    env: {
      MEIAO_VOICEOVER_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_VOICEOVER_PROBE_SESSION_TOKEN: 'session-secret',
    },
  });
  delete missing.queryChildTask;
  missing.fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jobs: [] }),
  });
  const missingResult = await runVoiceoverProbe(
    ['--resume-child-task-id', 'unknown-child-task'],
    missing,
  );
  assert.equal(missingResult.exitCode, 1);
  assert.equal(missing.calls.providerCreate, 0);
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
  assert.doesNotMatch(result.stdout, /accessKey|never-print|kie-secret|session-secret/);
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

  const invalidMedia = probeDeps({ env: liveEnv });
  invalidMedia.verifyFinalResult = async () => {
    invalidMedia.calls.finalVerify += 1;
    return {
      managedAsset: true,
      h264: true,
      aac: false,
      rangeReadable: true,
      ftypPresent: true,
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
  const raw = [
    `Bearer ${secret}`,
    `https://example.test/result.mp4?signature=${secret}#fragment`,
    `transcript: confidential spoken words`,
    `provider body: {"taskId":"provider-task-secret","token":"${secret}"}`,
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
    'confidential spoken words',
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
    throw new Error(raw);
  };
  const result = await runVoiceoverProbe(['--resume-parent-job-id', 'parent-sensitive'], deps);
  assert.equal(result.exitCode, 1);
  for (const forbidden of [secret, 'signature=', 'confidential spoken words', 'provider-task-secret', '/Users/private']) {
    assert.equal(result.stderr.includes(forbidden), false, forbidden);
  }
});
