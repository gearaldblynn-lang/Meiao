import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

import {
  createMediaTranscodeError,
  normalizeMediaTranscodeProfile,
} from './mediaTranscodeContract.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeFileName(value) {
  const cleaned = basename(String(value || 'source').replaceAll('\0', '')).trim();
  return cleaned.slice(0, 180) || 'source';
}

function assertSessionId(sessionId) {
  if (!UUID_PATTERN.test(String(sessionId || ''))) {
    throw createMediaTranscodeError('media_session_invalid_id', '媒体处理会话编号无效');
  }
}

export function createMediaTranscodeSessionStore({
  rootDir,
  ttlMs = 30 * 60 * 1000,
  maxSessions = 20,
  clock = Date,
} = {}) {
  if (!rootDir) throw new TypeError('rootDir is required');
  const resolvedRoot = resolve(rootDir);
  const effectiveTtlMs = positiveInteger(ttlMs, 30 * 60 * 1000);
  const effectiveMaxSessions = positiveInteger(maxSessions, 20);
  const sessionLocks = new Map();
  const activeLeases = new Set();

  const withSessionLock = async (sessionId, operation) => {
    const previous = sessionLocks.get(sessionId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    sessionLocks.set(sessionId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId);
    }
  };

  const sessionDirectory = (sessionId) => {
    assertSessionId(sessionId);
    const directory = resolve(resolvedRoot, sessionId);
    if (!directory.startsWith(`${resolvedRoot}${sep}`)) {
      throw createMediaTranscodeError('media_session_invalid_id', '媒体处理会话编号无效');
    }
    return directory;
  };

  const sidecarPath = (sessionId) => join(sessionDirectory(sessionId), 'session.json');
  const hydrate = (record) => ({
    ...record,
    profile: normalizeMediaTranscodeProfile(record.profile),
    sourcePath: join(sessionDirectory(record.id), 'source'),
  });

  const writeSidecar = async (record) => {
    const target = sidecarPath(record.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  };

  const readSidecar = async (sessionId) => {
    try {
      return JSON.parse(await readFile(sidecarPath(sessionId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw createMediaTranscodeError('media_session_not_found', '媒体处理会话不存在或已过期');
      }
      throw error;
    }
  };

  const remove = async (sessionId) => {
    const directory = sessionDirectory(sessionId);
    try {
      try {
        await stat(directory);
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
      await rm(directory, { recursive: true, force: true });
      return true;
    } finally {
      activeLeases.delete(sessionId);
    }
  };

  const isExpired = (sessionId, record) => !activeLeases.has(sessionId)
    && Number(record.updatedAt || record.createdAt || 0) + effectiveTtlMs <= clock.now();

  const cleanupExpired = async () => {
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const entries = await readdir(resolvedRoot, { withFileTypes: true });
    let removed = 0;
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      if (!UUID_PATTERN.test(entry.name)) return;
      await withSessionLock(entry.name, async () => {
        try {
          const record = await readSidecar(entry.name);
          if (isExpired(entry.name, record) && await remove(entry.name)) {
            removed += 1;
          }
        } catch (error) {
          if (error?.code === 'media_session_not_found' && await remove(entry.name)) removed += 1;
        }
      });
    }));
    return { removed };
  };

  const count = async () => {
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const entries = await readdir(resolvedRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name)).length;
  };

  const getOwned = async (sessionId, userId) => {
    const record = await readSidecar(sessionId);
    if (record.userId !== userId) {
      throw createMediaTranscodeError('media_session_forbidden', '无权访问这个媒体处理会话');
    }
    if (isExpired(sessionId, record)) {
      await remove(sessionId);
      throw createMediaTranscodeError('media_session_expired', '媒体处理会话已过期，请重新上传');
    }
    return hydrate(record);
  };

  const updateOwned = async (sessionId, userId, changes) => withSessionLock(sessionId, async () => {
    const current = await getOwned(sessionId, userId);
    const { sourcePath: _sourcePath, ...record } = current;
    const next = { ...record, ...changes, updatedAt: clock.now() };
    await writeSidecar(next);
    return hydrate(next);
  });

  const transitionOwned = async (sessionId, userId, fromStates, nextState, { acquireLease = false } = {}) => withSessionLock(sessionId, async () => {
    const current = await getOwned(sessionId, userId);
    if (!fromStates.includes(current.state)) {
      if (current.state === 'cancelled') {
        throw createMediaTranscodeError('media_transcode_cancelled', '媒体转码已取消');
      }
      throw createMediaTranscodeError('media_session_busy', '媒体处理会话正在执行其他操作');
    }
    const { sourcePath: _sourcePath, ...record } = current;
    const next = { ...record, state: nextState, updatedAt: clock.now() };
    await writeSidecar(next);
    if (acquireLease) activeLeases.add(sessionId);
    return hydrate(next);
  });

  return {
    async create({ userId, kind, profile = 'seedance_reference', fileName, fileBuffer, probe = null }) {
      if (!userId) throw createMediaTranscodeError('media_session_invalid_owner', '无法确认媒体处理会话所属用户');
      if (kind !== 'video' && kind !== 'audio') {
        throw createMediaTranscodeError('media_kind_unsupported', '仅支持视频或音频转码');
      }
      const normalizedProfile = normalizeMediaTranscodeProfile(profile);
      if (normalizedProfile === 'subtitle_removal' && kind !== 'video') {
        throw createMediaTranscodeError('media_kind_unsupported', '去字幕功能仅支持视频');
      }
      if (normalizedProfile === 'voiceover_translation' && kind !== 'video') {
        throw createMediaTranscodeError('media_kind_unsupported', '口播翻译功能仅支持视频');
      }
      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        throw createMediaTranscodeError('media_source_empty', '上传的媒体文件为空');
      }
      await cleanupExpired();
      if (await count() >= effectiveMaxSessions) {
        throw createMediaTranscodeError('media_session_capacity_reached', '当前媒体处理任务较多，请稍后再试');
      }

      const id = randomUUID();
      const directory = sessionDirectory(id);
      await mkdir(directory, { recursive: false, mode: 0o700 });
      const now = clock.now();
      const record = {
        id,
        userId,
        kind,
        profile: normalizedProfile,
        fileName: sanitizeFileName(fileName),
        createdAt: now,
        updatedAt: now,
        state: probe ? 'ready' : 'probing',
        probe,
      };
      try {
        await writeFile(join(directory, 'source'), fileBuffer, { mode: 0o600 });
        await writeSidecar(record);
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      return hydrate(record);
    },

    getOwned,

    updateProbe(sessionId, userId, probe) {
      return updateOwned(sessionId, userId, { probe, state: 'ready' });
    },

    markConverting(sessionId, userId) {
      return transitionOwned(sessionId, userId, ['ready'], 'converting', { acquireLease: true });
    },

    claimConversion(sessionId, userId) {
      return transitionOwned(sessionId, userId, ['ready'], 'converting', { acquireLease: true });
    },

    beginPersisting(sessionId, userId) {
      return transitionOwned(sessionId, userId, ['converting'], 'persisting');
    },

    requestCancel(sessionId, userId) {
      return withSessionLock(sessionId, async () => {
        const current = await getOwned(sessionId, userId);
        if (current.state === 'persisting') {
          return { cancelled: false, remove: false, session: current };
        }
        if (current.state === 'cancelled') {
          return { cancelled: true, remove: false, session: current };
        }
        const { sourcePath: _sourcePath, ...record } = current;
        const next = { ...record, state: 'cancelled', updatedAt: clock.now() };
        await writeSidecar(next);
        return {
          cancelled: true,
          remove: current.state === 'ready' || current.state === 'probing',
          session: hydrate(next),
        };
      });
    },

    remove,
    cleanupExpired,
    count,

    async destroy() {
      try {
        await rm(resolvedRoot, { recursive: true, force: true });
      } finally {
        activeLeases.clear();
      }
    },
  };
}
