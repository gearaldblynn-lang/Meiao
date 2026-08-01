import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import mysql from 'mysql2/promise';

import {
  deleteStoredAssetFile,
  persistAssetFile,
  resolveStoredAssetPath,
} from '../server/assetStore.mjs';
import {
  probeVoiceoverAudio,
  runVoiceoverProcess,
  validateVoiceoverOutput,
} from '../server/voiceoverAudio.mjs';
import { resolvePackagedFfmpegPath } from '../server/mediaTranscodeService.mjs';
import {
  VOICEOVER_ALIGNMENT_VERSION,
  VOICEOVER_ANALYSIS_EVIDENCE_VERSION,
  getVoiceoverConfig,
  normalizeVoiceoverCheckpoint,
} from '../server/voiceoverContract.mjs';

export const ALIGNMENT_REPAIR_CONFIRM_ENV = 'MEIAO_VOICEOVER_ALIGNMENT_REPAIR_CONFIRM';
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REPAIR_FINGERPRINT = 'voiceover:semantic_alignment:manual_existing_tts_repair';

const repairError = (message, details = {}) => {
  const error = new Error(message);
  error.code = 'voiceover_alignment_repair_invalid';
  Object.assign(error, details);
  return error;
};

const assertSafeId = (value, label) => {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) throw repairError(`${label} 无效`);
  return normalized;
};

const clone = (value) => structuredClone(value);

const parseJsonObject = (value, label) => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw repairError(`${label} 不是有效 JSON`, { cause: error?.message });
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw repairError(`${label} 必须是对象`);
  }
  return parsed;
};

export function assertRepairConfirmation(env, parentJobId) {
  const expected = assertSafeId(parentJobId, 'parentJobId');
  if (String(env?.[ALIGNMENT_REPAIR_CONFIRM_ENV] || '').trim() !== expected) {
    const error = new Error(
      `生产修复被拦截：必须把 ${ALIGNMENT_REPAIR_CONFIRM_ENV} 精确设置为父任务 ID`,
    );
    error.code = 'voiceover_alignment_repair_confirmation_required';
    throw error;
  }
}

export function assertMatchingVideoStreamHashes(sourceHash, finalHash) {
  const source = String(sourceHash || '').trim().toLowerCase();
  const final = String(finalHash || '').trim().toLowerCase();
  if (!SHA256.test(source) || !SHA256.test(final) || source !== final) {
    throw repairError('校正视频改变了原始 H.264 画面码流');
  }
  return source;
}

const sha256VideoStream = async (filePath) => {
  const ffmpegPath = String(
    process.env.MEIAO_FFMPEG_PATH || resolvePackagedFfmpegPath(),
  ).trim();
  const { stdout } = await runVoiceoverProcess(ffmpegPath, [
    '-v', 'error',
    '-i', filePath,
    '-map', '0:v:0',
    '-c', 'copy',
    '-f', 'hash',
    '-hash', 'sha256',
    '-',
  ]);
  const match = String(stdout || '').match(/^SHA256=([a-f0-9]{64})$/imu);
  if (!match) throw repairError('无法读取视频 H.264 码流 SHA-256');
  return match[1].toLowerCase();
};

const assertAssetIdentity = (asset, label) => {
  const id = assertSafeId(asset?.id, `${label}.id`);
  const publicUrl = String(asset?.publicUrl || '').trim();
  if (!publicUrl) throw repairError(`${label}.publicUrl 缺失`);
  const contentHash = String(asset?.contentHash || '').trim().toLowerCase();
  if (contentHash && !SHA256.test(contentHash)) {
    throw repairError(`${label}.contentHash 无效`);
  }
  return { id, publicUrl, contentHash };
};

const assertRepairEvidence = ({
  parentJobId,
  currentResult,
  evidence,
}) => {
  const checkpoint = parseJsonObject(currentResult?.voiceoverCheckpoint, '当前检查点');
  if (
    checkpoint.stage !== 'result_persisted'
    || Number(checkpoint.analysisEvidenceVersion) >= VOICEOVER_ANALYSIS_EVIDENCE_VERSION
    || Number(checkpoint.analysisEvidenceVersion) <= 0
    || checkpoint.finalAssetId !== currentResult.finalAssetId
  ) {
    throw repairError('当前任务不是可修复的旧版已完成口播任务');
  }
  if (
    evidence.parentJobId !== parentJobId
    || evidence.sourceAssetId !== checkpoint.baseVideoAssetId
    || evidence.previousAlignedAssetId !== checkpoint.alignedAudioAssetId
    || evidence.previousFinalAssetId !== currentResult.finalAssetId
    || Number(evidence.analysisEvidenceVersion) !== VOICEOVER_ANALYSIS_EVIDENCE_VERSION
    || Number(evidence.providerCallsCreated) !== 0
    || evidence.sourceAudioIncludedInFinalMix !== false
    || evidence.backgroundAudioIncludedInFinalMix !== false
  ) {
    throw repairError('修复证据身份或零 provider/纯新口播合同不成立');
  }
  const analysisSegments = checkpoint.analysis?.segments;
  const translationSegments = checkpoint.translation?.segments;
  const groups = checkpoint.ttsGroups;
  const timing = evidence.timing;
  if (
    !Array.isArray(analysisSegments)
    || !Array.isArray(translationSegments)
    || !Array.isArray(groups)
    || !Array.isArray(timing)
    || timing.length === 0
    || timing.length !== analysisSegments.length
    || timing.length !== translationSegments.length
    || timing.length !== groups.length
  ) {
    throw repairError('修复证据分段数量不一致');
  }
  let previousEndMs = -1;
  const normalizedTiming = timing.map((item, index) => {
    const startMs = Number(item.targetStartMs);
    const endMs = Number(item.targetEndMs);
    const rawTtsDurationMs = Number(item.rawTtsDurationMs);
    const atempo = Number(item.atempo);
    const actualStartMs = Number(item.actualStartMs);
    const actualEndMs = Number(item.actualEndMs);
    const childJobId = String(item.childJobId || '');
    const providerTaskId = String(item.providerTaskId || '');
    const ttsAssetId = String(item.ttsAssetId || '');
    const ttsContentHash = String(item.ttsContentHash || '').toLowerCase();
    if (
      Number(item.index) !== index + 1
      || !Number.isInteger(startMs)
      || !Number.isInteger(endMs)
      || startMs < 0
      || endMs <= startMs
      || startMs < previousEndMs
      || !Number.isFinite(rawTtsDurationMs)
      || rawTtsDurationMs <= 0
      || !Number.isFinite(atempo)
      || atempo <= 0
      || !Number.isFinite(actualStartMs)
      || !Number.isFinite(actualEndMs)
      || actualStartMs < startMs
      || actualEndMs > endMs
      || actualEndMs <= actualStartMs
      || !SHA256.test(ttsContentHash)
    ) {
      throw repairError(`第 ${index + 1} 段时间证据无效`);
    }
    const analysis = analysisSegments[index];
    const translation = translationSegments[index];
    const group = groups[index];
    if (
      String(item.sourceText || '') !== String(analysis.sourceText || '')
      || String(item.sourceText || '') !== String(translation.sourceText || '')
      || String(item.translatedText || '') !== String(analysis.targetText || '')
      || String(item.translatedText || '') !== String(translation.targetText || '')
      || String(item.ttsText || '') !== String(translation.targetText || '')
      || Number(group.index) !== index
      || group.status !== 'succeeded'
      || group.childJobId !== childJobId
      || group.providerTaskId !== providerTaskId
      || group.assetId !== ttsAssetId
      || Number(group.actualDurationMs) !== rawTtsDurationMs
    ) {
      throw repairError(`第 ${index + 1} 段文本或 TTS 身份漂移`);
    }
    const expectedAtempo = rawTtsDurationMs / (endMs - startMs);
    if (Math.abs(expectedAtempo - atempo) > 0.000001) {
      throw repairError(`第 ${index + 1} 段 atempo 与时间窗不一致`);
    }
    previousEndMs = endMs;
    return {
      startMs,
      endMs,
      atempo,
      childJobId,
      providerTaskId,
      ttsAssetId,
      ttsContentHash,
      actionEvidence: String(item.actionEvidence || ''),
    };
  });
  return { checkpoint, normalizedTiming };
};

export function buildRepairedVoiceoverResult({
  parentJobId,
  currentResult,
  evidence,
  newAlignedAsset,
  newFinalAsset,
  repairedAt,
  videoStreamSha256,
}) {
  const normalizedParentJobId = assertSafeId(parentJobId, 'parentJobId');
  const current = parseJsonObject(currentResult, '当前结果');
  const repairEvidence = parseJsonObject(evidence, '修复证据');
  const alignedAsset = assertAssetIdentity(newAlignedAsset, 'newAlignedAsset');
  const finalAsset = assertAssetIdentity(newFinalAsset, 'newFinalAsset');
  const repairedAtMs = Number(repairedAt);
  if (!Number.isSafeInteger(repairedAtMs) || repairedAtMs <= 0) {
    throw repairError('修复时间无效');
  }
  const { checkpoint, normalizedTiming } = assertRepairEvidence({
    parentJobId: normalizedParentJobId,
    currentResult: current,
    evidence: repairEvidence,
  });
  const preservedVideoStreamHash = assertMatchingVideoStreamHashes(
    videoStreamSha256,
    videoStreamSha256,
  );
  const nextCheckpoint = clone(checkpoint);
  nextCheckpoint.analysisEvidenceVersion = VOICEOVER_ANALYSIS_EVIDENCE_VERSION;
  nextCheckpoint.alignmentVersion = VOICEOVER_ALIGNMENT_VERSION;
  nextCheckpoint.alignedAudioAssetId = alignedAsset.id;
  nextCheckpoint.finalAssetId = finalAsset.id;
  normalizedTiming.forEach((timing, index) => {
    Object.assign(nextCheckpoint.analysis.segments[index], {
      startMs: timing.startMs,
      endMs: timing.endMs,
    });
    Object.assign(nextCheckpoint.translation.segments[index], {
      startMs: timing.startMs,
      endMs: timing.endMs,
    });
    Object.assign(nextCheckpoint.ttsGroups[index], {
      startMs: timing.startMs,
      endMs: timing.endMs,
      atempo: timing.atempo,
    });
  });
  const durationMs = Math.max(
    ...checkpoint.analysis.segments.map((segment) => Number(segment.endMs || 0)),
  );
  const validatedCheckpoint = normalizeVoiceoverCheckpoint(nextCheckpoint, {
    durationMs,
    removeText: Boolean(nextCheckpoint.subtitleRemoval),
    minAtempo: getVoiceoverConfig(process.env).minAtempo,
    maxAtempo: getVoiceoverConfig(process.env).maxAtempo,
  });
  return {
    ...current,
    videoUrl: finalAsset.publicUrl,
    finalAssetId: finalAsset.id,
    voiceoverCheckpoint: validatedCheckpoint,
    voiceoverRepairEvidence: {
      version: 1,
      fingerprint: REPAIR_FINGERPRINT,
      repairedAt: repairedAtMs,
      previousFinalAssetId: current.finalAssetId,
      previousAlignedAudioAssetId: checkpoint.alignedAudioAssetId,
      finalAssetId: finalAsset.id,
      alignedAudioAssetId: alignedAsset.id,
      finalContentHash: finalAsset.contentHash,
      alignedContentHash: alignedAsset.contentHash,
      videoStreamSha256: preservedVideoStreamHash,
      providerCallsCreated: 0,
      sourceAudioIncludedInFinalMix: false,
      backgroundAudioIncludedInFinalMix: false,
      timing: normalizedTiming.map((item, index) => ({
        index: index + 1,
        startMs: item.startMs,
        endMs: item.endMs,
        atempo: item.atempo,
        childJobId: item.childJobId,
        ttsAssetId: item.ttsAssetId,
        ttsContentHash: item.ttsContentHash,
        actionEvidence: item.actionEvidence,
      })),
    },
  };
}

const parseArgs = (argv) => {
  const options = { apply: false, rollbackBackupPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      options.apply = true;
      continue;
    }
    const key = {
      '--parent-job-id': 'parentJobId',
      '--expected-final-asset-id': 'expectedFinalAssetId',
      '--aligned-path': 'alignedPath',
      '--final-path': 'finalPath',
      '--evidence-path': 'evidencePath',
      '--expected-aligned-sha256': 'expectedAlignedSha256',
      '--expected-final-sha256': 'expectedFinalSha256',
      '--rollback-backup': 'rollbackBackupPath',
    }[token];
    if (!key || index + 1 >= argv.length) throw repairError(`未知或缺值参数: ${token}`);
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
};

const sha256File = async (filePath) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const input = createReadStream(filePath);
  input.on('data', (chunk) => hash.update(chunk));
  input.once('error', reject);
  input.once('end', () => resolve(hash.digest('hex')));
});

const dbConfigFromEnv = (env) => {
  const config = {
    host: String(env.MEIAO_DB_HOST || '').trim(),
    port: Number(env.MEIAO_DB_PORT || 3306),
    user: String(env.MEIAO_DB_USER || '').trim(),
    password: String(env.MEIAO_DB_PASSWORD || ''),
    database: String(env.MEIAO_DB_NAME || '').trim(),
  };
  if (!config.host || !config.user || !config.database || !Number.isInteger(config.port)) {
    throw repairError('缺少生产 MySQL 配置');
  }
  return config;
};

const assetFromRow = (row) => ({
  id: String(row?.id || ''),
  userId: String(row?.user_id ?? row?.userId ?? ''),
  storageKey: String(row?.storage_key || ''),
  publicUrl: String(row?.public_url || ''),
  contentHash: String(row?.content_hash || ''),
  mimeType: String(row?.mime_type || ''),
  provider: String(row?.provider || ''),
  storageStatus: String(row?.storage_status || ''),
  jobId: String(row?.job_id || ''),
  expiresAt: Number(row?.expires_at || 0),
  deletedAt: row?.deleted_at ?? null,
});

const childFromRow = (row) => ({
  id: String(row?.id || ''),
  userId: String(row?.user_id ?? row?.userId ?? ''),
  module: String(row?.module || ''),
  taskType: String(row?.task_type ?? row?.taskType ?? ''),
  provider: String(row?.provider || ''),
  status: String(row?.status || ''),
  providerTaskId: String(row?.provider_task_id ?? row?.providerTaskId ?? ''),
  payload: parseJsonObject(row?.payload_json ?? row?.payload, 'TTS 子任务 payload'),
  result: parseJsonObject(row?.result_json ?? row?.result, 'TTS 子任务 result'),
});

const uniqueRowsById = (rows, label, mapper) => {
  const output = new Map();
  for (const row of rows || []) {
    const normalized = mapper(row);
    if (!normalized.id || output.has(normalized.id)) {
      throw repairError(`${label} 身份重复或缺失`);
    }
    output.set(normalized.id, normalized);
  }
  return output;
};

export function hydrateRepairEvidenceIdentities({
  currentResult,
  evidence,
  assetRows,
}) {
  const current = parseJsonObject(currentResult, '当前结果');
  const checkpoint = parseJsonObject(current.voiceoverCheckpoint, '当前检查点');
  const nextEvidence = clone(parseJsonObject(evidence, '修复证据'));
  const groups = checkpoint.ttsGroups;
  if (
    !Array.isArray(groups)
    || !Array.isArray(nextEvidence.timing)
    || groups.length === 0
    || nextEvidence.timing.length !== groups.length
  ) {
    throw repairError('修复证据与 TTS 分组数量不一致');
  }
  if (
    nextEvidence.previousAlignedAssetId
    && nextEvidence.previousAlignedAssetId !== checkpoint.alignedAudioAssetId
  ) {
    throw repairError('修复证据的旧对齐素材身份漂移');
  }
  const assets = uniqueRowsById(assetRows, '托管素材', assetFromRow);
  nextEvidence.previousAlignedAssetId = checkpoint.alignedAudioAssetId;
  nextEvidence.timing = nextEvidence.timing.map((item, index) => {
    const group = groups[index];
    const ttsAsset = assets.get(group?.assetId);
    const ttsContentHash = String(item?.ttsContentHash || '').trim().toLowerCase();
    if (
      !group
      || !ttsAsset
      || !SHA256.test(ttsContentHash)
      || ttsContentHash !== ttsAsset.contentHash
      || (item.childJobId && item.childJobId !== group.childJobId)
      || (item.providerTaskId && item.providerTaskId !== group.providerTaskId)
      || (item.ttsAssetId && item.ttsAssetId !== group.assetId)
    ) {
      throw repairError(`第 ${index + 1} 段 TTS 耐久身份或文件哈希漂移`);
    }
    return {
      ...item,
      ttsContentHash,
      childJobId: group.childJobId,
      providerTaskId: group.providerTaskId,
      ttsAssetId: group.assetId,
    };
  });
  return nextEvidence;
}

export function assertExistingRepairDependencies({
  parentJobId,
  job,
  ownerRows,
  currentResult,
  evidence,
  childRows,
  assetRows,
}) {
  const normalizedParentJobId = assertSafeId(parentJobId, 'parentJobId');
  const userId = assertSafeId(job?.user_id ?? job?.userId, 'parent.userId');
  if (
    String(job?.id || '') !== normalizedParentJobId
    || String(job?.module || '') !== 'video'
    || String(job?.task_type ?? job?.taskType ?? '') !== 'voiceover_translate_video'
    || String(job?.provider || '') !== 'internal'
    || String(job?.status || '') !== 'succeeded'
    || String(job?.provider_task_id ?? job?.providerTaskId ?? '') !== ''
  ) {
    throw repairError('父任务身份或终态已变化');
  }
  const owner = Array.isArray(ownerRows) && ownerRows.length === 1 ? ownerRows[0] : null;
  if (
    String(owner?.id || '') !== userId
    || String(owner?.status || '') !== 'active'
  ) {
    throw repairError('父任务账号不存在或已停用');
  }
  const { checkpoint, normalizedTiming } = assertRepairEvidence({
    parentJobId: normalizedParentJobId,
    currentResult: parseJsonObject(currentResult, '当前结果'),
    evidence: parseJsonObject(evidence, '修复证据'),
  });
  const groups = checkpoint.ttsGroups;
  const children = uniqueRowsById(childRows, 'TTS 子任务', childFromRow);
  if (children.size !== groups.length) throw repairError('TTS 子任务数量不一致');

  const expectedAssetIds = new Set([
    checkpoint.baseVideoAssetId,
    checkpoint.originalAudioAssetId,
    checkpoint.vocalAssetId,
    checkpoint.backgroundAssetId,
    checkpoint.alignedAudioAssetId,
    checkpoint.finalAssetId,
    checkpoint.subtitleRemoval?.resultAssetId,
    ...groups.map((group) => group.assetId),
  ].filter(Boolean));
  const assets = uniqueRowsById(assetRows, '托管素材', assetFromRow);
  if (assets.size !== expectedAssetIds.size) throw repairError('托管素材数量不一致');
  for (const assetId of expectedAssetIds) {
    const asset = assets.get(assetId);
    if (
      !asset
      || asset.userId !== userId
      || asset.storageStatus !== 'active'
      || asset.deletedAt !== null
      || !asset.storageKey
      || !asset.publicUrl
      || !SHA256.test(asset.contentHash)
    ) {
      throw repairError(`托管素材 ${assetId} 身份、所有权或可用状态无效`);
    }
  }

  groups.forEach((group, index) => {
    const child = children.get(group.childJobId);
    const timing = normalizedTiming[index];
    const expectedChildKey = `tts:${index}:attempt:${group.attempt}`;
    const expectedSubmissionKey = `voiceover-child:${normalizedParentJobId}:${expectedChildKey}`;
    const dialogueTurns = child?.payload?.dialogueTurns;
    const ttsAsset = assets.get(group.assetId);
    if (
      !child
      || child.userId !== userId
      || child.module !== 'video'
      || child.taskType !== 'kie_tts'
      || child.provider !== 'kie'
      || child.status !== 'succeeded'
      || child.providerTaskId !== group.providerTaskId
      || child.payload.executionOwner !== 'parent'
      || child.payload.parentJobId !== normalizedParentJobId
      || child.payload.childKey !== expectedChildKey
      || child.payload.clientSubmissionKey !== expectedSubmissionKey
      || Number(child.payload.groupIndex) !== index
      || child.payload.targetLanguage !== checkpoint.translation.targetLanguage
      || child.payload.voiceName !== checkpoint.translation.selectedVoiceName
      || !Array.isArray(dialogueTurns)
      || dialogueTurns.length !== 1
      || dialogueTurns[0]?.speaker !== 'Speaker 1'
      || dialogueTurns[0]?.text !== checkpoint.translation.segments[index].targetText
      || child.result.assetId !== group.assetId
      || child.result.audioUrl !== `managed://${group.assetId}`
      || ttsAsset?.provider !== 'kie'
      || ttsAsset?.jobId !== normalizedParentJobId
      || !ttsAsset?.mimeType.startsWith('audio/')
      || ttsAsset?.contentHash !== timing.ttsContentHash
    ) {
      throw repairError(`第 ${index + 1} 段已有 child/provider/TTS 素材身份漂移`);
    }
  });
  return { checkpoint, assets, children };
}

const readRepairInputs = async (connection, options, evidence, lock = false) => {
  const suffix = lock ? ' FOR UPDATE' : '';
  const [jobRows] = await connection.query(
    `SELECT * FROM internal_jobs WHERE id = ? LIMIT 1${suffix}`,
    [options.parentJobId],
  );
  const job = jobRows?.[0];
  if (
    !job
    || job.status !== 'succeeded'
    || job.task_type !== 'voiceover_translate_video'
    || job.provider_task_id
  ) {
    throw repairError('父任务不存在、未成功或不是本地编排的口播翻译任务');
  }
  const currentResult = parseJsonObject(job.result_json, '父任务结果');
  if (currentResult.finalAssetId !== options.expectedFinalAssetId) {
    throw repairError('父任务最终资产已变化，拒绝继续');
  }
  const checkpoint = parseJsonObject(currentResult.voiceoverCheckpoint, '父任务检查点');
  const childIds = checkpoint.ttsGroups?.map((group) => group.childJobId) || [];
  if (childIds.length === 0) throw repairError('父任务缺少 TTS 子任务');
  const assetIds = [
    checkpoint.baseVideoAssetId,
    checkpoint.originalAudioAssetId,
    checkpoint.vocalAssetId,
    checkpoint.backgroundAssetId,
    checkpoint.alignedAudioAssetId,
    checkpoint.finalAssetId,
    checkpoint.subtitleRemoval?.resultAssetId,
    ...checkpoint.ttsGroups.map((group) => group.assetId),
  ].filter(Boolean);
  const [ownerRows] = await connection.query(
    `SELECT id, status FROM users WHERE id = ? LIMIT 1${suffix}`,
    [job.user_id],
  );
  const [childRows] = await connection.query(
    `SELECT * FROM internal_jobs WHERE id IN (${childIds.map(() => '?').join(',')})${suffix}`,
    childIds,
  );
  const [assetRows] = await connection.query(
    `SELECT * FROM stored_assets WHERE id IN (${assetIds.map(() => '?').join(',')})${suffix}`,
    assetIds,
  );
  const hydratedEvidence = hydrateRepairEvidenceIdentities({
    currentResult,
    evidence,
    assetRows,
  });
  const { assets, children } = assertExistingRepairDependencies({
    parentJobId: options.parentJobId,
    job,
    ownerRows,
    currentResult,
    evidence: hydratedEvidence,
    childRows,
    assetRows,
  });
  return {
    job,
    currentResult,
    evidence: hydratedEvidence,
    children,
    sourceAsset: assets.get(checkpoint.baseVideoAssetId),
    previousAlignedAsset: assets.get(checkpoint.alignedAudioAssetId),
    previousFinalAsset: assets.get(checkpoint.finalAssetId),
  };
};

const validateFiles = async (inputs, options, evidence) => {
  const alignedPath = path.resolve(options.alignedPath);
  const finalPath = path.resolve(options.finalPath);
  const expectedAligned = String(options.expectedAlignedSha256 || '').toLowerCase();
  const expectedFinal = String(options.expectedFinalSha256 || '').toLowerCase();
  if (!SHA256.test(expectedAligned) || !SHA256.test(expectedFinal)) {
    throw repairError('必须提供两个合法的预期 SHA-256');
  }
  const [alignedHash, finalHash] = await Promise.all([
    sha256File(alignedPath),
    sha256File(finalPath),
  ]);
  if (alignedHash !== expectedAligned || finalHash !== expectedFinal) {
    throw repairError('上传文件 SHA-256 与本地验收值不一致');
  }
  const sourcePath = resolveStoredAssetPath(inputs.sourceAsset);
  const sourceMetadata = await probeVoiceoverAudio(sourcePath);
  const [
    alignedMetadata,
    finalMetadata,
    sourceVideoStreamHash,
    finalVideoStreamHash,
  ] = await Promise.all([
    probeVoiceoverAudio(alignedPath),
    validateVoiceoverOutput({
      path: finalPath,
      expectedDurationMs: sourceMetadata.durationMs,
      toleranceMs: getVoiceoverConfig(process.env).durationToleranceMs,
    }),
    sha256VideoStream(sourcePath),
    sha256VideoStream(finalPath),
  ]);
  const videoStreamSha256 = assertMatchingVideoStreamHashes(
    sourceVideoStreamHash,
    finalVideoStreamHash,
  );
  if (
    alignedMetadata.audioCodec !== 'pcm_s16le'
    || alignedMetadata.sampleRate !== 48_000
    || alignedMetadata.channels !== 1
    || Math.abs(alignedMetadata.durationMs - sourceMetadata.durationMs) > 100
  ) {
    throw repairError('校正 aligned WAV 媒体合同无效');
  }
  buildRepairedVoiceoverResult({
    parentJobId: options.parentJobId,
    currentResult: inputs.currentResult,
    evidence,
    newAlignedAsset: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      publicUrl: '/dry-run/aligned.wav',
      contentHash: alignedHash,
    },
    newFinalAsset: {
      id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      publicUrl: '/dry-run/final.mp4',
      contentHash: finalHash,
    },
    repairedAt: Date.now(),
    videoStreamSha256,
  });
  return {
    alignedPath,
    finalPath,
    alignedHash,
    finalHash,
    sourceMetadata,
    alignedMetadata,
    finalMetadata,
    videoStreamSha256,
  };
};

const publicBaseUrl = (value) => {
  const normalized = String(value || '').trim().replace(/\/+$/u, '');
  if (!/^https?:\/\//u.test(normalized)) throw repairError('MEIAO_PUBLIC_BASE_URL 无效');
  return normalized;
};

const createBackupPath = async (parentJobId, repairedAt) => {
  const directory = path.resolve('server/data/voiceover-repairs');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, `${parentJobId}-${repairedAt}.json`);
};

const applyRepair = async (pool, options, evidence, fileValidation) => {
  assertRepairConfirmation(process.env, options.parentJobId);
  const connection = await pool.getConnection();
  const createdAssets = [];
  let backupPath = '';
  try {
    await connection.beginTransaction();
    const inputs = await readRepairInputs(connection, options, evidence, true);
    const repairedAt = Date.now();
    backupPath = await createBackupPath(options.parentJobId, repairedAt);
    const persist = async ({
      sourcePath,
      assetType,
      originalName,
      mimeType,
      expiresAt,
      expectedSha256,
    }) => {
      const asset = await persistAssetFile({
        pool: connection,
        publicBaseUrl: publicBaseUrl(process.env.MEIAO_PUBLIC_BASE_URL),
        userId: inputs.job.user_id,
        module: 'video',
        assetType,
        originalName,
        mimeType,
        sourcePath,
        provider: 'internal',
        jobId: options.parentJobId,
        expiresAt,
        expectedSha256,
      });
      createdAssets.push(asset);
      return asset;
    };
    const newAlignedAsset = await persist({
      sourcePath: fileValidation.alignedPath,
      assetType: 'intermediate',
      originalName: 'voiceover-aligned-v3.wav',
      mimeType: 'audio/wav',
      expiresAt: inputs.previousAlignedAsset.expiresAt,
      expectedSha256: fileValidation.alignedHash,
    });
    const newFinalAsset = await persist({
      sourcePath: fileValidation.finalPath,
      assetType: 'result',
      originalName: 'voiceover-translated-v3.mp4',
      mimeType: 'video/mp4',
      expiresAt: inputs.previousFinalAsset.expiresAt,
      expectedSha256: fileValidation.finalHash,
    });
    const repairedResult = buildRepairedVoiceoverResult({
      parentJobId: options.parentJobId,
      currentResult: inputs.currentResult,
      evidence: inputs.evidence,
      newAlignedAsset,
      newFinalAsset,
      repairedAt,
      videoStreamSha256: fileValidation.videoStreamSha256,
    });
    const backup = {
      version: 1,
      parentJobId: options.parentJobId,
      createdAt: repairedAt,
      previousResultJson: inputs.job.result_json,
      previousUpdatedAt: Number(inputs.job.updated_at || 0),
      previousFinalAssetId: inputs.previousFinalAsset.id,
      previousAlignedAudioAssetId: inputs.previousAlignedAsset.id,
      appliedFinalAssetId: newFinalAsset.id,
      appliedAlignedAudioAssetId: newAlignedAsset.id,
    };
    await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const [update] = await connection.query(
      `UPDATE internal_jobs
       SET result_json = ?, updated_at = ?
       WHERE id = ? AND status = 'succeeded' AND result_json = ?`,
      [
        JSON.stringify(repairedResult),
        repairedAt,
        options.parentJobId,
        inputs.job.result_json,
      ],
    );
    if (Number(update?.affectedRows || 0) !== 1) {
      throw repairError('父任务结果在修复期间变化，已拒绝写入');
    }
    await connection.commit();
    return {
      mode: 'applied',
      parentJobId: options.parentJobId,
      previousFinalAssetId: inputs.previousFinalAsset.id,
      previousAlignedAudioAssetId: inputs.previousAlignedAsset.id,
      finalAssetId: newFinalAsset.id,
      alignedAudioAssetId: newAlignedAsset.id,
      backupPath,
      finalContentHash: newFinalAsset.contentHash,
      alignedContentHash: newAlignedAsset.contentHash,
      videoStreamSha256: fileValidation.videoStreamSha256,
      providerCallsCreated: 0,
    };
  } catch (error) {
    await connection.rollback().catch(() => null);
    await Promise.all(createdAssets.map((asset) => (
      deleteStoredAssetFile(asset.storageKey).catch(() => null)
    )));
    if (backupPath) await unlink(backupPath).catch(() => null);
    throw error;
  } finally {
    connection.release();
  }
};

const rollbackRepair = async (pool, options) => {
  assertRepairConfirmation(process.env, options.parentJobId);
  const backupPath = path.resolve(options.rollbackBackupPath);
  const backup = parseJsonObject(await readFile(backupPath, 'utf8'), '回滚备份');
  if (backup.parentJobId !== options.parentJobId) throw repairError('回滚备份任务身份不匹配');
  const previousResult = parseJsonObject(backup.previousResultJson, '回滚结果');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      'SELECT result_json FROM internal_jobs WHERE id = ? AND status = ? LIMIT 1 FOR UPDATE',
      [options.parentJobId, 'succeeded'],
    );
    const current = parseJsonObject(rows?.[0]?.result_json, '当前结果');
    if (
      current.finalAssetId !== backup.appliedFinalAssetId
      || current.voiceoverCheckpoint?.alignedAudioAssetId !== backup.appliedAlignedAudioAssetId
    ) {
      throw repairError('当前结果已变化，不能使用该备份回滚');
    }
    const updatedAt = Date.now();
    const [update] = await connection.query(
      'UPDATE internal_jobs SET result_json = ?, updated_at = ? WHERE id = ? AND result_json = ?',
      [JSON.stringify(previousResult), updatedAt, options.parentJobId, rows[0].result_json],
    );
    if (Number(update?.affectedRows || 0) !== 1) throw repairError('回滚写入未命中精确任务');
    await connection.commit();
    return {
      mode: 'rolled_back',
      parentJobId: options.parentJobId,
      restoredFinalAssetId: previousResult.finalAssetId,
      preservedRepairAssets: [
        backup.appliedFinalAssetId,
        backup.appliedAlignedAudioAssetId,
      ],
    };
  } catch (error) {
    await connection.rollback().catch(() => null);
    throw error;
  } finally {
    connection.release();
  }
};

export async function runWithRepairPool(pool, operation) {
  try {
    return await operation();
  } finally {
    await pool.end();
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  options.parentJobId = assertSafeId(options.parentJobId, 'parentJobId');
  const pool = mysql.createPool({
    ...dbConfigFromEnv(process.env),
    waitForConnections: true,
    connectionLimit: 2,
    queueLimit: 0,
  });
  return runWithRepairPool(pool, async () => {
    if (options.rollbackBackupPath) return rollbackRepair(pool, options);
    options.expectedFinalAssetId = assertSafeId(
      options.expectedFinalAssetId,
      'expectedFinalAssetId',
    );
    for (const [value, label] of [
      [options.alignedPath, 'alignedPath'],
      [options.finalPath, 'finalPath'],
      [options.evidencePath, 'evidencePath'],
    ]) {
      if (!path.isAbsolute(String(value || ''))) throw repairError(`${label} 必须是绝对路径`);
    }
    const evidence = parseJsonObject(await readFile(options.evidencePath, 'utf8'), '修复证据');
    const connection = await pool.getConnection();
    let inputs;
    try {
      inputs = await readRepairInputs(connection, options, evidence, false);
    } finally {
      connection.release();
    }
    const fileValidation = await validateFiles(inputs, options, inputs.evidence);
    if (!options.apply) {
      return {
        mode: 'dry_run',
        parentJobId: options.parentJobId,
        currentFinalAssetId: inputs.previousFinalAsset.id,
        currentAlignedAudioAssetId: inputs.previousAlignedAsset.id,
        finalContentHash: fileValidation.finalHash,
        alignedContentHash: fileValidation.alignedHash,
        finalMetadata: fileValidation.finalMetadata,
        alignedMetadata: fileValidation.alignedMetadata,
        videoStreamSha256: fileValidation.videoStreamSha256,
        providerCallsCreated: 0,
      };
    }
    return applyRepair(pool, options, inputs.evidence, fileValidation);
  });
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runCli()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        code: error?.code || 'voiceover_alignment_repair_failed',
        message: error?.message || String(error),
      })}\n`);
      process.exitCode = 1;
    });
}
