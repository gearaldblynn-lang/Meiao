import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeLintResults } from './run-eslint-budget.mjs';

test('lint summary counts issues and keeps the most common rules', () => {
  const summary = summarizeLintResults([
    {
      filePath: '/repo/a.ts',
      errorCount: 1,
      warningCount: 2,
      messages: [
        { severity: 2, ruleId: 'danger' },
        { severity: 1, ruleId: 'no-any' },
        { severity: 1, ruleId: 'no-any' },
      ],
    },
  ]);

  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 2);
  assert.equal(summary.affectedFiles, 1);
  assert.deepEqual(summary.topRules[0], ['no-any', 2]);
});

test('lint summary treats parser failures without a rule id as unknown', () => {
  const summary = summarizeLintResults([
    { filePath: '/repo/a.ts', errorCount: 1, warningCount: 0, messages: [{ severity: 2, ruleId: null }] },
  ]);
  assert.deepEqual(summary.topRules[0], ['unknown', 1]);
});
