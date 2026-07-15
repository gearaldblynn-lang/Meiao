import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('stored asset route redirects active COS images to a fresh browser signed URL', () => {
  assert.match(source, /import \{ resolveManagedAssetReadUrl \} from '\.\/managedAssetReadResolver\.mjs'/);
  assert.match(source, /verifyManagedAssetAccessKey/);
  assert.match(
    source,
    /const serveStoredAsset[\s\S]{0,1400}asset\.storageStatus[\s\S]{0,1400}getStoredAssetStorageProvider\(asset\) === 'tencent_cos'[\s\S]{0,1400}verifyManagedAssetAccessKey[\s\S]{0,1400}purpose: 'browser'[\s\S]{0,1400}'Location': signedReadUrl/,
  );
  assert.match(source, /res\.writeHead\(302/);
});

test('provider execution injects the signed managed image resolver scoped to the job owner', () => {
  assert.match(
    source,
    /const executeProviderJobWithManagedAssetScrub[\s\S]{0,1800}assetTransferDeps[\s\S]{0,800}resolveManagedAssetReadUrl[\s\S]{0,500}userId: job\?\.userId/,
  );
});

test('provider video probe uses the local file path for internal managed assets', () => {
  assert.match(
    source,
    /const executeProviderJobWithManagedAssetScrub[\s\S]{0,2600}probeVideo: async[\s\S]{0,800}extractStoredAssetIdFromPublicUrl[\s\S]{0,800}getStoredAssetById[\s\S]{0,800}getStoredAssetStorageProvider\(asset\) === 'internal'[\s\S]{0,500}resolveStoredAssetPath\(asset\)[\s\S]{0,500}mediaTranscodeService\.probe/,
  );
});

test('subtitle removal stages local managed videos before handing them to the external provider', () => {
  assert.match(source, /resolveProviderGenerationMediaUrl/);
  assert.match(
    source,
    /const executeProviderJobWithManagedAssetScrub[\s\S]{0,3200}resolveProviderSourceUrl:[\s\S]{0,1200}resolveProviderGenerationMediaUrl[\s\S]{0,1200}uploadAssetViaKieStream/,
  );
});

test('managed asset scrubbing is scoped to the current owner instead of every active asset', () => {
  assert.match(source, /listStoredAssetsForUser,/);
  assert.match(source, /scrubDbJobPayloadBeforeSubmission\(job\?\.payload, job\?\.userId\)/);
  assert.match(source, /scrubLocalJobPayloadBeforeSubmission\(job\?\.payload, job\?\.userId\)/);
});
