import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const longVideoSource = readFileSync(new URL('./Video/LongVideoSubModule.tsx', import.meta.url), 'utf8');
const retouchSource = readFileSync(new URL('./Retouch/RetouchModule.tsx', import.meta.url), 'utf8');

test('video and retouch modules recognize recoverable kie errors for follow-up recovery', () => {
  assert.match(longVideoSource, /isRecoverableKieTaskResult/);
  assert.match(
    longVideoSource,
    /\(t\.status === 'generating' \|\| \(t\.status === 'error' && isRecoverableKieTaskResult\(t\.taskId, t\.error\)\)\)\s*&& t\.taskId/,
  );
  assert.match(retouchSource, /isRecoverableKieTaskResult/);
  assert.match(
    retouchSource,
    /task\.taskId[\s\S]*task\.status === 'error' && isRecoverableKieTaskResult\(task\.taskId, task\.error\)/,
  );
});
