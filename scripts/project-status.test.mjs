import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCurrentStatusMarkdown } from './project-status.mjs';

test('current status explains the exact development baseline in plain language', () => {
  const markdown = buildCurrentStatusMarkdown({
    generatedAt: '2026-07-10 12:00:00 +08:00',
    branch: 'feat/stability-phase2',
    commit: 'a1be5e8',
    latestTag: 'v260710A',
    aheadOfMain: 266,
    behindMain: 0,
    clean: true,
    packageVersion: '260516-frontend-shell-upgrade',
    testFiles: 190,
    testCases: 1756,
  });

  assert.match(markdown, /真正开发基线/);
  assert.match(markdown, /feat\/stability-phase2/);
  assert.match(markdown, /a1be5e8/);
  assert.match(markdown, /领先 `origin\/main` 266 个提交/);
  assert.match(markdown, /工作树干净/);
  assert.match(markdown, /不要仅凭 `package.json` 版本号判断线上版本/);
});
