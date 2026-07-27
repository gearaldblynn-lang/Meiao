import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeAppStateForStorage, writeMergedAppStateUnderUserLock } from './appStateMerge.mjs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('asset cleanup treats current user avatars and agent icons as managed-asset references', () => {
  assert.match(source, /const collectProtectedManagedAssetUrls = async \(\{ pool = null, store = null, ownerUserId = '' \}\) => \{/);
  assert.match(source, /users\.forEach\(\(item\) => addOwnedReferences\(item\.avatarUrl, item\.id\)\)/);
  assert.match(source, /agents\.forEach\(\(item\) => addOwnedReferences\(item\.iconUrl, item\.ownerUserId\)\)/);
  assert.match(source, /collectOneClickReferencePresetAssetUrls/);
  assert.match(source, /collectStateManagedAssetUrls/);
  assert.match(source, /'uploadedUrl'/);
  assert.match(source, /presets\.presets/);
  assert.match(source, /referenceImageUrls/);
  assert.match(source, /SELECT id, avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''/);
  assert.match(source, /SELECT owner_user_id, icon_url FROM agents WHERE icon_url IS NOT NULL AND icon_url <> ''/);
  assert.match(source, /SELECT user_id, state_json FROM app_states/);
});

test('asset cleanup marks protected managed assets as referenced before expiry filtering', () => {
  assert.match(source, /const protectedAssetUrls = await collectProtectedManagedAssetUrls\(/);
  assert.match(source, /isReferenced: protectedAssetUrls\.has\(asset\.publicUrl\) \|\| protectedAssetUrls\.has\(asset\.id\)/);
  assert.match(source, /const assetsByJobId = new Map\(\)/);
  assert.match(source, /const addActiveRunReferences = \(value, ownerUserId\) => \{/);
  assert.match(source, /addActiveRunReferences\(metadata, row\.user_id\)/);
  assert.match(source, /addActiveRunReferences\(message\?\.metadata, message\?\.userId\)/);
  const collectProtectedIndex = source.indexOf('const protectedAssetUrls = await collectProtectedManagedAssetUrls');
  const selectExpiredIndex = source.indexOf('selectExpiredAssetsForCleanup(assetsWithReferences');
  assert.ok(collectProtectedIndex >= 0 && selectExpiredIndex > collectProtectedIndex);
  const protectedCollector = source.match(/const collectProtectedManagedAssetUrls = async[\s\S]*?return protectedUrls;\n\};/)?.[0] || '';
  assert.match(protectedCollector, /collectStateManagedAssetUrls\(state, stateRefs\)/);
});

test('state loading scrubs deleted managed sku image items before returning to client', () => {
  assert.match(source, /scrubDbStateForUnavailableManagedAssets\(await getDbAppState\(user\.id\), user\.id\)/);
  assert.match(source, /scrubLocalStateForUnavailableManagedAssets\(store\.appStates\[user\.id\][\s\S]{0,100}, user\.id\)/);
  assert.match(source, /value\.role === 'product' \|\| value\.role === 'gift' \|\| value\.role === 'style_ref'/);
});

test('state saving scrubs deleted managed assets before they can be persisted again', () => {
  assert.match(source, /const scrubDbStateBeforeStorage = async \(state, userId\) => \{/);
  assert.match(source, /const scrubLocalStateBeforeStorage = async \(state, userId\) => \{/);
  const mysqlStateRoute = source.match(/if \(url\.pathname === '\/api\/state' && req\.method === 'PUT'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const lockedStateWrite = source.match(/const saveDbAppStateAndQueueRemovedAssetsUnderLock = async[\s\S]*?\n\};/)?.[0] || '';
  assert.match(mysqlStateRoute, /writeMergedAppStateUnderUserLock/);
  assert.match(mysqlStateRoute, /withUserLock: withManagedAssetUserLock/);
  assert.match(mysqlStateRoute, /readState: getDbAppStateUnderManagedAssetLock/);
  assert.match(mysqlStateRoute, /scrubState: scrubDbStateBeforeStorage/);
  assert.match(mysqlStateRoute, /saveState: saveDbAppStateAndQueueRemovedAssetsUnderLock/);
  assert.match(lockedStateWrite, /beginTransaction\(\)[\s\S]*INSERT INTO app_states[\s\S]*ON DUPLICATE KEY UPDATE[\s\S]*queueRemovedStateAssetsForCleanup[\s\S]*commit\(\)/);
  assert.match(source, /const previousState = store\.appStates\[user\.id\] \|\| createDefaultState\(\);[\s\S]{0,300}const nextState = await scrubLocalStateBeforeStorage\(\s*mergeAppStateForStorage\(previousState, incomingState\),\s*user\.id,\s*\)/);
});

test('locked app-state writer scrubs the merged state before saving the same scrubbed value', async () => {
  const user = { id: 'asset-cleanup-order-user' };
  const lockResource = { kind: 'managed-asset-user-lock' };
  const previousState = {
    draftInput: { prompt: 'existing prompt' },
    shellProjects: [{ id: 'existing-project', status: 'completed', results: [] }],
  };
  const incomingState = {
    draftInput: { prompt: 'incoming prompt' },
    shellProjects: [{ id: 'incoming-project', status: 'generating', results: [] }],
  };
  const expectedMergedState = mergeAppStateForStorage(previousState, incomingState);
  const scrubbedState = { ...expectedMergedState, scrubbed: true };
  const calls = [];

  const response = await writeMergedAppStateUnderUserLock({
    user,
    incomingState,
    withUserLock: async (userId, operation) => {
      calls.push('lock');
      assert.equal(userId, user.id);
      return operation(lockResource);
    },
    readState: async (userId, resource) => {
      calls.push('read');
      assert.equal(userId, user.id);
      assert.equal(resource, lockResource);
      return previousState;
    },
    scrubState: async (mergedState, userId, resource) => {
      calls.push('scrub');
      assert.deepEqual(mergedState, expectedMergedState);
      assert.equal(userId, user.id);
      assert.equal(resource, lockResource);
      return scrubbedState;
    },
    saveState: async ({ lockResource: resource, user: savedUser, previousState: savedPreviousState, nextState }) => {
      calls.push('save');
      assert.equal(resource, lockResource);
      assert.equal(savedUser, user);
      assert.equal(savedPreviousState, previousState);
      assert.equal(nextState, scrubbedState);
      return nextState;
    },
  });

  assert.deepEqual(calls, ['lock', 'read', 'scrub', 'save']);
  assert.deepEqual(response, { ok: true });
});

test('job creation scrubs stale managed assets from direct payload submissions', () => {
  assert.match(source, /const MANAGED_ASSET_REFERENCE_PATTERN = /);
  assert.match(source, /value\.replace\(MANAGED_ASSET_REFERENCE_PATTERN,/);
  assert.match(source, /value\.type === 'image_url'/);
  assert.match(source, /const scrubDbJobPayloadBeforeSubmission = async \(payload, userId\) => \{/);
  assert.match(source, /const scrubLocalJobPayloadBeforeSubmission = async \(payload, userId\) => \{/);
  assert.match(
    source,
    /payload: await scrubDbJobPayloadBeforeSubmission\(\s*await createLibraryModelJobPayload\(\{ payload: body\.payload, pool, user \}\),\s*user\.id,\s*\)/,
  );
  assert.match(source, /const recoveredPayload = await scrubDbJobPayloadBeforeSubmission\(\{/);
  assert.match(
    source,
    /payload: await scrubLocalJobPayloadBeforeSubmission\(\s*await createLibraryModelJobPayload\(\{ payload: body\.payload, store, user \}\),\s*user\.id,\s*\)/,
  );
  assert.match(source, /const recoveredPayload = await scrubLocalJobPayloadBeforeSubmission\(\{/);
});

test('provider execution boundary also scrubs stale managed assets', () => {
  assert.match(source, /const executeProviderJobWithManagedAssetScrub = async \(job, env, signal, options\) => \{/);
  assert.match(source, /taskType === 'upload_asset'/);
  assert.match(source, /shouldUseMysql\s+\? await scrubDbJobPayloadBeforeSubmission\(job\?\.payload, job\?\.userId\)/);
  assert.match(source, /: await scrubLocalJobPayloadBeforeSubmission\(job\?\.payload, job\?\.userId\)/);
  assert.match(
    source,
    /executeDefault:\s*\(\) => executeProviderJobWithManagedAssetScrub\(job, env, signal, options\)/,
  );
  assert.equal(
    (source.match(/const output = await executeApplicationJob\(job, process\.env, signal, options\);/g) || []).length,
    4,
  );
});

test('managed asset availability accepts active COS objects and checks every historical local path', () => {
  assert.match(source, /asset\.storageStatus !== 'active'/);
  assert.match(source, /getStoredAssetStorageProvider\(asset\) === 'internal'/);
  assert.match(source, /existsSync\(resolveStoredAssetPath\(asset\)\)/);
  assert.doesNotMatch(source, /existsSync\(resolveStoredAssetPath\(asset\.storageKey\)\)/);
});
