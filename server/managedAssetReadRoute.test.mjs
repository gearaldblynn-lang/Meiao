import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('stored asset route redirects active COS images to a fresh browser signed URL', () => {
  assert.match(source, /import \{ resolveManagedAssetReadUrl \} from '\.\/managedAssetReadResolver\.mjs'/);
  assert.match(
    source,
    /const serveStoredAsset[\s\S]{0,1000}asset\.storageStatus[\s\S]{0,1000}asset\.provider === 'tencent_cos'[\s\S]{0,1000}purpose: 'browser'[\s\S]{0,1000}'Location': signedReadUrl/,
  );
  assert.match(source, /res\.writeHead\(302/);
});

test('provider execution injects the signed managed image resolver scoped to the job owner', () => {
  assert.match(
    source,
    /const executeProviderJobWithManagedAssetScrub[\s\S]{0,1800}assetTransferDeps[\s\S]{0,800}resolveManagedAssetReadUrl[\s\S]{0,500}userId: job\?\.userId/,
  );
});
