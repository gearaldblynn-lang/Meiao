import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('asset cleanup treats current user avatars and agent icons as managed-asset references', () => {
  assert.match(source, /const collectProtectedManagedAssetUrls = async \(\{ pool = null, store = null \}\) => \{/);
  assert.match(source, /users\.map\(\(item\) => item\.avatarUrl\)/);
  assert.match(source, /agents\.map\(\(item\) => item\.iconUrl\)/);
  assert.match(source, /SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL AND avatar_url <> ''/);
  assert.match(source, /SELECT icon_url FROM agents WHERE icon_url IS NOT NULL AND icon_url <> ''/);
});

test('asset cleanup marks protected managed assets as referenced before expiry filtering', () => {
  assert.match(source, /const protectedAssetUrls = await collectProtectedManagedAssetUrls\(/);
  assert.match(source, /isReferenced: protectedAssetUrls\.has\(asset\.publicUrl\)/);
});
