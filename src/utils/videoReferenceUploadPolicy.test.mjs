import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getReferenceVideoUploadPolicy,
  shouldUseSeedanceMediaPreparation,
} from './videoReferenceUploadPolicy.mjs';

test('storyboard generation keeps the complete reference video instead of applying the Seedance 15-second trim', () => {
  assert.deepEqual(getReferenceVideoUploadPolicy({
    activeSubFeature: 'storyboard',
    videoMode: '爆款复刻',
  }), {
    requiresSeedancePreparation: false,
    maxDurationSeconds: null,
    durationHint: '上传完整爆款视频进行拆解，不受短视频生成 15 秒参考素材上限影响。',
  });
  assert.equal(shouldUseSeedanceMediaPreparation({
    activeSubFeature: 'storyboard',
    videoMode: 'viral_split',
    mediaType: 'referenceVideo',
  }), false);
  assert.equal(shouldUseSeedanceMediaPreparation({
    activeSubFeature: 'storyboard',
    videoMode: '原创分镜',
    mediaType: 'referenceVideo',
  }), false);
});

test('short-video generation keeps the Seedance trim flow for references over 15 seconds', () => {
  assert.deepEqual(getReferenceVideoUploadPolicy({
    activeSubFeature: 'generation',
    videoMode: '原创生成',
  }), {
    requiresSeedancePreparation: true,
    maxDurationSeconds: 15,
    durationHint: '单个 2–15 秒，最多 3 个，总时长不超过 15 秒；超过 15 秒请先选择范围截取。',
  });
  assert.equal(shouldUseSeedanceMediaPreparation({
    activeSubFeature: 'generation',
    videoMode: '原创生成',
    mediaType: 'referenceVideo',
  }), true);
  assert.equal(shouldUseSeedanceMediaPreparation({
    activeSubFeature: 'generation',
    videoMode: '原创生成',
    mediaType: 'audio',
  }), true);
});

test('the upload shell and material hint both consume the shared duration policy', () => {
  const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
  const inputBarSource = readFileSync(new URL('../shell/components/layout/BottomInputBar.tsx', import.meta.url), 'utf8');

  assert.match(shellSource, /shouldUseSeedanceMediaPreparation\(\{/);
  assert.match(inputBarSource, /getReferenceVideoUploadPolicy\(\{/);
  assert.match(inputBarSource, /referenceVideoPolicy\.durationHint/);
});
