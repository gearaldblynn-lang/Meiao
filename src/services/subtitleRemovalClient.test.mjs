import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSubtitleRemovalJobRequest,
  buildSubtitleRemovalSubmissionKey,
} from './subtitleRemovalClient.ts';

const input = {
  userId: 'user-7',
  sourceUrl: 'https://meiao.example/api/assets/file/asset-99.mp4?accessKey=signed-secret',
  sourceAssetId: 'asset-99',
  sourceProjectId: 'source-project',
  sourceResultId: 'source-result',
  shellProjectId: 'subtitle-project',
  shellProjectName: '去字幕 0715-01',
  batchId: 'batch-1',
  batchIndex: 0,
  batchCount: 2,
  shellResultId: 'batch-1-result-0',
  draftNonce: 'draft-123',
  subtitleRegionNormalized: { x: 0.1, y: 0.7, width: 0.8, height: 0.25 },
};

test('subtitle removal request is bound to the paid provider and zero retries', () => {
  const clientSubmissionKey = buildSubtitleRemovalSubmissionKey(input);
  assert.deepEqual(buildSubtitleRemovalJobRequest(input), {
    module: 'video',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    maxRetries: 0,
    payload: {
      taskPurpose: 'subtitle_removal',
      subFeature: 'subtitle_removal',
      sourceUrl: input.sourceUrl,
      subtitleRegionNormalized: input.subtitleRegionNormalized,
      sourceProjectId: input.sourceProjectId,
      sourceResultId: input.sourceResultId,
      shellProjectId: input.shellProjectId,
      shellProjectName: input.shellProjectName,
      batchId: input.batchId,
      batchIndex: input.batchIndex,
      batchCount: input.batchCount,
      shellResultId: input.shellResultId,
      clientSubmissionKey,
    },
  });
});

test('stable submission key uses owned source identity, region, user and draft nonce without secrets', () => {
  const key = buildSubtitleRemovalSubmissionKey({
    ...input,
    bearerToken: 'bearer-never-include',
  });

  assert.match(key, /subtitle_removal/);
  assert.match(key, /user-7/);
  assert.match(key, /asset-99/);
  assert.match(key, /0\.1,0\.7,0\.8,0\.25/);
  assert.match(key, /draft-123/);
  assert.match(key, /batch-1-result-0/);
  assert.doesNotMatch(key, /accessKey|signed-secret|bearer-never-include/);
  assert.equal(buildSubtitleRemovalSubmissionKey(input), key);
  assert.notEqual(buildSubtitleRemovalSubmissionKey({ ...input, draftNonce: 'draft-next' }), key);
  assert.notEqual(buildSubtitleRemovalSubmissionKey({
    ...input,
    batchIndex: 1,
    shellResultId: 'batch-1-result-1',
  }), key);
});

test('source pathname is used when an explicit managed asset id is unavailable', () => {
  const key = buildSubtitleRemovalSubmissionKey({ ...input, sourceAssetId: '' });
  assert.match(key, /asset-99\.mp4/);
  assert.doesNotMatch(key, /accessKey|signed-secret/);
});

test('retry can reuse the original submission identity after a lost create response', () => {
  const originalKey = buildSubtitleRemovalSubmissionKey(input);
  const retried = buildSubtitleRemovalJobRequest({
    ...input,
    draftNonce: 'a-new-nonce-that-must-not-change-identity',
    clientSubmissionKey: originalKey,
  });

  assert.equal(retried.payload.clientSubmissionKey, originalKey);
});
