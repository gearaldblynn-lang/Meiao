import { getVoiceoverConfig } from './voiceoverContract.mjs';

export function scheduleVoiceoverReadinessRetry({
  env = process.env,
  initialReadiness = {},
  checkReadiness,
  onUpdate = () => {},
  setTimeoutFn = setTimeout,
} = {}) {
  if (initialReadiness?.ready === true || typeof checkReadiness !== 'function') return null;
  const { readinessRetryDelayMs } = getVoiceoverConfig(env);
  const timer = setTimeoutFn(async () => {
    try {
      onUpdate(await checkReadiness({ env }));
    } catch {
      onUpdate({
        ready: false,
        pythonReady: false,
        modelReady: false,
        ffmpegReady: false,
      });
    }
  }, readinessRetryDelayMs);
  timer?.unref?.();
  return timer || null;
}
