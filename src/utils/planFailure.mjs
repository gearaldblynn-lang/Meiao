const trim = (value) => String(value || '').trim();

// 方案内容:取首个非空内容字段(前后端统一,等价旧 getOneClickPlanContent)
export const getPlanContent = (plan = {}) => trim(
  plan?.schemeContent
  || plan?.textLayout
  || plan?.sceneDescription
  || plan?.styleDirection
  || plan?.colorPalette
  || plan?.composition
  || plan?.originalContent
  || plan?.editedContent
  || plan?.prompt
  || plan?.error
  || plan?.title,
);

// 过渡期文本兜底(前后端两份正则的并集;2c 后仅被读边界迁移 normalizer 引用)
export const LEGACY_FAILURE_TEXT_PATTERNS = [
  /fetch failed/i,
  /共\s*\d+\s*张参考图，其中\s*\d+\s*张策划失败/,
  /Failed to get (?:the )?file information/i,
  /I cannot fulfill this request/i,
  /Internal Error,?\s*Please try again later/i,
  /server is currently being maintained/i,
  /Unauthorized\s*[–-]\s*Authentication failed/i,
  /Authentication failed\.?\s*Please check/i,
  /Cannot read properties of undefined/i,
  /providerTaskId/i,
  /网络连接失败，请检查网络后重试/,
  /AI\s*分析请求失败/,
  /SKU方案策划失败/,
  /策划失败/,
  /任务状态同步失败/,
];

export const isLegacyFailureText = (value) => {
  const content = trim(value).replace(/\s+/g, ' ');
  if (!content) return false;
  return LEGACY_FAILURE_TEXT_PATTERNS.some((pattern) => pattern.test(content));
};

// 单一判据:结构化字段优先,正则仅过渡期兜底(2c 删除最后一行)
export const isPlanFailed = (plan = {}) => {
  if (plan?.planningFailed === true) return true;
  if (plan?.status === 'error') return true;
  if (trim(plan?.errorCode)) return true;
  return isLegacyFailureText(getPlanContent(plan));
};
