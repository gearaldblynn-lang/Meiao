import test from 'node:test';
import assert from 'node:assert/strict';

import { createMaterialUploadCoordinator } from './materialUploadCoordinator.ts';

test('material upload coordinator shares one upload for concurrent callers', async () => {
  const coordinator = createMaterialUploadCoordinator();
  let calls = 0;
  let resolveUpload;
  const upload = () => {
    calls += 1;
    return new Promise((resolve) => {
      resolveUpload = resolve;
    });
  };

  const first = coordinator.run('draft-video-1', upload);
  const second = coordinator.run('draft-video-1', upload);

  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(coordinator.size(), 1);
  resolveUpload('https://meiaoyuntai.com/api/assets/file/video-1/source.mp4');
  assert.equal(await first, 'https://meiaoyuntai.com/api/assets/file/video-1/source.mp4');
  assert.equal(await second, 'https://meiaoyuntai.com/api/assets/file/video-1/source.mp4');
  assert.equal(coordinator.size(), 0);
  assert.equal(
    await coordinator.run('draft-video-1', upload),
    'https://meiaoyuntai.com/api/assets/file/video-1/source.mp4',
  );
  assert.equal(calls, 1);
});

test('material upload coordinator clears failed work so a later submit can retry', async () => {
  const coordinator = createMaterialUploadCoordinator();
  let calls = 0;

  await assert.rejects(
    coordinator.run('draft-video-2', async () => {
      calls += 1;
      throw new Error('temporary upload failure');
    }),
    /temporary upload failure/,
  );

  const url = await coordinator.run('draft-video-2', async () => {
    calls += 1;
    return 'https://meiaoyuntai.com/api/assets/file/video-2/source.mp4';
  });
  assert.equal(calls, 2);
  assert.equal(url, 'https://meiaoyuntai.com/api/assets/file/video-2/source.mp4');
  assert.equal(coordinator.size(), 0);
});
