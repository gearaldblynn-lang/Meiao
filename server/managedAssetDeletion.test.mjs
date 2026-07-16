import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const assetStoreSource = readFileSync(new URL('./assetStore.mjs', import.meta.url), 'utf8');

test('explicit batch and expiry deletion converge on the durable lifecycle request', () => {
  assert.match(source, /import \{ processAssetCleanupBatch, reconcileManagedAssetStorage \} from '\.\/assetCleanupWorker\.mjs'/);
  assert.match(source, /requestStoredAssetDeletion/);
  const explicitDelete = source.match(/const deleteStoredAssetForUser[\s\S]*?\n\};/)?.[0] || '';
  const batchDelete = source.match(/const deleteStoredAssetsByIdsForUser[\s\S]*?\n\};/)?.[0] || '';
  const expiryDelete = source.match(/const cleanupExpiredStoredAssets[\s\S]*?\n\};/)?.[0] || '';
  assert.match(explicitDelete, /requestStoredAssetDeletion/);
  assert.match(batchDelete, /queueStoredAssetsAfterReferenceRemoval/);
  assert.match(expiryDelete, /requestStoredAssetDeletion/);
  assert.doesNotMatch(explicitDelete, /deleteStoredAssetFile/);
  assert.doesNotMatch(batchDelete, /deleteStoredAssetFile/);
  assert.doesNotMatch(expiryDelete, /deleteStoredAssetFile/);
});

test('chat deletion removes references and queues cleanup in one MySQL transaction', () => {
  assert.match(
    source,
    /const deleteDbChatSession[\s\S]{0,1800}beginTransaction\(\)[\s\S]{0,1800}DELETE FROM chat_messages[\s\S]{0,1200}queueStoredAssetsAfterReferenceRemoval[\s\S]{0,800}commit\(\)/,
  );
  assert.match(
    source,
    /const sessionMessages = \(store\.chatMessages \|\| \[\]\)[\s\S]{0,1200}store\.chatMessages =[\s\S]{0,700}deleteStoredAssetsByIdsForUser/,
  );
});

test('agent deletion collects chat and icon assets before atomically queuing cleanup', () => {
  const mysqlDelete = source.match(/const deleteDbAgent = async \(user, agentId\) => \{[\s\S]*?\n\};/)?.[0] || '';
  const localDelete = source.match(/const deleteLocalAgent = async \(store, user, agentId\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(mysqlDelete, /collectStoredAssetIdsFromChatMessages/);
  assert.match(mysqlDelete, /collectStoredAssetIdsFromValue\(currentAgent\.icon_url\)/);
  assert.match(mysqlDelete, /queueStoredAssetsAfterReferenceRemoval/);
  assert.match(mysqlDelete, /beginTransaction\(\)/);
  assert.match(mysqlDelete, /commit\(\)/);
  assert.match(localDelete, /collectStoredAssetIdsFromChatMessages/);
  assert.match(localDelete, /queueStoredAssetsAfterReferenceRemoval/);
});

test('account deletion persists cleanup tasks before stored assets and user rows are removed', () => {
  const mysqlDelete = source.match(/const deleteDbUser = async \(userId\)[\s\S]*?\n\};/)?.[0] || '';
  assert.match(mysqlDelete, /acquireManagedAssetUserLocks\(connection, affectedUserIds\)/);
  assert.match(mysqlDelete, /SELECT id, provider, storage_key, storage_bucket, storage_region FROM stored_assets/);
  assert.match(mysqlDelete, /enqueueAssetCleanupTask\(connection/);
  assert.ok(mysqlDelete.indexOf('enqueueAssetCleanupTask(connection') < mysqlDelete.indexOf('DELETE FROM stored_assets'));
  assert.doesNotMatch(mysqlDelete, /deleteStoredAssetFile/);

  assert.match(source, /await queueUserAssetsForCleanup\(targetUser\.id\)/);
});

test('managed COS upload and account deletion serialize on the same user row lock', () => {
  const upload = source.match(/const persistUploadedAssetIfEnabled = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(upload, /withManagedAssetUserLock\(user\.id/);
  assert.match(upload, /findAnyDbUserById\(user\.id\)/);
  assert.match(upload, /withManagedAssetUserLock\(user\.id[\s\S]*return persist\(pool\)/);
  assert.match(source, /SELECT GET_LOCK\(\?, \?\) AS acquired/);
  assert.match(source, /SELECT RELEASE_LOCK\(\?\) AS released/);
  assert.match(source, /error\?\.statusCode && \/\^managed_asset_\/[\s\S]*json\(res, error\.statusCode/);
});

test('job deletion removes the job reference before requesting its managed asset cleanup', () => {
  assert.match(source, /const collectStoredAssetIdsFromJob = \(job\) =>/);
  assert.match(
    source,
    /deleteJobById\(lockedPool[\s\S]{0,1200}afterDelete: async \(connection, deletedJob\)[\s\S]{0,500}queueStoredAssetsAfterReferenceRemoval\(\{[\s\S]{0,300}reason: 'job_deleted'/,
  );
  assert.match(
    source,
    /deleteLocalJobRecord\(store, jobToDelete\.id\);[\s\S]{0,500}await deleteStoredAssetsByIdsForUser\(\{[\s\S]{0,300}referenceStore: store/,
  );
});

test('state saves queue assets removed by project or task deletion after the new state is durable', () => {
  assert.match(source, /queueRemovedStateAssetsForCleanup/);
  const lockedStateWrite = source.match(/const saveDbAppStateAndQueueRemovedAssetsUnderLock = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(
    lockedStateWrite,
    /beginTransaction\(\)[\s\S]{0,900}INSERT INTO app_states[\s\S]{0,900}queueRemovedStateAssetsForCleanup[\s\S]{0,500}commit\(\)/,
  );
  assert.match(
    source,
    /writeLocalStore\(store\);[\s\S]{0,300}await queueRemovedStateAssetsForCleanup/,
  );
});

test('cleanup timer reconciles states and drains durable tasks with an overlap guard', () => {
  assert.match(source, /reconcileManagedAssetStorage/);
  assert.match(source, /processAssetCleanupBatch/);
  assert.match(source, /assetCleanupRunning/);
  assert.match(source, /MEIAO_ASSET_CLEANUP_INTERVAL_MS/);
  assert.match(source, /isProtected: async \(task\) =>/);
  assert.match(source, /managedAssetCleanup/);
  const cleanupCycle = source.match(/const runManagedAssetCleanupCycle = async \(\{ mutationLockHeld = false \} = \{\}\) => \{[\s\S]*?\n\};/)?.[0] || '';
  const protectionCallback = cleanupCycle.match(/isProtected: async \(task\) => \{[\s\S]*?\n\s*\},/)?.[0] || '';
  assert.match(protectionCallback, /await collectProtectedManagedAssetUrls/);
  assert.match(protectionCallback, /getStoredAssetById\(pool, task\.assetId\)[\s\S]*ownerUserId: asset\.userId/);
  assert.doesNotMatch(cleanupCycle.slice(0, cleanupCycle.indexOf('processAssetCleanupBatch')), /protectedAssetRefs/);
  assert.match(source, /summarizeAssetCleanupStore/);
  assert.match(source, /pruneAssetCleanupTasks/);
  assert.match(source, /MEIAO_ASSET_CLEANUP_ALERT_BACKLOG/);
  assert.match(source, /MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS/);
});

test('job tombstones are durably reconciled and exposed through health', () => {
  const cycle = source.match(/const runTombstonedJobCleanupCycle = async \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(cycle, /WHERE updated_at >= \? ORDER BY updated_at ASC/);
  assert.match(cycle, /tombstonedStateScanTracker\.prepareRows/);
  assert.match(cycle, /tombstonedStateScanTracker\.commitPending/);
  assert.match(cycle, /reconcileTombstonedJobs/);
  assert.match(cycle, /listJobsByIdsForUser/);
  assert.match(cycle, /requestCancelJob/);
  assert.match(cycle, /deleteJobById/);
  assert.match(cycle, /hasDbProcessedCreditReservation/);
  assert.match(source, /tombstonedJobCleanup,/);
  assert.match(source, /MEIAO_TOMBSTONED_JOB_RECONCILE_INTERVAL_MS/);
  assert.match(source, /MEIAO_TOMBSTONED_JOB_PENDING_ALERT_MS/);
  assert.match(source, /idx_app_states_updated_at/);
  assert.match(source, /alreadyAbsent: true/);
});

test('durable managed-asset reference writes serialize with delete-pending transitions', () => {
  const lockedStateWrite = source.match(/const saveDbAppStateAndQueueRemovedAssetsUnderLock = async[\s\S]*?\n\};/)?.[0] || '';
  const mysqlStateRoute = source.match(/if \(url\.pathname === '\/api\/state' && req\.method === 'PUT'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(mysqlStateRoute, /withUserLock: withManagedAssetUserLock/);
  assert.match(mysqlStateRoute, /saveState: saveDbAppStateAndQueueRemovedAssetsUnderLock/);
  assert.doesNotMatch(lockedStateWrite, /withManagedAssetUserLock|acquireManagedAssetUserLock/);
  assert.match(lockedStateWrite, /return runWithTransientRetry/);
  assert.match(lockedStateWrite, /beginTransaction/);
  assert.match(lockedStateWrite, /assertActiveDbUserUnderManagedAssetLock\(connection, user\.id/);
  assert.match(lockedStateWrite, /assertOwnedActiveManagedAssetReferences\([\s\S]*pool: connection/);
  assert.match(lockedStateWrite, /queueRemovedStateAssetsForCleanup[\s\S]*commit\(\)/);

  const chatDelete = source.match(/const deleteDbChatSession = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(chatDelete, /acquireManagedAssetAgentLock\(connection, session\.agentId\)[\s\S]*acquireManagedAssetUserLock\(connection, user\.id\)/);
  assert.match(chatDelete, /assertNoPendingDbAgentChatRuns/);
  assert.match(chatDelete, /commit\(\)[\s\S]*releaseManagedAssetUserLock/);

  const chatReply = source.match(/const createDbChatReply = async[\s\S]*?const persistDbChatProviderTaskCheckpoint/)?.[0] || '';
  assert.match(chatReply, /acquireManagedAssetAgentLock\(pendingLockConnection, session\.agentId\)[\s\S]*acquireManagedAssetUserLock\(pendingLockConnection, user\.id\)/);
  assert.match(chatReply, /assertOwnedActiveManagedAssetReferences\([\s\S]*pool: pendingConnection[\s\S]*INSERT INTO chat_messages/);
  assert.match(chatReply, /const withDbChatReferenceFence[\s\S]*getManagedAssetLockPool\(\)[\s\S]*acquireManagedAssetAgentLock\(lockConnection, session\.agentId\)[\s\S]*acquireManagedAssetUserLock\(lockConnection, user\.id\)/);
  assert.match(chatReply, /INNER JOIN users owner[\s\S]*owner\.status = 'active'[\s\S]*activeSessionRows/);

  const agentDelete = source.match(/const deleteDbAgent = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(agentDelete, /acquireManagedAssetAgentLock\(connection, agentId\)/);
  assert.match(agentDelete, /assertNoPendingDbAgentChatRuns/);
  assert.match(source, /message\.created_at >= \?[\s\S]*getManagedAssetAgentBusyLeaseMs/);
  assert.match(agentDelete, /SELECT DISTINCT user_id FROM chat_sessions WHERE agent_id = \?/);
  assert.match(agentDelete, /acquireManagedAssetUserLocks\(connection, affectedUserIds\)[\s\S]*beginTransaction/);
  assert.match(agentDelete, /commit\(\)[\s\S]*releaseManagedAssetLocks/);

  const chatSessionCreate = source.match(/const createDbChatSession = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(chatSessionCreate, /acquireManagedAssetAgentLock\(connection, agentId\)[\s\S]*acquireManagedAssetUserLock\(connection, user\.id\)/);

  const imageCheckpoint = source.match(/const persistDbChatImageCheckpoint[\s\S]*?const markDbChatRunFailed/)?.[0] || '';
  assert.match(imageCheckpoint, /withDbChatReferenceFence/);
  assert.match(imageCheckpoint, /assistantUpdate\?\.affectedRows/);

  const expiry = source.match(/const cleanupExpiredStoredAssets = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(expiry, /withManagedAssetUserLock\(asset\.userId/);
  assert.match(expiry, /collectProtectedManagedAssetUrls\(\{[\s\S]{0,160}ownerUserId: freshAsset\.userId[\s\S]*requestStoredAssetDeletion/);
});

test('account deletion fences owned agents and all affected chat owners before removing rows', () => {
  const accountDelete = source.match(/const deleteDbUser = async \(userId\)[\s\S]*?\n\};/)?.[0] || '';
  assert.match(accountDelete, /acquireManagedAssetAgentOwnerLock\(connection, userId\)/);
  assert.match(accountDelete, /acquireManagedAssetAgentLocks\(connection, agentIds\)/);
  assert.match(accountDelete, /assertNoPendingDbAgentChatRuns\(connection, \{ agentIds \}\)/);
  assert.match(accountDelete, /SELECT DISTINCT user_id FROM chat_sessions WHERE agent_id IN/);
  assert.match(accountDelete, /acquireManagedAssetUserLocks\(connection, affectedUserIds\)/);
  assert.ok(accountDelete.indexOf('acquireManagedAssetAgentOwnerLock') < accountDelete.indexOf('acquireManagedAssetAgentLocks'));
  assert.ok(accountDelete.indexOf('acquireManagedAssetAgentLocks') < accountDelete.indexOf('acquireManagedAssetUserLocks'));
});

test('state initialization and job writers recheck durable owners after acquiring the lock', () => {
  const ensureState = source.match(/const ensureDbAppState = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(ensureState, /withManagedAssetUserLock\(userId/);
  assert.match(ensureState, /assertActiveDbUserUnderManagedAssetLock\(pool, userId/);

  const mysqlHandler = source.match(/const handleMysqlRequest = async[\s\S]*?\n\};/)?.[0] || source;
  assert.match(mysqlHandler, /url\.pathname === '\/api\/jobs'[\s\S]*req\.method === 'POST'[\s\S]*assertActiveDbUserUnderManagedAssetLock\(lockedPool, user\.id/);
  assert.match(mysqlHandler, /jobResultMatch[\s\S]*withManagedAssetUserLock\(user\.id[\s\S]*getJobById\(lockedPool, job\.id\)[\s\S]*updateResult\?\.affectedRows/);
});

test('all MySQL asset persistence paths hold the owner lock and recheck the account', () => {
  const userLock = source.match(/const withManagedAssetUserLock = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(userLock, /getManagedAssetLockPool\(\)/);
  assert.match(source, /MEIAO_ASSET_LOCK_CONNECTION_LIMIT/);

  const upload = source.match(/const persistUploadedAssetIfEnabled = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(upload, /if \(!shouldUseMysql\)[\s\S]*return persist\(null\)/);
  assert.match(upload, /withManagedAssetUserLock\(user\.id[\s\S]*findAnyDbUserById\(user\.id\)/);

  const jobOutput = source.match(/const persistJobOutputAssetsIfEnabled = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(jobOutput, /withManagedAssetUserLock\(job\.userId[\s\S]*findAnyDbUserById\(job\.userId\)/);

  const runtimeRemote = source.match(/const persistRuntimeRemoteAssetIfEnabled = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(runtimeRemote, /withManagedAssetUserLock\(userId[\s\S]*findAnyDbUserById\(userId\)/);

  const mediaTranscode = source.match(/const mediaTranscodeApi = createMediaTranscodeApi\([\s\S]*?\n\}\);/)?.[0] || '';
  assert.match(mediaTranscode, /withManagedAssetUserLock\(userId[\s\S]*assertActiveDbUserUnderManagedAssetLock\(pool, userId/);
  assert.match(mediaTranscode, /withLocalManagedAssetUserLock\(userId[\s\S]*owner\.status !== 'active'/);
});

test('remote video job results are persisted before every worker records completion', () => {
  const jobOutput = source.match(/const persistJobOutputAssetsIfEnabled = async[\s\S]*?const persistRuntimeRemoteAssetIfEnabled/)?.[0] || '';
  assert.match(jobOutput, /persistRemoteField\('videoUrl', 'video', `\$\{job\.taskType \|\| 'result'\}\.mp4`\)/);

  const workerPersistenceCalls = source.match(/return persistJobOutputAssetsIfEnabled\(job, output\)/g) || [];
  assert.ok(workerPersistenceCalls.length >= 4, 'all MySQL and local Temporal/classic workers persist video outputs');
});

test('account status transitions share the owner lock with asset persistence', () => {
  const mysqlPatchStart = source.indexOf("if (userDetailMatch && req.method === 'PATCH')");
  const mysqlPatchEnd = source.indexOf("if (userDetailMatch && req.method === 'DELETE')", mysqlPatchStart);
  const mysqlPatch = source.slice(mysqlPatchStart, mysqlPatchEnd);
  assert.match(mysqlPatch, /withManagedAssetUserLock\(targetUser\.id/);
  assert.match(mysqlPatch, /findAnyDbUserById\(targetUser\.id, lockedPool\)/);
  assert.match(mysqlPatch, /updateDbUser\(targetUser\.id,[\s\S]*lockedPool\)/);

  const localPatchStart = source.lastIndexOf("if (userDetailMatch && req.method === 'PATCH')");
  const localPatchEnd = source.indexOf("if (userDetailMatch && req.method === 'DELETE')", localPatchStart);
  const localPatch = source.slice(localPatchStart, localPatchEnd);
  assert.match(localPatch, /withLocalManagedAssetUserLock\(targetUser\.id/);
  assert.match(localPatch, /if \(nextStatus\) targetUser\.status = nextStatus;[\s\S]*writeLocalStore\(store\)/);
});

test('local JSON mutations are serialized before reading the full store snapshot', () => {
  assert.match(source, /const withLocalStoreMutationLock = async \(operation\) =>/);
  assert.match(
    source,
    /const handleLocalRequest = async \(req, res, url, \{ mutationLockHeld = false \} = \{\}\) => \{\s*if \(!mutationLockHeld && !\['GET', 'HEAD', 'OPTIONS'\]\.includes\(req\.method\)\) \{\s*return withLocalStoreMutationLock\(\(\) => handleLocalRequest\(req, res, url, \{ mutationLockHeld: true \}\)\);\s*\}\s*let store = readLocalStore\(\)/,
  );
  assert.match(
    source,
    /chatSessionMessagesMatch && req\.method === 'GET'[\s\S]{0,900}withLocalStoreMutationLock\(async \(\) => \{[\s\S]{0,500}const recoveryStore = readLocalStore\(\)/,
  );
  assert.match(source, /createLocalTemporalActivities\(\{[\s\S]{0,250}mutateStore: mutateLocalStore/);
  assert.match(source, /localJobWorker = createLocalJobWorker\(\{[\s\S]{0,250}mutateStore: mutateLocalStore/);
  assert.match(source, /const runManagedAssetCleanupCycle = async \(\{ mutationLockHeld = false \} = \{\}\)[\s\S]{0,300}withLocalStoreMutationLock/);
  assert.match(source, /const cleanupExpiredLogs = async[\s\S]{0,300}mutateLocalStore/);
  assert.match(assetStoreSource, /let localRegistryMutationTail = Promise\.resolve\(\)/);
  assert.match(assetStoreSource, /const mutateLocalRegistry = \(operation\) =>/);
  assert.equal((assetStoreSource.match(/writeLocalRegistry\(assets\)/g) || []).length, 1);
  assert.match(assetStoreSource, /markStoredAssetAccessed[\s\S]{0,500}mutateLocalRegistry/);
  assert.match(
    source,
    /if \(userDetailMatch && req\.method === 'DELETE'\) \{\s*const admin = localRequireAdmin[\s\S]{0,2200}withLocalManagedAssetUserLock\(targetUser\.id/,
  );
});

test('profile agent job and explicit asset mutations use the managed-asset user lock', () => {
  const explicitDelete = source.match(/const deleteStoredAssetForUser = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(explicitDelete, /withManagedAssetUserLock\(asset\.userId/);

  const mysqlHandler = source.match(/const handleMysqlRequest = async[\s\S]*?\n\};/)?.[0] || source;
  assert.match(mysqlHandler, /\/api\/auth\/me'[\s\S]*req\.method === 'PATCH'[\s\S]*withManagedAssetUserLock\(user\.id/);
  const agentCreate = source.match(/const createDbAgent = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(agentCreate, /acquireManagedAssetAgentOwnerLock\(connection, user\.id\)[\s\S]*acquireManagedAssetUserLock\(connection, user\.id\)/);
  assert.match(mysqlHandler, /url\.pathname === '\/api\/agents'[\s\S]*req\.method === 'POST'[\s\S]*createDbAgent\(admin/);
  assert.match(mysqlHandler, /agentDetailMatch[\s\S]*req\.method === 'PATCH'[\s\S]*withManagedAssetUserLock\(agentForLock\.ownerUserId/);
  assert.match(mysqlHandler, /url\.pathname === '\/api\/jobs'[\s\S]*req\.method === 'POST'[\s\S]*withManagedAssetUserLock\(user\.id/);
  assert.match(mysqlHandler, /deleteJobById[\s\S]*withManagedAssetUserLock|withManagedAssetUserLock\(user\.id[\s\S]*deleteJobById/);
});

test('reference protection recursively recognizes managed asset ids independent of hostname', () => {
  const collector = source.match(/const collectStateManagedAssetUrls = \(state, bucket\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(collector, /collectManagedAssetIdsInto\(state, bucket\)/);
});

test('periodic protection and scrubbing are owner-scoped and preserve external profile urls', () => {
  const protection = source.match(/const collectProtectedManagedAssetUrls = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(protection, /ownerUserId = ''/);
  assert.match(protection, /listAllStoredAssetsForUser\(pool, normalizedOwnerUserId\)/);
  assert.match(protection, /WHERE user_id = \?/);
  assert.match(protection, /const addOwnedReferences = \(value, ownerUserId\)/);
  assert.match(protection, /String\(asset\?\.userId \|\| ''\) !== String\(ownerUserId \|\| ''\)/);
  assert.match(protection, /SELECT user_id, state_json FROM app_states/);
  assert.match(protection, /SELECT id, user_id, status, provider_task_id, payload_json, result_json FROM internal_jobs/);
  assert.match(protection, /SELECT user_id, content, attachments_json, metadata_json FROM chat_messages/);
  assert.match(protection, /assetsByJobId/);
  assert.match(protection, /addActiveRunReferences/);

  const profileScrub = source.match(/const scrubDbProtectedManagedAssetRefs = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(profileScrub, /isManagedAssetUrl\(row\.avatar_url\)/);
  assert.match(profileScrub, /refsForUser\(row\.id\)/);
  assert.match(profileScrub, /refsForUser\(row\.owner_user_id\)/);
});
