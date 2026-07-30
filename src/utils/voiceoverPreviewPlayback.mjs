const createPlaybackError = () => {
  const error = new Error('音色试听播放失败');
  error.code = 'voiceover_preview_playback_failed';
  return error;
};

const createPlaybackAbortError = () => {
  const error = new Error('音色试听已停止');
  error.name = 'AbortError';
  error.code = 'voiceover_preview_playback_aborted';
  return error;
};

export const playVoiceoverPreviewAudio = async (audio, audioUrl, { signal } = {}) => {
  if (signal?.aborted) throw createPlaybackAbortError();
  audio.pause();
  audio.src = audioUrl;
  audio.load();

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('error', handleError);
      signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handlePlaying = () => finish(resolve);
    const handleError = () => finish(reject, createPlaybackError());
    const handleAbort = () => finish(reject, createPlaybackAbortError());

    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('error', handleError);
    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      Promise.resolve(audio.play()).catch((error) => finish(reject, error));
    } catch (error) {
      finish(reject, error);
    }
  });
};
