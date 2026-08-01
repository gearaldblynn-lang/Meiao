import {
  assertSubtitleRemovalInput,
  buildSubtitleRemovalSubmitBody,
  createSubtitleRemovalError,
  getSubtitleRemovalConfig,
  normalizeSubtitleRemovalProgressResponse,
  normalizeSubtitleRemovalSubmitResponse,
} from './subtitleRemovalContract.mjs';
import {
  clampSubtitleRegion,
  subtitleRegionToPixels,
} from '../src/utils/subtitleRemovalRegion.mjs';

const REQUEST_TIMEOUT_MS = 60_000;

const throwIfAborted = (signal) => {
  if (signal?.aborted) {
    throw createSubtitleRemovalError('request_cancelled', '任务已取消', {
      providerStage: 'provider_wait',
      providerStatus: 'cancelled',
    });
  }
};

const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    callback(value);
  };
  const onAbort = () => {
    finish(reject, createSubtitleRemovalError('request_cancelled', '任务已取消', {
      providerStage: 'provider_wait',
      providerStatus: 'cancelled',
    }));
  };
  const timer = setTimeout(() => finish(resolve), ms);
  if (signal?.aborted) {
    onAbort();
    return;
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  timer.unref?.();
});

const normalizeHttpError = (response, stage, providerTaskId = '') => {
  const status = Number(response?.status || 0);
  const extras = {
    providerStage: stage,
    providerStatus: status === 401 || status === 403 ? 'auth_invalid' : status === 429 ? 'rate_limited' : 'http_error',
    providerHttpStatus: status,
    ...(providerTaskId ? { providerTaskId } : {}),
  };
  if (status === 401 || status === 403) {
    return createSubtitleRemovalError('provider_auth_invalid', '去字幕服务鉴权失败', extras);
  }
  if (status === 429) {
    return createSubtitleRemovalError('provider_rate_limited', '去字幕服务请求过于频繁', extras);
  }
  if (status >= 500) {
    return createSubtitleRemovalError('provider_internal_error', '去字幕服务暂时异常', extras);
  }
  return createSubtitleRemovalError('provider_bad_response', '去字幕服务返回异常', extras);
};

const postJson = async ({ url, token, body, signal, fetchImpl, stage, providerTaskId = '' }) => {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response?.ok) throw normalizeHttpError(response, stage, providerTaskId);
    return await response.json().catch(() => ({}));
  } catch (error) {
    if (error?.code) throw error;
    if (signal?.aborted) throwIfAborted(signal);
    if (timedOut || error?.name === 'AbortError') {
      throw createSubtitleRemovalError('provider_timeout', '去字幕服务请求超时', {
        providerStage: stage,
        providerStatus: 'timeout',
        ...(providerTaskId ? { providerTaskId } : {}),
      });
    }
    if (stage === 'provider_submit') {
      throw createSubtitleRemovalError(
        'provider_submission_unknown',
        '暂时无法确认服务是否接单，已停止自动重提，避免重复扣费',
        {
          providerStage: stage,
          providerStatus: 'submission_unknown',
          submissionUnknown: true,
        },
      );
    }
    throw createSubtitleRemovalError('provider_network_error', '去字幕服务网络请求失败', {
      providerStage: stage,
      providerStatus: 'network_error',
      ...(providerTaskId ? { providerTaskId } : {}),
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};

const getResultRegion = (job, validated) => {
  if (validated) {
    return {
      subtitleRegionNormalized: validated.region,
      subtitleRegionPixels: validated.subtitleRegionPixels,
    };
  }
  const region = clampSubtitleRegion(job?.payload?.subtitleRegionNormalized);
  const width = Math.round(Number(job?.payload?.width || 0));
  const height = Math.round(Number(job?.payload?.height || 0));
  return {
    subtitleRegionNormalized: region,
    ...(width > 0 && height > 0
      ? { subtitleRegionPixels: subtitleRegionToPixels(region, width, height) }
      : {}),
  };
};

export async function runSubtitleRemovalJob({
  job,
  env = process.env,
  signal,
  onProviderTaskId = async () => {},
  deps = {},
} = {}) {
  throwIfAborted(signal);
  const config = getSubtitleRemovalConfig(env);
  const token = String(env?.GOLDEN_SUBTITLE_API_TOKEN || '').trim();
  if (!config.enabled || !config.configured || !token) {
    throw createSubtitleRemovalError(
      'subtitle_removal_unavailable',
      '去字幕功能暂未开放，请联系管理员',
      { providerStage: 'configuration', providerStatus: 'unavailable' },
    );
  }
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw createSubtitleRemovalError('provider_internal_error', '去字幕网络服务不可用');
  }
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  const sourceUrl = String(job?.payload?.sourceUrl || '').trim();
  let providerTaskId = String(job?.providerTaskId || '').trim();
  let validated;

  if (!providerTaskId) {
    if (
      typeof deps.resolveManagedAssetReadUrl !== 'function'
      || typeof deps.probeVideo !== 'function'
      || typeof deps.resolveProviderSourceUrl !== 'function'
    ) {
      throw createSubtitleRemovalError('provider_internal_error', '去字幕视频准备服务不可用', {
        providerStage: 'preparing_input',
        providerStatus: 'dependency_missing',
      });
    }
    const resolvedReadUrl = await deps.resolveManagedAssetReadUrl(sourceUrl, {
      purpose: 'provider',
      signal,
    });
    const readableUrl = String(resolvedReadUrl || sourceUrl).trim();
    throwIfAborted(signal);
    const metadata = await deps.probeVideo(readableUrl, signal);
    validated = assertSubtitleRemovalInput({
      sourceUrl: readableUrl,
      sizeBytes: metadata?.sizeBytes,
      durationSeconds: metadata?.durationSeconds,
      width: metadata?.width,
      height: metadata?.height,
      region: job?.payload?.subtitleRegionNormalized,
    });
    const providerSourceUrl = String(
      await deps.resolveProviderSourceUrl(sourceUrl, { signal }) || '',
    ).trim();
    if (!providerSourceUrl) {
      throw createSubtitleRemovalError('provider_internal_error', '去字幕视频暂存失败', {
        providerStage: 'preparing_input',
        providerStatus: 'staged_url_missing',
      });
    }
    throwIfAborted(signal);
    const submitResponse = await postJson({
      url: config.baseUrl,
      token,
      body: buildSubtitleRemovalSubmitBody({
        safeTaskId: job?.id,
        sourceUrl: providerSourceUrl,
        sizeBytes: validated.sizeBytes,
        durationSeconds: validated.durationSeconds,
        width: validated.width,
        height: validated.height,
        region: validated.region,
      }),
      signal,
      fetchImpl,
      stage: 'provider_submit',
    });
    const submitted = normalizeSubtitleRemovalSubmitResponse(submitResponse);
    providerTaskId = submitted.providerTaskId;
    try {
      await onProviderTaskId(providerTaskId);
    } catch (error) {
      throw createSubtitleRemovalError(
        'provider_internal_error',
        `Golden 去字幕任务已创建，但任务编号持久化失败：${error?.message || '未知错误'}`,
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
  const resultRegion = getResultRegion(job, validated);
  while (true) {
    throwIfAborted(signal);
    if (now() - startedAt > config.timeoutMs) {
      throw createSubtitleRemovalError('provider_timeout', '去字幕处理超时，可稍后根据原任务编号查询', {
        providerTaskId,
        providerStage: 'provider_wait',
        providerStatus: 'timeout',
      });
    }
    const progressBody = await postJson({
      url: config.baseUrl,
      token,
      body: { biz: 'aiRemoveSubtitleProgress', taskId: providerTaskId },
      signal,
      fetchImpl,
      stage: 'provider_wait',
      providerTaskId,
    });
    const progress = normalizeSubtitleRemovalProgressResponse(progressBody, providerTaskId);
    if (progress.state === 'success') {
      return {
        providerTaskId,
        providerStage: 'provider_wait',
        providerStatus: 'success',
        result: {
          videoUrl: progress.resultUrl,
          sourceUrl,
          ...resultRegion,
          sourceProjectId: String(job?.payload?.sourceProjectId || '').trim() || undefined,
          sourceResultId: String(job?.payload?.sourceResultId || '').trim() || undefined,
          providerTaskId,
          ...(progress.costRemove !== undefined ? { costRemove: progress.costRemove } : {}),
        },
      };
    }
    if (progress.state === 'failed') {
      throw createSubtitleRemovalError(
        'provider_job_failed',
        progress.providerMessage || '去字幕处理失败',
        {
          providerTaskId,
          providerStage: 'provider_wait',
          providerStatus: 'failed',
        },
      );
    }
    await sleep(config.pollIntervalMs, signal);
  }
}
