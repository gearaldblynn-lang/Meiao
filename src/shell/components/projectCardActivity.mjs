import { isStoryboardAwaitingImageConfirmation } from '../modules/Video/storyboardGenerationState.mjs';

/**
 * @param {{
 *   projectStatus?: 'planning' | 'generating' | 'completed' | 'error',
 *   storyboardProjectStatus?: string,
 *   hasGeneratingResult?: boolean,
 *   hasPlans?: boolean,
 *   projectProgressIncomplete?: boolean,
 *   hasPendingProductRestoreSync?: boolean,
 *   hasResults?: boolean,
 * }} input
 */
export const resolveProjectCardActivity = ({
  projectStatus,
  storyboardProjectStatus,
  hasGeneratingResult,
  hasPlans,
  projectProgressIncomplete,
  hasPendingProductRestoreSync = false,
  hasResults,
} = {}) => {
  const isAwaitingStoryboardConfirmation = isStoryboardAwaitingImageConfirmation(storyboardProjectStatus);
  const isProjectActivelyGenerating = !isAwaitingStoryboardConfirmation
    && projectStatus === 'generating'
    && (
      hasGeneratingResult
      || (!hasPlans && projectProgressIncomplete)
      || hasPendingProductRestoreSync
    );
  const displayProjectStatus = isAwaitingStoryboardConfirmation
    ? 'planning'
    : projectStatus === 'generating' && !isProjectActivelyGenerating
      ? (hasResults ? 'completed' : 'planning')
      : projectStatus;

  return { isProjectActivelyGenerating, displayProjectStatus };
};
