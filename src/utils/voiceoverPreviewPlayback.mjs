const createPlaybackError = () => {
  const error = new Error('音色试听播放失败');
  error.code = 'voiceover_preview_playback_failed';
  return error;
};

export const playVoiceoverPreviewAudio = async (audio, audioUrl) => {
  audio.pause();
  audio.src = audioUrl;
  audio.load();

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('error', handleError);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handlePlaying = () => finish(resolve);
    const handleError = () => finish(reject, createPlaybackError());

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('error', handleError);
    try {
      Promise.resolve(audio.play()).catch((error) => finish(reject, error));
    } catch (error) {
      finish(reject, error);
    }
  });
};
