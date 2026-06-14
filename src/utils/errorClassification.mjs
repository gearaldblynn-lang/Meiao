const trim = (value) => String(value || '').trim();

export const NON_RECOVERABLE_ERROR_CODES = new Set([
  'provider_credit_insufficient',
  'provider_request_limit',
  'provider_auth_invalid',
  'provider_bad_request',
  'task_not_found',
]);

export const RECOVERABLE_ERROR_CODES = new Set([
  'provider_timeout',
  'provider_network_error',
  'provider_internal_error',
  'provider_rate_limited',
]);

// 过渡期 message 兜底(2c 后仅被读边界引用)
export const RECOVERABLE_MESSAGE_PATTERN = /fetch failed|network|timeout|超时|服务异常|网络异常|网络连接失败/i;

// 单一判据:结构化(providerStatus / errorCode)优先,message 仅过渡期兜底
export const isRecoverableError = ({ errorCode, providerStatus, message } = {}) => {
  if (trim(providerStatus) === 'recoverable_pending_result') return true;
  const code = trim(errorCode);
  if (code && NON_RECOVERABLE_ERROR_CODES.has(code)) return false;
  if (code && RECOVERABLE_ERROR_CODES.has(code)) return true;
  return RECOVERABLE_MESSAGE_PATTERN.test(trim(message));
};
