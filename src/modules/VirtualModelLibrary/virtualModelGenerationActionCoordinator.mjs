/**
 * Serializes paid generation mutations and guards async responses by revision.
 *
 * Polls may only apply when no action has started since they were captured.
 * Disposing the coordinator invalidates every outstanding token permanently.
 */
export const createVirtualModelGenerationActionCoordinator = () => {
  let disposed = false;
  let activeToken = null;
  let revision = 0;

  const isCurrent = (token) => (
    !disposed
      && activeToken !== null
      && token === activeToken
  );

  const isPollCurrent = (capturedRevision) => (
    !disposed
      && activeToken === null
      && capturedRevision === revision
  );

  return {
    begin(actionId) {
      if (disposed || activeToken !== null) return null;
      revision += 1;
      activeToken = Object.freeze({
        actionId: String(actionId),
        revision,
      });
      return activeToken;
    },
    isBusy() {
      return !disposed && activeToken !== null;
    },
    isCurrent,
    finish(token) {
      if (!isCurrent(token)) return false;
      activeToken = null;
      revision += 1;
      return true;
    },
    dispose() {
      disposed = true;
      activeToken = null;
      revision += 1;
    },
    capturePoll() {
      return disposed || activeToken !== null ? null : revision;
    },
    isPollCurrent,
    acceptPoll(capturedRevision) {
      if (!isPollCurrent(capturedRevision)) return false;
      revision += 1;
      return true;
    },
  };
};
