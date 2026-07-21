import { basename, dirname, extname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  createMediaTranscodeError,
  isMediaCompatibleForProfile,
  validateTranscodedOutput,
  validateTrimRange,
} from './mediaTranscodeContract.mjs';

function publicProbeFields(probe = {}) {
  return {
    durationSeconds: Number(probe.durationSeconds || 0),
    sizeBytes: Number(probe.sizeBytes || 0),
    formatNames: Array.isArray(probe.formatNames) ? probe.formatNames : [],
    videoCodec: probe.videoCodec || null,
    pixelFormat: probe.pixelFormat || null,
    audioCodec: probe.audioCodec || null,
    width: Number(probe.width || 0) || null,
    height: Number(probe.height || 0) || null,
    frameRate: Number(probe.frameRate || 0) || null,
    hasAudio: Boolean(probe.hasAudio),
  };
}

function publicSession(session) {
  return {
    sessionId: session.id,
    kind: session.kind,
    fileName: session.fileName,
    profile: session.profile,
    state: session.state,
    compatibleSource: Boolean(
      session.probe && isMediaCompatibleForProfile(session.profile, session.probe)
    ),
    ...publicProbeFields(session.probe),
  };
}

async function safeLog(log, entry) {
  try {
    await log?.(entry);
  } catch {
    // Diagnostic logging must never change the upload result.
  }
}

export function createMediaTranscodeApi({
  store,
  service,
  persistAsset,
  readSource = readFile,
  log = () => {},
} = {}) {
  if (!store || !service || typeof persistAsset !== 'function') {
    throw new TypeError('store, service, and persistAsset are required');
  }

  return {
    async createSession({ userId, kind, profile = 'seedance_reference', fileName, fileBuffer }) {
      const created = await store.create({ userId, kind, profile, fileName, fileBuffer, probe: null });
      try {
        const probe = await service.probe(created.sourcePath, kind);
        if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) {
          throw createMediaTranscodeError('media_probe_missing_duration', '无法读取媒体时长，请更换文件后重试');
        }
        if (kind === 'video' && (!probe.width || !probe.height || !probe.videoCodec)) {
          throw createMediaTranscodeError('media_probe_missing_video', '文件中没有可用的视频画面');
        }
        if (kind === 'audio' && !probe.audioCodec) {
          throw createMediaTranscodeError('media_probe_missing_audio', '文件中没有可用的音频轨道');
        }
        const ready = await store.updateProbe(created.id, userId, probe);
        await safeLog(log, {
          action: 'media_transcode_session_created',
          sessionId: ready.id,
          userId,
          kind,
          durationSeconds: probe.durationSeconds,
          sizeBytes: probe.sizeBytes,
        });
        return publicSession(ready);
      } catch (error) {
        await store.remove(created.id);
        await safeLog(log, {
          action: 'media_transcode_session_failed',
          sessionId: created.id,
          userId,
          kind,
          code: error?.code || 'media_probe_failed',
        });
        throw error;
      }
    },

    async convertSession({ userId, sessionId, startSeconds, endSeconds, module = 'video' }) {
      const session = await store.getOwned(sessionId, userId);
      const trim = validateTrimRange({
        profile: session.profile,
        durationSeconds: session.probe?.durationSeconds,
        startSeconds,
        endSeconds,
      });
      await store.markConverting(sessionId, userId);
      const outputPath = join(dirname(session.sourcePath), session.kind === 'video' ? 'converted.mp4' : 'converted.mp3');
      try {
        const sourceDuration = Number(session.probe?.durationSeconds || 0);
        const keepsWholeSource = Math.abs(trim.startSeconds) < 0.001
          && Math.abs(trim.endSeconds - sourceDuration) < 0.001;
        const compatibleSource = keepsWholeSource
          && isMediaCompatibleForProfile(session.profile, session.probe);
        const output = compatibleSource
          ? {
            fileBuffer: await readSource(session.sourcePath),
            metadata: session.probe,
            mimeType: session.kind === 'video' ? 'video/mp4' : 'audio/mpeg',
          }
          : await service.transcode({
            sessionId,
            kind: session.kind,
            profile: session.profile,
            inputPath: session.sourcePath,
            outputPath,
            ...trim,
            width: session.probe?.width,
            height: session.probe?.height,
            hasAudio: session.probe?.hasAudio,
          });
        validateTranscodedOutput(session.kind, output.metadata, session.profile);
        const sourceBaseName = basename(session.fileName, extname(session.fileName)).trim() || 'converted';
        const canonicalFileName = `${sourceBaseName}.${session.kind === 'video' ? 'mp4' : 'mp3'}`;
        const persisted = await persistAsset({
          userId,
          module,
          assetType: 'source',
          fileBuffer: output.fileBuffer,
          fileName: canonicalFileName,
          mimeType: output.mimeType,
          metadata: output.metadata,
        });
        await safeLog(log, {
          action: 'media_transcode_succeeded',
          sessionId,
          userId,
          kind: session.kind,
          durationSeconds: output.metadata.durationSeconds,
          sizeBytes: output.metadata.sizeBytes,
          transcoded: !compatibleSource,
        });
        return {
          ...persisted,
          kind: session.kind,
          fileName: canonicalFileName,
          mimeType: output.mimeType,
          profile: session.profile,
          transcoded: !compatibleSource,
          ...publicProbeFields(output.metadata),
        };
      } catch (error) {
        await safeLog(log, {
          action: 'media_transcode_failed',
          sessionId,
          userId,
          kind: session.kind,
          code: error?.code || 'media_transcode_failed',
        });
        throw error;
      } finally {
        await store.remove(sessionId);
      }
    },

    async cancelSession({ userId, sessionId }) {
      const session = await store.getOwned(sessionId, userId);
      const cancelled = await service.cancel(sessionId);
      await store.remove(sessionId);
      await safeLog(log, {
        action: 'media_transcode_cancelled',
        sessionId,
        userId,
        kind: session.kind,
      });
      return { cancelled: Boolean(cancelled) };
    },

    async status() {
      return { ...service.getStatus(), sessions: await store.count() };
    },

    readiness() {
      return service.checkReadiness();
    },
  };
}
