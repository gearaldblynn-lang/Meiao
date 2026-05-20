import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildDreaminaCommandEnv,
  buildDreaminaCommandArgs,
  prepareDreaminaRuntimeHome,
  parseDreaminaLoginStartOutput,
  parseDreaminaStatusOutput,
} from './dreaminaCli.mjs';
import {
  buildDreaminaVideoCommandArgs,
  parseDreaminaVideoOutput,
} from './dreaminaVideoCli.mjs';

test('dreamina command args map the supported login and task flows', () => {
  assert.deepEqual(buildDreaminaCommandArgs('login-start'), ['login', '--headless']);
  assert.deepEqual(buildDreaminaCommandArgs('login-check', { deviceCode: 'abc123', poll: 30 }), [
    'login',
    'checklogin',
    '--device_code=abc123',
    '--poll=30',
  ]);
  assert.deepEqual(buildDreaminaCommandArgs('logout'), ['logout']);
  assert.deepEqual(buildDreaminaCommandArgs('status'), ['user_credit']);
});

test('dreamina login start parser extracts verification uri and device codes from cli output', () => {
  const parsed = parseDreaminaLoginStartOutput(`
Please visit https://example.com/device
user_code: AB12-CD34
device_code = device-xyz
`);

  assert.equal(parsed.verificationUri, 'https://example.com/device');
  assert.equal(parsed.userCode, 'AB12-CD34');
  assert.equal(parsed.deviceCode, 'device-xyz');
});

test('dreamina status parser marks the cli as authenticated and preserves the raw output', () => {
  const parsed = parseDreaminaStatusOutput('1234 credits remaining');

  assert.equal(parsed.authenticated, true);
  assert.equal(parsed.rawOutput, '1234 credits remaining');
  assert.equal(parsed.creditText, '1234 credits remaining');
});

test('dreamina status parser formats json account credit output for display', () => {
  const parsed = parseDreaminaStatusOutput('{"total_credit":854,"user_id":1402597008741451,"user_name":"","vip_level":"maestro"}');

  assert.equal(parsed.authenticated, true);
  assert.equal(parsed.creditText, '可用额度 854 · 等级 maestro');
  assert.equal(parsed.totalCredit, 854);
  assert.equal(parsed.userId, '1402597008741451');
  assert.equal(parsed.userName, '');
  assert.equal(parsed.vipLevel, 'maestro');
});

test('dreamina status parser treats missing login state as unauthenticated', () => {
  const parsed = parseDreaminaStatusOutput('未检测到有效登录态，请先执行 dreamina login');

  assert.equal(parsed.authenticated, false);
  assert.equal(parsed.creditText, '');
});

test('dreamina runtime home is prepared in a writable directory with version metadata', () => {
  const runtimeHome = mkdtempSync(path.join(tmpdir(), 'dreamina-home-test-'));
  const sourceVersionPath = path.join(runtimeHome, 'source-version.json');
  writeFileSync(sourceVersionPath, '{"version":"test"}', 'utf8');
  try {
    const result = prepareDreaminaRuntimeHome({
      runtimeHome,
      sourceVersionPath,
    });

    assert.equal(result.homeRoot, runtimeHome);
    assert.equal(existsSync(result.cliRoot), true);
    assert.equal(existsSync(result.logsDir), true);
    assert.equal(existsSync(result.versionFile), true);
  } finally {
    rmSync(runtimeHome, { recursive: true, force: true });
  }
});

test('dreamina command env preserves HOME so macOS keychain remains available', () => {
  const env = buildDreaminaCommandEnv({
    HOME: '/Users/example',
    PATH: '/usr/bin',
  }, {
    runtimeHome: '/tmp/meiao-dreamina-home',
  });

  assert.equal(env.HOME, '/Users/example');
  assert.match(env.PATH, /\/Users\/example\/\.local\/bin/);
  assert.equal(env.MEIAO_DREAMINA_HOME, '/tmp/meiao-dreamina-home');
  assert.equal(env.DREAMINA_HOME, '/tmp/meiao-dreamina-home');
});

test('dreamina video adapter maps image2video arguments and parses submit output', () => {
  const args = buildDreaminaVideoCommandArgs('image2video', {
    image: '/tmp/a.png',
    prompt: 'camera push in',
    modelVersion: 'seedance2.0fast',
    duration: 5,
    videoResolution: '720p',
    poll: 0,
  });

  assert.deepEqual(args, [
    'image2video',
    '--image=/tmp/a.png',
    '--prompt=camera push in',
    '--duration=5',
    '--video_resolution=720p',
    '--model_version=seedance2.0fast',
    '--poll=0',
  ]);

  const parsed = parseDreaminaVideoOutput('{"submit_id":"dreamina-task-1","gen_status":"querying"}');
  assert.equal(parsed.submitId, 'dreamina-task-1');
  assert.equal(parsed.status, 'querying');
});

test('dreamina video adapter maps multiframe and multimodal command arguments', () => {
  assert.deepEqual(buildDreaminaVideoCommandArgs('frames2video', {
    images: ['/tmp/start.png', '/tmp/end.png'],
    prompt: 'camera push in',
    modelVersion: 'seedance2.0fast',
    duration: 5,
    videoResolution: '720p',
    poll: 0,
  }), [
    'frames2video',
    '--first=/tmp/start.png',
    '--last=/tmp/end.png',
    '--prompt=camera push in',
    '--duration=5',
    '--video_resolution=720p',
    '--model_version=seedance2.0fast',
    '--poll=0',
  ]);

  assert.deepEqual(buildDreaminaVideoCommandArgs('multiframe2video', {
    images: ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png'],
    transitionPrompts: ['A to B', 'B to C'],
    transitionDurations: [3, 4],
    poll: 0,
  }), [
    'multiframe2video',
    '--images=/tmp/a.png,/tmp/b.png,/tmp/c.png',
    '--transition-prompt=A to B',
    '--transition-prompt=B to C',
    '--transition-duration=3',
    '--transition-duration=4',
    '--poll=0',
  ]);

  assert.deepEqual(buildDreaminaVideoCommandArgs('multimodal2video', {
    images: ['/tmp/a.png'],
    videos: ['/tmp/ref.mp4'],
    audios: ['/tmp/music.mp3'],
    prompt: 'cinematic ecommerce clip',
    ratio: '9:16',
    duration: 8,
    modelVersion: 'seedance2.0fast',
    videoResolution: '720p',
    poll: 0,
  }), [
    'multimodal2video',
    '--image=/tmp/a.png',
    '--video=/tmp/ref.mp4',
    '--audio=/tmp/music.mp3',
    '--prompt=cinematic ecommerce clip',
    '--duration=8',
    '--ratio=9:16',
    '--video_resolution=720p',
    '--model_version=seedance2.0fast',
    '--poll=0',
  ]);
});

test('dreamina video output parser extracts success url and failure reason', () => {
  const success = parseDreaminaVideoOutput(JSON.stringify({
    submit_id: 'dreamina-task-2',
    gen_status: 'success',
    result: { video_url: 'https://example.com/video.mp4' },
  }));
  assert.equal(success.submitId, 'dreamina-task-2');
  assert.equal(success.status, 'success');
  assert.equal(success.videoUrl, 'https://example.com/video.mp4');

  const failed = parseDreaminaVideoOutput('submit_id: dreamina-task-3\ngen_status: failed\nfail_reason: sensitive content');
  assert.equal(failed.submitId, 'dreamina-task-3');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failReason, 'sensitive content');
});
