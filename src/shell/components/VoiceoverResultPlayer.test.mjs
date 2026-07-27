import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (url) => existsSync(url) ? readFileSync(url, 'utf8') : '';
const playerSource = read(new URL('./VoiceoverResultPlayer.tsx', import.meta.url));
const cardSource = read(new URL('./ProjectCard.tsx', import.meta.url));

test('voiceover result player toggles one direct managed video and pauses the hidden player', () => {
  assert.match(playerSource, /originalVideoRef/);
  assert.match(playerSource, /finalVideoRef/);
  assert.match(playerSource, /inactiveVideo\?\.pause\(\)/);
  assert.match(playerSource, /src=\{activeUrl\}/);
  assert.match(playerSource, /preload="metadata"/);
  assert.doesNotMatch(playerSource, /URL\.createObjectURL|new Blob|fetch\(/);
});

test('voiceover result details are collapsed React text with language and actual voice metadata', () => {
  assert.match(playerSource, /<details/);
  assert.doesNotMatch(playerSource, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(playerSource, /\{result\.sourceTranscript(?:\s*\|\|[^}]*)?\}/);
  assert.match(playerSource, /\{result\.translatedTranscript(?:\s*\|\|[^}]*)?\}/);
  assert.match(playerSource, /result\.sourceLanguage/);
  assert.match(playerSource, /result\.targetLanguage/);
  assert.match(playerSource, /result\.voiceName/);
  assert.doesNotMatch(playerSource, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(playerSource, /声音克隆|音色克隆|voice cloning|唇形同步|lip sync/i);
});

test('voiceover final download delegates the managed URL to the shared card download path', () => {
  assert.match(playerSource, /onDownloadFinal/);
  assert.match(playerSource, /onDownloadFinal\(result\.videoUrl/);
  assert.match(cardSource, /<VoiceoverResultPlayer/);
  assert.match(cardSource, /onDownloadFinal=/);
});

test('voiceover retry and cancellation use explicit safe in-app boundaries', () => {
  assert.match(cardSource, /provider_submission_unknown/);
  assert.match(cardSource, /voiceover_analysis_submission_unknown/);
  assert.match(cardSource, /<ConfirmDialog/);
  assert.match(cardSource, /confirmNewProviderAttempt:\s*true/);
  assert.doesNotMatch(cardSource, /window\.confirm/);
  assert.match(playerSource, /canCancel/);
  assert.match(playerSource, /不能保证上游任务立即取消/);
  assert.match(cardSource, /Boolean\(result\.backendJobId \|\| project\.backendJobId\)/);
});
