import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('asset cleanup treats current user avatars and agent icons as managed-asset references', () => {
  assert.match(source, /const collectProtectedManagedAssetUrls = async \(\{ pool = null, store = null \}\) => \{/);
  assert.match(source, /users\.map\(\(item\) => item\.avatarUrl\)/);
  assert.match(source, /agents\.map\(\(item\) => item\.iconUrl\)/);
  assert.match(source, /collectOneClickReferencePresetAssetUrls/);
  assert.match(source, /collectStateManagedAssetUrls/);
  assert.match(source, /'uploadedUrl'/);
  assert.match(source, /presets\.presets/);
  assert.match(source, /referenceImageUrls/);
  assert.match(source, /SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''/);
  assert.match(source, /SELECT icon_url FROM agents WHERE icon_url IS NOT NULL AND icon_url <> ''/);
  assert.match(source, /SELECT state_json FROM app_states/);
});

test('asset cleanup marks protected managed assets as referenced before expiry filtering', () => {
  assert.match(source, /const protectedAssetUrls = await collectProtectedManagedAssetUrls\(/);
  assert.match(source, /isReferenced: protectedAssetUrls\.has\(asset\.publicUrl\) \|\| protectedAssetUrls\.has\(asset\.id\)/);
});

test('state loading scrubs deleted managed sku image items before returning to client', () => {
  assert.match(source, /scrubDbStateForUnavailableManagedAssets\(await getDbAppState\(user\.id\)\)/);
  assert.match(source, /scrubLocalStateForUnavailableManagedAssets\(store\.appStates\[user\.id\]/);
  assert.match(source, /value\.role === 'product' \|\| value\.role === 'gift' \|\| value\.role === 'style_ref'/);
});

test('state saving scrubs deleted managed assets before they can be persisted again', () => {
  assert.match(source, /const scrubDbStateBeforeStorage = async \(state\) => \{/);
  assert.match(source, /const scrubLocalStateBeforeStorage = async \(state\) => \{/);
  assert.match(source, /const nextState = await scrubDbStateBeforeStorage\(\s*mergeAppStateForStorage\(await getDbAppState\(user\.id\), incomingState\)\s*\)/);
  assert.match(source, /store\.appStates\[user\.id\] = await scrubLocalStateBeforeStorage\(\s*mergeAppStateForStorage\(store\.appStates\[user\.id\] \|\| createDefaultState\(\), incomingState\)\s*\)/);
});
