import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./VoiceoverTranslationWorkspace.tsx', import.meta.url), 'utf8');
const videoModuleSource = readFileSync(new URL('../modules/Video/VideoModule.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../../ShellMigratedApp.tsx', import.meta.url), 'utf8');

test('workspace owns exactly one MP4 or MOV source and confirms replacement', () => {
  assert.match(source, /type="file"/);
  assert.match(source, /accept="video\/mp4,video\/quicktime"/);
  assert.doesNotMatch(source, /\bmultiple\b/);
  assert.match(source, /pendingReplacementFile/);
  assert.match(source, /确认替换当前视频/);
  assert.doesNotMatch(source, /BatchItem|items:\s*\[/);
});

test('workspace prepares direct and existing-result sources with the voiceover media profile', () => {
  assert.match(source, /createMediaTranscodeSession\(\{/);
  assert.match(source, /profile: 'voiceover_translation'/);
  assert.match(source, /kind: 'video'/);
  assert.match(source, /convertMediaTranscodeSession\(\{/);
  assert.match(source, /initialSource/);
  assert.match(source, /sourceProjectId/);
  assert.match(source, /sourceResultId/);
});

test('workspace renders server-owned language and voice catalogs without drifting copies', () => {
  assert.match(source, /publicConfig\.languages/);
  assert.match(source, /\.filter\(\(language\) => language\.common\)/);
  assert.match(source, /更多语言/);
  assert.match(source, /voices\.map/);
  assert.match(source, /voice\.trait/);
  assert.doesNotMatch(source, /const VOICEOVER_(?:LANGUAGES|VOICES)/);
});

test('workspace exposes natural or literal translation and auto or preset voice modes', () => {
  assert.match(source, /useState<VoiceoverTranslationMode>\('natural'\)/);
  assert.match(source, /value="natural"/);
  assert.match(source, /value="literal"/);
  assert.match(source, /useState<VoiceoverVoiceMode>\('auto'\)/);
  assert.match(source, /value="auto"/);
  assert.match(source, /value="preset"/);
});

test('remove-text starts off and reuses the existing normalized subtitle editor', () => {
  assert.match(source, /useState\(false\)/);
  assert.match(source, /DEFAULT_SUBTITLE_REGION/);
  assert.match(source, /<SubtitleRegionEditor/);
  assert.match(source, /subtitleRegionNormalized/);
  assert.match(source, /setSubtitleRegion\(\{ \.\.\.DEFAULT_SUBTITLE_REGION \}\)/);
});

test('confirmation discloses possible paid stages without inventing a price', () => {
  assert.match(source, /确认开始口播翻译/);
  assert.match(source, /视频时长/);
  assert.match(source, /Gemini 视频分析/);
  assert.match(source, /KIE Gemini 3\.1 Flash TTS/);
  assert.match(source, /Golden 去文案/);
  assert.doesNotMatch(source, /预计(?:积分|价格|金额)|￥|¥|\d+\s*积分/);
});

test('workspace keeps one synchronous submission lock through async completion', () => {
  assert.match(source, /submitLockRef\.current/);
  assert.match(source, /submitLockRef\.current = true/);
  assert.match(source, /await onSubmit\(draft\)/);
  assert.match(source, /submitLockRef\.current = false/);
  assert.doesNotMatch(source, /userId: 'workspace'|activeSubmissionKeyRef/);
  assert.match(shellSource, /findActiveVoiceoverSubmissionIdentity\(/);
});

test('feature readiness blocks only new submission and keeps the workspace visible', () => {
  assert.match(source, /publicConfig\?\.enabled/);
  assert.match(source, /publicConfig\?\.ready/);
  assert.match(source, /历史项目仍可查看/);
  assert.doesNotMatch(videoModuleSource, /publicConfig\?\.enabled\s*&&\s*<VoiceoverTranslationWorkspace/);
});

test('voiceover composer portals into its dedicated slot while content stays in natural flow', () => {
  assert.match(source, /createPortal/);
  assert.match(source, /document\.getElementById\(composerSlotId\)/);
  assert.match(videoModuleSource, /hidden=\{activeSubFeature !== 'voiceover_translation'\}/);
  assert.match(videoModuleSource, /composerSlotId="voiceover-translation-composer-slot"/);
  assert.match(shellSource, /id="voiceover-translation-composer-slot"/);
  assert.doesNotMatch(source, /h-\[[^\]]+\].*overflow-y-(?:auto|scroll)|max-h-\[[^\]]+\].*overflow-y-(?:auto|scroll)/);
});
