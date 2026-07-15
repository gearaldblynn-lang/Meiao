import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const projectCardSource = readFileSync(new URL('../shell/components/ProjectCard.tsx', import.meta.url), 'utf8');

test('batch job identities are built before network work and persisted before the upload queue is cleared', () => {
  const submitBlock = shellSource.match(/const handleSubtitleRemovalSubmit = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
  const initialPersistIndex = submitBlock.indexOf('await persistSyncedProjectsToSharedState([initialSubtitleRemovalProject])');
  const firstCreateIndex = submitBlock.indexOf('createInternalJob(entry.subtitleRemovalJobRequest)');

  assert.match(submitBlock, /const submissionEntries = inputs\.map/);
  assert.ok(initialPersistIndex >= 0, 'full batch identity must be persisted before submission');
  assert.ok(firstCreateIndex > initialPersistIndex, 'no paid create call may happen before the batch checkpoint');
  assert.match(submitBlock, /clientSubmissionKey: String\(entry\.subtitleRemovalJobRequest\.payload\.clientSubmissionKey/);
  assert.match(submitBlock, /errorCode: creationUnknown \? 'job_creation_unknown' : 'subtitle_job_create_failed'/);
  assert.match(submitBlock, /await persistSubtitleRemovalCheckpoint\(/);
  assert.match(submitBlock, /await persistSyncedProjectsToSharedState\(\[subtitleRemovalProject\]\)/);
  assert.match(submitBlock, /return inputs\.map\(\(input\) => \(\{ clientItemId: input\.clientItemId, ok: true \}\)\)/);
  assert.doesNotMatch(submitBlock, /void persistSyncedProjectsToSharedState\(\[subtitleRemovalProject\]\)/);
});

test('every possibly-paid subtitle retry uses confirmation and unknown submissions stay blocked', () => {
  assert.doesNotMatch(projectCardSource, /subtitleCanRecoverExistingTask/);
  assert.match(projectCardSource, /getSubtitleRemovalRetryDecision/);
  assert.match(projectCardSource, /可能产生一次新的付费处理/);
  assert.match(projectCardSource, /setSubtitleRetryResultId\(displayResult\.id\)/);
  assert.doesNotMatch(projectCardSource, /onRegenerate\(project\.id, displayResult\.id\);\s*return;/);
});
