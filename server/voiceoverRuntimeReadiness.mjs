import { checkVoiceoverAlignmentReadiness } from './voiceoverForcedAlignment.mjs';
import { checkVoiceoverSeparationReadiness } from './voiceoverSeparation.mjs';

export async function checkVoiceoverRuntimeReadiness({
  env = process.env,
  config,
  verifyModelLoad = false,
  deps = {},
} = {}) {
  const options = {
    env,
    ...(config ? { config } : {}),
    verifyModelLoad: verifyModelLoad === true,
  };
  const checkSeparation = deps.checkSeparation || checkVoiceoverSeparationReadiness;
  const checkAlignment = deps.checkAlignment || checkVoiceoverAlignmentReadiness;
  const [separation, alignment] = verifyModelLoad === true
    ? [
        await checkSeparation(options),
        await checkAlignment(options),
      ]
    : await Promise.all([
        checkSeparation(options),
        checkAlignment(options),
      ]);
  const pythonReady = separation?.pythonReady === true && alignment?.pythonReady === true;
  const modelReady = separation?.modelReady === true && alignment?.modelReady === true;
  const ffmpegReady = separation?.ffmpegReady === true;
  const ready = separation?.ready === true
    && alignment?.ready === true
    && pythonReady
    && modelReady
    && ffmpegReady;
  return Object.freeze({
    ready,
    code: ready ? null : 'voiceover_unavailable',
    pythonReady,
    modelReady,
    ffmpegReady,
  });
}
