import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const shellScopeFiltersSource = readFileSync(new URL('../adapters/shellScopeFilters.ts', import.meta.url), 'utf8');
const shellPersistenceSource = readFileSync(new URL('../adapters/shellPersistence.ts', import.meta.url), 'utf8');

test('shell project cards refresh independently of locally remembered active jobs', () => {
  const liveSyncEffect = shellSource.match(
    /useEffect\(\(\) => \{[\s\S]*?startShellJobSync\([\s\S]*?\n  \}, \[[^\]]*pageMode[^\]]*\]\);/,
  )?.[0] || '';

  assert.match(shellSource, /startShellJobSync/);
  assert.match(liveSyncEffect, /if \(pageMode !== 'module'\) return undefined/);
  assert.match(liveSyncEffect, /run: hydrateShellJobs/);
  assert.doesNotMatch(liveSyncEffect, /hasActiveBackendTask|hasActiveBackendProject/);
  assert.doesNotMatch(liveSyncEffect, /projects\.some|tasks\.some/);
});

test('all shell job refresh triggers share one coalesced hydration runner', () => {
  assert.match(shellSource, /createCoalescedAsyncRunner/);
  assert.match(shellSource, /hydrateShellJobsOperationRef/);
  assert.match(shellSource, /hydrateShellJobsRunnerRef/);
  assert.match(shellSource, /\(\) => hydrateShellJobsOperationRef\.current\(\)/);
});

test('account changes invalidate old hydration before it can apply', () => {
  const hydrationBody = shellSource.match(
    /const runHydrateShellJobs = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/,
  )?.[1] || '';
  const resetBody = shellSource.match(
    /const resetShellWorkspaceForUser = useCallback\(\(userId\?: string \| null\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/,
  )?.[1] || '';

  assert.match(shellSource, /jobsHydrationScopeRef/);
  assert.match(hydrationBody, /const isHydrationCurrent = jobsHydrationScopeRef\.current!\.capture\(\)/);
  assert.match(hydrationBody, /if \(!isHydrationCurrent\(\)\) return/);
  assert.match(resetBody, /jobsHydrationScopeRef\.current\?\.invalidate\(\)/);
});

test('account scope guards deferred state updates and queued persistence writes', () => {
  const hydrationBody = shellSource.match(
    /const runHydrateShellJobs = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/,
  )?.[1] || '';
  const syncedPersistenceBody = shellSource.match(
    /const persistSyncedProjectsToSharedState = useCallback\(([\s\S]*?)\n  \}, \[[^\]]*shellLocalScopeUserId[^\]]*\]\);/,
  )?.[1] || '';

  assert.match(shellSource, /createAsyncScopeGuard/);
  assert.match(shellSource, /jobsHydrationScopeUserIdRef/);
  assert.match(hydrationBody, /const isHydrationCurrent = jobsHydrationScopeRef\.current!\.capture\(\)/);
  assert.match(hydrationBody, /persistVideoMemoryToSharedState\(nextVideoMemory, isHydrationCurrent\)/);
  assert.match(hydrationBody, /persistSyncedProjectsToSharedState\(syncedProjectsToPersist, isHydrationCurrent\)/);
  assert.match(hydrationBody, /setProjects\(\(prev\) => \{\s*if \(!isHydrationCurrent\(\)\) return prev/);
  assert.match(hydrationBody, /setTasks\(\(prev\) => \{\s*if \(!isHydrationCurrent\(\)\) return prev/);
  assert.match(syncedPersistenceBody, /const accountIsCurrent = sharedStateScopeRef\.current!\.capture\(\)/);
  assert.match(syncedPersistenceBody, /if \(!isWriteCurrent\(\)\) return false/);
  assert.match(syncedPersistenceBody, /await resolveSharedStateBaseForWrite\(isWriteCurrent\)/);
  assert.match(syncedPersistenceBody, /sharedStateWriteQueueRef\.current!\.enqueue\(isCurrent, write, false\)/);
  assert.match(shellSource, /jobsHydrationScopeRef\.current\?\.invalidate\(\)/);
  assert.match(shellSource, /sharedStateScopeRef\.current\?\.invalidate\(\)/);
});

test('every shared-state writer captures and enqueues an account-scoped guard', () => {
  const writerNames = [
    'persistVideoMemoryToSharedState',
    'persistShellDraftToSharedState',
    'persistSyncedProjectsToSharedState',
    'persistDeletionToSharedState',
    'persistProjectToSharedState',
    'persistTranslationFilesToSharedState',
  ];

  writerNames.forEach((writerName) => {
    const start = shellSource.indexOf(`const ${writerName} = useCallback`);
    assert.notEqual(start, -1, `${writerName} must exist`);
    const nextWriter = shellSource.indexOf('\n  const ', start + 10);
    const body = shellSource.slice(start, nextWriter === -1 ? undefined : nextWriter);
    assert.match(body, /sharedStateScopeRef\.current!\.capture\(\)/, `${writerName} must capture the account epoch`);
    assert.match(body, /captureInternalSessionToken\(\)/, `${writerName} must bind the original session token`);
    assert.match(body, /sharedStateWriteQueueRef\.current!\.enqueue\(/, `${writerName} must use the scoped queue`);
  });
});

test('job backfill does not fan out requests for terminal history outside the recent window', () => {
  const hydrationBody = shellSource.match(
    /const runHydrateShellJobs = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/,
  )?.[1] || '';

  assert.match(hydrationBody, /collectMissingActiveInternalJobIds/);
  assert.match(hydrationBody, /for \(const jobId of collectMissingActiveInternalJobIds/);
  assert.doesNotMatch(hydrationBody, /Promise\.all\([\s\S]{0,300}fetchInternalJob/);
  assert.match(hydrationBody, /shouldKeepRuntimeProject\(project\)/);
  assert.match(hydrationBody, /result\.status === 'generating' \|\| result\.status === 'retry_waiting'/);
  assert.match(hydrationBody, /isActiveTaskStatus\(task\.status\)/);
  assert.match(hydrationBody, /board\.status === 'generating'/);
  assert.doesNotMatch(hydrationBody, /Array\.from\(knownBackendJobIds\)/);
});

test('result contracts preserve retry-waiting child jobs even without a local task row', () => {
  assert.match(
    shellSource,
    /status: 'completed' \| 'generating' \| 'retry_waiting' \| 'error'/,
  );
  assert.match(
    shellScopeFiltersSource,
    /status: 'completed' \| 'generating' \| 'retry_waiting' \| 'error'/,
  );
  assert.match(
    shellPersistenceSource,
    /status: 'completed' \| 'generating' \| 'retry_waiting' \| 'error'/,
  );
});
