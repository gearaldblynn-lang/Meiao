import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeProbeOutcome, formatEvidenceValue, buildDiagnosisReportText, hasDiagnosisReportContent } from './videoDiagnosisUtils.mjs';

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

test('buildDiagnosisReportText includes ai analysis sections and report evidence', () => {
  const text = buildDiagnosisReportText({
    report: {
      summary: '勘探摘要：互动数据完整',
      evidence: [{ label: '播放量', value: 12000 }],
      inferences: [{ title: '流量判断', summary: '存在二跳不足' }],
      actions: [{ title: '补充素材', detail: '增加评论区截图' }],
    },
    aiAnalysis: {
      status: 'success',
      summary: 'AI总结：封面转化弱',
      overallRisk: 'medium',
      sections: [{
        id: 'cover',
        title: '封面诊断',
        level: 'warning',
        findings: ['标题利益点不够直接', '主体对比不足'],
        suggestion: '强化前3秒卖点与封面钩子',
      }],
      topActions: ['重做封面标题', '补充强对比首帧'],
    },
  });

  assert.match(text, /AI分析总结/);
  assert.match(text, /AI总结：封面转化弱/);
  assert.match(text, /分析结果/);
  assert.match(text, /封面诊断/);
  assert.match(text, /标题利益点不够直接/);
  assert.match(text, /优先操作建议/);
  assert.match(text, /重做封面标题/);
  assert.match(text, /数据勘探摘要/);
  assert.match(text, /播放量：12000/);
});

test('buildDiagnosisReportText stays empty for idle default diagnosis state', () => {
  assert.equal(
    buildDiagnosisReportText({
      probe: { status: 'idle', error: '', completedAt: null },
      report: { status: 'idle', summary: '', evidence: [], inferences: [], actions: [] },
      aiAnalysis: { status: 'idle', summary: '', sections: [], topActions: [], error: '', completedAt: null },
    }),
    ''
  );
});

test('buildDiagnosisReportText keeps loading text only while diagnosis is actually running', () => {
  assert.equal(
    buildDiagnosisReportText({
      probe: { status: 'loading', error: '', completedAt: null },
      report: { status: 'idle', summary: '', evidence: [], inferences: [], actions: [] },
      aiAnalysis: { status: 'idle', summary: '', sections: [], topActions: [], error: '', completedAt: null },
    }),
    '视频诊断进行中'
  );
});

test('hasDiagnosisReportContent rejects default idle diagnosis objects', () => {
  assert.equal(
    hasDiagnosisReportContent({
      url: '',
      probe: { status: 'idle', error: '', completedAt: null },
      report: { status: 'idle', summary: '', evidence: [], inferences: [], actions: [] },
      aiAnalysis: { status: 'idle', summary: '', sections: [], topActions: [], error: '', completedAt: null },
    }),
    false
  );
});

test('hasDiagnosisReportContent accepts real diagnosis content and active work', () => {
  assert.equal(hasDiagnosisReportContent({ probe: { status: 'loading' } }), true);
  assert.equal(hasDiagnosisReportContent({ report: { status: 'ready', summary: '已获取基础字段' } }), true);
  assert.equal(hasDiagnosisReportContent({ aiAnalysis: { status: 'success', summary: 'AI分析完成' } }), true);
  assert.equal(hasDiagnosisReportContent({ probe: { status: 'error', error: '链接不可访问' } }), true);
});
