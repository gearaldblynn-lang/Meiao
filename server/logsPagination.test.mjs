import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('db log listing uses dynamic pagination instead of a hardcoded 200-row cap', () => {
  assert.match(source, /const \{ page, pageSize, offset \} = normalizeLogPagination\(filters\)/);
  assert.match(source, /LIMIT \? OFFSET \?/);
  assert.doesNotMatch(source, /ORDER BY created_at DESC\s+LIMIT 200/);
});

test('server exposes dedicated log filter metadata endpoints for db and local modes', () => {
  assert.match(source, /if \(url\.pathname === '\/api\/logs\/meta' && req\.method === 'GET'\)/);
  assert.match(source, /const listDbLogMeta = async \(\) =>/);
  assert.match(source, /const listLocalLogMeta = \(store\) =>/);
});
