export const summarizeProbeOutcome = (probe) => {
  const sourceCount = Array.isArray(probe?.sources) ? probe.sources.length : 0;
  const missingCount = Array.isArray(probe?.missingCriticalFields) ? probe.missingCriticalFields.length : 0;
  return `已完成 ${sourceCount} 个数据源勘探，缺失 ${missingCount} 个关键字段`;
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

  if (probe?.error) {
    sections.push(['勘探错误', probe.error]);
  }

  if (report?.summary) {
    sections.push(['数据勘探摘要', report.summary]);
  }

  if (Array.isArray(report?.evidence) && report.evidence.length > 0) {
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
