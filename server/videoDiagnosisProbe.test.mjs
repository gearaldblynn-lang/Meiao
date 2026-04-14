import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  flattenFieldPaths,
  extractTikTokVideoIdFromUrl,
  buildDiagnosisReport,
  createVideoDiagnosisProbe,
} from './videoDiagnosisProbe.mjs';

test('extractTikTokVideoIdFromUrl parses share url', () => {
  assert.equal(
    extractTikTokVideoIdFromUrl('https://www.tiktok.com/@demo/video/7388888888888888888'),
    '7388888888888888888'
  );
});

test('flattenFieldPaths returns nested object paths', () => {
  const fields = flattenFieldPaths({
    data: {
      statistics: { play_count: 83 },
      author: { nickname: 'demo' },
    },
  });

  assert.deepEqual(fields, [
    'data',
    'data.statistics',
    'data.statistics.play_count',
    'data.author',
    'data.author.nickname',
  ]);
});

test('buildDiagnosisReport separates evidence and inference', () => {
  const report = buildDiagnosisReport({
    platform: 'tiktok',
    normalized: {
      video: { playCount: 83, diggCount: 1, commentCount: 0, desc: 'demo' },
      author: { nickname: 'tester' },
      platformSignals: { hasDirectRiskField: false },
    },
    missingCriticalFields: ['platform.review_status'],
  });

  assert.match(report.summary, /83/);
  assert.equal(report.evidence.length > 0, true);
  assert.equal(report.inferences.length > 0, true);
});

test('createVideoDiagnosisProbe orchestrates spiderFetch and builds normalized payload', async () => {
  const calls = [];
  const spiderFetch = async (payload) => {
    calls.push(payload);
    return {
      data: {
        desc: 'demo',
        review_status: 'reviewed',
        statistics: { play_count: 56, digg_count: 2, comment_count: 3 },
        author: { nickname: 'tester' },
      },
    };
  };

  const probeRunner = createVideoDiagnosisProbe({ spiderFetch });
  const result = await probeRunner({
    platform: 'tiktok',
    url: 'https://www.tiktok.com/@demo/video/123',
    analysisItems: ['video_basic'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].platform, 'tiktok');
  assert.equal(calls[0].videoId, '123');
  assert.equal(result.probe.status, 'success');
  assert.equal(result.probe.normalized.video.id, '123');
  assert.equal(result.probe.normalized.video.playCount, 56);
  assert.equal(result.probe.normalized.author.nickname, 'tester');
  assert.equal(result.probe.normalized.platformSignals.hasDirectRiskField, true);
  assert.deepEqual(result.probe.missingCriticalFields, []);
  assert.equal(result.report.status, 'ready');
  assert.match(result.report.summary, /56/);
});

test('createVideoDiagnosisProbe reads TikTok aweme_details payloads returned by spider', async () => {
  const spiderFetch = async () => ({
    data: {
      aweme_details: [
        {
          desc: 'cats',
          statistics: { play_count: 1234, digg_count: 88, comment_count: 7 },
          author: { nickname: 'scout2015' },
          review_status: 1,
        },
      ],
    },
    success: true,
  });

  const probeRunner = createVideoDiagnosisProbe({ spiderFetch });
  const result = await probeRunner({
    platform: 'tiktok',
    url: 'https://www.tiktok.com/@demo/video/6718335390845095173',
    analysisItems: ['video_basic'],
  });

  assert.equal(result.probe.status, 'success');
  assert.equal(result.probe.normalized.video.playCount, 1234);
  assert.equal(result.probe.normalized.video.diggCount, 88);
  assert.equal(result.probe.normalized.video.commentCount, 7);
  assert.equal(result.probe.normalized.author.nickname, 'scout2015');
  assert.equal(result.probe.normalized.platformSignals.hasDirectRiskField, true);
  assert.deepEqual(result.probe.missingCriticalFields, []);
  assert.match(result.report.summary, /1234/);
});

test('createVideoDiagnosisProbe returns structured error for invalid URL', async () => {
  const spiderFetch = async () => {
    throw new Error('should not be called');
  };
  const probeRunner = createVideoDiagnosisProbe({ spiderFetch });
  const result = await probeRunner({
    platform: 'tiktok',
    url: 'https://www.tiktok.com/@demo',
    analysisItems: [],
  });

  assert.equal(result.probe.status, 'error');
  assert.equal(result.report.status, 'idle');
  assert.equal(result.probe.missingCriticalFields[0], 'video.id');
});

test('createVideoDiagnosisProbe errors on unsupported platform', async () => {
  const spiderFetch = async () => ({});
  const probeRunner = createVideoDiagnosisProbe({ spiderFetch });
  const result = await probeRunner({
    platform: 'youtube',
    url: 'https://www.tiktok.com/@demo/video/123',
    analysisItems: [],
  });

  assert.equal(result.probe.status, 'error');
  assert.equal(result.report.status, 'idle');
  assert.ok(result.probe.missingCriticalFields.includes('platform'));
  assert.match(result.probe.error, /不支持的平台/);
});

test('createVideoDiagnosisProbe returns error when spiderFetch throws', async () => {
  const spiderFetch = async () => {
    throw new Error('boom');
  };
  const probeRunner = createVideoDiagnosisProbe({ spiderFetch });
  const result = await probeRunner({
    platform: 'tiktok',
    url: 'https://www.tiktok.com/@demo/video/456',
    analysisItems: [],
  });

  assert.equal(result.probe.status, 'error');
  assert.equal(result.report.status, 'idle');
  assert.match(result.probe.error, /boom/);
  assert.ok(result.probe.missingCriticalFields.includes('platform.review_status'));
});

test('buildDiagnosisReport tolerates omitted missingCriticalFields', () => {
  const report = buildDiagnosisReport({
    platform: 'tiktok',
    normalized: {
      video: { playCount: 0 },
      author: { nickname: 'tester' },
      platformSignals: { hasDirectRiskField: false },
    },
    missingCriticalFields: undefined,
  });

  assert.equal(report.inferences.length, 0);
});

test('createVideoDiagnosisProbe preserves zero counters from spiderFetch', async () => {
  const spiderFetch = async () => ({
    data: {
      statistics: { play_count: 0, digg_count: 0, comment_count: 0 },
      author: { nickname: 'zero' },
    },
  });
  const probeRunner = createVideoDiagnosisProbe({ spiderFetch });
  const result = await probeRunner({
    platform: 'tiktok',
    url: 'https://www.tiktok.com/@demo/video/789',
    analysisItems: [],
  });

  assert.equal(result.probe.normalized.video.playCount, 0);
  assert.equal(result.probe.normalized.video.diggCount, 0);
  assert.equal(result.probe.normalized.video.commentCount, 0);
});

test('video diagnosis route and client helper are wired', () => {
  const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const apiSource = readFileSync(new URL('../services/internalApi.ts', import.meta.url), 'utf8');

  const mysqlRouteRegex = /const handleMysqlRequest = async \(req, res, url\) =>[\s\S]*?if \(url.pathname === '\/api\/video-diagnosis\/probe' && req.method === 'POST'\)[\s\S]*?const user = await requireDbUser\(req, res\);[\s\S]*?await handleVideoDiagnosisProbeRequest\(req, res\);/;
  const localRouteRegex = /const handleLocalRequest = async \(req, res, url\) =>[\s\S]*?if \(url.pathname === '\/api\/video-diagnosis\/probe' && req.method === 'POST'\)[\s\S]*?const user = localRequireUser\(req, res, store\);[\s\S]*?await handleVideoDiagnosisProbeRequest\(req, res\);/;
  const apiRequestRegex = /request<[\s\S]*>\('\/api\/video-diagnosis\/probe',\s*\{[\s\S]*?method: 'POST',[\s\S]*?body:/;

  assert.match(serverSource, mysqlRouteRegex);
  assert.match(serverSource, localRouteRegex);
  assert.match(apiSource, apiRequestRegex);
  assert.ok(apiSource.includes("timeoutMs: 120_000"));
});
