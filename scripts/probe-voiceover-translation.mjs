import { randomUUID } from 'node:crypto';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  getVoiceoverConfig,
  normalizeVoiceoverCheckpoint,
} from '../server/voiceoverContract.mjs';
import { buildVoiceoverTtsGroups } from '../server/voiceoverAnalysis.mjs';
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
import {
  getVoiceoverLanguage,
  selectAutomaticVoice,
} from '../src/utils/voiceoverCatalog.mjs';

const MANAGED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const INTERNAL_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const CHILD_KEY_TTS_PATTERN = /^tts:(0|[1-9]\d?):attempt:(0|[1-9]\d{0,2})$/u;
const CHILD_KEY_GOLDEN_PATTERN = /^golden:attempt:(0|[1-9]\d{0,2})$/u;
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const VOICEOVER_CHECKPOINT_STAGES = new Set([
  'input_prepared',
  'subtitle_removal',
  'audio_extracted',
  'voice_separated',
  'speech_analysis_submitting',
  'speech_analyzed',
  'translated',
  'tts_generating',
  'audio_aligned',
  'result_persisted',
]);
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
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

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
const SENSITIVE_OUTPUT_MARKER = /\b(?:transcript|provider\s+(?:body|response))\b/iu;
const PROVIDER_ID = /((?:providerTaskId|provider_task_id|taskId|task_id)\s*[:=]\s*["']?)[A-Za-z0-9._-]+/giu;

export function redactVoiceoverProbeText(value, secrets = []) {
  let output = String(value || '');
  if (SENSITIVE_OUTPUT_MARKER.test(output)) return '[redacted-sensitive-output]';
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
    job: body?.job || null,
  };
};

const defaultQueryChildTask = async (childJobId, remote, deps) => {
  const body = await requestJson(
    deps.fetchImpl || globalThis.fetch,
    `${remote.baseUrl}/api/jobs/${encodeURIComponent(childJobId)}`,
    { headers: authHeaders(remote.sessionToken) },
  );
  const job = body?.job && typeof body.job === 'object' && !Array.isArray(body.job)
    ? body.job
    : null;
  const payload = job?.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
    ? job.payload
    : null;
  const parentJobId = clean(payload?.parentJobId);
  const childKey = clean(payload?.childKey);
  const taskType = clean(job?.taskType);
  const provider = clean(job?.provider);
  const isTts = CHILD_KEY_TTS_PATTERN.test(childKey);
  const isGolden = CHILD_KEY_GOLDEN_PATTERN.test(childKey);
  const validProviderContract = (
    (isTts && taskType === 'kie_tts' && provider === 'kie')
    || (isGolden && taskType === 'subtitle_remove_video' && provider === 'golden_subtitle')
  );
  const valid = Boolean(
    job
    && clean(job.id) === childJobId
    && INTERNAL_JOB_ID_PATTERN.test(childJobId)
    && clean(job.module) === 'video'
    && payload?.executionOwner === 'parent'
    && INTERNAL_JOB_ID_PATTERN.test(parentJobId)
    && validProviderContract
    && clean(payload.clientSubmissionKey) === `voiceover-child:${parentJobId}:${childKey}`,
  );
  return {
    found: valid,
    ...(valid ? {
      childJobId,
      parentJobId,
      childKey,
      taskType,
      provider,
      status: safeStatus(job.status),
    } : {}),
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

const resolveVoiceoverCheckpoint = (job) => {
  const result = job?.result && typeof job.result === 'object' && !Array.isArray(job.result)
    ? job.result
    : {};
  for (const candidate of [
    result.voiceoverCheckpoint,
    result.voiceover_checkpoint,
    result.checkpoint,
  ]) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return null;
};

const safeCheckpointStage = (value) => {
  const stage = clean(value);
  return VOICEOVER_CHECKPOINT_STAGES.has(stage) ? stage : 'unknown';
};

const safeAttemptStatus = (value) => {
  const status = clean(value);
  return ['queued', 'submitted', 'succeeded', 'failed'].includes(status)
    ? status
    : 'unknown';
};

const summarizeTtsStatuses = (groups) => {
  const boundedGroups = (Array.isArray(groups) ? groups : []).slice(0, 100);
  const summary = {
    total: boundedGroups.length,
    queued: 0,
    submitted: 0,
    succeeded: 0,
    failed: 0,
    unknown: 0,
  };
  for (const group of boundedGroups) summary[safeAttemptStatus(group?.status)] += 1;
  return summary;
};

const buildSafeCheckpointEvidenceFromCheckpoint = (checkpoint) => {
  const subtitleRemoval = checkpoint?.subtitleRemoval
    && typeof checkpoint.subtitleRemoval === 'object'
    && !Array.isArray(checkpoint.subtitleRemoval)
    ? checkpoint.subtitleRemoval
    : null;
  const ttsGroups = (Array.isArray(checkpoint?.ttsGroups) ? checkpoint.ttsGroups : [])
    .slice(0, 100);
  const childJobIds = [];
  const addChildJobId = (value) => {
    const childJobId = clean(value);
    if (
      INTERNAL_JOB_ID_PATTERN.test(childJobId)
      && !childJobIds.includes(childJobId)
      && childJobIds.length < 101
    ) childJobIds.push(childJobId);
  };
  addChildJobId(subtitleRemoval?.childJobId);
  for (const group of ttsGroups) addChildJobId(group?.childJobId);
  return {
    finalCheckpointStage: safeCheckpointStage(checkpoint?.stage),
    analysisAttempt: boundedInteger(checkpoint?.analysisAttempt, 0, 0, 100),
    childJobIds,
    ttsSummary: summarizeTtsStatuses(ttsGroups),
    goldenSummary: {
      present: Boolean(subtitleRemoval),
      status: subtitleRemoval ? safeAttemptStatus(subtitleRemoval.status) : 'unknown',
    },
  };
};

const buildSafeCheckpointEvidence = (job) => buildSafeCheckpointEvidenceFromCheckpoint(
  resolveVoiceoverCheckpoint(job),
);

const buildSafeLiveEvidence = (job) => {
  const parentJobId = clean(job?.id);
  return {
    ...(INTERNAL_JOB_ID_PATTERN.test(parentJobId) ? { parentJobId } : {}),
    ...buildSafeCheckpointEvidence(job),
  };
};

const resolveFinalManagedIdentity = (job, baseUrl) => {
  const result = job?.result && typeof job.result === 'object' && !Array.isArray(job.result)
    ? job.result
    : {};
  const finalAssetId = clean(result.finalAssetId);
  const videoUrl = clean(result.videoUrl);
  if (!MANAGED_ID_PATTERN.test(finalAssetId) || !videoUrl) {
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
      durationMs: Math.round(Number(metadata.durationSeconds) * 1000),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};

const verifiedDurationMs = (value) => {
  const durationMs = Number(value);
  return Number.isSafeInteger(durationMs) && durationMs > 0 ? durationMs : 0;
};

const latestTtsGroups = (groups) => {
  const latestByIndex = new Map();
  for (const group of groups) {
    const previous = latestByIndex.get(group.index);
    if (!previous || group.attempt > previous.attempt) latestByIndex.set(group.index, group);
  }
  return [...latestByIndex.values()];
};

const translationMatchesAnalysis = (analysisSegments, translationSegments) => (
  analysisSegments.length === translationSegments.length
  && analysisSegments.every((analysisSegment, index) => {
    const translationSegment = translationSegments[index];
    return analysisSegment.id === translationSegment.id
      && analysisSegment.startMs === translationSegment.startMs
      && analysisSegment.endMs === translationSegment.endMs
      && analysisSegment.sourceText === translationSegment.sourceText
      && analysisSegment.targetText === translationSegment.targetText;
  })
);

const requireCanonicalLiveCheckpoint = ({
  job,
  removeText,
  targetLanguage,
  finalIdentity,
  durationMs,
  env,
}) => {
  const rawCheckpoint = job?.result?.voiceoverCheckpoint;
  if (!rawCheckpoint || typeof rawCheckpoint !== 'object' || Array.isArray(rawCheckpoint)) {
    throw new Error('口播翻译成功任务缺少规范的持久化检查点。');
  }
  if (!hasOwn(rawCheckpoint, 'analysisAttempt')) {
    throw new Error('口播翻译持久化检查点缺少分析尝试索引。');
  }
  const config = getVoiceoverConfig(env);
  const checkpoint = normalizeVoiceoverCheckpoint(rawCheckpoint, {
    durationMs,
    overlapToleranceMs: config.overlapToleranceMs,
    minAtempo: config.minAtempo,
    maxAtempo: config.maxAtempo,
    removeText,
  });
  if (
    checkpoint.stage !== 'result_persisted'
    || checkpoint.finalAssetId !== finalIdentity.assetId
    || !checkpoint.analysis
    || !checkpoint.translation
  ) {
    throw new Error('口播翻译持久化检查点尚未形成可验证终态。');
  }
  if (
    checkpoint.translation.targetLanguage !== targetLanguage
    || checkpoint.translation.mode !== 'natural'
    || !translationMatchesAnalysis(
      checkpoint.analysis.segments,
      checkpoint.translation.segments,
    )
    || checkpoint.translation.selectedVoiceName
      !== selectAutomaticVoice(checkpoint.analysis.voiceProfile)
  ) {
    throw new Error('口播翻译持久化检查点与本次分析、文本或音色合同不一致。');
  }
  const plannedGroups = buildVoiceoverTtsGroups({
    segments: checkpoint.translation.segments,
    selectedVoiceName: checkpoint.translation.selectedVoiceName,
    maxInputTokens: config.ttsMaxInputTokens,
    groupGapMs: config.groupGapMs,
  });
  const latestGroups = latestTtsGroups(checkpoint.ttsGroups);
  const latestByIndex = new Map(latestGroups.map((group) => [group.index, group]));
  if (
    latestGroups.length !== plannedGroups.length
    || plannedGroups.some((planned) => {
      const group = latestByIndex.get(planned.groupIndex);
      return (
        !group
        || group.startMs !== planned.startMs
        || group.endMs !== planned.endMs
      );
    })
    || latestGroups.some((group) => (
      group.status !== 'succeeded'
      || !INTERNAL_JOB_ID_PATTERN.test(group.childJobId)
      || !MANAGED_ID_PATTERN.test(group.providerTaskId)
      || !MANAGED_ID_PATTERN.test(group.assetId)
    ))
  ) {
    throw new Error('口播翻译持久化检查点缺少已成功的最新 TTS 子任务证据。');
  }
  const subtitleRemoval = checkpoint.subtitleRemoval;
  if (
    removeText
    && (
      subtitleRemoval?.status !== 'succeeded'
      || !INTERNAL_JOB_ID_PATTERN.test(subtitleRemoval?.childJobId)
      || !MANAGED_ID_PATTERN.test(subtitleRemoval?.providerTaskId)
      || !MANAGED_ID_PATTERN.test(subtitleRemoval?.resultAssetId)
    )
  ) {
    throw new Error('口播翻译持久化检查点缺少已成功的 Golden 去文案证据。');
  }
  if (!removeText && subtitleRemoval !== undefined) {
    throw new Error('未启用去文案时不能接受 Golden 去文案检查点。');
  }
  return checkpoint;
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
      narrationOnlyMixReady: true,
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

const liveSummary = (job, args, verification, checkpoint) => {
  const parentJobId = clean(job?.id);
  return {
    mode: 'live',
    ...(INTERNAL_JOB_ID_PATTERN.test(parentJobId) ? { parentJobId } : {}),
    ...buildSafeCheckpointEvidenceFromCheckpoint(checkpoint),
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
  let latestLiveJob = null;
  let liveParentJobId = '';
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
          narrationOnlyMixReady: result?.narrationOnlyMixReady === true,
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
      if (!INTERNAL_JOB_ID_PATTERN.test(args.resumeParentJobId)) {
        throw usageError('--resume-parent-job-id 必须是合法的梅奥内部父任务 ID。');
      }
      const remote = resolveRemoteOptions(env);
      const query = deps.queryParentJob || ((id) => defaultQueryParentJob(id, remote, deps));
      const result = await query(args.resumeParentJobId, remote);
      const parentJob = result?.job && typeof result.job === 'object'
        ? result.job
        : { id: args.resumeParentJobId, status: result?.status };
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          mode: 'resume-parent',
          found: result?.found === true,
          status: safeStatus(result?.status),
          ...buildSafeLiveEvidence(parentJob),
          providerCreateCalls: 0,
        })}\n`,
        stderr: '',
      };
    }
    if (args.mode === 'resume-child') {
      if (!INTERNAL_JOB_ID_PATTERN.test(args.resumeChildTaskId)) {
        throw usageError('--resume-child-task-id 必须是 live 证据输出的合法内部 childJobId。');
      }
      const remote = resolveRemoteOptions(env);
      const query = deps.queryChildTask || ((id) => defaultQueryChildTask(id, remote, deps));
      const result = await query(args.resumeChildTaskId, remote);
      const childJobId = clean(result?.childJobId);
      const parentJobId = clean(result?.parentJobId);
      const childKey = clean(result?.childKey);
      const taskType = clean(result?.taskType);
      const provider = clean(result?.provider);
      const validKind = (
        (CHILD_KEY_TTS_PATTERN.test(childKey) && taskType === 'kie_tts' && provider === 'kie')
        || (
          CHILD_KEY_GOLDEN_PATTERN.test(childKey)
          && taskType === 'subtitle_remove_video'
          && provider === 'golden_subtitle'
        )
      );
      if (
        result?.found !== true
        || childJobId !== args.resumeChildTaskId
        || !INTERNAL_JOB_ID_PATTERN.test(childJobId)
        || !INTERNAL_JOB_ID_PATTERN.test(parentJobId)
        || !validKind
      ) {
        throw new Error('该 ID 不是当前账号可读的父持有口播子任务；不会扫描父任务或创建恢复任务。');
      }
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          mode: 'resume-child',
          found: true,
          childJobId,
          parentJobId,
          childKey,
          taskType,
          provider,
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
    if (!INTERNAL_JOB_ID_PATTERN.test(jobId)) {
      throw new Error('梅奥未返回合法的口播翻译父任务 ID。');
    }
    liveParentJobId = jobId;
    latestLiveJob = job;
    const query = deps.queryLiveJob || ((id) => defaultQueryLiveJob(id, remote, deps));
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = deps.now || Date.now;
    const startedAt = now();
    while (!TERMINAL_JOB_STATUSES.has(clean(job?.status))) {
      if (now() - startedAt > remote.timeoutMs) {
        throw new Error('口播翻译 canary 轮询超时；不会自动重新提交。');
      }
      await sleep(remote.pollIntervalMs);
      const queriedJob = await query(jobId, remote);
      if (!queriedJob || clean(queriedJob.id) !== jobId) {
        throw new Error('口播翻译父任务查询失败。');
      }
      job = queriedJob;
      latestLiveJob = job;
    }
    if (job.status !== 'succeeded') {
      throw new Error(`口播翻译 canary 未成功，终态为 ${safeStatus(job.status)}。`);
    }
    const finalIdentity = resolveFinalManagedIdentity(job, remote.baseUrl);
    const verifyFinal = deps.verifyFinalResult
      || ((identity) => defaultVerifyFinalResult(identity, remote, { ...deps, env }));
    const verification = await verifyFinal(finalIdentity, remote);
    const durationMs = verifiedDurationMs(verification?.durationMs);
    if (
      verification?.managedAsset !== true
      || verification?.h264 !== true
      || verification?.aac !== true
      || verification?.rangeReadable !== true
      || verification?.ftypPresent !== true
      || durationMs === 0
    ) {
      throw new Error('口播翻译最终托管视频未通过 H.264/AAC/Range/ftyp/时长验证。');
    }
    const checkpoint = requireCanonicalLiveCheckpoint({
      job,
      removeText: args.removeText,
      targetLanguage: args.targetLanguage,
      finalIdentity,
      durationMs,
      env,
    });
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(liveSummary(job, args, verification, checkpoint))}\n`,
      stderr: '',
    };
  } catch (error) {
    const exitCode = error instanceof VoiceoverProbeUsageError ? 2 : 1;
    const message = redactVoiceoverProbeText(
      error instanceof Error ? error.message : String(error),
      secretValues(env),
    );
    if (liveParentJobId) {
      return {
        exitCode,
        stdout: '',
        stderr: `${JSON.stringify({
          mode: 'live',
          ok: false,
          message: message || '口播翻译探针执行失败。',
          ...buildSafeLiveEvidence(latestLiveJob || { id: liveParentJobId }),
        })}\n`,
      };
    }
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
  const invocationLiveConfirmation = process.env.MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED;
  const invocationSessionToken = process.env.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN;
  loadServerEnvFile({ envPath: path.resolve('.env.server') });
  loadServerEnvFile({ envPath: path.resolve('.env.local') });
  if (invocationLiveConfirmation === undefined) {
    delete process.env.MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED;
  } else {
    process.env.MEIAO_VOICEOVER_LIVE_CANARY_CONFIRMED = invocationLiveConfirmation;
  }
  if (invocationSessionToken === undefined) {
    delete process.env.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN;
  } else {
    process.env.MEIAO_VOICEOVER_PROBE_SESSION_TOKEN = invocationSessionToken;
  }
  const result = await runVoiceoverProbe(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
