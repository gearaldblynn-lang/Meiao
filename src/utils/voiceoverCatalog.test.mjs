import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICEOVER_LANGUAGES,
  VOICEOVER_MODEL_MAX_INPUT_TOKENS,
  VOICEOVER_TTS_MODEL,
  VOICEOVER_VOICES,
  getVoiceoverVoice,
  selectAutomaticVoice,
} from './voiceoverCatalog.mjs';

test('catalog pins the current model contract', () => {
  assert.equal(VOICEOVER_TTS_MODEL, 'google/gemini-3-1-flash-tts');
  assert.equal(VOICEOVER_MODEL_MAX_INPUT_TOKENS, 8192);
  assert.equal(VOICEOVER_VOICES.length, 30);
  assert.equal(new Set(VOICEOVER_VOICES.map((voice) => voice.name)).size, 30);
  assert.deepEqual(
    VOICEOVER_LANGUAGES.filter((language) => language.common).map((language) => language.code),
    ['cmn', 'en', 'ja', 'ko', 'es', 'pt', 'fr', 'de', 'ar', 'ru'],
  );
});

test('automatic voice mapping is deterministic and returns a supported voice', () => {
  const profile = {
    pitch: 'high',
    brightness: 'bright',
    energy: 'energetic',
    pace: 'fast',
    accentDescription: 'clear Mandarin',
  };
  assert.equal(selectAutomaticVoice(profile), selectAutomaticVoice(profile));
  assert.ok(getVoiceoverVoice(selectAutomaticVoice(profile)));
});
