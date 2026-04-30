import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const internalApiSource = readFileSync(new URL('./internalApi.ts', import.meta.url), 'utf8');
const cosServiceSource = readFileSync(new URL('./tencentCosService.ts', import.meta.url), 'utf8');
const xhsModuleSource = readFileSync(new URL('../modules/XhsCover/XhsCoverModule.tsx', import.meta.url), 'utf8');

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

test('xhs cover module passes upload abort signals into cloud upload path', () => {
  assert.match(xhsModuleSource, /const uploadController = new AbortController\(\);/);
  assert.match(xhsModuleSource, /abortControllersRef\.current\.add\(uploadController\);/);
  assert.match(xhsModuleSource, /uploadToCos\(image, apiConfig, undefined, undefined, uploadController\.signal\)/);
});
