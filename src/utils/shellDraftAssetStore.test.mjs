import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRestoredShellDraftAssetUrls } from './shellDraftAssetRestore.mjs';

test('restores local draft video preview url even when a remote url exists', () => {
  const restored = applyRestoredShellDraftAssetUrls(
    {
      referenceVideo: [{
        id: 'video-1',
        localAssetId: 'asset-video-1',
        url: 'https://tempfile.redpandaai.co/openrouter-chat/expired',
        remoteUrl: 'https://tempfile.redpandaai.co/openrouter-chat/expired',
        fileName: '车前子壳已剪.mp4',
      }],
    },
    [{
      id: 'asset-video-1',
      blob: new Blob(['video-bytes'], { type: 'video/mp4' }),
      fileName: '车前子壳已剪.mp4',
      mimeType: 'video/mp4',
      updatedAt: 1,
    }],
    () => 'blob:restored-video-url',
  );

  assert.equal(restored.referenceVideo[0].url, 'blob:restored-video-url');
  assert.equal(restored.referenceVideo[0].remoteUrl, 'https://tempfile.redpandaai.co/openrouter-chat/expired');
  assert.equal(restored.referenceVideo[0].localAssetId, 'asset-video-1');
});

test('keeps materials unchanged when the local draft asset is unavailable', () => {
  const material = {
    id: 'video-1',
    localAssetId: 'missing-asset',
    url: 'https://example.com/video.mp4',
    remoteUrl: 'https://example.com/video.mp4',
    fileName: 'video.mp4',
  };

  const restored = applyRestoredShellDraftAssetUrls({ referenceVideo: [material] }, [], () => 'blob:unused');
  assert.equal(restored.referenceVideo[0], material);
});
