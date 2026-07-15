import { readFile } from 'node:fs/promises';
import { isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createMediaTranscodeService } from '../server/mediaTranscodeService.mjs';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 40 * 60_000;

const clean = (value) => String(value || '').trim();

export function parseProbeArgs(argv = []) {
  const parsed = { live: false, fixture: '', baseUrl: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    if (arg === '--live') parsed.live = true;
    else if (arg === '--fixture') parsed.fixture = clean(argv[++index]);
    else if (arg.startsWith('--fixture=')) parsed.fixture = clean(arg.slice('--fixture='.length));
    else if (arg === '--base-url') parsed.baseUrl = clean(argv[++index]);
    else if (arg.startsWith('--base-url=')) parsed.baseUrl = clean(arg.slice('--base-url='.length));
    else throw new Error(`不支持的参数：${arg}`);
  }
  return parsed;
}

const normalizeBaseUrl = (value) => {
  const parsed = new URL(clean(value) || DEFAULT_BASE_URL);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('梅奥 base URL 必须是不含账号、query 和 hash 的 HTTP(S) 地址。');
  }
  return parsed.href.replace(/\/+$/u, '');
};

const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export function resolveProbeOptions({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseProbeArgs(argv);
  const options = {
    ...args,
    baseUrl: normalizeBaseUrl(args.baseUrl || env.MEIAO_SUBTITLE_REMOVAL_PROBE_BASE_URL || DEFAULT_BASE_URL),
    sessionToken: clean(env.MEIAO_SUBTITLE_REMOVAL_PROBE_SESSION_TOKEN),
    pollIntervalMs: boundedInteger(env.MEIAO_SUBTITLE_REMOVAL_PROBE_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 500, 30_000),
    timeoutMs: boundedInteger(env.MEIAO_SUBTITLE_REMOVAL_PROBE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 60_000, 7_200_000),
    inspectionMs: boundedInteger(env.MEIAO_SUBTITLE_REMOVAL_PROBE_INSPECTION_MS, 0, 0, 600_000),
    redactionValues: [
      clean(env.MEIAO_SUBTITLE_REMOVAL_PROBE_SESSION_TOKEN),
      clean(env.GOLDEN_SUBTITLE_API_TOKEN),
    ].filter(Boolean),
  };
  if (!options.live) return options;
  if (clean(env.MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM) !== '1') {
    throw new Error('live 模式必须显式设置 MEIAO_SUBTITLE_REMOVAL_CANARY_CONFIRM=1。');
  }
  if (!options.sessionToken) throw new Error('live 模式需要梅奥登录会话令牌。');
  if (!options.fixture || !isAbsolute(options.fixture)) throw new Error('live 模式的 --fixture 必须是 2–3 秒 MP4 绝对路径。');
  return options;
}

const stripUrlQuery = (value) => String(value || '').replace(/(https?:\/\/[^\s"']+)[?#][^\s"']*/giu, '$1?[redacted]');

export function redactProbeText(value, secrets = []) {
  let output = stripUrlQuery(value).replace(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]');
  for (const secret of secrets.filter(Boolean)) output = output.split(secret).join('[redacted]');
  return output;
}

const authHeaders = (sessionToken, extra = {}) => ({
  ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
  ...extra,
});

const requestJson = async (fetchImpl, url, init = {}) => {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`梅奥 API 返回 HTTP ${response.status}：${clean(body?.message) || '请求失败'}`);
    error.statusCode = response.status;
    error.code = body?.code;
    throw error;
  }
  return body;
};

const checkReadiness = async (options, fetchImpl) => {
  const health = await requestJson(fetchImpl, `${options.baseUrl}/api/health`);
  const readiness = health?.subtitleRemoval || {};
  let publicConfig = null;
  if (options.sessionToken) {
    const configResponse = await requestJson(fetchImpl, `${options.baseUrl}/api/system/config`, {
      headers: authHeaders(options.sessionToken),
    });
    publicConfig = configResponse?.config || null;
  }
  const configured = Boolean(readiness.configured);
  const enabled = Boolean(readiness.enabled);
  if (!health?.ok) throw new Error('梅奥 health 未就绪。');
  if (publicConfig) {
    if (Boolean(publicConfig?.providers?.goldenSubtitle?.configured) !== configured
      || Boolean(publicConfig?.featureRollouts?.subtitleRemoval) !== enabled) {
      throw new Error('健康状态与公开配置的去字幕就绪信号不一致。');
    }
  }
  return { enabled, configured, publicConfigChecked: Boolean(publicConfig) };
};

const defaultProbeFixture = async (fixture) => {
  const service = createMediaTranscodeService({
    env: { ...process.env, MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
  });
  return service.probe(fixture, 'video');
};

const isManagedAssetUrl = (value, baseUrl) => {
  try {
    const parsed = new URL(value, baseUrl);
    return parsed.pathname.startsWith('/api/assets/file/');
  } catch {
    return false;
  }
};

const ensureRangeReadable = async ({ fetchImpl, url, sessionToken }) => {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: authHeaders(sessionToken, { Range: 'bytes=0-0' }),
  });
  if (response.status !== 206 || !clean(response.headers?.get?.('content-range')).startsWith('bytes 0-0/')) {
    throw new Error('托管视频未通过 Range 播放检查。');
  }
};

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled']);

export async function runSubtitleRemovalProbe(options, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const readFileImpl = deps.readFileImpl || readFile;
  const probeFixtureImpl = deps.probeFixtureImpl || defaultProbeFixture;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now || Date.now;
  const log = deps.log || console.log;
  if (typeof fetchImpl !== 'function') throw new Error('fetch 不可用。');

  const readiness = await checkReadiness(options, fetchImpl);
  if (!options.live) {
    const result = { ok: true, mode: 'readiness', ...readiness, paidSubmissions: 0 };
    log(JSON.stringify(result));
    return result;
  }
  if (!readiness.enabled || !readiness.configured) throw new Error('live 探针前必须同时启用并配置去字幕服务。');

  const fixture = await probeFixtureImpl(options.fixture);
  const durationSeconds = Number(fixture?.durationSeconds || 0);
  if (durationSeconds < 2 || durationSeconds > 3) throw new Error('live 探针素材时长必须介于 2–3 秒。');
  if (!Number(fixture?.width) || !Number(fixture?.height)) throw new Error('live 探针素材缺少有效视频尺寸。');

  const fileBuffer = await readFileImpl(options.fixture);
  const formData = new FormData();
  formData.append('module', 'video');
  formData.append('assetType', 'source');
  formData.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), basename(options.fixture));

  let sourceUrl = '';
  let jobId = '';
  let completed = false;
  const startedAt = now();
  try {
    const upload = await requestJson(fetchImpl, `${options.baseUrl}/api/assets/upload-stream`, {
      method: 'POST',
      headers: authHeaders(options.sessionToken),
      body: formData,
    });
    sourceUrl = clean(upload?.fileUrl);
    if (!isManagedAssetUrl(sourceUrl, options.baseUrl)) throw new Error('探针源视频未进入梅奥托管素材。');
    await ensureRangeReadable({ fetchImpl, url: sourceUrl, sessionToken: options.sessionToken });

    const nonce = `${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
    const shellProjectId = `subtitle-canary-${nonce}`;
    const created = await requestJson(fetchImpl, `${options.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: authHeaders(options.sessionToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        module: 'video',
        taskType: 'subtitle_remove_video',
        provider: 'golden_subtitle',
        maxRetries: 0,
        payload: {
          taskPurpose: 'subtitle_removal',
          subFeature: 'subtitle_removal',
          sourceUrl,
          subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
          shellProjectId,
          shellProjectName: '去字幕付费探针',
          clientSubmissionKey: `subtitle_canary|${nonce}`,
        },
      }),
    });
    jobId = clean(created?.job?.id);
    if (!jobId) throw new Error('梅奥未返回 canary job ID。');

    let job = created.job;
    while (!terminalStatuses.has(clean(job?.status))) {
      if (now() - startedAt > options.timeoutMs) throw new Error('canary 轮询超时，已保留持久任务供排查。');
      await sleep(options.pollIntervalMs);
      const response = await requestJson(fetchImpl, `${options.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
        headers: authHeaders(options.sessionToken),
      });
      job = response?.job || {};
    }
    if (job.status !== 'succeeded') throw new Error(`canary 未成功，终态为 ${clean(job.status) || 'unknown'}。`);
    const providerTaskIdPresent = Boolean(clean(job.providerTaskId || job?.result?.providerTaskId));
    if (!providerTaskIdPresent) throw new Error('canary 成功但缺少 checkpoint 的 provider task ID。');
    const resultUrl = clean(job?.result?.videoUrl);
    if (!isManagedAssetUrl(resultUrl, options.baseUrl)) throw new Error('canary 结果不是梅奥托管视频。');
    await ensureRangeReadable({ fetchImpl, url: resultUrl, sessionToken: options.sessionToken });
    completed = true;

    const result = {
      ok: true,
      mode: 'live',
      jobId,
      providerTaskIdPresent,
      managedSourceUrlPresent: true,
      managedResultUrlPresent: true,
      rangeReadable: true,
      durationSeconds,
      paidSubmissions: 1,
      inspectionMs: options.inspectionMs,
      elapsedMs: Math.max(0, now() - startedAt),
    };
    log(JSON.stringify(result));
    if (options.inspectionMs > 0) await sleep(options.inspectionMs);
    return result;
  } finally {
    if (completed && jobId) {
      await requestJson(fetchImpl, `${options.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        headers: authHeaders(options.sessionToken),
      });
    }
    if ((!jobId || completed) && sourceUrl) {
      await requestJson(fetchImpl, `${options.baseUrl}/api/assets/by-url`, {
        method: 'DELETE',
        headers: authHeaders(options.sessionToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ fileUrl: sourceUrl }),
      }).catch(() => {});
    }
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    const options = resolveProbeOptions();
    await runSubtitleRemovalProbe(options);
  } catch (error) {
    const secrets = [
      clean(process.env.MEIAO_SUBTITLE_REMOVAL_PROBE_SESSION_TOKEN),
      clean(process.env.GOLDEN_SUBTITLE_API_TOKEN),
    ];
    console.error(redactProbeText(error instanceof Error ? error.message : String(error), secrets));
    process.exitCode = 1;
  }
}
