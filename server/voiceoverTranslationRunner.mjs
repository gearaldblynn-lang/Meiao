import { mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { selectAutomaticVoice } from '../src/utils/voiceoverCatalog.mjs';
import {
  buildVoiceoverAnalysisMessages,
  buildVoiceoverTtsGroups,
  parseVoiceoverAnalysis,
} from './voiceoverAnalysis.mjs';
import {
  VOICEOVER_CHECKPOINT_VERSION,
  buildVoiceoverError,
  getVoiceoverConfig,
  mergeVoiceoverCheckpoint,
  normalizeVoiceoverCheckpoint,
  normalizeVoiceoverPayload,
} from './voiceoverContract.mjs';

const CHILD_DEFINITIVE_FAILURE_CODES = new Set([
  'provider_auth_invalid',
  'provider_bad_request',
  'provider_balance_insufficient',
  'provider_job_failed',
  'provider_submission_unknown',
  'voiceover_tts_input_too_large',
]);
const DEFAULT_VOICEOVER_SOURCE_MAX_BYTES = 200 * 1024 * 1024;
const MIN_VOICEOVER_SOURCE_MAX_BYTES = 1024 * 1024;
const MAX_VOICEOVER_SOURCE_MAX_BYTES = 1024 * 1024 * 1024;

export const getVoiceoverSourceMaxBytes = (env = {}) => {
  const parsed = Number.parseInt(String(env.MEIAO_MEDIA_TRANSCODE_INPUT_MAX_BYTES || ''), 10);
  const value = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_VOICEOVER_SOURCE_MAX_BYTES;
  return Math.max(
    MIN_VOICEOVER_SOURCE_MAX_BYTES,
    Math.min(MAX_VOICEOVER_SOURCE_MAX_BYTES, value),
  );
};

const safeId = (value, field) => {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(normalized)) {
    throw buildVoiceoverError('voiceover_checkpoint_invalid', `${field} 无效`);
  }
  return normalized;
};

const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  throw Object.assign(new Error('口播翻译已取消'), {
    name: 'AbortError',
    code: 'request_cancelled',
    cancelled: true,
  });
};

export async function streamVoiceoverAssetToFile({
  remoteUrl,
  destinationPath,
  maxBytes,
  signal,
  timeoutMs = 120_000,
  deps = {},
} = {}) {
  const normalizedMaxBytes = Number(maxBytes);
  if (
    !/^https?:\/\//iu.test(String(remoteUrl || ''))
    || !path.isAbsolute(String(destinationPath || ''))
    || !Number.isInteger(normalizedMaxBytes)
    || normalizedMaxBytes <= 0
  ) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '托管视频下载参数无效');
  }
  throwIfAborted(signal);
  const fetchImpl = deps.fetchImpl || fetch;
  const openFile = deps.openFile || open;
  const renameFile = deps.renameFile || rename;
  const removeFile = deps.removeFile || rm;
  const partPath = `${destinationPath}.part`;
  const controller = new AbortController();
  let timedOut = false;
  const abortDownload = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortDownload, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, Number(timeoutMs) || 120_000));
  timeout.unref?.();
  const assertDownloadActive = () => {
    throwIfAborted(signal);
    if (timedOut) {
      throw Object.assign(new Error('托管视频下载超时'), {
        code: 'provider_network_error',
        retryable: true,
      });
    }
  };
  let file = null;
  let reader = null;
  let sizeBytes = 0;

  try {
    await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
    await removeFile(partPath, { force: true }).catch(() => null);
    const response = await fetchImpl(remoteUrl, { signal: controller.signal });
    if (!response?.ok) {
      await response?.body?.cancel?.().catch?.(() => null);
      throw Object.assign(new Error(`托管视频下载失败: HTTP ${response?.status || 0}`), {
        code: 'provider_bad_response',
        httpStatus: Number(response?.status || 0),
      });
    }
    const declaredBytes = Number(response.headers?.get?.('content-length') || 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > normalizedMaxBytes) {
      await response.body?.cancel?.().catch?.(() => null);
      throw buildVoiceoverError('voiceover_source_too_large', '源视频文件超过本地处理上限');
    }
    reader = response.body?.getReader?.();
    if (!reader) {
      throw Object.assign(new Error('托管视频下载响应缺少数据流'), {
        code: 'provider_bad_response',
      });
    }
    file = await openFile(partPath, 'wx', 0o600);
    while (true) {
      assertDownloadActive();
      const chunk = await reader.read();
      assertDownloadActive();
      if (chunk.done) break;
      const bytes = Buffer.from(chunk.value || []);
      sizeBytes += bytes.length;
      if (sizeBytes > normalizedMaxBytes) {
        await reader.cancel().catch(() => null);
        throw buildVoiceoverError('voiceover_source_too_large', '源视频文件超过本地处理上限');
      }
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await file.write(
          bytes,
          offset,
          bytes.length - offset,
          null,
        );
        if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
          throw Object.assign(new Error('托管视频写入不完整'), {
            code: 'provider_bad_response',
          });
        }
        offset += bytesWritten;
      }
    }
    assertDownloadActive();
    if (sizeBytes <= 0) {
      throw Object.assign(new Error('托管视频下载结果为空'), {
        code: 'provider_bad_response',
      });
    }
    await file.sync();
    await file.close();
    file = null;
    assertDownloadActive();
    await renameFile(partPath, destinationPath);
    return { path: destinationPath, sizeBytes };
  } catch (error) {
    await reader?.cancel?.().catch?.(() => null);
    await file?.close?.().catch?.(() => null);
    await removeFile(partPath, { force: true }).catch(() => null);
    if (signal?.aborted) {
      throw Object.assign(new Error('口播翻译已取消'), {
        name: 'AbortError',
        code: 'request_cancelled',
        cancelled: true,
      });
    }
    if (timedOut) {
      throw Object.assign(new Error('托管视频下载超时'), {
        code: 'provider_network_error',
        retryable: true,
      });
    }
    if (error?.code) throw error;
    throw Object.assign(new Error('托管视频下载失败'), {
      code: 'provider_network_error',
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortDownload);
  }
}

const workPathError = () => Object.assign(
  new Error('口播翻译内部工作路径无效'),
  { code: 'voiceover_work_path_invalid' },
);

const containedBy = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/**
 * Canonicalizes an existing input or a prospective output and proves
 * path-segment containment. A string prefix is intentionally insufficient:
 * `/job-root-escape` is not a child of `/job-root`.
 */
export async function assertVoiceoverWorkPath(workRoot, candidate, {
  mustExist = false,
  realpathImpl = realpath,
} = {}) {
  if (!path.isAbsolute(String(workRoot || '')) || !path.isAbsolute(String(candidate || ''))) {
    throw workPathError();
  }
  let canonicalRoot;
  let canonicalCandidate;
  try {
    canonicalRoot = await realpathImpl(workRoot);
    if (mustExist) {
      canonicalCandidate = await realpathImpl(candidate);
    } else {
      const canonicalParent = await realpathImpl(path.dirname(candidate));
      canonicalCandidate = path.join(canonicalParent, path.basename(candidate));
    }
  } catch {
    throw workPathError();
  }
  if (!containedBy(canonicalRoot, canonicalCandidate)) throw workPathError();
  return canonicalCandidate;
}

const requireDependency = (deps, name) => {
  const dependency = deps?.[name];
  if (typeof dependency !== 'function') {
    throw Object.assign(new Error(`口播翻译依赖 ${name} 不可用`), {
      code: 'voiceover_unavailable',
    });
  }
  return dependency;
};

const transcript = (segments, field) => segments.map((segment) => segment[field]).join('\n');

const normalizeAnalysisContent = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value?.content === 'string') return value.content;
  if (typeof value?.result?.content === 'string') return value.result.content;
  return '';
};

const normalizeManagedResult = (value, kind) => {
  const assetId = safeId(value?.assetId || value?.id, `${kind}AssetId`);
  const url = String(value?.url || value?.publicUrl || value?.videoUrl || value?.audioUrl || '').trim();
  if (!url) throw buildVoiceoverError('voiceover_result_persist_failed', `${kind} 托管结果无效`);
  return {
    assetId,
    url,
    ...(value?.path ? { path: String(value.path) } : {}),
    ...(Number.isFinite(Number(value?.durationMs)) ? { durationMs: Number(value.durationMs) } : {}),
  };
};

const normalizeOwnedAsset = (value, {
  expectedAssetId = '',
  userId,
  destinationPath,
  kind,
}) => {
  const assetId = safeId(value?.assetId || value?.id, `${kind}AssetId`);
  if (expectedAssetId && assetId !== expectedAssetId) {
    throw Object.assign(new Error('托管素材身份不匹配'), { code: 'managed_asset_forbidden' });
  }
  if (String(value?.userId || '') !== String(userId || '')) {
    throw Object.assign(new Error('托管素材不属于当前账号'), { code: 'managed_asset_forbidden' });
  }
  const filePath = String(value?.path || '');
  if (filePath !== destinationPath) {
    throw workPathError();
  }
  const url = String(value?.url || value?.publicUrl || '').trim();
  if (!url) throw Object.assign(new Error('托管素材地址无效'), { code: 'managed_asset_unavailable' });
  return {
    ...value,
    assetId,
    url,
    path: filePath,
    durationMs: Number(value?.durationMs),
  };
};

const latestGroupAttempts = (groups = []) => {
  const latest = new Map();
  for (const group of groups) {
    const previous = latest.get(group.index);
    if (!previous || group.attempt > previous.attempt) latest.set(group.index, group);
  }
  return latest;
};

const childCheckpoint = (child, {
  index,
  attempt,
  startMs,
  endMs,
  status,
  assetId,
  actualDurationMs,
  atempo,
}) => ({
  index,
  attempt,
  childJobId: safeId(child.id, 'childJobId'),
  ...(child.providerTaskId ? { providerTaskId: safeId(child.providerTaskId, 'providerTaskId') } : {}),
  ...(assetId ? { assetId: safeId(assetId, 'assetId') } : {}),
  status,
  startMs,
  endMs,
  ...(actualDurationMs !== undefined ? { actualDurationMs: Number(actualDurationMs) } : {}),
  ...(atempo !== undefined ? { atempo: Number(atempo) } : {}),
});

const goldenCheckpoint = (child, {
  attempt,
  status,
  resultAssetId,
}) => ({
  childJobId: safeId(child.id, 'childJobId'),
  ...(child.providerTaskId ? { providerTaskId: safeId(child.providerTaskId, 'providerTaskId') } : {}),
  ...(resultAssetId ? { resultAssetId: safeId(resultAssetId, 'resultAssetId') } : {}),
  attempt,
  status,
});

const safelyLog = (logger, level, event) => {
  const method = logger?.[level];
  if (typeof method !== 'function') return;
  method({
    event: String(event.event || ''),
    jobId: String(event.jobId || ''),
    childJobId: String(event.childJobId || ''),
    providerTaskId: String(event.providerTaskId || '').slice(0, 12),
    stage: String(event.stage || ''),
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : 0,
    errorCode: String(event.errorCode || ''),
  });
};

const managedSourceAssetId = (value) => {
  const normalized = String(value || '').trim();
  const scheme = normalized.match(/^(?:managed|asset):\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})$/u);
  if (scheme) return scheme[1];
  const route = normalized.match(/^\/api\/(?:assets|media)\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})$/u);
  return route?.[1] || '';
};

export async function withVoiceoverProbeWorkspace({
  createWorkRoot,
  cleanupWorkRoot,
  operation,
} = {}) {
  if (
    typeof createWorkRoot !== 'function'
    || typeof cleanupWorkRoot !== 'function'
    || typeof operation !== 'function'
  ) {
    throw new TypeError('Voiceover probe workspace dependencies are required.');
  }
  const workRoot = await createWorkRoot();
  let primaryError = null;
  try {
    return await operation(workRoot);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanupWorkRoot(workRoot);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
}

export async function prepareVoiceoverSubmission({
  body,
  userId,
  resolveOwnedAsset,
  probeVideo,
  signal,
} = {}) {
  if (body?.taskType !== 'voiceover_translate_video') {
    return { body, sourceProbe: null };
  }
  if (typeof resolveOwnedAsset !== 'function' || typeof probeVideo !== 'function') {
    throw buildVoiceoverError('voiceover_unavailable', '口播翻译素材探测能力不可用');
  }
  const { subFeature: _ignoredSubFeature, ...browserPayload } = body?.payload || {};
  const payload = normalizeVoiceoverPayload({
    ...browserPayload,
    taskType: 'voiceover_translate_video',
    taskPurpose: 'voiceover_translation',
  }, {
    actorUserId: userId,
  });
  const asset = await resolveOwnedAsset({
    userId,
    ...(payload.sourceAssetId
      ? { assetId: payload.sourceAssetId }
      : { sourceUrl: payload.sourceUrl }),
    signal,
  });
  if (
    !asset
    || String(asset.userId || '') !== String(userId || '')
    || (payload.sourceAssetId && String(asset.assetId || asset.id || '') !== payload.sourceAssetId)
    || (payload.sourceUrl && String(asset.assetId || asset.id || '') !== managedSourceAssetId(payload.sourceUrl))
  ) {
    throw Object.assign(new Error('托管素材不属于当前账号'), {
      code: 'managed_asset_forbidden',
      statusCode: 403,
    });
  }
  const probed = await probeVideo(asset, signal);
  const sourceProbe = {
    durationMs: Number(probed?.durationMs),
    hasAudio: probed?.hasAudio === true,
    width: Number(probed?.width || 0),
    height: Number(probed?.height || 0),
  };
  return {
    body: {
      ...body,
      payload: {
        ...payload,
        subFeature: 'voiceover_translation',
      },
    },
    sourceProbe,
  };
}

export async function runVoiceoverTranslationJob({
  job,
  env = process.env,
  signal,
  onResultCheckpoint,
  deps = {},
} = {}) {
  if (
    job?.taskType !== 'voiceover_translate_video'
    || job?.provider !== 'internal'
    || job?.module !== 'video'
    || job?.payload?.subFeature !== 'voiceover_translation'
    || !String(job?.userId || '').trim()
  ) {
    throw buildVoiceoverError('voiceover_unavailable', '口播翻译父任务身份无效');
  }
  if (typeof onResultCheckpoint !== 'function') {
    throw buildVoiceoverError('voiceover_unavailable', '口播翻译缺少耐久检查点回调');
  }

  // One parent execution owns one immutable normalized configuration snapshot.
  // Every downstream helper receives this object explicitly.
  const config = (deps.getConfig || getVoiceoverConfig)(env);
  if (!config?.enabled) throw buildVoiceoverError('voiceover_unavailable', '口播翻译功能暂未启用');

  const payload = job.payload || {};
  const removeText = payload.removeText === true;
  const sourceAssetId = String(payload.sourceAssetId || '').trim();
  const sourceUrl = String(payload.sourceUrl || '').trim();
  if (!sourceAssetId && !sourceUrl) {
    throw buildVoiceoverError('voiceover_analysis_invalid', '请选择当前账号拥有的托管视频');
  }
  const checkpointOptions = {
    removeText,
    overlapToleranceMs: config.overlapToleranceMs,
    minAtempo: config.minAtempo,
    maxAtempo: config.maxAtempo,
  };
  let checkpoint = job?.result?.voiceoverCheckpoint
    ? normalizeVoiceoverCheckpoint(job.result.voiceoverCheckpoint, checkpointOptions)
    : null;

  const createWorkRoot = requireDependency(deps, 'createWorkRoot');
  const cleanupWorkRoot = requireDependency(deps, 'cleanupWorkRoot');
  const resolveOwnedAsset = requireDependency(deps, 'resolveOwnedAsset');
  const persistManagedFile = requireDependency(deps, 'persistManagedFile');
  const workRoot = await createWorkRoot({ jobId: job.id, userId: job.userId });
  let canonicalRoot = '';
  let primaryError = null;

  const prepareOutputPath = async (...segments) => {
    const outputPath = path.join(canonicalRoot, ...segments);
    await mkdir(path.dirname(outputPath), { recursive: true });
    return assertVoiceoverWorkPath(canonicalRoot, outputPath);
  };
  const resolveIntoWorkRoot = async ({
    assetId = '',
    managedUrl = '',
    fileName,
    kind,
  }) => {
    const destinationPath = await prepareOutputPath('inputs', fileName);
    const resolved = normalizeOwnedAsset(await resolveOwnedAsset({
      userId: job.userId,
      ...(assetId ? { assetId } : { sourceUrl: managedUrl }),
      destinationPath,
      expectedKind: kind,
      signal,
    }), {
      expectedAssetId: assetId,
      userId: job.userId,
      destinationPath,
      kind,
    });
    await assertVoiceoverWorkPath(canonicalRoot, resolved.path, { mustExist: true });
    return resolved;
  };
  const persistLocal = async (filePath, stage, metadata = {}) => {
    await assertVoiceoverWorkPath(canonicalRoot, filePath, { mustExist: true });
    try {
      return normalizeManagedResult(await persistManagedFile({
        filePath,
        userId: job.userId,
        parentJobId: job.id,
        module: 'video',
        stage,
        config,
        ...metadata,
      }), stage);
    } catch (error) {
      if (stage === 'result_persisted') {
        throw buildVoiceoverError(
          'voiceover_result_persist_failed',
          '口播翻译最终结果保存失败',
          { cause: error },
        );
      }
      throw error;
    }
  };
  const persistStage = async (patch, durationMs) => {
    const options = {
      ...checkpointOptions,
      ...(Number.isFinite(Number(durationMs)) ? { durationMs: Number(durationMs) } : {}),
    };
    checkpoint = checkpoint
      ? mergeVoiceoverCheckpoint(checkpoint, patch, options)
      : normalizeVoiceoverCheckpoint(patch, options);
    await onResultCheckpoint(
      { voiceoverCheckpoint: checkpoint },
      { voiceoverConfig: config },
    );
    safelyLog(deps.logger, 'info', {
      event: 'voiceover_stage_checkpointed',
      jobId: job.id,
      stage: checkpoint.stage,
      durationMs,
    });
  };

  try {
    canonicalRoot = await assertVoiceoverWorkPath(workRoot, workRoot, { mustExist: true });
    throwIfAborted(signal);
    const source = await resolveIntoWorkRoot({
      assetId: sourceAssetId,
      managedUrl: sourceUrl,
      fileName: 'source.mp4',
      kind: 'source_video',
    });
    if (source.hasAudio === false) {
      throw buildVoiceoverError('voiceover_source_has_no_audio', '源视频没有可用音轨');
    }
    if (
      source.hasAudio !== true
      || !Number.isFinite(source.durationMs)
      || source.durationMs <= 0
      || (removeText && (
        !Number.isFinite(Number(source.sizeBytes)) || Number(source.sizeBytes) <= 0
        || !Number.isFinite(Number(source.width)) || Number(source.width) <= 0
        || !Number.isFinite(Number(source.height)) || Number(source.height) <= 0
      ))
    ) {
      const probeMedia = requireDependency(deps, 'probeMedia');
      const probed = await probeMedia({ filePath: source.path, signal, config });
      source.durationMs = Number(probed?.durationMs);
      source.hasAudio = probed?.hasAudio === true;
      source.sizeBytes = Number(probed?.sizeBytes || source.sizeBytes);
      source.width = Number(probed?.width || source.width);
      source.height = Number(probed?.height || source.height);
      if (!source.hasAudio) {
        throw buildVoiceoverError('voiceover_source_has_no_audio', '源视频没有可用音轨');
      }
    }
    const durationMs = source.durationMs;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw buildVoiceoverError('voiceover_analysis_invalid', '源视频时长无效');
    }
    if (removeText && durationMs > 600_000) {
      throw buildVoiceoverError('voiceover_analysis_invalid', '去文案视频不能超过 600 秒');
    }
    if (
      removeText
      && (
        !Number.isFinite(source.sizeBytes) || source.sizeBytes <= 0
        || !Number.isFinite(source.width) || source.width <= 0
        || !Number.isFinite(source.height) || source.height <= 0
      )
    ) {
      throw buildVoiceoverError('voiceover_analysis_invalid', '去文案源视频媒体信息无效');
    }
    checkpointOptions.durationMs = durationMs;

    if (!checkpoint) {
      await persistStage({
        version: VOICEOVER_CHECKPOINT_VERSION,
        stage: 'input_prepared',
        baseVideoAssetId: source.assetId,
        analysisAttempt: 0,
      }, durationMs);
    } else if (checkpoint.baseVideoAssetId !== source.assetId) {
      throw buildVoiceoverError('voiceover_checkpoint_invalid', '检查点源素材与当前父任务不一致');
    }

    if (checkpoint.stage === 'result_persisted') {
      const final = await resolveIntoWorkRoot({
        assetId: checkpoint.finalAssetId,
        fileName: 'final-resume.mp4',
        kind: 'final_video',
      });
      return {
        result: {
          videoUrl: final.url,
          sourceUrl: source.url,
          sourceLanguage: checkpoint.analysis.sourceLanguage,
          targetLanguage: checkpoint.translation.targetLanguage,
          translationMode: checkpoint.translation.mode,
          voiceName: checkpoint.translation.selectedVoiceName,
          sourceTranscript: transcript(checkpoint.analysis.segments, 'sourceText'),
          translatedTranscript: transcript(checkpoint.translation.segments, 'targetText'),
          voiceoverStage: 'result_persisted',
          finalAssetId: checkpoint.finalAssetId,
        },
      };
    }

    let baseVideo = source;
    if (removeText) {
      if (checkpoint.subtitleRemoval?.status === 'succeeded') {
        baseVideo = await resolveIntoWorkRoot({
          assetId: checkpoint.subtitleRemoval.resultAssetId,
          fileName: 'base-golden.mp4',
          kind: 'golden_video',
        });
      } else {
        throwIfAborted(signal);
        const childJobs = deps.childJobs;
        if (!childJobs?.getOrCreate) throw buildVoiceoverError('voiceover_unavailable', 'Golden 子任务账本不可用');
        const attempt = Number(checkpoint.subtitleRemoval?.attempt ?? 0);
        let child = await childJobs.getOrCreate({
          parentJob: job,
          childKey: `golden:attempt:${attempt}`,
          taskType: 'subtitle_remove_video',
          provider: 'golden_subtitle',
          payload: {
            taskPurpose: 'subtitle_removal',
            subFeature: 'voiceover_translation',
            sourceAssetId: source.assetId,
            sourceUrl: source.url,
            subtitleRegionNormalized: payload.subtitleRegionNormalized,
            ...(payload.sourceProjectId ? { sourceProjectId: payload.sourceProjectId } : {}),
            ...(payload.sourceResultId ? { sourceResultId: payload.sourceResultId } : {}),
            shellProjectId: payload.shellProjectId,
            shellProjectName: payload.shellProjectName,
            shellResultId: payload.shellResultId,
            batchId: job.id,
            batchIndex: 0,
            batchCount: 1,
            sizeBytes: Number(source.sizeBytes),
            durationSeconds: durationMs / 1000,
            width: Number(source.width),
            height: Number(source.height),
          },
        });
        if (child.status === 'failed') {
          if (checkpoint.subtitleRemoval?.status !== 'failed') {
            await persistStage({
              stage: 'subtitle_removal',
              subtitleRemoval: goldenCheckpoint(child, {
                attempt,
                status: 'failed',
              }),
            }, durationMs);
          }
          throw Object.assign(new Error(child.errorMessage || 'Golden 去文案失败'), {
            code: child.errorCode || 'provider_job_failed',
          });
        }
        if (child.status === 'succeeded') {
          const persisted = normalizeManagedResult(child.result, 'golden');
          await persistStage({
            stage: 'subtitle_removal',
            subtitleRemoval: goldenCheckpoint(child, {
              attempt,
              status: 'succeeded',
              resultAssetId: persisted.assetId,
            }),
          }, durationMs);
          baseVideo = await resolveIntoWorkRoot({
            assetId: persisted.assetId,
            fileName: 'base-golden.mp4',
            kind: 'golden_video',
          });
        } else {
          const runGolden = requireDependency(deps, 'runGolden');
          try {
            const output = await runGolden({
              job: child,
              env,
              signal,
              config,
              trustedParentExecution: true,
              onProviderTaskId: async (providerTaskId) => {
                child = await childJobs.checkpointProviderTaskId(child.id, providerTaskId);
                await persistStage({
                  stage: 'subtitle_removal',
                  subtitleRemoval: goldenCheckpoint(child, { attempt, status: 'submitted' }),
                }, durationMs);
              },
            });
            const persistGoldenOutput = requireDependency(deps, 'persistGoldenOutput');
            const persisted = normalizeManagedResult(
              await persistGoldenOutput({ child, output, parentJob: job, config }),
              'golden',
            );
            child = await childJobs.markSucceeded(child.id, {
              assetId: persisted.assetId,
              resultAssetId: persisted.assetId,
              videoUrl: persisted.url,
              durationMs: persisted.durationMs,
            });
            await persistStage({
              stage: 'subtitle_removal',
              subtitleRemoval: goldenCheckpoint(child, {
                attempt,
                status: 'succeeded',
                resultAssetId: persisted.assetId,
              }),
            }, durationMs);
            baseVideo = await resolveIntoWorkRoot({
              assetId: persisted.assetId,
              fileName: 'base-golden.mp4',
              kind: 'golden_video',
            });
          } catch (error) {
            if (CHILD_DEFINITIVE_FAILURE_CODES.has(error?.code)) {
              const failedChild = await childJobs.markFailed(child.id, error).catch(() => null);
              if (failedChild?.status === 'failed') {
                child = failedChild;
                await persistStage({
                  stage: 'subtitle_removal',
                  subtitleRemoval: goldenCheckpoint(child, {
                    attempt,
                    status: 'failed',
                  }),
                }, durationMs);
              }
            }
            throw error;
          }
        }
      }
    }

    let originalAudio;
    if (checkpoint.stage === 'input_prepared' || checkpoint.stage === 'subtitle_removal') {
      throwIfAborted(signal);
      const extractAudio = requireDependency(deps, 'extractAudio');
      const outputWavPath = await prepareOutputPath('audio', 'original.wav');
      await assertVoiceoverWorkPath(canonicalRoot, baseVideo.path, { mustExist: true });
      await extractAudio({
        inputVideoPath: baseVideo.path,
        outputWavPath,
        signal,
        config,
      });
      originalAudio = await persistLocal(outputWavPath, 'audio_extracted');
      await persistStage({
        stage: 'audio_extracted',
        originalAudioAssetId: originalAudio.assetId,
      }, durationMs);
    } else {
      originalAudio = await resolveIntoWorkRoot({
        assetId: checkpoint.originalAudioAssetId,
        fileName: 'original.wav',
        kind: 'original_audio',
      });
    }

    let vocal;
    let background;
    if (checkpoint.stage === 'audio_extracted') {
      throwIfAborted(signal);
      const separateVoice = requireDependency(deps, 'separateVoice');
      await assertVoiceoverWorkPath(canonicalRoot, originalAudio.path, { mustExist: true });
      const separated = await separateVoice({
        inputWavPath: originalAudio.path,
        workDir: canonicalRoot,
        signal,
        env,
        config,
      });
      await assertVoiceoverWorkPath(canonicalRoot, separated.vocalsPath, { mustExist: true });
      await assertVoiceoverWorkPath(canonicalRoot, separated.backgroundPath, { mustExist: true });
      vocal = await persistLocal(separated.vocalsPath, 'voice_separated_vocal');
      background = await persistLocal(separated.backgroundPath, 'voice_separated_background');
      await persistStage({
        stage: 'voice_separated',
        vocalAssetId: vocal.assetId,
        backgroundAssetId: background.assetId,
      }, durationMs);
    } else {
      vocal = await resolveIntoWorkRoot({
        assetId: checkpoint.vocalAssetId,
        fileName: 'vocals.wav',
        kind: 'vocal_audio',
      });
      background = await resolveIntoWorkRoot({
        assetId: checkpoint.backgroundAssetId,
        fileName: 'background.wav',
        kind: 'background_audio',
      });
    }

    if (checkpoint.stage === 'speech_analysis_submitting') {
      throw buildVoiceoverError(
        'voiceover_analysis_submission_unknown',
        '语音分析提交结果未知，已停止自动重提',
      );
    }

    let analysis = checkpoint.analysis;
    if (!analysis) {
      throwIfAborted(signal);
      const buildVocalOnlyVideo = requireDependency(deps, 'buildVocalOnlyVideo');
      const analysisVideoPath = await prepareOutputPath('analysis', 'vocal-only.mp4');
      await assertVoiceoverWorkPath(canonicalRoot, baseVideo.path, { mustExist: true });
      await assertVoiceoverWorkPath(canonicalRoot, vocal.path, { mustExist: true });
      await buildVocalOnlyVideo({
        sourceVideoPath: baseVideo.path,
        vocalPath: vocal.path,
        outputPath: analysisVideoPath,
        config,
        signal,
      });
      const analysisMedia = await persistLocal(analysisVideoPath, 'speech_analysis_media');
      await persistStage({
        stage: 'speech_analysis_submitting',
      }, durationMs);
      throwIfAborted(signal);
      const analyzeSpeech = requireDependency(deps, 'analyzeSpeech');
      const messages = (deps.buildAnalysisMessages || buildVoiceoverAnalysisMessages)({
        vocalOnlyVideoUrl: analysisMedia.url,
        targetLanguage: payload.targetLanguage,
        translationMode: payload.translationMode,
        durationMs,
      });
      const analysisOutput = await analyzeSpeech({
        messages,
        vocalOnlyVideoUrl: analysisMedia.url,
        targetLanguage: payload.targetLanguage,
        translationMode: payload.translationMode,
        durationMs,
        signal,
        env,
        config,
      });
      const parseAnalysis = deps.parseAnalysis || parseVoiceoverAnalysis;
      analysis = parseAnalysis(normalizeAnalysisContent(analysisOutput), {
        durationMs,
        targetLanguage: payload.targetLanguage,
        translationMode: payload.translationMode,
        overlapToleranceMs: config.overlapToleranceMs,
        maxTargetTextBytesPerSecond: config.maxTargetTextBytesPerSecond,
      });
      await persistStage({
        stage: 'speech_analyzed',
        analysis,
      }, durationMs);
    }

    let translation = checkpoint.translation;
    if (!translation) {
      const selectedVoiceName = payload.voiceMode === 'preset'
        ? payload.voiceName
        : (deps.selectVoice || selectAutomaticVoice)(analysis.voiceProfile);
      translation = {
        targetLanguage: payload.targetLanguage,
        mode: payload.translationMode,
        segments: analysis.segments,
        selectedVoiceName,
      };
      const buildGroups = deps.buildTtsGroups || buildVoiceoverTtsGroups;
      // Planning is intentionally done before the translated checkpoint so an
      // invalid/oversized group cannot advance durable state.
      buildGroups({
        segments: translation.segments,
        selectedVoiceName,
        maxInputTokens: config.ttsMaxInputTokens,
        groupGapMs: config.groupGapMs,
      });
      await persistStage({
        stage: 'translated',
        translation,
      }, durationMs);
    }

    const buildGroups = deps.buildTtsGroups || buildVoiceoverTtsGroups;
    const plannedGroups = buildGroups({
      segments: translation.segments,
      selectedVoiceName: translation.selectedVoiceName,
      maxInputTokens: config.ttsMaxInputTokens,
      groupGapMs: config.groupGapMs,
    });
    const attempts = latestGroupAttempts(checkpoint.ttsGroups);
    const childJobs = deps.childJobs;
    if (!childJobs || typeof childJobs.getOrCreate !== 'function') {
      throw buildVoiceoverError('voiceover_unavailable', 'TTS 子任务账本不可用');
    }
    const completedGroups = [];
    const durableGroups = [];
    for (const planned of plannedGroups) {
      throwIfAborted(signal);
      const index = planned.groupIndex;
      const existingAttempt = attempts.get(index);
      const attempt = Number(existingAttempt?.attempt ?? 0);
      const childKey = `tts:${index}:attempt:${attempt}`;
      let child = existingAttempt?.status === 'succeeded' && existingAttempt?.assetId
        ? {
            id: existingAttempt.childJobId,
            status: 'succeeded',
            providerTaskId: existingAttempt.providerTaskId || '',
            result: {
              assetId: existingAttempt.assetId,
              durationMs: existingAttempt.actualDurationMs,
            },
          }
        : await childJobs.getOrCreate({
            parentJob: job,
            childKey,
            taskType: 'kie_tts',
            provider: 'kie',
            payload: {
              groupIndex: index,
              targetLanguage: translation.targetLanguage,
              voiceName: translation.selectedVoiceName,
              dialogueTurns: planned.dialogueTurns,
              temperature: 1,
              scene: planned.scene,
              sampleContext: planned.sampleContext,
            },
          });
      let assetId = existingAttempt?.assetId || child.result?.assetId || '';
      let actualDurationMs = existingAttempt?.actualDurationMs || child.result?.durationMs;
      if (!assetId) {
        if (child.status === 'failed') {
          throw Object.assign(new Error(child.errorMessage || 'TTS 子任务失败'), {
            code: child.errorCode || 'provider_job_failed',
            providerTaskId: child.providerTaskId || '',
          });
        }
        const runTts = requireDependency(deps, 'runTts');
        if (
          typeof childJobs.checkpointProviderTaskId !== 'function'
          || typeof childJobs.markSucceeded !== 'function'
          || typeof childJobs.markFailed !== 'function'
        ) {
          throw buildVoiceoverError('voiceover_unavailable', 'TTS 子任务账本写入能力不可用');
        }
        try {
          const output = await runTts({
            job: child,
            env,
            signal,
            config,
            trustedParentExecution: true,
            onProviderTaskId: async (providerTaskId) => {
              child = await childJobs.checkpointProviderTaskId(child.id, providerTaskId);
            },
          });
          const persistTtsOutput = requireDependency(deps, 'persistTtsOutput');
          const persisted = await persistTtsOutput({
            child,
            output,
            parentJob: job,
            config,
          });
          // Task 3 names the managed ID `audioUrlAssetId`; the child ledger
          // contract deliberately stores it as `assetId`.
          assetId = safeId(persisted?.audioUrlAssetId, 'audioUrlAssetId');
          actualDurationMs = Number(persisted?.durationMs);
          child = await childJobs.markSucceeded(child.id, {
            audioUrl: persisted.audioUrl,
            assetId,
            ...(Number.isInteger(actualDurationMs) && actualDurationMs > 0
              ? { durationMs: actualDurationMs }
              : {}),
          });
        } catch (error) {
          if (CHILD_DEFINITIVE_FAILURE_CODES.has(error?.code)) {
            child = await childJobs.markFailed(child.id, error).catch(() => child);
          }
          const hasProviderTaskId = Boolean(child.providerTaskId || error?.providerTaskId);
          const uncertainWithoutId = error?.code === 'provider_submission_unknown'
            || error?.submissionUnknown === true;
          const failedCheckpoint = childCheckpoint(child, {
            index,
            attempt,
            startMs: planned.startMs,
            endMs: planned.endMs,
            status: child.status === 'failed'
              ? 'failed'
              : hasProviderTaskId || uncertainWithoutId
                ? 'submitted'
                : 'queued',
          });
          await persistStage({ stage: 'tts_generating', ttsGroups: [failedCheckpoint] }, durationMs);
          throw error;
        }
      }
      const groupCheckpoint = childCheckpoint(child, {
        index,
        attempt,
        startMs: planned.startMs,
        endMs: planned.endMs,
        status: 'succeeded',
        assetId,
        ...(Number.isInteger(actualDurationMs) && actualDurationMs > 0 ? { actualDurationMs } : {}),
      });
      durableGroups.push(groupCheckpoint);
      completedGroups.push({
        index,
        assetId,
        startMs: planned.startMs,
        endMs: planned.endMs,
        actualDurationMs,
      });
    }
    if (checkpoint.stage === 'translated' || checkpoint.stage === 'tts_generating') {
      await persistStage({
        stage: 'tts_generating',
        ttsGroups: durableGroups,
      }, durationMs);
    }

    let alignedAudio;
    if (checkpoint.stage === 'tts_generating') {
      const localGroups = [];
      for (const group of completedGroups) {
        const asset = await resolveIntoWorkRoot({
          assetId: group.assetId,
          fileName: `tts-${group.index}.wav`,
          kind: 'tts_audio',
        });
        localGroups.push({ ...group, audioPath: asset.path });
      }
      throwIfAborted(signal);
      const alignAudio = requireDependency(deps, 'alignAudio');
      const alignedPath = await prepareOutputPath('audio', 'aligned.wav');
      const aligned = await alignAudio({
        groups: localGroups,
        outputPath: alignedPath,
        totalDurationMs: durationMs,
        config,
        signal,
      });
      alignedAudio = await persistLocal(alignedPath, 'audio_aligned');
      const alignmentByIndex = new Map((aligned.groups || []).map((group) => [group.index, group]));
      const alignedCheckpoints = durableGroups.map((group) => {
        const alignment = alignmentByIndex.get(group.index);
        return {
          ...group,
          ...(alignment?.actualDurationMs ? { actualDurationMs: alignment.actualDurationMs } : {}),
          ...(alignment?.atempo ? { atempo: alignment.atempo } : {}),
        };
      });
      await persistStage({
        stage: 'audio_aligned',
        alignedAudioAssetId: alignedAudio.assetId,
        ttsGroups: alignedCheckpoints,
      }, durationMs);
    } else {
      alignedAudio = await resolveIntoWorkRoot({
        assetId: checkpoint.alignedAudioAssetId,
        fileName: 'aligned.wav',
        kind: 'aligned_audio',
      });
    }

    throwIfAborted(signal);
    const mixAudio = requireDependency(deps, 'mixAudio');
    const finalPath = await prepareOutputPath('result', 'voiceover-translated.mp4');
    await assertVoiceoverWorkPath(canonicalRoot, baseVideo.path, { mustExist: true });
    await assertVoiceoverWorkPath(canonicalRoot, background.path, { mustExist: true });
    await assertVoiceoverWorkPath(canonicalRoot, alignedAudio.path, { mustExist: true });
    await mixAudio({
      baseVideoPath: baseVideo.path,
      backgroundPath: background.path,
      narrationPath: alignedAudio.path,
      outputPath: finalPath,
      config,
      signal,
    });
    const finalAsset = await persistLocal(finalPath, 'result_persisted');
    await persistStage({
      stage: 'result_persisted',
      finalAssetId: finalAsset.assetId,
    }, durationMs);

    return {
      result: {
        videoUrl: finalAsset.url,
        sourceUrl: source.url,
        sourceLanguage: analysis.sourceLanguage,
        targetLanguage: translation.targetLanguage,
        translationMode: translation.mode,
        voiceName: translation.selectedVoiceName,
        sourceTranscript: transcript(analysis.segments, 'sourceText'),
        translatedTranscript: transcript(translation.segments, 'targetText'),
        voiceoverStage: 'result_persisted',
        finalAssetId: finalAsset.assetId,
      },
    };
  } catch (error) {
    primaryError = error;
    safelyLog(deps.logger, 'error', {
      event: 'voiceover_failed',
      jobId: job.id,
      stage: checkpoint?.stage,
      errorCode: error?.code,
    });
    const release = error?.releasePermitWhenClosed;
    if (release) {
      try {
        await (typeof release === 'function' ? release() : release);
      } catch {
        // The original process error remains authoritative.
      }
    }
    throw error;
  } finally {
    try {
      await cleanupWorkRoot(canonicalRoot || workRoot);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
}
