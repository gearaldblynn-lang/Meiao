// S2 Task G2 · 失败原因人话化(单一映射,前后端/多引擎共用)
//
// 背景:云上 7 天 408 条错误里 `fetch failed` 等传输原文直接甩给用户,用户看不懂。
// 契约:humanizeProviderError(error) → { message, detail }
//   - message:用户能看懂的人话文案,永不为空
//   - detail:技术原文(error.message),原样保留不丢信息
// 判定顺序:结构化字段优先(code + providerStage),文字匹配只用于细分展示文案
// (上游过载类 503),不决定控制流——见根因库 #2。

const OVERLOAD_TEXT_PATTERN = /cpu overloaded|concurrency limit|server overloaded|too many concurrent/i;
const CJK_PATTERN = /[一-鿿]/;
const RAW_NOTE_MAX_LENGTH = 160;

// 传输阶段(素材上传/下载)错误:换文案比按 code 细分更有用,用户动作一致。
const TRANSFER_STAGE_CODES = new Set([
  'provider_network_error',
  'provider_timeout',
  'provider_internal_error',
]);

const CODE_MESSAGES = {
  provider_submission_unknown: '提交结果暂时无法确认。为防止重复扣费，系统未自动重试，请先在任务列表确认是否已有结果。',
  provider_network_error: '服务器到生成服务的网络暂时不稳，已自动重试仍未成功，请稍后重试',
  provider_timeout: '生成服务响应超时，请稍后重试',
  provider_internal_error: '生成服务暂时异常，请稍后重试',
  provider_credit_insufficient: '生成服务余额不足，请联系管理员充值',
  provider_rate_limited: '生成服务请求过于频繁，请稍后重试',
  provider_auth_invalid: '生成服务访问凭证无效或未配置，请联系管理员检查配置',
  provider_request_limit: '生成服务调用额度受限，请联系管理员',
  provider_bad_response: '生成服务返回了无法解析的结果，请稍后重试',
};

const trimRawNote = (value) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > RAW_NOTE_MAX_LENGTH ? `${text.slice(0, RAW_NOTE_MAX_LENGTH)}...` : text;
};

const withRawNote = (baseMessage, raw) => {
  const note = trimRawNote(raw);
  return note ? `${baseMessage}（技术原因：${note}）` : baseMessage;
};

export const humanizeProviderError = (error) => {
  const code = String(error?.code || '').trim();
  const providerStage = String(error?.providerStage || '').trim();
  const raw = String(error?.message || '');

  // 取消不是失败,原文已是人话,原样透传。
  if (code === 'request_cancelled') {
    return { message: raw || '任务已取消', detail: raw };
  }

  // 传输阶段细分:asset_upload / asset_download(根因库 #23:这类错误换模型也没用)。
  if (TRANSFER_STAGE_CODES.has(code)) {
    if (providerStage === 'asset_upload') {
      return { message: '素材上传到生成服务失败，请稍后重试或压缩素材', detail: raw };
    }
    if (providerStage === 'asset_download') {
      return { message: '从生成服务下载素材失败，请稍后重试', detail: raw };
    }
  }

  // "cpu overloaded"/"Concurrency limit" 类 503:上游过载,给更准确的等待预期。
  if ((code === 'provider_internal_error' || code === 'provider_rate_limited') && OVERLOAD_TEXT_PATTERN.test(raw)) {
    return { message: '生成服务当前繁忙（上游过载），请稍后重试', detail: raw };
  }

  // bad_request / refusal:原文常带可操作信息(如 Seedance 时长限制已是中文人话),
  // 含中文直接透传;英文原文包成人话并附技术原因,不丢信息。
  if (code === 'provider_bad_request') {
    if (CJK_PATTERN.test(raw)) return { message: raw, detail: raw };
    return { message: withRawNote('生成服务无法处理本次请求，请调整素材或参数后重试', raw), detail: raw };
  }
  if (code === 'provider_refusal') {
    if (CJK_PATTERN.test(raw)) return { message: raw, detail: raw };
    return { message: withRawNote('生成服务拒绝了本次生成请求，请调整提示词或素材后重试', raw), detail: raw };
  }

  const mapped = CODE_MESSAGES[code];
  if (mapped) {
    return { message: mapped, detail: raw };
  }

  // 未知 code:兜底文案 + 原文附注,不丢技术信息。
  return { message: withRawNote('任务执行失败，请稍后重试', raw), detail: raw };
};
