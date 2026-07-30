import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadServerEnvFile } from '../server/envLoader.mjs';
import { executeProviderJob as defaultExecuteProviderJob } from '../server/providerGateway.mjs';
import {
  VOICEOVER_PREVIEW_LANGUAGE,
  VOICEOVER_PREVIEW_LIBRARY_VERSION,
  VOICEOVER_PREVIEW_SAMPLE_TEXT,
  createEmptyVoiceoverPreviewManifest,
  detectVoiceoverPreviewAudio,
  validateVoiceoverPreviewManifest,
  writeVoiceoverPreviewJsonAtomic,
} from '../server/voiceoverPreviewLibrary.mjs';
import { VOICEOVER_VOICES } from '../src/utils/voiceoverCatalog.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_VERSION = 1;
const MAX_DOWNLOAD_BYTES_DEFAULT = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS_DEFAULT = 60_000;

const generationError = (code, message, extras = {}) => Object.assign(
  new Error(message || '系统音色试听库生成失败'),
  { code, ...extras },
);

const parseBoundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};

const confirmed = (env) => String(
  env?.MEIAO_VOICE_PREVIEW_LIBRARY_CONFIRM || '',
).trim() === '1';

const readJson = async (filePath, fallback) => {
  if (!existsSync(filePath)) return structuredClone(fallback);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
};

const normalizeManifest = (value) => {
  const empty = createEmptyVoiceoverPreviewManifest();
  if (value?.version !== empty.version
    || value?.model !== empty.model
    || value?.language !== empty.language
    || value?.sampleText !== empty.sampleText
    || !Array.isArray(value?.voices)) {
    return empty;
  }
  return {
    ...empty,
    voices: value.voices.filter((entry) => entry && typeof entry === 'object'),
  };
};

const normalizeLedger = (value) => ({
  version: LEDGER_VERSION,
  voices: value?.version === LEDGER_VERSION
    && value?.voices
    && typeof value.voices === 'object'
    && !Array.isArray(value.voices)
    ? value.voices
    : {},
});

export const buildVoiceoverPreviewProviderJob = (
  voice,
  groupIndex,
  providerTaskId = '',
) => ({
  id: `system-voice-preview-${voice.name}`,
  provider: 'kie',
  taskType: 'kie_tts',
  ...(providerTaskId ? { providerTaskId } : {}),
  payload: {
    executionOwner: 'parent',
    parentJobId: `system-voice-preview-library-v${VOICEOVER_PREVIEW_LIBRARY_VERSION}`,
    childKey: `tts:${groupIndex}:attempt:0`,
    groupIndex,
    targetLanguage: VOICEOVER_PREVIEW_LANGUAGE,
    voiceName: voice.name,
    dialogueTurns: [{
      speaker: 'Speaker 1',
      text: VOICEOVER_PREVIEW_SAMPLE_TEXT,
    }],
    temperature: 0.7,
    scene: 'A clean studio recording for a short Mandarin voice preview.',
    sampleContext: 'One narrator speaks the same neutral sentence so listeners can compare timbre.',
  },
});

const writeBinaryAtomic = async (filePath, bytes) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, bytes, { mode: 0o644 });
  await rename(temporaryPath, filePath);
};

const downloadAudio = async ({
  remoteUrl,
  fetchImpl,
  timeoutMs,
  maxBytes,
}) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(remoteUrl || ''));
  } catch {
    throw generationError('voiceover_preview_download_url_invalid', 'KIE 没有返回安全的试听地址');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw generationError('voiceover_preview_download_url_invalid', 'KIE 没有返回安全的试听地址');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(parsedUrl, { signal: controller.signal });
    if (!response?.ok) {
      throw generationError(
        'voiceover_preview_download_failed',
        `试听音频下载失败（HTTP ${Number(response?.status || 0)}）`,
      );
    }
    const declaredBytes = Number(response.headers?.get?.('content-length') || 0);
    if (declaredBytes > maxBytes) {
      throw generationError('voiceover_preview_download_too_large', '试听音频超过单文件大小上限');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw generationError('voiceover_preview_download_too_large', '试听音频超过单文件大小上限');
    }
    const audio = detectVoiceoverPreviewAudio(
      bytes,
      response.headers?.get?.('content-type') || '',
    );
    return { bytes, ...audio };
  } catch (error) {
    if (error?.code) throw error;
    throw generationError(
      'voiceover_preview_download_failed',
      error?.name === 'AbortError' ? '试听音频下载超时' : '试听音频下载失败',
    );
  } finally {
    clearTimeout(timer);
  }
};

export async function generateVoiceoverPreviewLibrary({
  rootDir = SCRIPT_ROOT,
  env = process.env,
  catalog = VOICEOVER_VOICES,
  log = () => {},
  deps = {},
} = {}) {
  const publicDir = path.join(rootDir, 'public');
  const libraryDir = path.join(publicDir, 'voiceover-previews');
  const manifestPath = path.join(libraryDir, 'manifest.json');
  const ledgerPath = path.join(rootDir, 'server', 'data', 'voiceover-preview-library-ledger.json');
  const executeProviderJob = deps.executeProviderJob || defaultExecuteProviderJob;
  const fetchImpl = deps.fetchImpl || fetch;
  const concurrency = parseBoundedInteger(
    env.MEIAO_VOICE_PREVIEW_LIBRARY_CONCURRENCY,
    1,
    1,
    2,
  );
  const timeoutMs = parseBoundedInteger(
    env.MEIAO_VOICE_PREVIEW_LIBRARY_DOWNLOAD_TIMEOUT_MS,
    DOWNLOAD_TIMEOUT_MS_DEFAULT,
    5_000,
    300_000,
  );
  const maxBytes = parseBoundedInteger(
    env.MEIAO_VOICE_PREVIEW_LIBRARY_MAX_BYTES,
    MAX_DOWNLOAD_BYTES_DEFAULT,
    1024,
    100 * 1024 * 1024,
  );

  await mkdir(libraryDir, { recursive: true });
  const manifest = normalizeManifest(await readJson(
    manifestPath,
    createEmptyVoiceoverPreviewManifest(),
  ));
  const ledger = normalizeLedger(await readJson(ledgerPath, {
    version: LEDGER_VERSION,
    voices: {},
  }));
  const initialValidation = validateVoiceoverPreviewManifest({
    manifest,
    libraryDir,
  });
  const readyAtStart = new Set(
    catalog
      .map((voice) => voice.name)
      .filter((voiceName) => initialValidation.previewUrlsByVoice[voiceName]),
  );
  const pendingVoices = catalog.filter((voice) => !readyAtStart.has(voice.name));

  for (const voice of pendingVoices) {
    const record = ledger.voices[voice.name] || {};
    if (!record.providerTaskId && ['submitting', 'unknown'].includes(record.status)) {
      throw generationError(
        'voiceover_preview_submission_unknown',
        `${voice.name} 上次提交状态未知，为避免重复扣费已停止自动重提`,
        { voiceName: voice.name },
      );
    }
  }
  const paidCreateCount = pendingVoices.filter((voice) => (
    !String(ledger.voices[voice.name]?.providerTaskId || '').trim()
  )).length;
  if (paidCreateCount > 0 && !confirmed(env)) {
    throw generationError(
      'voiceover_preview_generation_confirmation_required',
      `还需创建 ${paidCreateCount} 个 KIE 试听任务；确认后才会提交`,
      { remaining: paidCreateCount },
    );
  }

  let mutationTail = Promise.resolve();
  const mutate = (operation) => {
    const run = mutationTail.then(operation, operation);
    mutationTail = run.then(() => undefined, () => undefined);
    return run;
  };
  const persistLedger = () => writeVoiceoverPreviewJsonAtomic(
    ledgerPath,
    ledger,
    { mode: 0o600 },
  );
  const persistManifest = () => writeVoiceoverPreviewJsonAtomic(
    manifestPath,
    manifest,
    { mode: 0o644 },
  );
  const updateManifestEntry = (nextEntry) => {
    const entriesByName = new Map(
      manifest.voices.map((entry) => [String(entry?.name || ''), entry]),
    );
    entriesByName.set(nextEntry.name, nextEntry);
    manifest.voices = catalog
      .map((voice) => entriesByName.get(voice.name))
      .filter(Boolean);
  };

  let generated = 0;
  let nextIndex = 0;
  let fatalError = null;
  const processVoice = async (voice) => {
    const groupIndex = VOICEOVER_VOICES.findIndex((entry) => entry.name === voice.name);
    if (groupIndex < 0 || groupIndex > 99) {
      throw generationError('voiceover_preview_catalog_invalid', '音色目录索引无效', {
        voiceName: voice.name,
      });
    }
    const existingRecord = ledger.voices[voice.name] || {};
    let providerTaskId = String(existingRecord.providerTaskId || '').trim();
    if (!providerTaskId) {
      await mutate(async () => {
        ledger.voices[voice.name] = {
          status: 'submitting',
          providerTaskId: '',
          updatedAt: Date.now(),
        };
        await persistLedger();
      });
    }
    log({ voiceName: voice.name, status: providerTaskId ? 'resuming' : 'submitting' });
    try {
      const output = await executeProviderJob(
        buildVoiceoverPreviewProviderJob(voice, groupIndex, providerTaskId),
        env,
        new AbortController().signal,
        {
          onProviderTaskId: async (nextProviderTaskId) => {
            providerTaskId = String(nextProviderTaskId || '').trim();
            if (!providerTaskId) {
              throw generationError(
                'voiceover_preview_checkpoint_invalid',
                'KIE TTS 没有返回可持久化的任务编号',
              );
            }
            await mutate(async () => {
              ledger.voices[voice.name] = {
                status: 'processing',
                providerTaskId,
                updatedAt: Date.now(),
              };
              await persistLedger();
            });
          },
        },
      );
      providerTaskId = String(output?.providerTaskId || providerTaskId).trim();
      const remoteUrl = String(output?.result?.audioUrl || '').trim();
      if (!remoteUrl) {
        throw generationError(
          'voiceover_preview_audio_missing',
          'KIE TTS 完成但没有返回试听音频',
        );
      }
      const downloaded = await downloadAudio({
        remoteUrl,
        fetchImpl,
        timeoutMs,
        maxBytes,
      });
      const file = `${voice.name}.${downloaded.extension}`;
      await writeBinaryAtomic(path.join(libraryDir, file), downloaded.bytes);
      const entry = {
        name: voice.name,
        file,
        contentType: downloaded.contentType,
        bytes: downloaded.bytes.length,
        sha256: createHash('sha256').update(downloaded.bytes).digest('hex'),
      };
      await mutate(async () => {
        updateManifestEntry(entry);
        ledger.voices[voice.name] = {
          status: 'ready',
          providerTaskId,
          file,
          updatedAt: Date.now(),
        };
        await persistManifest();
        await persistLedger();
      });
      generated += 1;
      log({ voiceName: voice.name, status: 'ready' });
    } catch (error) {
      await mutate(async () => {
        const checkpointId = String(error?.providerTaskId || providerTaskId || '').trim();
        ledger.voices[voice.name] = {
          status: error?.code === 'provider_submission_unknown' ? 'unknown' : 'failed',
          providerTaskId: checkpointId,
          errorCode: String(error?.code || 'voiceover_preview_generation_failed').slice(0, 120),
          updatedAt: Date.now(),
        };
        await persistLedger();
      });
      throw error;
    }
  };

  const worker = async () => {
    while (!fatalError) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= pendingVoices.length) return;
      try {
        await processVoice(pendingVoices[index]);
      } catch (error) {
        fatalError = error;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, pendingVoices.length)) },
      () => worker(),
    ),
  );
  await mutationTail;

  const finalValidation = validateVoiceoverPreviewManifest({
    manifest,
    libraryDir,
  });
  const ready = catalog.filter(
    (voice) => finalValidation.previewUrlsByVoice[voice.name],
  ).length;
  if (ready !== catalog.length) {
    throw generationError(
      'voiceover_preview_library_incomplete',
      `系统试听库不完整：${ready}/${catalog.length}`,
      { ready, total: catalog.length },
    );
  }
  return {
    ready,
    total: catalog.length,
    generated,
    skipped: readyAtStart.size,
  };
}

export const keepVoiceoverPreviewProcessAlive = async (
  task,
  {
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  } = {},
) => {
  const keepAliveHandle = setIntervalImpl(() => {}, 60_000);
  try {
    return await task();
  } finally {
    clearIntervalImpl(keepAliveHandle);
  }
};

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const env = { ...process.env };
  loadServerEnvFile({
    envPath: path.join(SCRIPT_ROOT, '.env.server'),
    targetEnv: env,
  });
  keepVoiceoverPreviewProcessAlive(() => generateVoiceoverPreviewLibrary({
    rootDir: SCRIPT_ROOT,
    env,
    log: ({ voiceName, status }) => {
      process.stdout.write(`[voiceover-preview] ${voiceName}: ${status}\n`);
    },
  })).then((result) => {
    process.stdout.write(
      `[voiceover-preview] ready ${result.ready}/${result.total}; generated ${result.generated}; skipped ${result.skipped}\n`,
    );
  }).catch((error) => {
    process.stderr.write(
      `[voiceover-preview] ${String(error?.code || 'voiceover_preview_generation_failed')}: ${String(error?.message || '生成失败')}\n`,
    );
    process.exitCode = 1;
  });
}
