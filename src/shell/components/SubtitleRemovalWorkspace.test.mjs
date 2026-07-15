import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubtitleRemovalWorkspace.tsx', import.meta.url), 'utf8');
const videoModuleSource = readFileSync(new URL('../modules/Video/VideoModule.tsx', import.meta.url), 'utf8');

test('workspace accepts videos and starts the subtitle media profile immediately', () => {
  assert.match(source, /accept="video\/\*"/);
  assert.match(source, /multiple/);
  assert.match(source, /file\.type\.startsWith\('video\/'\)/);
  assert.match(source, /createMediaTranscodeSession\(\{/);
  assert.match(source, /kind: 'video'/);
  assert.match(source, /profile: 'subtitle_removal'/);
  assert.match(source, /onUploadProgress/);
  assert.match(source, /progress\.ratio/);
});

test('workspace converts the full authoritative source duration and explains the path', () => {
  assert.match(source, /startSeconds: 0/);
  assert.match(source, /endSeconds: probe\.durationSeconds/);
  assert.match(source, /probe\.durationSeconds > 600/);
  assert.match(source, /result\.transcoded/);
  assert.match(source, /原视频已是兼容格式/);
  assert.match(source, /正在保留原画幅转换为 H\.264 MP4/);
});

test('workspace gives every queued video its own default region and cancellable session', () => {
  assert.match(source, /DEFAULT_SUBTITLE_REGION/);
  assert.match(source, /regionMode: 'default'/);
  assert.match(source, /clientItemId/);
  assert.match(source, /AbortController/);
  assert.match(source, /cancelMediaTranscodeSession/);
  assert.match(source, /return \(\) => \{/);
  assert.match(source, /sessionIdsRef\.current/);
});

test('workspace renders a list-first batch flow and separate region editor', () => {
  assert.match(source, /去字幕批量任务/);
  assert.match(source, /批量任务/);
  assert.match(source, /默认区域/);
  assert.match(source, /已调整/);
  assert.match(source, /调整区域/);
  assert.match(source, /SubtitleRemovalRegionDialog/);
  assert.doesNotMatch(source, /event\.target\.files\?\.\[0\]/);
});

test('workspace synchronously blocks duplicate batch submission', () => {
  assert.match(source, /submitLockRef\.current/);
  assert.match(source, /submitLockRef\.current = true/);
  assert.match(source, /批量开始去字幕/);
  assert.match(source, /本次将创建/);
  assert.match(source, /await onSubmit/);
  assert.match(source, /submitLockRef\.current = false/);
});

test('workspace only submits selected ready sources with valid pixel regions', () => {
  assert.match(source, /subtitleRegionToPixels/);
  assert.match(source, /readySelectedCount/);
  assert.match(source, /item\.selected/);
  assert.match(source, /item\.phase === 'ready'/);
  assert.match(source, /批量开始去字幕/);
});

test('workspace supports drag and drop and enforces the published batch limit', () => {
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /batchMaxItems/);
  assert.match(source, /一次最多上传/);
});

test('video module keeps the batch workspace mounted while users inspect result tabs', () => {
  assert.match(videoModuleSource, /hidden=\{activeSubFeature !== 'subtitle_removal'\}/);
  assert.match(videoModuleSource, /subtitleRemovalBatchLimits/);
  assert.doesNotMatch(videoModuleSource, /activeSubFeature === 'subtitle_removal' \? \(\s*<SubtitleRemovalWorkspace/);
});
