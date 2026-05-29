type OneClickPlanLike = {
  title?: unknown;
  schemeContent?: unknown;
  textLayout?: unknown;
  sceneDescription?: unknown;
  styleDirection?: unknown;
  colorPalette?: unknown;
  composition?: unknown;
  originalContent?: unknown;
  editedContent?: unknown;
  prompt?: unknown;
  error?: unknown;
};

const INVALID_ONE_CLICK_PLAN_PATTERNS = [
  /fetch failed/i,
  /共\s*\d+\s*张参考图，其中\s*\d+\s*张策划失败/,
  /Failed to get (?:the )?file information/i,
  /I cannot fulfill this request/i,
  /Cannot read properties of undefined/i,
  /providerTaskId/i,
  /网络连接失败，请检查网络后重试/,
  /AI\s*分析请求失败/,
  /SKU方案策划失败/,
  /策划失败/,
  /任务状态同步失败/,
];

export const getOneClickPlanContent = (plan: OneClickPlanLike = {}) => String(
  plan.schemeContent
  || plan.textLayout
  || plan.sceneDescription
  || plan.styleDirection
  || plan.colorPalette
  || plan.composition
  || plan.originalContent
  || plan.editedContent
  || plan.prompt
  || plan.error
  || plan.title
  || ''
).trim();

export const isInvalidOneClickPlanText = (value: unknown) => {
  const content = String(value || '').replace(/\s+/g, ' ').trim();
  if (!content) return false;
  return INVALID_ONE_CLICK_PLAN_PATTERNS.some((pattern) => pattern.test(content));
};

export const isInvalidOneClickPlanLike = (plan: OneClickPlanLike = {}) => (
  isInvalidOneClickPlanText(getOneClickPlanContent(plan))
);
