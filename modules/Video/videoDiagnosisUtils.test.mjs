import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeProbeOutcome, formatEvidenceValue } from './videoDiagnosisUtils.mjs';

const appStateSource = readFileSync(new URL('../../utils/appState.ts', import.meta.url), 'utf8');
const videoModuleSource = readFileSync(new URL('./VideoModule.tsx', import.meta.url), 'utf8');

test('createDefaultVideoState keeps storyboard subMode while defining diagnosis defaults', () => {
  assert.match(appStateSource, /createDefaultVideoState\s*=\s*\(\)\s*:\s*VideoPersistentState\s*=>\s*\(\{/);
  assert.match(appStateSource, /subMode:\s*VideoSubMode\.STORYBOARD/);
  assert.match(appStateSource, /diagnosis:\s*\{\s*[\s\S]*platform:\s*'tiktok'/);
  assert.match(appStateSource, /url:\s*''/);
  assert.match(appStateSource, /analysisItems:\s*\[\s*'video_basic'\s*,\s*'video_metrics'\s*,\s*'author_profile'\s*\]/);
  assert.match(appStateSource, /probe:\s*\{\s*[\s\S]*status:\s*'idle'/);
  assert.match(appStateSource, /report:\s*\{\s*[\s\S]*status:\s*'idle'/);
});

test('normalizeLoadedPersistedAppState backfills diagnosis state when missing', () => {
  assert.match(appStateSource, /normalizeLoadedPersistedAppState/);
  assert.match(appStateSource, /diagnosis:\s*saved\.videoMemory\.diagnosis\s*\|\|\s*defaultVideoState\.diagnosis/);
});

test('video module handles diagnosis loading and error states', () => {
  assert.match(videoModuleSource, /probeVideoDiagnosis/);
  assert.match(videoModuleSource, /probe:\s*\{\s*[\s\S]*status:\s*'loading'/);
  assert.match(videoModuleSource, /status:\s*'error'/);
  assert.match(videoModuleSource, /addToast/);
});

test('summarizeProbeOutcome returns a friendly probe summary', () => {
  assert.equal(
    summarizeProbeOutcome({
      sources: [{ key: 'video', status: 'success', summary: '已获取视频详情' }],
      missingCriticalFields: ['platform.review_status'],
    }),
    '已完成 1 个数据源勘探，缺失 1 个关键字段'
  );
});

test('summarizeProbeOutcome handles missing and invalid shapes', () => {
  assert.equal(summarizeProbeOutcome(undefined), '已完成 0 个数据源勘探，缺失 0 个关键字段');
  assert.equal(summarizeProbeOutcome(null), '已完成 0 个数据源勘探，缺失 0 个关键字段');
  assert.equal(summarizeProbeOutcome({}), '已完成 0 个数据源勘探，缺失 0 个关键字段');
  assert.equal(summarizeProbeOutcome({ sources: 'nope', missingCriticalFields: {} }), '已完成 0 个数据源勘探，缺失 0 个关键字段');
  assert.equal(summarizeProbeOutcome({ sources: [], missingCriticalFields: [] }), '已完成 0 个数据源勘探，缺失 0 个关键字段');
});

test('formatEvidenceValue stringifies primitive values', () => {
  assert.equal(formatEvidenceValue(83), '83');
  assert.equal(formatEvidenceValue(true), 'true');
});

test('formatEvidenceValue handles nullish and objects without throwing', () => {
  assert.equal(formatEvidenceValue(null), '');
  assert.equal(formatEvidenceValue(undefined), '');
  assert.equal(formatEvidenceValue({ a: 1 }), '{"a":1}');

  const circular = {};
  circular.self = circular;
  assert.equal(formatEvidenceValue(circular), '[object Object]');
});
