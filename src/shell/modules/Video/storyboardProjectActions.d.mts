import type { VideoStoryboardProject } from '../../../types';

type StoryboardTaskIdentity = {
  id?: unknown;
  projectId?: unknown;
  backendJobId?: unknown;
  storyboardBoardId?: unknown;
  status?: unknown;
};

type StoryboardShellProjectIdentity = {
  backendJobId?: unknown;
  results?: Array<{
    id?: unknown;
    backendJobId?: unknown;
    storyboardBoardId?: unknown;
  }>;
};

type StoryboardJobIdentity = {
  id?: unknown;
  module?: unknown;
  status?: unknown;
  payload?: {
    shellProjectId?: unknown;
    planningPurpose?: unknown;
    boardId?: unknown;
  };
};

export function collectStoryboardProjectJobIds(
  project: VideoStoryboardProject,
  context?: { tasks?: StoryboardTaskIdentity[]; shellProject?: StoryboardShellProjectIdentity },
): string[];
export function collectStoryboardBoardJobIds(
  project: VideoStoryboardProject,
  boardId: string,
  context?: {
    tasks?: StoryboardTaskIdentity[];
    jobs?: StoryboardJobIdentity[];
    shellProject?: StoryboardShellProjectIdentity;
  },
): string[];
export function collectActiveStoryboardBoardJobIds(
  project: VideoStoryboardProject,
  boardId: string,
  context?: {
    tasks?: StoryboardTaskIdentity[];
    jobs?: StoryboardJobIdentity[];
    guardedJobIds?: unknown[];
  },
): string[];
export function markStoryboardProjectCancelled(project: VideoStoryboardProject): VideoStoryboardProject;
export function removeStoryboardBoardResult(project: VideoStoryboardProject, boardId: string): VideoStoryboardProject;
