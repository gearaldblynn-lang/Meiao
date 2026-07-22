const ACTIVE_PROVIDER_STATUSES = new Set([
  '',
  'pending',
  'queued',
  'running',
  'generating',
  'retry_waiting',
]);

const FAILED_PROVIDER_STATUSES = new Set([
  'error',
  'failed',
  'failure',
  'task_not_found',
]);

const CANCELLED_PROVIDER_STATUSES = new Set([
  'aborted',
  'canceled',
  'cancelled',
  'interrupted',
]);

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

export const normalizeStoryboardProviderStatus = (result = {}, options = {}) => {
  if (options.recoverable === true) return 'generating';
  const status = normalizeStatus(result.status);
  if (CANCELLED_PROVIDER_STATUSES.has(status)) return 'cancelled';
  if (FAILED_PROVIDER_STATUSES.has(status)) return 'failed';
  if (status === 'success' || status === 'succeeded' || status === 'completed') {
    return String(result.imageUrl || '').trim() ? 'success' : 'failed';
  }
  if (ACTIVE_PROVIDER_STATUSES.has(status)) return 'generating';
  return String(result.imageUrl || '').trim() ? 'success' : 'generating';
};

export const applyStoryboardBoardResult = (board = {}, result = {}, options = {}) => {
  const providerStatus = normalizeStoryboardProviderStatus(result, options);
  const next = { ...board };
  const taskId = String(result.taskId || '').trim();
  const backendJobId = String(result.backendJobId || '').trim();
  if (taskId) next.taskId = taskId;
  if (backendJobId) next.backendJobId = backendJobId;
  if (result.creditsConsumed != null) next.creditsConsumed = result.creditsConsumed;
  if (options.prompt != null) next.prompt = options.prompt;
  if (options.previousBoardImageUrl !== undefined) next.previousBoardImageUrl = options.previousBoardImageUrl;
  if (options.revisionInstruction !== undefined) next.revisionInstruction = options.revisionInstruction;

  if (providerStatus === 'success') {
    next.status = 'completed';
    next.imageUrl = String(result.imageUrl || '').trim();
    next.error = undefined;
    return next;
  }
  if (providerStatus === 'generating') {
    next.status = 'generating';
    next.error = String(result.message || '').trim() || undefined;
    return next;
  }

  next.status = 'failed';
  next.error = providerStatus === 'cancelled'
    ? String(result.message || '').trim() || '任务已中断'
    : String(result.message || '').trim() || (normalizeStatus(result.status) === 'success' ? '生成成功但未返回图片' : '生成失败');
  return next;
};

export const deriveStoryboardProjectStatus = (boards = [], fallback = 'imaging') => {
  if (boards.some((board) => board?.status === 'failed')) return 'failed';
  if (boards.some((board) => board?.status === 'pending' || board?.status === 'generating')) return 'imaging';
  if (boards.length > 0 && boards.every((board) => board?.status === 'completed' && String(board?.imageUrl || '').trim())) {
    return 'completed';
  }
  return fallback === 'completed' ? 'imaging' : fallback;
};

export const getResumableStoryboardBoard = (project = {}) => {
  if (project.status !== 'imaging') return null;
  const boards = Array.isArray(project.boards) ? project.boards : [];
  if (boards.some((board) => board?.status === 'generating' || board?.status === 'retry_waiting')) return null;

  let previousBoardImageUrl = '';
  for (const board of boards) {
    if (board?.status === 'completed' && String(board?.imageUrl || '').trim()) {
      previousBoardImageUrl = String(board.imageUrl).trim();
      continue;
    }
    if (board?.status === 'pending') {
      if (board?.autoResumeBlocked === true) return null;
      if (String(board?.backendJobId || board?.taskId || '').trim()) return null;
      return {
        boardId: String(board.id || '').trim(),
        previousBoardImageUrl,
      };
    }
    return null;
  }
  return null;
};

export const mergeRecoveredStoryboardProject = (current = {}, recovered = {}) => {
  const recoveredById = new Map(
    (Array.isArray(recovered.boards) ? recovered.boards : [])
      .map((board) => [String(board?.id || '').trim(), board]),
  );
  const currentBoards = Array.isArray(current.boards) ? current.boards : [];
  const boards = currentBoards.map((board) => {
    const boardId = String(board?.id || '').trim();
    const recoveredBoard = recoveredById.get(boardId);
    if (!recoveredBoard) return board;
    recoveredById.delete(boardId);
    const currentBackendJobId = String(board?.backendJobId || '').trim();
    const recoveredBackendJobId = String(recoveredBoard?.backendJobId || '').trim();
    const sameJob = !currentBackendJobId
      || !recoveredBackendJobId
      || currentBackendJobId === recoveredBackendJobId;
    const currentActive = board?.status === 'pending' || board?.status === 'generating';
    const recoveredActive = Boolean(recoveredBackendJobId)
      && (recoveredBoard?.status === 'generating' || recoveredBoard?.status === 'retry_waiting');
    const recoveredTerminal = recoveredBoard?.status === 'completed' || recoveredBoard?.status === 'failed';

    if (
      recoveredBackendJobId
      && currentBackendJobId
      && recoveredBackendJobId !== currentBackendJobId
      && (recoveredActive || currentActive)
    ) {
      const currentCompletedImageUrl = board?.status === 'completed'
        ? String(board?.imageUrl || '').trim()
        : '';
      return {
        ...board,
        ...recoveredBoard,
        status: recoveredActive ? 'generating' : recoveredBoard?.status,
        imageUrl: currentCompletedImageUrl || recoveredBoard?.imageUrl || board?.imageUrl,
        prompt: board?.prompt || recoveredBoard?.prompt,
        imageVersions: Array.isArray(board?.imageVersions) && board.imageVersions.length > 0
          ? board.imageVersions
          : recoveredBoard?.imageVersions,
      };
    }

    if (currentActive && recoveredActive && sameJob) {
      return {
        ...board,
        ...recoveredBoard,
        status: 'generating',
        imageUrl: recoveredBoard?.imageUrl || board?.imageUrl,
        prompt: board?.prompt || recoveredBoard?.prompt,
        imageVersions: Array.isArray(board?.imageVersions) && board.imageVersions.length > 0
          ? board.imageVersions
          : recoveredBoard?.imageVersions,
      };
    }

    if (currentActive && recoveredTerminal && sameJob) {
      return {
        ...board,
        ...recoveredBoard,
        prompt: board?.prompt || recoveredBoard?.prompt,
        imageVersions: Array.isArray(board?.imageVersions) && board.imageVersions.length > 0
          ? board.imageVersions
          : recoveredBoard?.imageVersions,
      };
    }
    return {
      ...recoveredBoard,
      ...board,
      backendJobId: board?.backendJobId || recoveredBoard?.backendJobId,
      taskId: board?.taskId || recoveredBoard?.taskId,
    };
  });
  recoveredById.forEach((board) => boards.push(board));

  const currentStatus = String(current.status || '');
  const recoveredStatus = String(recovered.status || '');
  const shouldAdvanceProject = (
    currentStatus === 'scripting'
    && recoveredStatus
    && recoveredStatus !== 'scripting'
  ) || (
    currentStatus === 'imaging'
    && (recoveredStatus === 'completed' || recoveredStatus === 'failed')
  );
  const status = currentStatus === 'imaging'
    ? deriveStoryboardProjectStatus(boards, shouldAdvanceProject ? recoveredStatus : currentStatus)
    : shouldAdvanceProject
      ? recoveredStatus
      : currentStatus || recoveredStatus;

  return {
    ...recovered,
    ...current,
    status,
    config: { ...(recovered.config || {}), ...(current.config || {}) },
    shots: Array.isArray(current.shots) && current.shots.length > 0 ? current.shots : recovered.shots,
    boards,
    planningJobId: current.planningJobId || recovered.planningJobId,
    backendJobId: current.backendJobId || recovered.backendJobId,
    planningTaskId: current.planningTaskId || recovered.planningTaskId,
    creditsConsumed: current.creditsConsumed ?? recovered.creditsConsumed,
  };
};

export const toStoryboardShellResultStatus = (board = {}) => {
  if (board.status === 'failed') return 'error';
  if (board.status === 'completed' && String(board.imageUrl || '').trim()) return 'completed';
  if (board.status === 'pending') return 'planning';
  return 'generating';
};

export const isStoryboardAwaitingImageConfirmation = (status) => (
  String(status || '') === 'awaiting_image_confirmation'
);

export const toStoryboardShellProjectStatus = (status) => {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'error';
  if (status === 'scripting' || status === 'imaging') return 'generating';
  return 'planning';
};

export const getStoryboardCardSegmentCount = (project = {}) => Math.max(
  Array.isArray(project.results) ? project.results.length : 0,
  Array.isArray(project.storyboardSourceProject?.boards)
    ? project.storyboardSourceProject.boards.length
    : 0,
);
