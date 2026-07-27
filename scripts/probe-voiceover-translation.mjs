import { randomUUID } from 'node:crypto';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  getVoiceoverConfig,
} from '../server/voiceoverContract.mjs';
import {
  createMediaTranscodeService,
  inspectMp4Container,
} from '../server/mediaTranscodeService.mjs';
import { loadServerEnvFile } from '../server/envLoader.mjs';
import {
  alignVoiceoverGroups,
  buildVocalOnlyAnalysisVideo,
  extractVoiceoverAudio,
  mixVoiceoverResult,
} from '../server/voiceoverAudio.mjs';
import {
  checkVoiceoverSeparationReadiness,
  separateVoiceover,
} from '../server/voiceoverSeparation.mjs';
import {
  getVoiceoverSourceMaxBytes,
  streamVoiceoverAssetToFile,
} from '../server/voiceoverTranslationRunner.mjs';
import { getVoiceoverLanguage } from '../src/utils/voiceoverCatalog.mjs';

const MANAGED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 40 * 60_000;

class VoiceoverProbeUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VoiceoverProbeUsageError';
  }
}

const clean = (value) => String(value || '').trim();
const usageError = (message) => new VoiceoverProbeUsageError(message);

const takeValue = (argv, index, option) => {
  const value = argv[index + 1];
  if (value === undefined || String(value).startsWith('--') || !clean(value)) {
    throw usageError(`${option} 缺少参数值。`);
  }
  return clean(value);
};

export function parseVoiceoverProbeArgs(argv = []) {
  const parsed = {
    mode: 'readiness',
    fixturePath: '',
    sourceAssetId: '',
    targetLanguage: '',
    resumeParentJobId: '',
    resumeChildTaskId: '',
    removeText: false,
  };
  const seen = new Set();
  let explicitReadiness = false;
  let live = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg.startsWith('--')) throw usageError(`不支持的参数：${arg}`);
    const [option, inlineValue] = arg.split('=', 2);
    if (seen.has(option)) throw usageError(`参数重复：${option}`);
    seen.add(option);
    const valueFor = () => {
      if (inlineValue !== undefined) {
        if (!clean(inlineValue)) throw usageError(`${option} 缺少参数值。`);
        return clean(inlineValue);
      }
      const value = takeValue(argv, index, option);
      index += 1;
      return value;
    };
    if (option === '--readiness') {
      if (inlineValue !== undefined) throw usageError('--readiness 不接受参数值。');
      explicitReadiness = true;
    } else if (option === '--fixture-path') {
      parsed.fixturePath = valueFor();
    } else if (option === '--live') {
      if (inlineValue !== undefined) throw usageError('--live 不接受参数值。');
      live = true;
    } else if (option === '--source-asset-id') {
      parsed.sourceAssetId = valueFor();
    } else if (option === '--target-language') {
      parsed.targetLanguage = valueFor();
    } else if (option === '--remove-text') {
      if (inlineValue !== undefined) throw usageError('--remove-text 不接受参数值。');
      parsed.removeText = true;
    } else if (option === '--resume-parent-job-id') {
      parsed.resumeParentJobId = valueFor();
    } else if (option === '--resume-child-task-id') {
      parsed.resumeChildTaskId = valueFor();
    } else {
      throw usageError(`不支持的参数：${option}`);
    }
  }

  const selectedModes = [
    explicitReadiness,
    Boolean(parsed.fixturePath),
    live,
    Boolean(parsed.resumeParentJobId),
    Boolean(parsed.resumeChildTaskId),
  ].filter(Boolean).length;
  if (selectedModes > 1) throw usageError('只能选择一种探针模式。');
  if (live) parsed.mode = 'live';
  else if (parsed.fixturePath) parsed.mode = 'fixture';
  else if (parsed.resumeParentJobId) parsed.mode = 'resume-parent';
  else if (parsed.resumeChildTaskId) parsed.mode = 'resume-child';
  if (parsed.mode !== 'live' && (parsed.sourceAssetId || parsed.targetLanguage || parsed.removeText)) {
    throw usageError('--source-asset-id、--target-language 和 --remove-text 只能用于 --live。');
  }
  return Object.freeze(parsed);
}

const URL_WITH_SUFFIX = /\bhttps?:\/\/[^\s"'<>]+/giu;
const LOCAL_PATH = /(?:\/(?:Users|home|tmp|private|opt|www|usr\/local|var\/folders)\/[^\s"',)}\]]+|[A-Za-z]:\\[^\s"',)}\]]+)/gu;
const SENSITIVE_LINE = /^.*(?:transcript|provider\s+(?:body|response)).*$/gimu;
const PROVIDER_ID = /((?:providerTaskId|provider_task_id|taskId|task_id)\s*[:=]\s*["']?)[A-Za-z0-9._-]+/giu;

export function redactVoiceoverProbeText(value, secrets = []) {
  let output = String(value || '');
  output = output.replace(URL_WITH_SUFFIX, (raw) => {
    try {
      const url = new URL(raw);
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return '[redacted-url]';
    }
  });
  output = output
    .replace(/Bearer\s+[^\s"',)}\]]+/giu, 'Bearer [redacted]')
    .replace(SENSITIVE_LINE, '[redacted-sensitive-output]')
    .replace(PROVIDER_ID, '$1[redacted]')
    .replace(LOCAL_PATH, '[redacted-local-path]');
  for (const secret of secrets.map(clean).filter(Boolean)) {
    output = output.split(secret).join('[redacted]');
  }
  return output;
}

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};

const normalizeBaseUrl = (value) => {
  const raw = clean(value);
  if (!raw) throw usageError('远程模式必须配置 MEIAO_VOICEOVER_PROBE_BASE_URL。');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw usageError('MEIAO_VOICEOVER_PROBE_BASE_URL 必须是有效的 HTTP(S) 地址。');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw usageError('MEIAO_VOICEOVER_PROBE_BASE_URL 不得包含账号、query 或 hash。');
  }
  return parsed.href.replace(/\/+$/u, '');
};

const resolveRemoteOptions = (env) => {
  const sessionToken = clean(env.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN);
  if (!sessionToken) throw usageError('远程模式需要 MEIAO_VOICEOVER_PROBE_SESSION_TOKEN 登录会话。');
  return Object.freeze({
    baseUrl: normalizeBaseUrl(env.MEIAO_VOICEOVER_PROBE_BASE_URL),
    sessionToken,
    pollIntervalMs: boundedInteger(
      env.MEIAO_VOICEOVER_PROBE_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
      500,
      30_000,
    ),
    timeoutMs: boundedInteger(
      env.MEIAO_VOICEOVER_PROBE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      60_000,
      7_200_000,
    ),
  });
};

const authHeaders = (sessionToken, extra = {}) => ({
  Authorization: `Bearer ${sessionToken}`,
  ...extra,
});

const requestJson = async (fetchImpl, url, init = {}) => {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`梅奥 API 请求失败（HTTP ${response.status}）。`);
    error.statusCode = response.status;
    throw error;
  }
  return body;
};

const defaultFetchHealth = async (remote, deps) => requestJson(
  deps.fetchImpl || globalThis.fetch,
  `${remote.baseUrl}/api/health`,
  { headers: authHeaders(remote.sessionToken) },
);

const defaultQueryParentJob = async (jobId, remote, deps) => {
  const body = await requestJson(
    deps.fetchImpl || globalThis.fetch,
    `${remote.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`,
    { headers: authHeaders(remote.sessionToken) },
  );
  return {
    found: Boolean(body?.job),
    status: clean(body?.job?.status) || 'unknown',
  };
};

const defaultQueryChildTask = async (taskId, remote, deps) => {
  const body = await requestJson(
    deps.fetchImpl || globalThis.fetch,
    `${remote.baseUrl}/api/jobs?limit=100`,
    { headers: authHeaders(remote.sessionToken) },
  );
  let matchingAttempt = null;
  for (const job of Array.isArray(body?.jobs) ? body.jobs : []) {
    if (job?.taskType !== 'voiceover_translate_video' || job?.provider !== 'internal') continue;
    const result = job?.result && typeof job.result === 'object' ? job.result : {};
    const checkpoint = (
      result.voiceoverCheckpoint
      || result.voiceover_checkpoint
      || result.checkpoint
    );
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) continue;
    const attempts = [
      ...(checkpoint.subtitleRemoval && typeof checkpoint.subtitleRemoval === 'object'
        ? [checkpoint.subtitleRemoval]
        : []),
      ...(Array.isArray(checkpoint.ttsGroups) ? checkpoint.ttsGroups : []),
    ];
    matchingAttempt = attempts.find((attempt) => (
      clean(attempt?.childJobId) === taskId
      || clean(attempt?.providerTaskId) === taskId
    )) || null;
    if (matchingAttempt) break;
  }
  return {
    found: Boolean(matchingAttempt),
    status: clean(matchingAttempt?.status) || 'unknown',
  };
};

const defaultCreateProviderTask = async (request, remote, deps) => requestJson(
  deps.fetchImpl || globalThis.fetch,
  `${remote.baseUrl}/api/jobs`,
  {
    method: 'POST',
    headers: authHeaders(remote.sessionToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(request),
  },
);

const defaultQueryLiveJob = async (jobId, remote, deps) => {
  const body = await requestJson(
    deps.fetchImpl || globalThis.fetch,
    `${remote.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`,
    { headers: authHeaders(remote.sessionToken) },
  );
  return body?.job || null;
};

const resolveFinalManagedIdentity = (job, baseUrl) => {
  const result = job?.result && typeof job.result === 'object' ? job.result : {};
  const checkpoint = (
    result.voiceoverCheckpoint
    || result.voiceover_checkpoint
    || result.checkpoint
  );
  const finalAssetId = clean(
    result.finalAssetId
    || result.final_asset_id
    || checkpoint?.finalAssetId,
  );
  const videoUrl = clean(result.videoUrl || result.video_url);
  const stage = clean(
    result.voiceoverStage
    || result.voiceover_stage
    || checkpoint?.stage,
  );
  if (!MANAGED_ID_PATTERN.test(finalAssetId) || !videoUrl || stage !== 'result_persisted') {
    throw new Error('口播翻译终态缺少有效的托管最终素材。');
  }
  let parsed;
  try {
    parsed = new URL(videoUrl, baseUrl);
  } catch {
    throw new Error('口播翻译最终素材 URL 无效。');
  }
  const routeMatch = parsed.pathname.match(/^\/api\/assets\/file\/([^/]+)(?:\/.*)?$/u);
  const routeAssetId = routeMatch ? decodeURIComponent(routeMatch[1]) : '';
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.origin !== new URL(baseUrl).origin
    || routeAssetId !== finalAssetId
  ) {
    throw new Error('口播翻译最终素材不是当前梅奥托管 URL。');
  }
  return Object.freeze({
    assetId: finalAssetId,
    canonicalUrl: `${baseUrl}/api/assets/file/${encodeURIComponent(finalAssetId)}`,
  });
};

const defaultVerifyFinalResult = async (identity, remote, deps) => {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const rangeResponse = await fetchImpl(identity.canonicalUrl, {
    method: 'GET',
    headers: authHeaders(remote.sessionToken, { Range: 'bytes=0-0' }),
  });
  const rangeReadable = rangeResponse.status === 206
    && clean(rangeResponse.headers?.get?.('content-range')).startsWith('bytes 0-0/');
  await Promise.resolve(rangeResponse.body?.cancel?.()).catch(() => null);
  const workspace = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-live-verify-'));
  const outputPath = path.join(workspace, 'final.mp4');
  try {
    await streamVoiceoverAssetToFile({
      remoteUrl: identity.canonicalUrl,
      destinationPath: outputPath,
      maxBytes: getVoiceoverSourceMaxBytes(deps.env || process.env),
      timeoutMs: Math.min(remote.timeoutMs, 300_000),
      deps: {
        fetchImpl: (url, init = {}) => fetchImpl(url, {
          ...init,
          headers: authHeaders(remote.sessionToken, init.headers || {}),
        }),
      },
    });
    const service = createMediaTranscodeService({
      env: { ...(deps.env || process.env), MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
    });
    const metadata = await service.probe(outputPath, 'video');
    const container = await inspectMp4Container(outputPath);
    return {
      managedAsset: true,
      h264: metadata.videoCodec === 'h264',
      aac: metadata.audioCodec === 'aac',
      rangeReadable,
      ftypPresent: Boolean(container.containerBrand),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};

const assertLocalRangeReadable = async (filePath) => {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size < 2) return false;
  const handle = await open(filePath, 'r');
  try {
    const first = Buffer.alloc(1);
    const last = Buffer.alloc(1);
    const [firstRead, lastRead] = await Promise.all([
      handle.read(first, 0, 1, 0),
      handle.read(last, 0, 1, metadata.size - 1),
    ]);
    return firstRead.bytesRead === 1 && lastRead.bytesRead === 1;
  } finally {
    await handle.close();
  }
};

async function defaultRunFixtureProbe(fixturePath, { env, deps }) {
  const config = getVoiceoverConfig(env);
  const readiness = await checkVoiceoverSeparationReadiness({ env });
  if (!readiness.ready) throw new Error('本地 Demucs/FFmpeg readiness 未通过。');
  const mediaService = createMediaTranscodeService({
    env: { ...env, MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
  });
  const workspace = await mkdtemp(path.join(tmpdir(), 'meiao-voiceover-fixture-'));
  try {
    const source = await mediaService.probe(fixturePath, 'video');
    const inputH264Aac = source.videoCodec === 'h264'
      && source.audioCodec === 'aac'
      && source.hasVideo === true
      && source.hasAudio === true;
    if (!inputH264Aac) throw new Error('fixture 必须是包含 H.264/AAC 的 MP4。');
    const durationMs = Math.round(Number(source.durationSeconds) * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new Error('fixture 时长无效。');
    }
    const originalAudioPath = path.join(workspace, 'original.wav');
    const analysisVideoPath = path.join(workspace, 'analysis.mp4');
    const alignedAudioPath = path.join(workspace, 'aligned.wav');
    const finalVideoPath = path.join(workspace, 'final.mp4');
    await extractVoiceoverAudio({
      inputVideoPath: fixturePath,
      outputWavPath: originalAudioPath,
    });
    const separated = await separateVoiceover({
      inputWavPath: originalAudioPath,
      workDir: workspace,
      env,
      config,
    });
    await buildVocalOnlyAnalysisVideo({
      sourceVideoPath: fixturePath,
      vocalPath: separated.vocalsPath,
      outputPath: analysisVideoPath,
      config,
    });
    await alignVoiceoverGroups({
      groups: [{
        index: 0,
        startMs: 0,
        endMs: durationMs,
        audioPath: separated.vocalsPath,
      }],
      outputPath: alignedAudioPath,
      totalDurationMs: durationMs,
      config,
    });
    const final = await mixVoiceoverResult({
      baseVideoPath: fixturePath,
      backgroundPath: separated.backgroundPath,
      narrationPath: alignedAudioPath,
      outputPath: finalVideoPath,
      config,
    });
    const container = await inspectMp4Container(finalVideoPath);
    const rangeReadable = await assertLocalRangeReadable(finalVideoPath);
    return Object.freeze({
      inputH264Aac,
      separationReady: true,
      vocalOnlyAnalysisMedia: true,
      alignmentReady: true,
      duckingReady: true,
      outputH264Aac: final.videoCodec === 'h264' && final.audioCodec === 'aac',
      durationWithinTolerance: Math.abs(final.durationMs - durationMs) <= config.durationToleranceMs,
      ftypPresent: Boolean(container.containerBrand),
      rangeReadable,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const readinessSummary = async (env, deps) => {
  const config = getVoiceoverConfig(env);
  const check = deps.checkReadiness || checkVoiceoverSeparationReadiness;
  const readiness = await check({ env, config });
  const pythonReady = readiness?.pythonReady === true;
  const modelReady = readiness?.modelReady === true;
  const ffmpegReady = readiness?.ffmpegReady === true;
  const kieConfigured = Boolean(clean(env.KIE_API_KEY || env.MEIAO_KIE_API_KEY));
  return {
    enabled: config.enabled,
    ready: config.enabled && pythonReady && modelReady && ffmpegReady && kieConfigured,
    pythonReady,
    modelReady,
    ffmpegReady,
    separationConcurrency: config.separationConcurrency,
    kieConfigured,
    goldenConfigured: Boolean(clean(env.GOLDEN_SUBTITLE_API_TOKEN)),
  };
};

const safeStatus = (value) => {
  const status = clean(value);
  return ['queued', 'running', 'retry_waiting', 'succeeded', 'failed', 'cancelled', 'submitted']
    .includes(status)
    ? status
    : 'unknown';
};

const buildLiveRequest = (args, deps) => {
  const nonce = clean(deps.randomId?.()) || randomUUID().replaceAll('-', '');
  const shellProjectId = `voiceover-canary-${nonce}`;
  return {
    module: 'video',
    subFeature: 'voiceover_translation',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    maxRetries: 0,
    payload: {
      taskType: 'voiceover_translate_video',
      taskPurpose: 'voiceover_translation',
      subFeature: 'voiceover_translation',
      sourceAssetId: args.sourceAssetId,
      shellProjectId,
      shellProjectName: '口播翻译最小付费探针',
      shellResultId: `${shellProjectId}-result`,
      clientSubmissionKey: `voiceover_canary|${nonce}`,
      targetLanguage: args.targetLanguage,
      translationMode: 'natural',
      voiceMode: 'auto',
      removeText: args.removeText,
      ...(args.removeText
        ? { subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 } }
        : {}),
    },
  };
};

const liveSummary = (job, args, verification) => {
  return {
    mode: 'live',
    parentJobCreated: true,
    parentJobCompleted: job?.status === 'succeeded',
    finalManagedAssetPresent: verification.managedAsset === true,
    finalH264: verification.h264 === true,
    finalAac: verification.aac === true,
    rangeReadable: verification.rangeReadable === true,
    ftypPresent: verification.ftypPresent === true,
    removeText: args.removeText,
    goldenPaidStageRequested: args.removeText,
  };
};

const secretValues = (env) => [
  env.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN,
  env.KIE_API_KEY,
  env.MEIAO_KIE_API_KEY,
  env.GOLDEN_SUBTITLE_API_TOKEN,
].map(clean).filter(Boolean);

export async function runVoiceoverProbe(argv = [], deps = {}) {
  const env = deps.env || process.env;
  let args;
  try {
    args = parseVoiceoverProbeArgs(argv);
    if (args.mode === 'readiness') {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(await readinessSummary(env, deps))}\n`,
        stderr: '',
      };
    }
    if (args.mode === 'fixture') {
      if (!path.isAbsolute(args.fixturePath)) {
        throw usageError('--fixture-path 必须是用户明确提供的绝对路径。');
      }
      const runFixture = deps.runFixtureProbe || defaultRunFixtureProbe;
      const result = await runFixture(args.fixturePath, { env, deps });
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          mode: 'fixture',
          inputH264Aac: result?.inputH264Aac === true,
          separationReady: result?.separationReady === true,
          vocalOnlyAnalysisMedia: result?.vocalOnlyAnalysisMedia === true,
          alignmentReady: result?.alignmentReady === true,
          duckingReady: result?.duckingReady === true,
          outputH264Aac: result?.outputH264Aac === true,
          durationWithinTolerance: result?.durationWithinTolerance === true,
          ftypPresent: result?.ftypPresent === true,
          rangeReadable: result?.rangeReadable === true,
          providerCreateCalls: 0,
        })}\n`,
        stderr: '',
      };
    }

    if (args.mode === 'resume-parent') {
      const remote = resolveRemoteOptions(env);
      const query = deps.queryParentJob || ((id) => defaultQueryParentJob(id, remote, deps));
      const result = await query(args.resumeParentJobId, remote);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          mode: 'resume-parent',
          found: result?.found === true,
          status: safeStatus(result?.status),
          providerCreateCalls: 0,
        })}\n`,
        stderr: '',
      };
    }
    if (args.mode === 'resume-child') {
      const remote = resolveRemoteOptions(env);
      const query = deps.queryChildTask || ((id) => defaultQueryChildTask(id, remote, deps));
      const result = await query(args.resumeChildTaskId, remote);
      if (result?.found !== true) {
        throw new Error('未在耐久父任务检查点中找到该子任务；不会创建恢复任务。');
      }
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          mode: 'resume-child',
          found: result?.found === true,
          status: safeStatus(result?.status),
          providerCreateCalls: 0,
        })}\n`,
        stderr: '',
      };
    }

    if (!MANAGED_ID_PATTERN.test(args.sourceAssetId)) {
      throw usageError('--live 必须提供一个明确、合法的 --source-asset-id。');
    }
    if (!getVoiceoverLanguage(args.targetLanguage)) {
      throw usageError('--live 必须提供受支持的 --target-language。');
    }
    if (clean(env.MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED) !== '1') {
      const golden = args.removeText ? '；--remove-text 会额外产生 Golden 去文案费用' : '';
      throw usageError(`live 模式会调用 Gemini/KIE 并可能计费${golden}；确认后设置 MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED=1。`);
    }
    const remote = resolveRemoteOptions(env);
    const fetchHealth = deps.fetchHealth || ((options) => defaultFetchHealth(options, deps));
    const health = await fetchHealth(remote);
    const voiceover = health?.voiceoverTranslation || {};
    if (
      health?.ok !== true
      || voiceover.enabled !== true
      || voiceover.ready !== true
      || voiceover.pythonReady !== true
      || voiceover.modelReady !== true
      || voiceover.ffmpegReady !== true
    ) {
      throw new Error('远程口播翻译 readiness 未通过。');
    }
    if (
      args.removeText
      && (
        health?.subtitleRemoval?.enabled !== true
        || health?.subtitleRemoval?.configured !== true
      )
    ) {
      throw new Error('Golden 去文案 readiness 未通过。');
    }
    const create = deps.createProviderTask
      || ((request) => defaultCreateProviderTask(request, remote, deps));
    const created = await create(buildLiveRequest(args, deps), remote);
    let job = created?.job || null;
    const jobId = clean(job?.id);
    if (!jobId) throw new Error('梅奥未返回口播翻译父任务。');
    const query = deps.queryLiveJob || ((id) => defaultQueryLiveJob(id, remote, deps));
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = deps.now || Date.now;
    const startedAt = now();
    while (!TERMINAL_JOB_STATUSES.has(clean(job?.status))) {
      if (now() - startedAt > remote.timeoutMs) {
        throw new Error('口播翻译 canary 轮询超时；不会自动重新提交。');
      }
      await sleep(remote.pollIntervalMs);
      job = await query(jobId, remote);
      if (!job) throw new Error('口播翻译父任务查询失败。');
    }
    if (job.status !== 'succeeded') {
      throw new Error(`口播翻译 canary 未成功，终态为 ${safeStatus(job.status)}。`);
    }
    const finalIdentity = resolveFinalManagedIdentity(job, remote.baseUrl);
    const verifyFinal = deps.verifyFinalResult
      || ((identity) => defaultVerifyFinalResult(identity, remote, { ...deps, env }));
    const verification = await verifyFinal(finalIdentity, remote);
    if (
      verification?.managedAsset !== true
      || verification?.h264 !== true
      || verification?.aac !== true
      || verification?.rangeReadable !== true
      || verification?.ftypPresent !== true
    ) {
      throw new Error('口播翻译最终托管视频未通过 H.264/AAC/Range/ftyp 验证。');
    }
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(liveSummary(job, args, verification))}\n`,
      stderr: '',
    };
  } catch (error) {
    const exitCode = error instanceof VoiceoverProbeUsageError ? 2 : 1;
    const message = redactVoiceoverProbeText(
      error instanceof Error ? error.message : String(error),
      secretValues(env),
    );
    return {
      exitCode,
      stdout: '',
      stderr: `${message || '口播翻译探针执行失败。'}\n`,
    };
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  loadServerEnvFile({ envPath: path.resolve('.env.server') });
  loadServerEnvFile({ envPath: path.resolve('.env.local') });
  const result = await runVoiceoverProbe(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
