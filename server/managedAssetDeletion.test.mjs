import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('explicit batch and expiry deletion converge on the durable lifecycle request', () => {
  assert.match(source, /import \{ processAssetCleanupBatch, reconcileManagedAssetStorage \} from '\.\/assetCleanupWorker\.mjs'/);
  assert.match(source, /requestStoredAssetDeletion/);
  const explicitDelete = source.match(/const deleteStoredAssetForUser[\s\S]*?\n\};/)?.[0] || '';
  const batchDelete = source.match(/const deleteStoredAssetsByIdsForUser[\s\S]*?\n\};/)?.[0] || '';
  const expiryDelete = source.match(/const cleanupExpiredStoredAssets[\s\S]*?\n\};/)?.[0] || '';
  assert.match(explicitDelete, /requestStoredAssetDeletion/);
  assert.match(batchDelete, /requestStoredAssetDeletion/);
  assert.match(expiryDelete, /requestStoredAssetDeletion/);
  assert.doesNotMatch(explicitDelete, /deleteStoredAssetFile/);
  assert.doesNotMatch(batchDelete, /deleteStoredAssetFile/);
  assert.doesNotMatch(expiryDelete, /deleteStoredAssetFile/);
});

test('chat deletion removes references before requesting physical asset cleanup', () => {
  assert.match(
    source,
    /const deleteDbChatSession[\s\S]{0,1200}DELETE FROM chat_messages[\s\S]{0,700}deleteStoredAssetsByIdsForUser/,
  );
  assert.match(
    source,
    /const sessionMessages = \(store\.chatMessages \|\| \[\]\)[\s\S]{0,1200}store\.chatMessages =[\s\S]{0,700}deleteStoredAssetsByIdsForUser/,
  );
});

test('account deletion persists cleanup tasks before stored assets and user rows are removed', () => {
  const mysqlDelete = source.match(/const deleteDbUser = async \(userId\)[\s\S]*?\n\};/)?.[0] || '';
  assert.match(mysqlDelete, /SELECT id, provider, storage_key FROM stored_assets/);
  assert.match(mysqlDelete, /enqueueAssetCleanupTask\(connection/);
  assert.ok(mysqlDelete.indexOf('enqueueAssetCleanupTask(connection') < mysqlDelete.indexOf('DELETE FROM stored_assets'));
  assert.doesNotMatch(mysqlDelete, /deleteStoredAssetFile/);

  assert.match(source, /await queueUserAssetsForCleanup\(targetUser\.id\)/);
});

test('job deletion removes the job reference before requesting its managed asset cleanup', () => {
  assert.match(source, /const collectStoredAssetIdsFromJob = \(job\) =>/);
  assert.match(
    source,
    /if \(!deletion\.deleted\)[\s\S]{0,900}await deleteStoredAssetsByIdsForUser\(\{[\s\S]{0,300}reason: 'job_deleted'/,
  );
  assert.match(
    source,
    /deleteLocalJobRecord\(store, jobToDelete\.id\);[\s\S]{0,500}await deleteStoredAssetsByIdsForUser\(\{[\s\S]{0,300}referenceStore: store/,
  );
});

test('state saves queue assets removed by project or task deletion after the new state is durable', () => {
  assert.match(source, /queueRemovedStateAssetsForCleanup/);
  assert.match(
    source,
    /await saveDbAppState\(user\.id, nextState\);[\s\S]{0,300}await queueRemovedStateAssetsForCleanup/,
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
  assert.match(source, /MEIAO_ASSET_CLEANUP_ALERT_BACKLOG/);
  assert.match(source, /MEIAO_ASSET_CLEANUP_ALERT_OLDEST_MS/);
});
