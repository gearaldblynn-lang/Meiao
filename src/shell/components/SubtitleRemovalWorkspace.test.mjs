import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubtitleRemovalWorkspace.tsx', import.meta.url), 'utf8');

test('workspace accepts videos and starts the subtitle media profile immediately', () => {
  assert.match(source, /accept="video\/\*"/);
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

test('workspace resets the region and cancels unfinished sessions', () => {
  assert.match(source, /DEFAULT_SUBTITLE_REGION/);
  assert.match(source, /setRegion\(\{ \.\.\.DEFAULT_SUBTITLE_REGION \}\)/);
  assert.match(source, /cancelMediaTranscodeSession/);
  assert.match(source, /return \(\) => \{/);
  assert.match(source, /sessionIdRef\.current/);
  assert.match(source, /onDraftChange\(null\)/);
});

test('workspace synchronously blocks duplicate task submission', () => {
  assert.match(source, /submitLockRef\.current/);
  assert.match(source, /submitLockRef\.current = true/);
  assert.match(source, /await onSubmit/);
  assert.match(source, /submitLockRef\.current = false/);
});

test('workspace only enables start after a managed source and valid pixel region exist', () => {
  assert.match(source, /subtitleRegionToPixels/);
  assert.match(source, /const canSubmit =/);
  assert.match(source, /draft\?\.sourceUrl/);
  assert.match(source, /开始去字幕/);
  assert.match(source, /<SubtitleRegionEditor/);
});
