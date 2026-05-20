import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const internalApiSource = readFileSync(new URL('./internalApi.ts', import.meta.url), 'utf8');
const cosServiceSource = readFileSync(new URL('./tencentCosService.ts', import.meta.url), 'utf8');

test('stream upload API accepts AbortSignal and forwards it through fetchWithTimeout', () => {
  assert.match(
    internalApiSource,
    /export const uploadInternalAssetStream = async \(payload: \{[\s\S]*?signal\?: AbortSignal;[\s\S]*?\}\) => \{/
  );
  assert.match(internalApiSource, /signal: payload\.signal,/);
});

test('cos upload supports cancellation and avoids base64 fallback after abort', () => {
  assert.match(
    cosServiceSource,
    /export const uploadToCos = async \([\s\S]*?signal\?: AbortSignal,[\s\S]*?\): Promise<string> => \{/
  );
  assert.match(cosServiceSource, /if \(signal\?\.aborted\) \{/);
  assert.match(cosServiceSource, /signal: signal,/);
  assert.match(cosServiceSource, /if \(signal\?\.aborted\) \{\s*throw new DOMException\('The operation was aborted\.', 'AbortError'\);/);
});

test('asset uploads normalize missing file extensions before generating public urls', () => {
  assert.match(internalApiSource, /import \{ ensureUploadFileName \} from '\.\.\/utils\/uploadFileName\.mjs';/);
  assert.match(internalApiSource, /fileName: ensureUploadFileName\(payload\.fileName, payload\.mimeType\)/);
  assert.match(internalApiSource, /const normalizedFileName = ensureUploadFileName\(/);
  assert.match(internalApiSource, /formData\.append\('file', payload\.file, normalizedFileName\)/);
  assert.match(cosServiceSource, /const sourceName = ensureUploadFileName\(customFileName \|\| file\.name \|\| 'upload\.bin', file\.type \|\| ''\);/);
});
