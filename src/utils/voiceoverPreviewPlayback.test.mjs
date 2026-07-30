import test from 'node:test';
import assert from 'node:assert/strict';

import { playVoiceoverPreviewAudio } from './voiceoverPreviewPlayback.mjs';

const createAudio = ({ playError = null, emit = 'playing' } = {}) => {
  const listeners = new Map();
  const audio = {
    src: '',
    paused: true,
    pauseCalls: 0,
    loadCalls: 0,
    pause() {
      this.paused = true;
      this.pauseCalls += 1;
    },
    load() {
      this.loadCalls += 1;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    async play() {
      if (playError) throw playError;
      queueMicrotask(() => {
        this.paused = false;
        listeners.get(emit)?.();
      });
    },
  };
  return { audio, listeners };
};

test('prebuilt preview resolves only after the audio starts playing', async () => {
  const { audio, listeners } = createAudio();
  await playVoiceoverPreviewAudio(audio, '/voiceover-previews/Zephyr.mp3');
  assert.equal(audio.src, '/voiceover-previews/Zephyr.mp3');
  assert.equal(audio.pauseCalls, 1);
  assert.equal(audio.loadCalls, 1);
  assert.equal(listeners.size, 0);
});

test('play rejection and media error both reject so the caller can fall back', async () => {
  const rejected = createAudio({ playError: new Error('autoplay rejected') });
  await assert.rejects(
    playVoiceoverPreviewAudio(rejected.audio, '/voiceover-previews/Puck.mp3'),
    /autoplay rejected/,
  );
  assert.equal(rejected.listeners.size, 0);

  const failed = createAudio({ emit: 'error' });
  await assert.rejects(
    playVoiceoverPreviewAudio(failed.audio, '/voiceover-previews/Kore.mp3'),
    (error) => error?.code === 'voiceover_preview_playback_failed',
  );
  assert.equal(failed.listeners.size, 0);
});
