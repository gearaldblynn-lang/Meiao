export interface ProductRestoreCancellationAudit {
  projectId: string;
  jobIds: string[];
  cancelledJobCount: number;
}

export interface ProductRestoreCancellationRegistry {
  beginCancellation(projectId: string, initialJobIds?: string[]): unknown;
  addCancellationJobs(projectId: string, jobIds?: string[]): string[];
  observeJob(projectId: string, jobId: string): boolean;
  waitForCancellations(projectId: string): Promise<PromiseSettledResult<unknown>[]>;
  isCancelled(projectId: string): boolean;
  getCancellationJobIds(projectId: string): string[];
  getObservedJobIds(projectId: string): string[];
  clearForExplicitRetry(projectId: string): void;
  reset(): void;
}

export function createProductRestoreCancellationRegistry(input: {
  cancelJob: (jobId: string) => Promise<unknown> | unknown;
  onAudit?: (entry: ProductRestoreCancellationAudit) => unknown;
}): ProductRestoreCancellationRegistry;

export function runProductRestoreFanout<T, R>(input: {
  items?: T[];
  concurrency?: number;
  shouldStop?: () => boolean;
  runItem: (item: T, index: number) => Promise<R> | R;
}): Promise<R[]>;

export function markProductRestoreProjectCancelled<T extends object>(
  project: T,
  errorMessage?: string,
): T & {
  status: 'error';
  completedAt: undefined;
  results: unknown[];
  completedCount: number;
  error: string;
};

export function shouldResumeProductRestoreProject(
  project: object,
  options?: { cancelled?: boolean },
): boolean;
