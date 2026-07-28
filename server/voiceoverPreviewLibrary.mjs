import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import {
  mkdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  VOICEOVER_TTS_MODEL,
  VOICEOVER_VOICES,
} from '../src/utils/voiceoverCatalog.mjs';

export const VOICEOVER_PREVIEW_LIBRARY_VERSION = 1;
export const VOICEOVER_PREVIEW_LANGUAGE = 'cmn';
export const VOICEOVER_PREVIEW_SAMPLE_TEXT = '你好，这是一段口播音色试听。';

const MIN_AUDIO_BYTES = 128;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;

const previewError = (code, message) => Object.assign(
  new Error(message || '系统音色试听资源无效'),
  { code },
);

const startsWithBytes = (bytes, signature, offset = 0) => {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
};

const startsWithText = (bytes, value, offset = 0) => (
  startsWithBytes(bytes, [...Buffer.from(value)], offset)
);

export function detectVoiceoverPreviewAudio(value, _contentType = '') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < MIN_AUDIO_BYTES) {
    throw previewError('voiceover_preview_audio_invalid', '试听音频为空或过短');
  }
  if (startsWithText(bytes, 'ID3')
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { extension: 'mp3', contentType: 'audio/mpeg' };
  }
  if (startsWithText(bytes, 'RIFF') && startsWithText(bytes, 'WAVE', 8)) {
    return { extension: 'wav', contentType: 'audio/wav' };
  }
  if (startsWithText(bytes, 'OggS')) {
    return { extension: 'ogg', contentType: 'audio/ogg' };
  }
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { extension: 'webm', contentType: 'audio/webm' };
  }
  if (startsWithText(bytes, 'ftyp', 4)) {
    return { extension: 'm4a', contentType: 'audio/mp4' };
  }
  throw previewError('voiceover_preview_audio_invalid', '试听响应不是支持的音频格式');
}

export function createEmptyVoiceoverPreviewManifest() {
  return {
    version: VOICEOVER_PREVIEW_LIBRARY_VERSION,
    model: VOICEOVER_TTS_MODEL,
    language: VOICEOVER_PREVIEW_LANGUAGE,
    sampleText: VOICEOVER_PREVIEW_SAMPLE_TEXT,
    voices: [],
  };
}

const publicResult = ({
  valid = false,
  previewUrlsByVoice = {},
  errors = [],
} = {}) => ({
  valid,
  total: VOICEOVER_VOICES.length,
  ready: Object.keys(previewUrlsByVoice).length,
  previewUrlsByVoice,
  errors,
});

const addError = (errors, code, voiceName = '') => {
  errors.push({
    code,
    ...(voiceName ? { voiceName } : {}),
  });
};

const hasExpectedCatalog = (entries) => {
  if (!Array.isArray(entries) || entries.length !== VOICEOVER_VOICES.length) return false;
  const actual = entries.map((entry) => String(entry?.name || ''));
  const expected = VOICEOVER_VOICES.map((voice) => voice.name);
  return actual.length === new Set(actual).size
    && expected.every((voiceName) => actual.includes(voiceName))
    && actual.every((voiceName) => expected.includes(voiceName));
};

export function validateVoiceoverPreviewManifest({
  manifest,
  libraryDir,
} = {}) {
  const errors = [];
  const previewUrlsByVoice = {};
  const contractMatches = manifest?.version === VOICEOVER_PREVIEW_LIBRARY_VERSION
    && manifest?.model === VOICEOVER_TTS_MODEL
    && manifest?.language === VOICEOVER_PREVIEW_LANGUAGE
    && manifest?.sampleText === VOICEOVER_PREVIEW_SAMPLE_TEXT
    && Array.isArray(manifest?.voices);
  if (!contractMatches) {
    addError(errors, 'voiceover_preview_manifest_contract_mismatch');
    return publicResult({ errors });
  }
  if (!hasExpectedCatalog(manifest.voices)) {
    addError(errors, 'voiceover_preview_catalog_mismatch');
  }
  for (const entry of manifest.voices) {
    const voiceName = String(entry?.name || '');
    if (!VOICEOVER_VOICES.some((voice) => voice.name === voiceName)) continue;
    const file = String(entry?.file || '');
    if (!SAFE_FILE_NAME.test(file) || path.basename(file) !== file) {
      addError(errors, 'voiceover_preview_file_unsafe', voiceName);
      continue;
    }
    const expectedBytes = Number(entry?.bytes);
    const expectedHash = String(entry?.sha256 || '');
    const expectedType = String(entry?.contentType || '');
    const filePath = path.join(String(libraryDir || ''), file);
    if (!existsSync(filePath)) {
      addError(errors, 'voiceover_preview_file_missing', voiceName);
      continue;
    }
    let bytes;
    try {
      const stats = statSync(filePath);
      if (!stats.isFile() || stats.size !== expectedBytes) {
        addError(errors, 'voiceover_preview_file_size_mismatch', voiceName);
        continue;
      }
      bytes = readFileSync(filePath);
    } catch {
      addError(errors, 'voiceover_preview_file_unreadable', voiceName);
      continue;
    }
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (!SHA256_HEX.test(expectedHash) || actualHash !== expectedHash) {
      addError(errors, 'voiceover_preview_file_hash_mismatch', voiceName);
      continue;
    }
    let detected;
    try {
      detected = detectVoiceoverPreviewAudio(bytes, expectedType);
    } catch {
      addError(errors, 'voiceover_preview_file_audio_invalid', voiceName);
      continue;
    }
    if (detected.contentType !== expectedType
      || !file.toLowerCase().endsWith(`.${detected.extension}`)) {
      addError(errors, 'voiceover_preview_file_type_mismatch', voiceName);
      continue;
    }
    previewUrlsByVoice[voiceName] = `/voiceover-previews/${encodeURIComponent(file)}`;
  }
  return publicResult({
    valid: errors.length === 0 && Object.keys(previewUrlsByVoice).length === VOICEOVER_VOICES.length,
    previewUrlsByVoice,
    errors,
  });
}

export function loadVoiceoverPreviewLibrary({ publicDir } = {}) {
  const libraryDir = path.join(String(publicDir || ''), 'voiceover-previews');
  const manifestPath = path.join(libraryDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return publicResult({
      errors: [{ code: 'voiceover_preview_manifest_missing' }],
    });
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return publicResult({
      errors: [{ code: 'voiceover_preview_manifest_invalid' }],
    });
  }
  return validateVoiceoverPreviewManifest({ manifest, libraryDir });
}

export async function writeVoiceoverPreviewJsonAtomic(
  filePath,
  value,
  { mode = 0o600 } = {},
) {
  const targetPath = path.resolve(String(filePath || ''));
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporaryPath, targetPath);
}
