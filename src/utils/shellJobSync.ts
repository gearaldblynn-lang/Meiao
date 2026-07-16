export const DEFAULT_SHELL_JOB_SYNC_INTERVAL_MS = 10_000;
export const MIN_SHELL_JOB_SYNC_INTERVAL_MS = 1_000;

type AsyncOperation = () => Promise<void>;

export const createAsyncScopeGuard = () => {
  let epoch = 0;
  return {
    capture: () => {
      const capturedEpoch = epoch;
      return () => capturedEpoch === epoch;
    },
    invalidate: () => {
      epoch += 1;
    },
  };
};

interface InternalJobIdentityCandidate {
  id: unknown;
  active: boolean;
}

export const collectMissingActiveInternalJobIds = (
  candidates: InternalJobIdentityCandidate[],
  recentJobIds: Iterable<unknown>,
) => {
  const recentIds = new Set(Array.from(recentJobIds, (value) => String(value || '').trim()));
  const missingIds: string[] = [];
  const seenIds = new Set<string>();
  candidates.forEach(({ id, active }) => {
    if (!active) return;
    const jobId = String(id || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(jobId) || recentIds.has(jobId) || seenIds.has(jobId)) return;
    seenIds.add(jobId);
    missingIds.push(jobId);
  });
  return missingIds;
};

export const createCoalescedAsyncRunner = (operation: AsyncOperation) => {
  let inFlight: Promise<void> | null = null;
  let trailingRunRequested = false;

  return () => {
    if (inFlight) {
      trailingRunRequested = true;
      return inFlight;
    }

    inFlight = (async () => {
      let finalError: unknown;
      let finalAttemptFailed = false;
      do {
        trailingRunRequested = false;
        try {
          await operation();
          finalAttemptFailed = false;
        } catch (error) {
          finalError = error;
          finalAttemptFailed = true;
        }
      } while (trailingRunRequested);
      if (finalAttemptFailed) throw finalError;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
};

export const getShellJobSyncIntervalMs = (rawValue?: unknown) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < MIN_SHELL_JOB_SYNC_INTERVAL_MS) {
    return DEFAULT_SHELL_JOB_SYNC_INTERVAL_MS;
  }
  return Math.floor(parsed);
};

interface ShellJobSyncWindowTarget {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
  setInterval(callback: () => void, intervalMs: number): number;
  clearInterval(timerId: number): void;
  addEventListener(type: 'focus' | 'pageshow' | 'online', listener: () => void): void;
  removeEventListener(type: 'focus' | 'pageshow' | 'online', listener: () => void): void;
}

interface ShellJobSyncDocumentTarget {
  visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface StartShellJobSyncOptions {
  run: AsyncOperation;
  intervalMs: number;
  windowTarget?: ShellJobSyncWindowTarget;
  documentTarget?: ShellJobSyncDocumentTarget;
}

export const startShellJobSync = ({
  run,
  intervalMs,
  windowTarget = window,
  documentTarget = document,
}: StartShellJobSyncOptions) => {
  let stopped = false;
  const requestSync = () => {
    if (stopped) return;
    void run().catch(() => undefined);
  };
  const handleVisibilityChange = () => {
    if (documentTarget.visibilityState === 'visible') requestSync();
  };

  const initialTimerId = windowTarget.setTimeout(requestSync, 0);
  const intervalId = windowTarget.setInterval(requestSync, intervalMs);
  windowTarget.addEventListener('focus', requestSync);
  windowTarget.addEventListener('pageshow', requestSync);
  windowTarget.addEventListener('online', requestSync);
  documentTarget.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    stopped = true;
    windowTarget.clearTimeout(initialTimerId);
    windowTarget.clearInterval(intervalId);
    windowTarget.removeEventListener('focus', requestSync);
    windowTarget.removeEventListener('pageshow', requestSync);
    windowTarget.removeEventListener('online', requestSync);
    documentTarget.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};
