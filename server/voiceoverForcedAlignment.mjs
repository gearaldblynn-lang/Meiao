import { spawn } from 'node:child_process';
import path from 'node:path';

import { buildVoiceoverError, getVoiceoverConfig } from './voiceoverContract.mjs';

const FASTER_WHISPER_VERSION = '1.2.1';
const DEFAULT_ALIGNMENT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_MIN_SIMILARITY = 0.82;
const DEFAULT_MIN_TURN_DURATION_MS = 40;
const MAX_ALIGNMENT_INPUT_BYTES = 256 * 1024;
const MAX_LOOKAHEAD_CHARACTERS = 12;
const ALIGNMENT_ENV_ALLOWLIST = Object.freeze([
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TZ',
]);
const WHISPER_LANGUAGE_CODES = new Set([
  'af', 'am', 'ar', 'as', 'az', 'ba', 'be', 'bg', 'bn', 'bo', 'br', 'bs',
  'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu', 'fa', 'fi',
  'fo', 'fr', 'gl', 'gu', 'ha', 'haw', 'he', 'hi', 'hr', 'ht', 'hu', 'hy',
  'id', 'is', 'it', 'ja', 'jw', 'ka', 'kk', 'km', 'kn', 'ko', 'la', 'lb',
  'ln', 'lo', 'lt', 'lv', 'mg', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt',
  'my', 'ne', 'nl', 'nn', 'no', 'oc', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru',
  'sa', 'sd', 'si', 'sk', 'sl', 'sn', 'so', 'sq', 'sr', 'su', 'sv', 'sw',
  'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tr', 'tt', 'uk', 'ur', 'uz', 'vi',
  'yi', 'yo', 'zh',
]);
const LANGUAGE_ALIASES = Object.freeze({
  cmn: 'zh',
  fil: 'tl',
  jv: 'jw',
  nb: 'no',
});

const PYTHON_READINESS_SCRIPT = [
  'import importlib.metadata as metadata',
  'import json, sys',
  'payload = json.load(sys.stdin)',
  'version = metadata.version("faster-whisper")',
  'model_loaded = False',
  'if payload.get("loadModel", True):',
  '    from faster_whisper import WhisperModel',
  '    WhisperModel(payload["modelPath"], device="cpu", compute_type="int8", cpu_threads=1, local_files_only=True)',
  '    model_loaded = True',
  'print(json.dumps({"fasterWhisperVersion": version, "modelLoaded": model_loaded}, separators=(",", ":")))',
].join('\n');

const PYTHON_ALIGNMENT_SCRIPT = [
  'import json, sys',
  'from faster_whisper import WhisperModel',
  'payload = json.load(sys.stdin)',
  'model = WhisperModel(payload["modelPath"], device="cpu", compute_type="int8", cpu_threads=1, local_files_only=True)',
  'kwargs = {',
  '    "beam_size": 5,',
  '    "temperature": 0,',
  '    "condition_on_previous_text": True,',
  '    "word_timestamps": True,',
  '    "vad_filter": False,',
  '    "initial_prompt": payload["initialPrompt"],',
  '}',
  'if payload.get("language"):',
  '    kwargs["language"] = payload["language"]',
  'segments, info = model.transcribe(payload["audioPath"], **kwargs)',
  'transcript_parts = []',
  'words = []',
  'for segment in segments:',
  '    transcript_parts.append(segment.text or "")',
  '    for item in (segment.words or []):',
  '        if item.start is None or item.end is None:',
  '            continue',
  '        words.append({"text": item.word or "", "startMs": round(item.start * 1000), "endMs": round(item.end * 1000)})',
  'print(json.dumps({',
  '    "transcript": "".join(transcript_parts).strip(),',
  '    "detectedLanguage": getattr(info, "language", None),',
  '    "words": words,',
  '}, ensure_ascii=False, separators=(",", ":")))',
].join('\n');

const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

function alignmentError(message = '本地口播强制对齐失败') {
  return buildVoiceoverError('voiceover_forced_alignment_failed', message);
}

function unavailableError() {
  return buildVoiceoverError('voiceover_alignment_unavailable', '本地口播对齐模型未就绪');
}

function abortError() {
  return Object.assign(new Error('voiceover alignment cancelled'), {
    name: 'AbortError',
    code: 'voiceover_alignment_cancelled',
  });
}

function boundedNumber(value, fallback, minimum, maximum, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number)
    || number < minimum
    || number > maximum
    || (integer && !Number.isInteger(number))) {
    return fallback;
  }
  return number;
}

function normalizedAlignmentConfig(env, providedConfig) {
  const base = providedConfig || getVoiceoverConfig(env);
  return Object.freeze({
    ...base,
    alignmentPython: String(
      base.alignmentPython
      || env.MEIAO_VOICEOVER_ALIGNMENT_PYTHON
      || base.separationPython
      || '',
    ).trim(),
    whisperModelDir: String(
      base.whisperModelDir
      || env.MEIAO_VOICEOVER_WHISPER_MODEL_DIR
      || '',
    ).trim(),
    alignmentTimeoutMs: boundedNumber(
      base.alignmentTimeoutMs ?? env.MEIAO_VOICEOVER_ALIGNMENT_TIMEOUT_MS,
      DEFAULT_ALIGNMENT_TIMEOUT_MS,
      30_000,
      3_600_000,
      true,
    ),
    alignmentMaxOutputBytes: boundedNumber(
      base.alignmentMaxOutputBytes ?? env.MEIAO_VOICEOVER_ALIGNMENT_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
      16 * 1024,
      2 * 1024 * 1024,
      true,
    ),
    alignmentMinSimilarity: boundedNumber(
      base.alignmentMinSimilarity ?? env.MEIAO_VOICEOVER_ALIGNMENT_MIN_SIMILARITY,
      DEFAULT_MIN_SIMILARITY,
      0.5,
      1,
    ),
    alignmentMinTurnDurationMs: boundedNumber(
      base.alignmentMinTurnDurationMs ?? env.MEIAO_VOICEOVER_ALIGNMENT_MIN_TURN_DURATION_MS,
      DEFAULT_MIN_TURN_DURATION_MS,
      20,
      2_000,
      true,
    ),
  });
}

function buildAlignmentProcessEnv(env, pythonPath) {
  const childEnv = {
    PATH: [path.dirname(pythonPath), '/usr/bin', '/bin'].join(':'),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_DATASETS_OFFLINE: '1',
    OMP_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    NUMEXPR_NUM_THREADS: '1',
  };
  for (const key of ALIGNMENT_ENV_ALLOWLIST) {
    const value = String(env?.[key] || '').trim();
    if (value) childEnv[key] = value;
  }
  return childEnv;
}

function defaultRunProcess(command, args, {
  input = '',
  signal,
  timeoutMs,
  maxOutputBytes,
  env,
  spawnProcess = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let child;
    try {
      child = spawnProcess(command, args, {
        shell: false,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } catch {
      reject(unavailableError());
      return;
    }
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const terminate = (error) => {
      try { child.kill?.('SIGKILL'); } catch {}
      finish(reject, error);
    };
    const append = (target, chunk) => {
      if (settled) return;
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        terminate(alignmentError('本地口播对齐输出超出限制'));
        return;
      }
      if (target === 'stdout') stdout += text;
      else stderr += text;
    };
    const onAbort = () => terminate(abortError());
    const timer = setTimeout(() => {
      terminate(Object.assign(new Error('voiceover alignment timed out'), {
        code: 'voiceover_alignment_timeout',
      }));
    }, timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));
    child.once?.('error', () => finish(reject, unavailableError()));
    child.once?.('close', (exitCode) => finish(resolve, { exitCode, stdout, stderr }));
    try {
      child.stdin?.end(input);
    } catch {
      terminate(unavailableError());
    }
  });
}

function assertKnownKeys(value, allowed) {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw alignmentError();
  }
}

function normalizeCharacters(value) {
  return Array.from(String(value || '').normalize('NFKC').toLocaleLowerCase('und'))
    .filter((character) => /[\p{L}\p{M}\p{N}]/u.test(character));
}

function normalizeTurns(turns) {
  if (!Array.isArray(turns) || !turns.length || turns.length > 200) throw alignmentError();
  const normalized = turns.map((turn, index) => {
    const text = String(typeof turn === 'string' ? turn : turn?.text ?? turn?.targetText ?? '').trim();
    const characters = normalizeCharacters(text);
    if (!text || !characters.length) throw alignmentError();
    return { index, text, characters };
  });
  if (Buffer.byteLength(JSON.stringify(normalized.map(({ text }) => text)), 'utf8') > MAX_ALIGNMENT_INPUT_BYTES) {
    throw alignmentError();
  }
  return normalized;
}

function normalizeRecognition(value) {
  assertKnownKeys(value, new Set(['transcript', 'detectedLanguage', 'words']));
  const transcript = String(value.transcript || '').trim();
  const detectedLanguage = value.detectedLanguage == null
    ? undefined
    : String(value.detectedLanguage || '').trim();
  if (!transcript || !Array.isArray(value.words) || !value.words.length) throw alignmentError();
  let previousEndMs = -Infinity;
  const words = value.words.map((item, wordIndex) => {
    assertKnownKeys(item, new Set(['text', 'startMs', 'endMs']));
    const text = String(item.text || '');
    const startMs = Number(item.startMs);
    const endMs = Number(item.endMs);
    if (!text
      || !Number.isInteger(startMs)
      || !Number.isInteger(endMs)
      || startMs < 0
      || endMs <= startMs
      || startMs < previousEndMs) {
      throw alignmentError();
    }
    previousEndMs = endMs;
    return {
      wordIndex,
      text,
      startMs,
      endMs,
      characters: normalizeCharacters(text),
    };
  });
  if (!words.some(({ characters }) => characters.length)) throw alignmentError();
  return { transcript, ...(detectedLanguage ? { detectedLanguage } : {}), words };
}

function findWithin(characters, start, target) {
  const end = Math.min(characters.length, start + MAX_LOOKAHEAD_CHARACTERS + 1);
  for (let index = start + 1; index < end; index += 1) {
    if (characters[index] === target) return index;
  }
  return -1;
}

function mapExpectedCharacters(expected, recognized) {
  const mappings = new Array(expected.length);
  let expectedIndex = 0;
  let recognizedIndex = 0;
  let exactMatches = 0;
  while (expectedIndex < expected.length && recognizedIndex < recognized.length) {
    if (expected[expectedIndex] === recognized[recognizedIndex].character) {
      mappings[expectedIndex] = { recognizedIndex, exact: true };
      exactMatches += 1;
      expectedIndex += 1;
      recognizedIndex += 1;
      continue;
    }
    const recognizedCharacters = recognized.map(({ character }) => character);
    const recognizedMatch = findWithin(
      recognizedCharacters,
      recognizedIndex,
      expected[expectedIndex],
    );
    const expectedMatch = findWithin(
      expected,
      expectedIndex,
      recognized[recognizedIndex].character,
    );
    const recognizedDistance = recognizedMatch < 0 ? Infinity : recognizedMatch - recognizedIndex;
    const expectedDistance = expectedMatch < 0 ? Infinity : expectedMatch - expectedIndex;
    if (recognizedDistance < expectedDistance) {
      recognizedIndex = recognizedMatch;
      continue;
    }
    if (expectedDistance < Infinity) {
      expectedIndex = expectedMatch;
      continue;
    }
    mappings[expectedIndex] = { recognizedIndex, exact: false };
    expectedIndex += 1;
    recognizedIndex += 1;
  }
  return {
    mappings,
    exactMatches,
    similarity: exactMatches / Math.max(expected.length, recognized.length),
  };
}

export function resolveVoiceoverWhisperLanguage(targetLanguage) {
  const normalized = LANGUAGE_ALIASES[String(targetLanguage || '').trim()]
    || String(targetLanguage || '').trim();
  return WHISPER_LANGUAGE_CODES.has(normalized) ? normalized : undefined;
}

export function buildVoiceoverTurnAlignment({
  turns,
  recognition,
  minSimilarity = DEFAULT_MIN_SIMILARITY,
  minTurnDurationMs = DEFAULT_MIN_TURN_DURATION_MS,
} = {}) {
  const normalizedTurns = normalizeTurns(turns);
  const normalizedRecognition = normalizeRecognition(recognition);
  const expected = normalizedTurns.flatMap(({ characters }) => characters);
  const recognized = normalizedRecognition.words.flatMap((item) => (
    item.characters.map((character) => ({
      character,
      wordIndex: item.wordIndex,
    }))
  ));
  const mapping = mapExpectedCharacters(expected, recognized);
  const requiredSimilarity = boundedNumber(
    minSimilarity,
    DEFAULT_MIN_SIMILARITY,
    0.5,
    1,
  );
  const minimumDuration = boundedNumber(
    minTurnDurationMs,
    DEFAULT_MIN_TURN_DURATION_MS,
    20,
    2_000,
    true,
  );
  if (!Number.isFinite(mapping.similarity) || mapping.similarity < requiredSimilarity) {
    throw alignmentError();
  }

  const groups = [];
  const claimedWords = new Set();
  let characterOffset = 0;
  let previousEndMs = -Infinity;
  for (const turn of normalizedTurns) {
    const turnMappings = mapping.mappings.slice(
      characterOffset,
      characterOffset + turn.characters.length,
    );
    characterOffset += turn.characters.length;
    const exactMappings = turnMappings.filter((item) => item?.exact === true);
    if (exactMappings.length / turn.characters.length < requiredSimilarity) {
      throw alignmentError();
    }
    const wordIndexes = [...new Set(exactMappings.map(({ recognizedIndex }) => (
      recognized[recognizedIndex].wordIndex
    )))];
    if (!wordIndexes.length || wordIndexes.some((wordIndex) => claimedWords.has(wordIndex))) {
      throw alignmentError();
    }
    wordIndexes.forEach((wordIndex) => claimedWords.add(wordIndex));
    const firstWord = normalizedRecognition.words[wordIndexes[0]];
    const lastWord = normalizedRecognition.words[wordIndexes[wordIndexes.length - 1]];
    if (!firstWord
      || !lastWord
      || firstWord.startMs < previousEndMs
      || lastWord.endMs - firstWord.startMs < minimumDuration) {
      throw alignmentError();
    }
    previousEndMs = lastWord.endMs;
    groups.push({
      index: turn.index,
      sourceStartMs: firstWord.startMs,
      sourceEndMs: lastWord.endMs,
      actualDurationMs: lastWord.endMs - firstWord.startMs,
    });
  }
  return Object.freeze({
    similarity: Number(mapping.similarity.toFixed(6)),
    transcript: normalizedRecognition.transcript,
    groups: Object.freeze(groups.map((group) => Object.freeze(group))),
  });
}

function parseProcessJson(result, maxOutputBytes) {
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  if ((result?.exitCode ?? 1) !== 0
    || Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8') > maxOutputBytes) {
    throw alignmentError();
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw alignmentError();
  }
  return parsed;
}

export async function checkVoiceoverAlignmentReadiness({
  env = process.env,
  config: providedConfig,
  verifyModelLoad = true,
  deps = {},
} = {}) {
  const config = normalizedAlignmentConfig(env, providedConfig);
  if (!path.isAbsolute(config.alignmentPython) || !path.isAbsolute(config.whisperModelDir)) {
    return Object.freeze({
      ready: false,
      code: 'voiceover_alignment_unavailable',
      pythonReady: false,
      modelReady: false,
    });
  }
  const runProcess = deps.runProcess || defaultRunProcess;
  try {
    const result = await runProcess(
      config.alignmentPython,
      ['-c', PYTHON_READINESS_SCRIPT],
      {
        input: JSON.stringify({
          modelPath: config.whisperModelDir,
          ...(verifyModelLoad ? {} : { loadModel: false }),
        }),
        timeoutMs: config.alignmentTimeoutMs,
        maxOutputBytes: config.alignmentMaxOutputBytes,
        env: buildAlignmentProcessEnv(env, config.alignmentPython),
      },
    );
    const parsed = parseProcessJson(result, config.alignmentMaxOutputBytes);
    assertKnownKeys(parsed, new Set(['fasterWhisperVersion', 'modelLoaded']));
    const pythonReady = parsed.fasterWhisperVersion === FASTER_WHISPER_VERSION;
    const modelReady = verifyModelLoad ? parsed.modelLoaded === true : pythonReady;
    const ready = pythonReady && modelReady;
    return Object.freeze({
      ready,
      code: ready ? null : 'voiceover_alignment_unavailable',
      pythonReady,
      modelReady,
    });
  } catch {
    return Object.freeze({
      ready: false,
      code: 'voiceover_alignment_unavailable',
      pythonReady: false,
      modelReady: false,
    });
  }
}

export async function alignVoiceoverTurns({
  audioPath,
  turns,
  targetLanguage,
  signal,
  env = process.env,
  config: providedConfig,
  deps = {},
} = {}) {
  if (signal?.aborted) throw abortError();
  const config = normalizedAlignmentConfig(env, providedConfig);
  const normalizedTurns = normalizeTurns(turns);
  if (!path.isAbsolute(String(audioPath || ''))
    || !path.isAbsolute(config.alignmentPython)
    || !path.isAbsolute(config.whisperModelDir)) {
    throw unavailableError();
  }
  const processInput = JSON.stringify({
    audioPath,
    modelPath: config.whisperModelDir,
    language: resolveVoiceoverWhisperLanguage(targetLanguage) || null,
    initialPrompt: normalizedTurns.map(({ text }) => text).join('\n'),
  });
  if (Buffer.byteLength(processInput, 'utf8') > MAX_ALIGNMENT_INPUT_BYTES) {
    throw alignmentError();
  }
  const runProcess = deps.runProcess || defaultRunProcess;
  try {
    const result = await runProcess(
      config.alignmentPython,
      ['-c', PYTHON_ALIGNMENT_SCRIPT],
      {
        input: processInput,
        signal,
        timeoutMs: config.alignmentTimeoutMs,
        maxOutputBytes: config.alignmentMaxOutputBytes,
        env: buildAlignmentProcessEnv(env, config.alignmentPython),
      },
    );
    const recognition = parseProcessJson(result, config.alignmentMaxOutputBytes);
    return buildVoiceoverTurnAlignment({
      turns: normalizedTurns,
      recognition,
      minSimilarity: config.alignmentMinSimilarity,
      minTurnDurationMs: config.alignmentMinTurnDurationMs,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (error?.code === 'voiceover_alignment_unavailable') throw error;
    throw alignmentError();
  }
}
