import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.match(lockedStateWrite, /beginTransaction\(\)[\s\S]*INSERT INTO app_states[\s\S]*queueRemovedStateAssetsForCleanup[\s\S]*commit\(\)/);
  assert.match(source, /const previousState = store\.appStates\[user\.id\] \|\| createDefaultState\(\);[\s\S]{0,300}const nextState = await scrubLocalStateBeforeStorage\(\s*mergeAppStateForStorage\(previousState, incomingState\),\s*user\.id,\s*\)/);
});

test('job creation scrubs stale managed assets from direct payload submissions', () => {
  assert.match(source, /const MANAGED_ASSET_REFERENCE_PATTERN = /);
  assert.match(source, /value\.replace\(MANAGED_ASSET_REFERENCE_PATTERN,/);
  assert.match(source, /value\.type === 'image_url'/);
  assert.match(source, /const scrubDbJobPayloadBeforeSubmission = async \(payload, userId\) => \{/);
  assert.match(source, /const scrubLocalJobPayloadBeforeSubmission = async \(payload, userId\) => \{/);
  assert.match(source, /payload: await scrubDbJobPayloadBeforeSubmission\(body\.payload, user\.id\)/);
  assert.match(source, /const recoveredPayload = await scrubDbJobPayloadBeforeSubmission\(\{/);
  assert.match(source, /payload: await scrubLocalJobPayloadBeforeSubmission\(body\.payload, user\.id\)/);
  assert.match(source, /const recoveredPayload = await scrubLocalJobPayloadBeforeSubmission\(\{/);
});

test('provider execution boundary also scrubs stale managed assets', () => {
  assert.match(source, /const executeProviderJobWithManagedAssetScrub = async \(job, env, signal, options\) => \{/);
  assert.match(source, /taskType === 'upload_asset'/);
  assert.match(source, /shouldUseMysql\s+\? await scrubDbJobPayloadBeforeSubmission\(job\?\.payload, job\?\.userId\)/);
  assert.match(source, /: await scrubLocalJobPayloadBeforeSubmission\(job\?\.payload, job\?\.userId\)/);
  assert.match(source, /executeJob: async \(job, signal, options\) => \{\s*const output = await executeProviderJobWithManagedAssetScrub/);
});

test('managed asset availability accepts active COS objects and checks every historical local path', () => {
  assert.match(source, /asset\.storageStatus !== 'active'/);
  assert.match(source, /getStoredAssetStorageProvider\(asset\) === 'internal'/);
  assert.match(source, /existsSync\(resolveStoredAssetPath\(asset\)\)/);
  assert.doesNotMatch(source, /existsSync\(resolveStoredAssetPath\(asset\.storageKey\)\)/);
});
