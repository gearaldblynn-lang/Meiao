import {
  VOICEOVER_TTS_MODEL,
  getVoiceoverLanguage,
  getVoiceoverVoice,
} from '../src/utils/voiceoverCatalog.mjs';
import {
  buildVoiceoverTtsProviderInput,
  estimateVoiceoverTtsInputTokens,
} from './voiceoverAnalysis.mjs';
import { getVoiceoverConfig } from './voiceoverContract.mjs';

const SPEAKER = 'Speaker 1';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_POLL_MAX_ATTEMPTS = 180;
const DEFAULT_NOT_FOUND_GRACE_MS = 45_000;
const OPERATIONAL_BOUNDS = Object.freeze({
  requestTimeoutMs: Object.freeze([5_000, 300_000]),
  pollIntervalMs: Object.freeze([500, 30_000]),
  pollMaxAttempts: Object.freeze([1, 720]),
  notFoundGraceMs: Object.freeze([0, 300_000]),
});

const createTtsError = (code, message, extras = {}) => {
  const error = new Error(String(message || 'KIE TTS 处理失败'));
  error.code = code;
  error.providerMessage = error.message;
  Object.assign(error, extras);
  return error;
};

const withProviderTaskId = (error, providerTaskId, extras = {}) => {
  const result = error && typeof error === 'object'
    ? error
    : createTtsError('provider_internal_error', String(error || 'KIE TTS 处理失败'));
  if (providerTaskId && !result.providerTaskId) result.providerTaskId = providerTaskId;
  Object.assign(result, extras);
  return result;
};

const parseBoundedInteger = (value, fallback, [minimum, maximum]) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};

const getKieTtsOperationalConfig = (env = {}) => ({
  requestTimeoutMs: parseBoundedInteger(
    env.MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    OPERATIONAL_BOUNDS.requestTimeoutMs,
  ),
  pollIntervalMs: parseBoundedInteger(
    env.MEIAO_KIE_TTS_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    OPERATIONAL_BOUNDS.pollIntervalMs,
  ),
  pollMaxAttempts: parseBoundedInteger(
    env.MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS,
    DEFAULT_POLL_MAX_ATTEMPTS,
    OPERATIONAL_BOUNDS.pollMaxAttempts,
  ),
  notFoundGraceMs: parseBoundedInteger(
    env.MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS,
    DEFAULT_NOT_FOUND_GRACE_MS,
    OPERATIONAL_BOUNDS.notFoundGraceMs,
  ),
});

const throwIfAborted = (signal, providerTaskId = '') => {
  if (!signal?.aborted) return;
  throw createTtsError('request_cancelled', '任务已取消', {
    ...(providerTaskId ? { providerTaskId } : {}),
    providerStage: 'provider_wait',
    providerStatus: 'cancelled',
    retryable: false,
  });
};

const defaultSleep = (ms, signal, providerTaskId = '') => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
    callback(value);
  };
  const onAbort = () => finish(
    reject,
    createTtsError('request_cancelled', '任务已取消', {
      ...(providerTaskId ? { providerTaskId } : {}),
      providerStage: 'provider_wait',
      providerStatus: 'cancelled',
      retryable: false,
    }),
  );
  const timer = setTimeout(() => finish(resolve), ms);
  timer.unref?.();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener?.('abort', onAbort, { once: true });
});

const normalizeTemperature = (value) => {
  const temperature = value === undefined ? 1 : value;
  if (typeof temperature !== 'number'
    || !Number.isFinite(temperature)
    || temperature < 0
    || temperature > 2
    || Math.abs(temperature * 100 - Math.round(temperature * 100)) > Number.EPSILON * 100) {
    throw createTtsError('provider_bad_request', 'TTS temperature 必须在 0 到 2 之间并以 0.01 为步长', {
      providerStage: 'validation',
      providerStatus: 'invalid_input',
    });
  }
  return temperature;
};

const normalizePayload = (job, env, voiceoverConfig = null) => {
  if (job?.provider !== 'kie' || job?.taskType !== 'kie_tts') {
    throw createTtsError('provider_bad_request', '仅支持 parent-owned kie_tts 子任务', {
      providerStage: 'validation',
      providerStatus: 'invalid_job',
    });
  }
  const payload = job?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createTtsError('provider_bad_request', 'KIE TTS payload 无效', {
      providerStage: 'validation',
      providerStatus: 'invalid_input',
    });
  }
  const parentJobId = String(payload.parentJobId || '').trim();
  const childKey = String(payload.childKey || '').trim();
  const childMatch = childKey.match(/^tts:(0|[1-9]\d?):attempt:(0|[1-9]\d*)$/u);
  const groupIndex = payload.groupIndex;
  const attemptIndex = Number(childMatch?.[2]);
  if (payload.executionOwner !== 'parent'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(parentJobId)
    || !childMatch
    || !Number.isSafeInteger(groupIndex)
    || groupIndex < 0
    || groupIndex > 99
    || Number(childMatch?.[1]) !== groupIndex
    || !Number.isSafeInteger(attemptIndex)) {
    throw createTtsError('provider_bad_request', 'KIE TTS 父子任务身份无效', {
      providerStage: 'validation',
      providerStatus: 'invalid_parent_child',
    });
  }
  const targetLanguage = String(payload.targetLanguage || '').trim();
  const voiceName = String(payload.voiceName || '').trim();
  if (!getVoiceoverLanguage(targetLanguage) || !getVoiceoverVoice(voiceName)) {
    throw createTtsError('provider_bad_request', 'KIE TTS 语言或音色无效', {
      providerStage: 'validation',
      providerStatus: 'invalid_catalog_value',
    });
  }
  if (!Array.isArray(payload.dialogueTurns) || payload.dialogueTurns.length === 0) {
    throw createTtsError('provider_bad_request', 'KIE TTS 对话不能为空', {
      providerStage: 'validation',
      providerStatus: 'invalid_dialogue',
    });
  }
  const dialogueTurns = payload.dialogueTurns.map((turn) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)
      || turn.speaker !== SPEAKER || typeof turn.text !== 'string' || !turn.text.trim()) {
      throw createTtsError('provider_bad_request', 'KIE TTS 仅支持 Speaker 1 的非空对话', {
        providerStage: 'validation',
        providerStatus: 'invalid_dialogue',
      });
    }
    return { speaker: SPEAKER, text: turn.text };
  });
  const scene = typeof payload.scene === 'string' ? payload.scene : '';
  const sampleContext = typeof payload.sampleContext === 'string' ? payload.sampleContext : '';
  if (!scene.trim() || !sampleContext.trim()
    || Array.from(scene).length > 1000
    || Array.from(sampleContext).length > 1000) {
    throw createTtsError('provider_bad_request', 'KIE TTS scene 或 sample_context 无效', {
      providerStage: 'validation',
      providerStatus: 'invalid_context',
    });
  }
  const temperature = normalizeTemperature(payload.temperature);
  const normalized = {
    executionOwner: 'parent',
    parentJobId,
    childKey,
    groupIndex,
    targetLanguage,
    voiceName,
    dialogueTurns,
    temperature,
    scene,
    sampleContext,
  };
  if (
    estimateVoiceoverTtsInputTokens(normalized)
    > (voiceoverConfig || getVoiceoverConfig(env)).ttsMaxInputTokens
  ) {
    throw createTtsError('voiceover_tts_input_too_large', '口播组超过当前语音模型输入上限', {
      providerStage: 'validation',
      providerStatus: 'input_too_large',
      retryable: false,
    });
  }
  return normalized;
};

export function buildKieTtsCreateBody(payload) {
  const input = buildVoiceoverTtsProviderInput(payload);
  return {
    model: VOICEOVER_TTS_MODEL,
    input,
  };
}

const responseError = (code, message, providerTaskId = '', stage = 'provider_wait') => {
  const numericCode = Number(code || 0);
  const extras = {
    ...(providerTaskId ? { providerTaskId } : {}),
    providerStage: stage,
    providerHttpStatus: numericCode,
  };
  if (numericCode === 401 || numericCode === 403) {
    return createTtsError('provider_auth_invalid', message || 'KIE TTS 鉴权失败', {
      ...extras,
      providerStatus: 'auth_invalid',
      retryable: false,
    });
  }
  if (numericCode === 402) {
    return createTtsError('provider_balance_insufficient', message || 'KIE TTS 余额不足', {
      ...extras,
      providerStatus: 'balance_insufficient',
      retryable: false,
    });
  }
  if (numericCode === 404) {
    return createTtsError('task_not_found', message || 'KIE TTS 任务不存在或已过期', {
      ...extras,
      providerStatus: 'not_found',
      retryable: false,
    });
  }
  if (numericCode === 429) {
    return createTtsError('provider_rate_limited', message || 'KIE TTS 请求过于频繁', {
      ...extras,
      providerStatus: 'rate_limited',
    });
  }
  if (numericCode >= 500) {
    return createTtsError('provider_internal_error', message || 'KIE TTS 服务暂时异常', {
      ...extras,
      providerStatus: 'server_error',
    });
  }
  return createTtsError('provider_bad_request', message || 'KIE TTS 请求参数无效', {
    ...extras,
    providerStatus: 'bad_request',
    retryable: false,
  });
};

export function normalizeKieTtsCreateResponse(body) {
  const code = Number(body?.code || 0);
  if (!code) {
    throw createTtsError(
      'provider_submission_unknown',
      '无法读取 KIE TTS 创建响应，已停止自动重提',
      {
        providerStage: 'provider_submit',
        providerStatus: 'submission_unknown',
        submissionUnknown: true,
        retryable: false,
      },
    );
  }
  if (code !== 200) throw responseError(code, body?.msg, '', 'provider_submit');
  const providerTaskId = String(body?.data?.taskId || '').trim();
  if (!providerTaskId) {
    throw createTtsError(
      'provider_submission_unknown',
      'KIE TTS 返回成功但没有任务编号，已停止自动重提',
      {
        providerStage: 'provider_submit',
        providerStatus: 'submission_unknown',
        submissionUnknown: true,
        retryable: false,
      },
    );
  }
  return { providerTaskId };
}

const firstSafeAudioUrl = (resultUrls) => {
  if (!Array.isArray(resultUrls)) return '';
  for (const value of resultUrls) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch {
      // Ignore malformed provider candidates and continue to the next one.
    }
  }
  return '';
};

export function normalizeKieTtsRecordResponse(body, taskId) {
  const providerTaskId = String(taskId || '').trim();
  if (!providerTaskId) {
    throw createTtsError('provider_bad_request', 'KIE TTS 查询缺少任务编号', {
      providerStage: 'provider_wait',
      providerStatus: 'invalid_task_id',
      retryable: false,
    });
  }
  const code = Number(body?.code || 0);
  if (!code) {
    throw createTtsError('provider_bad_response', '无法读取 KIE TTS 查询响应', {
      providerTaskId,
      providerStage: 'provider_wait',
      providerStatus: 'invalid_response',
    });
  }
  if (code !== 200) throw responseError(code, body?.msg, providerTaskId);
  const returnedTaskId = String(body?.data?.taskId || '').trim();
  if (returnedTaskId && returnedTaskId !== providerTaskId) {
    throw createTtsError('provider_bad_response', 'KIE TTS 查询返回了不匹配的任务编号', {
      providerTaskId,
      providerStage: 'provider_wait',
      providerStatus: 'task_id_mismatch',
    });
  }
  const state = String(body?.data?.state || '').trim();
  if (state === 'waiting') return { state, providerTaskId };
  if (state === 'fail') {
    const failCode = String(body?.data?.failCode || '').trim();
    const failMsg = String(body?.data?.failMsg || body?.msg || 'KIE TTS 合成失败').trim();
    throw createTtsError('provider_job_failed', failMsg, {
      providerTaskId,
      providerStage: 'provider_wait',
      providerStatus: 'failed',
      failCode,
      failMsg,
      retryable: false,
    });
  }
  if (state !== 'success') {
    throw createTtsError('provider_bad_response', 'KIE TTS 返回了未知任务状态', {
      providerTaskId,
      providerStage: 'provider_wait',
      providerStatus: 'invalid_state',
    });
  }
  let result;
  try {
    result = JSON.parse(String(body?.data?.resultJson || ''));
  } catch {
    throw createTtsError('provider_bad_response', 'KIE TTS resultJson 无效', {
      providerTaskId,
      providerStage: 'provider_wait',
      providerStatus: 'invalid_result',
    });
  }
  const audioUrl = firstSafeAudioUrl(result?.resultUrls);
  if (!audioUrl) {
    throw createTtsError('provider_bad_response', 'KIE TTS 成功响应没有安全音频地址', {
      providerTaskId,
      providerStage: 'provider_wait',
      providerStatus: 'success_without_result',
    });
  }
  return { state, providerTaskId, audioUrl };
}

const readJsonResponse = async (response) => {
  try {
    const body = await response?.json?.();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
};

const normalizeQueryError = (error, providerTaskId) => {
  if (error?.code) return withProviderTaskId(error, providerTaskId);
  return createTtsError('provider_network_error', error?.message || 'KIE TTS 查询失败', {
    providerTaskId,
    providerStage: 'provider_wait',
    providerStatus: 'network_error',
  });
};

export async function runKieTtsJob({
  job,
  env = process.env,
  signal,
  onProviderTaskId,
  config: providedConfig,
  deps = {},
} = {}) {
  const voiceoverConfig = providedConfig || getVoiceoverConfig(env);
  const payload = normalizePayload(job, env, voiceoverConfig);
  const kieApiKey = String(env?.KIE_API_KEY || env?.MEIAO_KIE_API_KEY || '').trim();
  if (!kieApiKey) {
    throw createTtsError('provider_auth_invalid', 'KIE API Key 未配置', {
      providerStage: 'configuration',
      providerStatus: 'auth_invalid',
      retryable: false,
    });
  }
  const fetchWithTimeout = deps.fetchWithTimeout;
  if (typeof fetchWithTimeout !== 'function') {
    throw createTtsError('provider_internal_error', 'KIE TTS 网络依赖不可用', {
      providerStage: 'configuration',
      providerStatus: 'dependency_missing',
      retryable: false,
    });
  }
  const operational = getKieTtsOperationalConfig(env);
  const baseUrl = voiceoverConfig.kieBaseUrl.replace(/\/+$/u, '');
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  let providerTaskId = String(job?.providerTaskId || '').trim();
  throwIfAborted(signal, providerTaskId);

  if (!providerTaskId) {
    if (typeof onProviderTaskId !== 'function') {
      throw createTtsError('provider_internal_error', 'KIE TTS 缺少任务编号持久化回调', {
        providerStage: 'provider_checkpoint',
        providerStatus: 'dependency_missing',
        retryable: false,
      });
    }
    let response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/api/v1/jobs/createTask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kieApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildKieTtsCreateBody(payload)),
        signal,
      }, 'KIE TTS 创建任务超时', operational.requestTimeoutMs, 'provider_submit', {
        maxRetries: 0,
        idempotent: false,
      });
    } catch (error) {
      throw createTtsError(
        'provider_submission_unknown',
        error?.providerMessage || error?.message || 'KIE TTS 提交结果未知',
        {
          providerStage: 'provider_submit',
          providerStatus: 'submission_unknown',
          submissionUnknown: true,
          retryable: false,
        },
      );
    }
    const body = await readJsonResponse(response);
    if (!response?.ok) {
      throw responseError(response?.status, body?.msg, '', 'provider_submit');
    }
    ({ providerTaskId } = normalizeKieTtsCreateResponse(body));
    try {
      await onProviderTaskId(providerTaskId);
    } catch (error) {
      throw createTtsError(
        'provider_internal_error',
        `KIE TTS 任务已创建，但任务编号持久化失败：${error?.message || '未知错误'}`,
        {
          cause: error,
          checkpointErrorCode: String(error?.code || ''),
          providerTaskId,
          providerStage: 'provider_checkpoint',
          providerStatus: 'checkpoint_failed',
          retryable: false,
        },
      );
    }
  }

  const startedAt = now();
  for (let attempt = 0; attempt < operational.pollMaxAttempts; attempt += 1) {
    throwIfAborted(signal, providerTaskId);
    let response;
    try {
      response = await fetchWithTimeout(
        `${baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(providerTaskId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${kieApiKey}` },
          signal,
        },
        'KIE TTS 查询任务超时',
        operational.requestTimeoutMs,
        'provider_wait',
      );
    } catch (error) {
      throw normalizeQueryError(error, providerTaskId);
    }
    const body = await readJsonResponse(response);
    const isNotFound = response?.status === 404
      || (response?.ok && Number(body?.code) === 404);
    if (isNotFound
      && operational.notFoundGraceMs > 0
      && now() - startedAt < operational.notFoundGraceMs
      && attempt + 1 < operational.pollMaxAttempts) {
      await sleep(operational.pollIntervalMs, signal, providerTaskId);
      continue;
    }
    if (!response?.ok) {
      body.code = response?.status;
    }
    let normalized;
    try {
      normalized = normalizeKieTtsRecordResponse(body, providerTaskId);
    } catch (error) {
      throw withProviderTaskId(error, providerTaskId);
    }
    if (normalized.state === 'success') {
      return {
        providerTaskId,
        providerStage: 'provider_wait',
        providerStatus: 'success',
        result: {
          audioUrl: normalized.audioUrl,
          voiceName: payload.voiceName,
          groupIndex: payload.groupIndex,
        },
      };
    }
    if (attempt + 1 < operational.pollMaxAttempts) {
      await sleep(operational.pollIntervalMs, signal, providerTaskId);
    }
  }

  throw createTtsError('provider_timeout', 'KIE TTS 处理超时，可稍后按原任务编号继续查询', {
    providerTaskId,
    providerStage: 'provider_wait',
    providerStatus: 'timeout',
  });
}
