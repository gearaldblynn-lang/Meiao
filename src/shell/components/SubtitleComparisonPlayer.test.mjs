import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SubtitleComparisonPlayer.tsx', import.meta.url), 'utf8');

test('comparison player renders two metadata-only videos with one audio owner', () => {
  assert.match(source, /preload=\{preloadMode\}/);
  assert.match(source, /renderSide\('source', '原片', sourceUrl\)/);
  assert.match(source, /renderSide\('result', '去字幕后', resultUrl\)/);
  assert.match(source, /const preloadMode = playIntent \? 'auto' : 'metadata'/);
  assert.match(source, /muted=\{isSource \? true : volume === 0\}/);
  assert.match(source, /resultVideoRef/);
  assert.doesNotMatch(source, /<video[\s\S]{0,300}\scontrols(?:=|\s|>)/);
});

test('comparison player has one unified play seek rate volume and fullscreen control surface', () => {
  assert.match(source, /aria-label={isPlaying \? '暂停对比视频' : '播放对比视频'}/);
  assert.match(source, /aria-label="对比播放进度"/);
  assert.match(source, /aria-label="播放倍速"/);
  assert.match(source, /aria-label="结果视频音量"/);
  assert.match(source, /requestFullscreen/);
});

test('result is the master clock with bounded drift and shared buffer gating', () => {
  assert.match(source, /getComparisonDriftCorrection/);
  assert.match(source, /masterTime: master\.currentTime/);
  assert.match(source, /thresholdSeconds: 0\.12/);
  assert.match(source, /shouldPauseForComparisonBuffer/);
  assert.match(source, /VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS/);
  assert.match(source, /VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS/);
});

test('comparison player supports responsive switching without rebuilding playback state', () => {
  assert.match(source, /md:grid-cols-2/);
  assert.match(source, /activeSide/);
  assert.match(source, /原片/);
  assert.match(source, /去字幕后/);
  assert.doesNotMatch(source, /setCurrentTime\(0\)/);
});

test('comparison player cleans up and enforces one document playback owner', () => {
  assert.match(source, /COMPARISON_PLAYBACK_EVENT/);
  assert.match(source, /document\.dispatchEvent\(new CustomEvent/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /document\.removeEventListener\('visibilitychange'/);
  assert.match(source, /sourceVideoRef\.current\?\.pause\(\)/);
  assert.match(source, /resultVideoRef\.current\?\.pause\(\)/);
  assert.match(source, /handleClose/);
});
