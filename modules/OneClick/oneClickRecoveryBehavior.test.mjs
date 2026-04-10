import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('./MainImageSubModule.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./DetailPageSubModule.tsx', import.meta.url), 'utf8');
const skuSource = readFileSync(new URL('./SkuSubModule.tsx', import.meta.url), 'utf8');

test('one click modules auto-recover refresh-persisted recoverable kie errors instead of only resuming generating tasks', () => {
  assert.match(mainSource, /isRecoverableKieTaskResult/);
  assert.match(detailSource, /isRecoverableKieTaskResult/);
  assert.match(skuSource, /isRecoverableKieTaskResult/);
  assert.match(mainSource, /\(s\.status === 'generating' \|\| \(s\.status === 'error' && isRecoverableKieTaskResult\(s\.taskId, s\.error\)\)\)\s*&& s\.taskId/);
  assert.match(detailSource, /\(s\.status === 'generating' \|\| \(s\.status === 'error' && isRecoverableKieTaskResult\(s\.taskId, s\.error\)\)\)\s*&& s\.taskId/);
  assert.match(skuSource, /\(s\.status === 'generating' \|\| \(s\.status === 'error' && isRecoverableKieTaskResult\(s\.taskId, s\.error\)\)\)\s*&& s\.taskId/);
});
