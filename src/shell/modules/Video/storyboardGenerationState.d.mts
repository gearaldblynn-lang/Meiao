import type {
  VideoStoryboardBoard,
  VideoStoryboardProject,
} from '../../../types.ts';

export type StoryboardProviderStatus = 'generating' | 'success' | 'failed' | 'cancelled';

export type StoryboardProviderResult = {
  status?: unknown;
  imageUrl?: string;
  taskId?: string;
  backendJobId?: string;
  creditsConsumed?: number;
  message?: string;
};

export type StoryboardBoardResultOptions = {
  recoverable?: boolean;
  prompt?: string;
  previousBoardImageUrl?: string;
  revisionInstruction?: string;
};

export function normalizeStoryboardProviderStatus(
  result?: StoryboardProviderResult,
  options?: StoryboardBoardResultOptions,
): StoryboardProviderStatus;

export function applyStoryboardBoardResult<T extends VideoStoryboardBoard>(
  board: T,
  result?: StoryboardProviderResult,
  options?: StoryboardBoardResultOptions,
): T & { backendJobId?: string };

export function deriveStoryboardProjectStatus(
  boards?: VideoStoryboardBoard[],
  fallback?: VideoStoryboardProject['status'],
): VideoStoryboardProject['status'];

export function getResumableStoryboardBoard(
  project?: VideoStoryboardProject,
): { boardId: string; previousBoardImageUrl: string } | null;

export function mergeRecoveredStoryboardProject(
  current: VideoStoryboardProject,
  recovered: VideoStoryboardProject,
): VideoStoryboardProject;

export function toStoryboardShellResultStatus(
  board?: VideoStoryboardBoard,
): 'planning' | 'completed' | 'generating' | 'error';

export function isStoryboardAwaitingImageConfirmation(
  status?: unknown,
): boolean;

export function toStoryboardShellProjectStatus(
  status?: VideoStoryboardProject['status'],
): 'planning' | 'generating' | 'completed' | 'error';

export function getStoryboardCardSegmentCount(project?: {
  results?: unknown[];
  storyboardSourceProject?: { boards?: unknown[] };
}): number;
