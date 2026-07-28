import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import {
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  getVoiceoverLanguage,
  getVoiceoverVoice,
} from '../src/utils/voiceoverCatalog.mjs';

const DEFAULT_CACHE_TTL_MS = 0;
const MAX_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CACHE_TTL_MS = 60 * 60 * 1000;
const SPEAKER = 'Speaker 1';

const PREVIEW_TEXT = Object.freeze({
  cmn: '你好，这是一段口播音色试听。',
  en: 'Hello, this is a short voice preview.',
  ja: 'こんにちは、音声サンプルをお聞きください。',
  ko: '안녕하세요. 음성 미리 듣기입니다.',
  es: 'Hola, esta es una breve muestra de voz.',
  pt: 'Olá, esta é uma breve amostra de voz.',
  fr: 'Bonjour, voici un court aperçu de la voix.',
  de: 'Hallo, dies ist eine kurze Stimmvorschau.',
  ar: 'مرحبًا، هذه معاينة صوتية قصيرة.',
  ru: 'Здравствуйте, это короткий пример голоса.',
});

const parseCacheTtlMs = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === '0') return DEFAULT_CACHE_TTL_MS;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed >= MIN_CACHE_TTL_MS && parsed <= MAX_CACHE_TTL_MS
    ? parsed
    : DEFAULT_CACHE_TTL_MS;
};

const createPreviewError = (code, message, statusCode = 400, extras = {}) => (
  Object.assign(new Error(message), { code, statusCode, ...extras })
);

const normalizeInput = ({ userId, targetLanguage, voiceName } = {}) => {
  const normalizedUserId = String(userId || '').trim();
  const normalizedLanguage = String(targetLanguage || '').trim();
  const normalizedVoice = String(voiceName || '').trim();
  if (!normalizedUserId || !getVoiceoverLanguage(normalizedLanguage) || !getVoiceoverVoice(normalizedVoice)) {
    throw createPreviewError('voiceover_preview_invalid', '试听语言或音色无效');
  }
  return {
    userId: normalizedUserId,
    targetLanguage: normalizedLanguage,
    voiceName: normalizedVoice,
  };
};

const buildPreviewId = ({ userId, targetLanguage, voiceName }) => (
  `voice-preview-${createHash('sha256')
    .update(`${userId}\0${targetLanguage}\0${voiceName}`)
    .digest('hex')
    .slice(0, 24)}`
);

const normalizeRegistry = (value) => ({
  records: Array.isArray(value?.records)
    ? value.records.filter((record) => record && typeof record === 'object')
    : [],
});

const toPublicRecord = (record) => ({
  previewId: record.previewId,
  status: record.status,
  voiceName: record.voiceName,
  targetLanguage: record.targetLanguage,
  ...(record.status === 'ready' && record.audioUrl ? { audioUrl: record.audioUrl } : {}),
  ...(record.message ? { message: record.message } : {}),
});

const buildProviderJob = (record) => ({
  id: record.previewId,
  taskType: 'kie_tts',
  provider: 'kie',
  ...(record.providerTaskId ? { providerTaskId: record.providerTaskId } : {}),
  payload: {
    executionOwner: 'parent',
    parentJobId: record.previewId,
    childKey: 'tts:0:attempt:0',
    groupIndex: 0,
    targetLanguage: record.targetLanguage,
    voiceName: record.voiceName,
    dialogueTurns: [{
      speaker: SPEAKER,
      text: PREVIEW_TEXT[record.targetLanguage] || PREVIEW_TEXT.en,
    }],
    temperature: 0.7,
    scene: 'A clean studio recording for a short voice preview.',
    sampleContext: 'One narrator speaks a short neutral sentence so the listener can compare timbre.',
  },
});

const safeFailureMessage = (error) => {
  if (error?.code === 'provider_balance_insufficient') return 'KIE 余额不足，暂时无法生成试听';
  if (error?.code === 'provider_auth_invalid') return 'KIE 语音服务未正确配置';
  if (error?.code === 'provider_rate_limited') return '试听请求过于频繁，请稍后再试';
  if (error?.code === 'provider_submission_unknown') {
    return '上游提交结果未知，为避免重复扣费，本次不会自动重提';
  }
  return String(error?.message || '音色试听生成失败').slice(0, 240);
};

export const createVoiceoverPreviewService = ({
  rootDir,
  env = process.env,
  executeProviderJob,
  persistAudio,
  ensureAudioPersistent = async () => {},
  now = Date.now,
  log = () => {},
} = {}) => {
  if (!rootDir || typeof executeProviderJob !== 'function' || typeof persistAudio !== 'function') {
    throw createPreviewError('voiceover_preview_unavailable', '音色试听服务依赖未就绪', 503);
  }
  mkdirSync(rootDir, { recursive: true });
  const registryPath = path.join(rootDir, 'registry.json');
  let registry = { records: [] };
  if (existsSync(registryPath)) {
    try {
      registry = normalizeRegistry(JSON.parse(readFileSync(registryPath, 'utf8')));
    } catch {
      registry = { records: [] };
    }
  }

  const cacheTtlMs = parseCacheTtlMs(env.MEIAO_VOICEOVER_PREVIEW_CACHE_TTL_MS);
  const inFlight = new Map();
  let mutationTail = Promise.resolve();

  const persistRegistry = async () => {
    const temporaryPath = `${registryPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(registry, null, 2), { mode: 0o600 });
    await rename(temporaryPath, registryPath);
  };

  const mutate = (operation) => {
    const run = mutationTail.then(operation, operation);
    mutationTail = run.then(() => undefined, () => undefined);
    return run;
  };

  const pinReadyRecord = async (record) => {
    if (record?.status !== 'ready' || !record.audioUrl) return;
    await ensureAudioPersistent({
      userId: record.userId,
      previewId: record.previewId,
      voiceName: record.voiceName,
      targetLanguage: record.targetLanguage,
      audioUrl: record.audioUrl,
    });
  };

  const schedule = (previewId) => {
    if (inFlight.has(previewId)) return;
    const work = (async () => {
      const initial = registry.records.find((item) => item.previewId === previewId);
      if (!initial || initial.status !== 'processing') return;
      try {
        const output = await executeProviderJob(
          buildProviderJob(initial),
          env,
          new AbortController().signal,
          {
            onProviderTaskId: async (providerTaskId) => {
              await mutate(async () => {
                const current = registry.records.find((item) => item.previewId === previewId);
                if (!current || current.status !== 'processing') return;
                current.providerTaskId = String(providerTaskId || '').trim();
                current.updatedAt = now();
                await persistRegistry();
              });
            },
          },
        );
        const remoteUrl = String(output?.result?.audioUrl || '').trim();
        if (!remoteUrl) {
          throw createPreviewError('voiceover_preview_missing_audio', '语音服务没有返回试听音频', 502);
        }
        const audioUrl = String(await persistAudio({
          userId: initial.userId,
          previewId,
          voiceName: initial.voiceName,
          targetLanguage: initial.targetLanguage,
          remoteUrl,
        }) || '').trim();
        if (!audioUrl) {
          throw createPreviewError('voiceover_preview_persist_failed', '试听音频保存失败', 502);
        }
        await mutate(async () => {
          const current = registry.records.find((item) => item.previewId === previewId);
          if (!current) return;
          current.status = 'ready';
          current.audioUrl = audioUrl;
          current.message = '';
          current.providerTaskId = String(output?.providerTaskId || current.providerTaskId || '').trim();
          current.readyAt = now();
          current.updatedAt = current.readyAt;
          await persistRegistry();
        });
      } catch (error) {
        await mutate(async () => {
          const current = registry.records.find((item) => item.previewId === previewId);
          if (!current) return;
          current.status = error?.code === 'provider_submission_unknown' ? 'unknown' : 'failed';
          current.message = safeFailureMessage(error);
          current.providerTaskId = String(error?.providerTaskId || current.providerTaskId || '').trim();
          current.updatedAt = now();
          await persistRegistry();
        });
        log({
          level: 'warn',
          action: 'voice_preview_failed',
          previewId,
          code: String(error?.code || ''),
          message: safeFailureMessage(error),
        });
      } finally {
        inFlight.delete(previewId);
      }
    })();
    inFlight.set(previewId, work);
  };

  const request = async (input) => {
    const normalized = normalizeInput(input);
    const previewId = buildPreviewId(normalized);
    let shouldSchedule = false;
    const result = await mutate(async () => {
      const existing = registry.records.find((item) => item.previewId === previewId);
      const cacheFresh = existing?.status === 'ready'
        && existing.audioUrl
        && (cacheTtlMs === 0 || now() - Number(existing.readyAt || 0) < cacheTtlMs);
      if (cacheFresh || existing?.status === 'processing' || existing?.status === 'unknown') {
        return toPublicRecord(existing);
      }
      const otherActive = registry.records.find((item) => (
        item.userId === normalized.userId
        && item.previewId !== previewId
        && item.status === 'processing'
      ));
      if (otherActive) {
        throw createPreviewError(
          'voiceover_preview_busy',
          '请等待当前音色试听生成完成',
          409,
        );
      }
      const timestamp = now();
      const nextRecord = {
        ...normalized,
        previewId,
        status: 'processing',
        providerTaskId: '',
        audioUrl: '',
        message: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (existing) {
        Object.assign(existing, nextRecord);
      } else {
        registry.records.push(nextRecord);
      }
      await persistRegistry();
      shouldSchedule = true;
      return toPublicRecord(existing || nextRecord);
    });
    if (shouldSchedule) schedule(previewId);
    if (result.status === 'ready') {
      await ensureAudioPersistent({
        ...normalized,
        previewId: result.previewId,
        audioUrl: result.audioUrl,
      });
    }
    return result;
  };

  const get = async ({ userId, previewId } = {}) => {
    const normalizedUserId = String(userId || '').trim();
    const normalizedPreviewId = String(previewId || '').trim();
    const record = registry.records.find((item) => (
      item.previewId === normalizedPreviewId && item.userId === normalizedUserId
    ));
    if (!record) {
      throw createPreviewError('voiceover_preview_not_found', '试听任务不存在', 404);
    }
    await pinReadyRecord(record);
    return toPublicRecord(record);
  };

  for (const record of registry.records) {
    if (record.status === 'ready' && record.audioUrl) {
      queueMicrotask(() => {
        void pinReadyRecord(record).catch((error) => {
          log({
            level: 'warn',
            action: 'voice_preview_pin_failed',
            previewId: record.previewId,
            code: String(error?.code || ''),
            message: String(error?.message || '试听音频永久化失败').slice(0, 240),
          });
        });
      });
    } else if (record.status === 'processing' && record.providerTaskId) {
      queueMicrotask(() => schedule(record.previewId));
    } else if (record.status === 'processing') {
      record.status = 'unknown';
      record.message = '上次试听提交状态未知，为避免重复扣费，本次不会自动重提';
    }
  }

  return { request, get };
};
