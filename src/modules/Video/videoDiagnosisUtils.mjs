export const summarizeProbeOutcome = (probe) => {
  const sourceCount = Array.isArray(probe?.sources) ? probe.sources.length : 0;
  const missingCount = Array.isArray(probe?.missingCriticalFields) ? probe.missingCriticalFields.length : 0;
  const metricSummary = buildProbeMetricSummary(probe);
  return `已完成 ${sourceCount} 个数据源勘探，缺失 ${missingCount} 个关键字段${metricSummary ? `，${metricSummary}` : ''}`;
};

export const formatEvidenceValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);

  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
};

const hasDisplayValue = (value) => value !== null && value !== undefined && value !== '' && !Number.isNaN(Number(value));

const formatMetricNumber = (value) => {
  if (!hasDisplayValue(value)) return '';
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('zh-CN').format(number) : String(value);
};

const metricLine = (label, value) => {
  const formatted = formatMetricNumber(value);
  return formatted ? `${label} ${formatted}` : '';
};

const getProbeDiag = (probe) => probe?.normalized?.diag || null;

const buildProbeMetricSummary = (probe) => {
  const diag = getProbeDiag(probe);
  if (!diag || typeof diag !== 'object') return '';
  const stats = diag.statistics || {};
  const isXhs = Boolean(diag.note);
  const metrics = isXhs
    ? [
        metricLine('点赞', stats.likedCount),
        metricLine('评论', stats.commentCount),
        metricLine('收藏', stats.collectCount),
      ].filter(Boolean)
    : [
        metricLine('播放量', stats.playCount),
        metricLine('点赞', stats.diggCount),
        metricLine('评论', stats.commentCount),
      ].filter(Boolean);
  return metrics.join('，');
};

const buildProbeDataSummary = (probe) => {
  const diag = getProbeDiag(probe);
  if (!diag || typeof diag !== 'object') return '';

  const stats = diag.statistics || {};
  const author = diag.author || {};
  const video = diag.video || diag.note || {};
  const isXhs = Boolean(diag.note);
  const metrics = isXhs
    ? [
        metricLine('点赞', stats.likedCount),
        metricLine('评论', stats.commentCount),
        metricLine('收藏', stats.collectCount),
        metricLine('分享', stats.shareCount),
        metricLine('浏览', stats.viewCount),
      ].filter(Boolean)
    : [
        metricLine('播放量', stats.playCount),
        metricLine('点赞', stats.diggCount),
        metricLine('评论', stats.commentCount),
        metricLine('分享', stats.shareCount),
        metricLine('收藏', stats.collectCount),
      ].filter(Boolean);

  const lines = [];
  if (metrics.length > 0) lines.push(`${isXhs ? '公开互动' : '互动数据'}：${metrics.join('，')}。`);
  if (author.nickname) lines.push(`作者：${author.nickname}`);
  const title = video.desc || video.title || '';
  if (title) lines.push(`${isXhs ? '笔记内容' : '视频内容'}：${String(title).slice(0, 80)}`);
  return lines.join('\n');
};

const buildProbeEvidenceText = (probe) => {
  const diag = getProbeDiag(probe);
  if (!diag || typeof diag !== 'object') return '';

  const stats = diag.statistics || {};
  const isXhs = Boolean(diag.note);
  const evidence = isXhs
    ? [
        ['点赞数', stats.likedCount],
        ['评论数', stats.commentCount],
        ['收藏数', stats.collectCount],
        ['分享数', stats.shareCount],
        ['浏览数', stats.viewCount],
      ]
    : [
        ['播放量', stats.playCount],
        ['点赞数', stats.diggCount],
        ['评论数', stats.commentCount],
        ['分享数', stats.shareCount],
        ['收藏数', stats.collectCount],
      ];

  return evidence
    .map(([label, value]) => {
      const formatted = formatMetricNumber(value);
      return formatted ? `${label}：${formatted}` : '';
    })
    .filter(Boolean)
    .join('\n');
};

const levelLabels = {
  normal: '正常',
  warning: '注意',
  danger: '风险',
};

const riskLabels = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  unknown: '未知',
};

export const isDiagnosisRunning = (state) => {
  const report = state?.report || {};
  const aiAnalysis = state?.aiAnalysis || {};
  const probe = state?.probe || {};
  return probe?.status === 'loading'
    || report?.status === 'loading'
    || aiAnalysis?.status === 'loading'
    || state?.status === 'loading';
};

export const hasDiagnosisReportContent = (state) => {
  const report = state?.report || {};
  const aiAnalysis = state?.aiAnalysis || {};
  const probe = state?.probe || {};
  if (isDiagnosisRunning(state)) return true;
  if (probe?.status === 'error' && probe?.error) return true;
  if (report?.status === 'ready' && report?.summary) return true;
  if (aiAnalysis?.status === 'success' && aiAnalysis?.summary) return true;
  if (aiAnalysis?.status === 'error' && aiAnalysis?.error) return true;
  return false;
};

export const buildDiagnosisReportText = (state) => {
  const report = state?.report || {};
  const aiAnalysis = state?.aiAnalysis || {};
  const probe = state?.probe || {};
  const sections = [];
  const probeDataSummary = buildProbeDataSummary(probe);
  const probeEvidenceText = buildProbeEvidenceText(probe);

  if (probe?.error) {
    sections.push(['勘探错误', probe.error]);
  }

  if (probeDataSummary || report?.summary) {
    sections.push(['数据勘探摘要', probeDataSummary || report.summary]);
  }

  if (probeEvidenceText) {
    sections.push(['关键证据', probeEvidenceText]);
  } else if (Array.isArray(report?.evidence) && report.evidence.length > 0) {
    sections.push([
      '关键证据',
      report.evidence
        .map((item) => {
          const value = formatEvidenceValue(item?.value);
          return value ? `${item?.label || '证据'}：${value}` : item?.label || '';
        })
        .filter(Boolean)
        .join('\n'),
    ]);
  }

  if (Array.isArray(report?.inferences) && report.inferences.length > 0) {
    sections.push([
      '规则判断',
      report.inferences
        .map((item) => `${item?.title || '判断'}：${item?.summary || ''}`.trim())
        .filter(Boolean)
        .join('\n'),
    ]);
  }

  if (Array.isArray(report?.actions) && report.actions.length > 0) {
    sections.push([
      '执行建议',
      report.actions
        .map((item) => `${item?.title || '建议'}：${item?.detail || ''}`.trim())
        .filter(Boolean)
        .join('\n'),
    ]);
  }

  if (aiAnalysis?.summary) {
    sections.push(['AI分析总结', aiAnalysis.summary]);
  }

  if (aiAnalysis?.overallRisk) {
    sections.push(['风险等级', riskLabels[aiAnalysis.overallRisk] || riskLabels.unknown]);
  }

  if (Array.isArray(aiAnalysis?.sections) && aiAnalysis.sections.length > 0) {
    sections.push([
      '分析结果',
      aiAnalysis.sections
        .map((section, index) => {
          const findings = Array.isArray(section?.findings) ? section.findings.filter(Boolean) : [];
          const lines = [
            `${index + 1}. ${section?.title || '分析项'}（${levelLabels[section?.level] || levelLabels.normal}）`,
            ...findings.map((finding) => `- ${finding}`),
          ];
          if (section?.suggestion) lines.push(`建议：${section.suggestion}`);
          return lines.join('\n');
        })
        .join('\n\n'),
    ]);
  }

  if (Array.isArray(aiAnalysis?.topActions) && aiAnalysis.topActions.length > 0) {
    sections.push([
      '优先操作建议',
      aiAnalysis.topActions
        .map((action, index) => `${index + 1}. ${action}`)
        .join('\n'),
    ]);
  }

  const text = sections
    .map(([title, body]) => `${title}\n${body}`)
    .filter((entry) => entry.trim());

  return text.length > 0 ? text.join('\n\n') : (isDiagnosisRunning(state) ? '视频诊断进行中' : '');
};
