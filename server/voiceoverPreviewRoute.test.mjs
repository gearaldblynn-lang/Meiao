import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('voice preview API is authenticated in both mysql and local handlers', () => {
  assert.match(source, /createVoiceoverPreviewService/);
  assert.equal(
    (source.match(/url\.pathname === '\/api\/voiceover\/voice-previews'/g) || []).length,
    2,
  );
  assert.equal(
    source.split("url.pathname.match(/^\\/api\\/voiceover\\/voice-previews\\/([^/]+)$/)").length - 1,
    2,
  );
  assert.match(source, /requireDbUser\(req, res\)[\s\S]*voiceoverPreviewService\.request/);
  assert.match(source, /localRequireUser\(req, res, store\)[\s\S]*voiceoverPreviewService\.request/);
  assert.match(source, /canUseVideoGenerationFeature\(user\)/);
});

test('voice preview persists provider audio as an account-owned managed asset', () => {
  assert.match(source, /module: 'voiceover_preview'/);
  assert.match(source, /assetType: 'preview'/);
  assert.match(source, /originalName: `voice-preview-\$\{voiceName\}\.wav`/);
  assert.match(source, /provider: 'kie_tts'/);
  assert.match(source, /expiresAt: 0/);
  assert.match(source, /ensureVoiceoverPreviewAudioPersistent/);
  assert.match(source, /markStoredAssetPermanent/);
});
