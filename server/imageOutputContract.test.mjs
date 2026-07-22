import test from 'node:test';
import assert from 'node:assert/strict';

import { createProviderCompletedImageOutputRejectedError } from './imageOutputContract.mjs';

test('provider-completed image rejection hides the result URL and preserves quarantine evidence', () => {
  const error = createProviderCompletedImageOutputRejectedError({
    job: { provider: 'kie', providerTaskId: 'provider-task-1' },
    output: { providerTaskId: 'provider-task-1', result: { imageUrl: 'https://temp.test/raw.png', prompt: 'safe' } },
    result: { imageUrl: 'https://temp.test/raw.png', imageUrlAssetId: 'visible-asset', prompt: 'safe' },
    sourceUrl: 'https://temp.test/raw.png',
    persisted: { id: 'quarantine-asset', publicUrl: '/api/assets/file/quarantine-asset/raw.jpg' },
    transformed: { sourceWidth: 899, sourceHeight: 1750, targetWidth: 312, targetHeight: 840 },
  });

  assert.equal(error.code, 'image_output_aspect_ratio_mismatch');
  assert.equal(error.providerCompleted, true);
  assert.equal(error.providerTaskId, 'provider-task-1');
  assert.equal(error.rejectedOutput.result.imageUrl, undefined);
  assert.equal(error.rejectedOutput.result.imageUrlAssetId, undefined);
  assert.equal(error.rejectedOutput.result.quarantinedImageAssetId, 'quarantine-asset');
  assert.equal(error.rejectedOutput.result.providerImageUrl, 'https://temp.test/raw.png');
  assert.equal(error.rejectedOutput.result.imageOutputContract.status, 'rejected');
});

test('quarantine persistence failure still marks provider completion for correct billing finalization', () => {
  const storageError = Object.assign(new Error('secret storage detail'), {
    code: 'managed_asset_persist_failed',
  });
  const error = createProviderCompletedImageOutputRejectedError({
    job: { provider: 'maxforai' },
    output: { result: { imageUrl: 'data:image/png;base64,secret' } },
    result: { imageUrl: 'data:image/png;base64,secret' },
    transformed: { sourceWidth: 899, sourceHeight: 1750, targetWidth: 312, targetHeight: 840 },
    quarantineError: storageError,
  });

  assert.equal(error.providerCompleted, true);
  assert.equal(error.rejectedOutput.result.imageUrl, undefined);
  assert.equal(error.rejectedOutput.result.quarantinedImageUrl, undefined);
  assert.deepEqual(error.rejectedOutput.result.imageOutputContract.quarantinePersistence, {
    status: 'failed',
    code: 'managed_asset_persist_failed',
  });
  assert.doesNotMatch(JSON.stringify(error.rejectedOutput), /base64|secret storage detail|data:image/);
  assert.equal(error.cause, undefined);
  assert.equal(error.quarantinePersistenceErrorCode, 'managed_asset_persist_failed');
});
