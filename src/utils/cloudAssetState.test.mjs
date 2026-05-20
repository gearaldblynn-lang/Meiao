import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPersistedResultFileName,
  getTaskDisplayName,
  hasAvailableAssetSources,
  hasReusableTaskAsset,
} from './cloudAssetState.mjs';

test('hasAvailableAssetSources treats uploaded urls as valid inputs after refresh', () => {
  assert.equal(hasAvailableAssetSources([], ['https://example.com/source.png']), true);
  assert.equal(hasAvailableAssetSources([], []), false);
});

test('hasReusableTaskAsset keeps remote-backed tasks even when file objects are gone', () => {
  assert.equal(
    hasReusableTaskAsset({
      file: null,
      sourceUrl: 'https://example.com/source.png',
      taskId: '',
    }),
    true
  );
  assert.equal(
    hasReusableTaskAsset({
      file: null,
      sourceUrl: '',
      resultUrl: '',
      taskId: '',
    }),
    false
  );
});

test('getTaskDisplayName prefers persisted fileName and falls back safely', () => {
  assert.equal(getTaskDisplayName({ fileName: 'demo.png', relativePath: 'a/b.png' }), 'demo.png');
  assert.equal(getTaskDisplayName({ relativePath: 'a/b.png' }), 'a/b.png');
  assert.equal(getTaskDisplayName({}), '未命名任务');
});

test('buildPersistedResultFileName appends result suffix without losing extension', () => {
  assert.equal(buildPersistedResultFileName('detail-banner.jpg'), 'detail-banner_result.jpg');
  assert.equal(buildPersistedResultFileName('detail-banner'), 'detail-banner_result.png');
});
