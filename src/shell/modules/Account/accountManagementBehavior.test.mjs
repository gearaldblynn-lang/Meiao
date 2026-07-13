import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AccountManagement.tsx', import.meta.url), 'utf8');

test('shell account management exports every filtered log page instead of one capped page', () => {
  assert.match(source, /const exportPageSize = 200/);
  assert.match(source, /const exportedLogs: InternalLogEntry\[\] = \[\]/);
  assert.match(source, /while \(exportedLogs\.length < totalToExport\)/);
  assert.match(source, /await fetchInternalLogs\(\{/);
  assert.doesNotMatch(source, /pageSize: Math\.max\(200, logsTotal\)/);
  assert.match(source, /setMessage\(`已导出 \$\{exportedLogs\.length\} 条日志`\)/);
});

test('shell account management exposes account credit controls and status', () => {
  const utilsSource = readFileSync(new URL('./accountManagementUtils.mjs', import.meta.url), 'utf8');

  assert.match(utilsSource, /formatAccountCreditStatus/);
  assert.match(utilsSource, /getAccountCreditAvailable/);
  assert.match(source, /creditLimitMode: 'unlimited' as 'unlimited' \| 'limited'/);
  assert.match(source, /creditBalance: '0'/);
  assert.match(source, /creditLimitMode: createForm\.creditLimitMode/);
  assert.match(source, /creditBalance: Number\(createForm\.creditBalance \|\| 0\)/);
  assert.match(source, /formatAccountCreditStatus\(user\)/);
  assert.match(source, /updateUser\(user, \{ creditLimitMode: mode as 'unlimited' \| 'limited' \}\)/);
  assert.match(source, /updateUser\(user, \{ creditBalance: Math\.max\(0, Number\(creditDrafts\[user\.id\] \?\? user\.creditBalance \?\? 0\)\) \}\)/);
});

test('shell account management safely resolves provider submission unknown jobs', () => {
  assert.match(source, /provider_submission_unknown/);
  assert.match(source, /selectedJob\?\.errorCode === 'provider_submission_unknown'\s*&& selectedJob\.submissionResolution\.allowed/);
  assert.match(source, /submissionResolution\.canBind/);
  assert.match(source, /已确认 KIE 无任务且未扣费/);
  assert.match(source, /resolveTaskPlatformSubmission/);
  assert.match(source, /providerTaskId\.trim\(\)/);
  assert.match(source, /await queryTaskJobs\(taskPage\)/);
  assert.match(source, /await openTaskTimeline\(refreshedJob\)/);
  assert.match(source, /setSubmissionResolutionError\(err\.message/);
  assert.doesNotMatch(source, /provider_submission_unknown[\s\S]{0,500}retryInternalJob/);
});
