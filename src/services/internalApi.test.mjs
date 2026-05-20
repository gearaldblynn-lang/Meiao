import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./internalApi.ts', import.meta.url), 'utf8');

test('probeInternalApi uses a timeouted fetch instead of waiting on a bare health request', () => {
  const probeBody = source.match(/export const probeInternalApi = async \([^)]*\)(?:: [^{]+)? => \{([\s\S]*?)\n\};/)?.[1] || '';

  assert.match(probeBody, /fetchWithTimeout/);
  assert.match(probeBody, /timeoutMs/);
  assert.doesNotMatch(probeBody, /await fetch\('\s*\/api\/health\s*'\)/);
});

test('authenticated GET request dedupe keys include the current session token', () => {
  assert.match(source, /const buildDedupeKey = \(path: string, method: string, body\?: BodyInit \| null, token = ''\)/);
  assert.match(source, /const authScope = token \? `auth:\$\{token\}` : 'auth:anonymous'/);
  assert.match(source, /if \(method === 'GET'\) return `GET:\$\{path\}:\$\{authScope\}`/);
  assert.match(source, /const token = getSessionToken\(\);\s+const dedupeKey = dedupe \? buildDedupeKey\(path, method, init\?\.body, token\) : ''/);
});
