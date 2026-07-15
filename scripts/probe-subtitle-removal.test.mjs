import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseProbeArgs,
  resolveProbeOptions,
  runSubtitleRemovalProbe,
} from './probe-subtitle-removal.mjs';

const response = (status, body = {}, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('argument parsing defaults to readiness and never infers paid live mode', () => {
  assert.deepEqual(parseProbeArgs([]), { live: false, fixture: '', baseUrl: '' });
  assert.deepEqual(parseProbeArgs(['--live', '--fixture', '/tmp/canary.mp4', '--base-url=https://meiao.test']), {
    live: true,
    fixture: '/tmp/canary.mp4',
    baseUrl: 'https://meiao.test',
  });
});

test('live mode requires explicit confirmation, authenticated base URL and absolute fixture', () => {
  assert.throws(
    () => resolveProbeOptions({ argv: ['--live', '--fixture', '/tmp/canary.mp4'], env: {} }),
    /MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM=1/,
  );
  assert.throws(
    () => resolveProbeOptions({
      argv: ['--live', '--fixture', '/tmp/canary.mp4'],
      env: { MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM: '1' },
    }),
    /登录会话/,
  );
  assert.throws(
    () => resolveProbeOptions({
      argv: ['--live', '--fixture', 'relative.mp4'],
      env: {
        MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM: '1',
        MEIAO_SUBTITLE_REMOVAL_PROBE_SESSION_TOKEN: 'session-secret',
        MEIAO_SUBTITLE_REMOVAL_PROBE_BASE_URL: 'https://meiao.test',
      },
    }),
    /绝对路径/,
  );
});

test('readiness mode only requests health and authenticated config without submitting', async () => {
  const calls = [];
  const logs = [];
  const result = await runSubtitleRemovalProbe(resolveProbeOptions({
    argv: [],
    env: {
      MEIAO_SUBTITLE_REMOVAL_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_SUBTITLE_REMOVAL_PROBE_SESSION_TOKEN: 'session-secret',
    },
  }), {
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' });
      if (String(url).endsWith('/api/health')) {
        return response(200, { ok: true, subtitleRemoval: { enabled: false, configured: true } });
      }
      return response(200, {
        config: {
          providers: { goldenSubtitle: { configured: true } },
          featureRollouts: { subtitleRemoval: false },
        },
      });
    },
    log: (line) => logs.push(line),
  });

  assert.equal(result.mode, 'readiness');
  assert.deepEqual(calls, [
    { url: 'https://meiao.test/api/health', method: 'GET' },
    { url: 'https://meiao.test/api/system/config', method: 'GET' },
  ]);
  assert.equal(calls.some((call) => call.method === 'POST'), false);
  assert.equal(logs.join('\n').includes('session-secret'), false);
});

test('live mode creates exactly one job, verifies managed Range playback, and performs scoped cleanup', async () => {
  const sessionToken = 'session-super-secret';
  const providerToken = 'golden-never-log';
  const signedSource = 'https://meiao.test/api/assets/file/source.mp4?accessKey=source-signature';
  const signedResult = 'https://meiao.test/api/assets/file/result.mp4?accessKey=result-signature';
  const calls = [];
  const logs = [];
  let polls = 0;
  const options = resolveProbeOptions({
    argv: ['--live', '--fixture', '/tmp/canary.mp4'],
    env: {
      MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM: '1',
      MEIAO_SUBTITLE_REMOVAL_PROBE_BASE_URL: 'https://meiao.test',
      MEIAO_SUBTITLE_REMOVAL_PROBE_SESSION_TOKEN: sessionToken,
      GOLDEN_SUBTITLE_API_TOKEN: providerToken,
    },
  });

  const result = await runSubtitleRemovalProbe(options, {
    readFileImpl: async () => Buffer.from('fixture'),
    probeFixtureImpl: async () => ({ durationSeconds: 2.5, width: 720, height: 1280, sizeBytes: 7 }),
    sleep: async () => {},
    log: (line) => logs.push(line),
    fetchImpl: async (url, init = {}) => {
      const href = String(url);
      const method = init.method || 'GET';
      calls.push({ href, method, headers: init.headers, body: init.body });
      if (href.endsWith('/api/health')) return response(200, { ok: true, subtitleRemoval: { enabled: true, configured: true } });
      if (href.endsWith('/api/system/config')) return response(200, { config: { providers: { goldenSubtitle: { configured: true } }, featureRollouts: { subtitleRemoval: true } } });
      if (href.endsWith('/api/assets/upload-stream')) return response(200, { fileUrl: signedSource, assetId: 'source' });
      if (href.endsWith('/api/jobs') && method === 'POST') return response(201, { job: { id: 'job-canary-1', status: 'queued' } });
      if (href.endsWith('/api/jobs/job-canary-1') && method === 'GET') {
        polls += 1;
        return polls === 1
          ? response(200, { job: { id: 'job-canary-1', status: 'running', providerTaskId: 'provider-1' } })
          : response(200, { job: { id: 'job-canary-1', status: 'succeeded', providerTaskId: 'provider-1', result: { videoUrl: signedResult } } });
      }
      if ((href === signedSource || href === signedResult) && method === 'GET') {
        return response(206, {}, { 'content-range': 'bytes 0-0/7' });
      }
      if (href.endsWith('/api/jobs/job-canary-1') && method === 'DELETE') return response(200, { ok: true });
      if (href.endsWith('/api/assets/by-url') && method === 'DELETE') return response(200, { ok: true });
      throw new Error(`Unexpected request: ${method} ${href}`);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerTaskIdPresent, true);
  assert.equal(result.managedResultUrlPresent, true);
  assert.equal(calls.filter((call) => call.href.endsWith('/api/jobs') && call.method === 'POST').length, 1);
  assert.equal(calls.some((call) => call.href.endsWith('/api/jobs/job-canary-1') && call.method === 'DELETE'), true);
  assert.equal(calls.some((call) => call.href.endsWith('/api/assets/by-url') && call.method === 'DELETE'), true);
  const output = logs.join('\n');
  for (const secret of [sessionToken, providerToken, 'source-signature', 'result-signature', 'provider-1']) {
    assert.equal(output.includes(secret), false);
  }
  assert.match(output, /"jobId":"job-canary-1"/);
  assert.match(output, /"providerTaskIdPresent":true/);
  assert.match(output, /"managedResultUrlPresent":true/);
  assert.match(output, /"durationSeconds":2\.5/);
});
