import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const bottomInputSource = readFileSync(new URL('./components/layout/BottomInputBar.tsx', import.meta.url), 'utf8');
const selectorSource = readFileSync(new URL('./components/UploadTypeSelector.tsx', import.meta.url), 'utf8');
const workflowSource = readFileSync(new URL('../adapters/shellWorkflow.ts', import.meta.url), 'utf8');

test('short-video audio and video uploads are intercepted before draft or legacy upload persistence', () => {
  assert.match(shellSource, /activeModule === AppModuleObj\.VIDEO/);
  assert.match(shellSource, /type === 'referenceVideo' \|\| type === 'audio'/);
  assert.match(shellSource, /MediaTrimTranscodeDialog/);
  assert.match(shellSource, /mediaTranscoded: true/);
  assert.match(shellSource, /durationSeconds: result\.durationSeconds/);
});

test('upload choices expose complete Seedance image, video, and audio hints', () => {
  assert.match(bottomInputSource, /视频格式：MP4、MOV/);
  assert.match(bottomInputSource, /音频格式：WAV、MP3/);
  assert.match(bottomInputSource, /图片格式：JPEG、PNG、WEBP、BMP、TIFF、GIF/);
  assert.match(bottomInputSource, /总时长不超过 15 秒/);
  assert.match(bottomInputSource, /24–60 FPS/);
  assert.match(selectorSource, /materialHints/);
  assert.match(selectorSource, /group-hover/);
  assert.match(selectorSource, /aria-label/);
});

test('canonical media durations travel with the paid job payload', () => {
  assert.match(workflowSource, /referenceVideoDurations/);
  assert.match(workflowSource, /referenceAudioDurations/);
  assert.match(workflowSource, /collectMaterialDurations/);
});
