const uniqueText = (values = []) => Array.from(new Set(
  values.map((value) => String(value || '').trim()).filter(Boolean),
));

const ACTIVE_JOB_STATUSES = new Set(['pending', 'queued', 'running', 'generating', 'retry_waiting']);

const isStoryboardBoardJob = (job, projectId, boardId) => {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  return String(job?.module || '').trim() === 'video'
    && String(payload?.shellProjectId || '').trim() === projectId
    && String(payload?.planningPurpose || '').trim() === 'storyboard_board_image'
    && String(payload?.boardId || '').trim() === boardId;
};

export const collectStoryboardProjectJobIds = (project = {}, context = {}) => uniqueText([
  project.planningJobId,
  project.backendJobId,
  ...(Array.isArray(project.boards) ? project.boards.map((board) => board?.backendJobId) : []),
  ...(Array.isArray(context.tasks)
    ? context.tasks
        .filter((task) => String(task?.projectId || '').trim() === String(project?.id || '').trim())
        .flatMap((task) => [task?.backendJobId, task?.id])
    : []),
  context.shellProject?.backendJobId,
  ...(Array.isArray(context.shellProject?.results)
    ? context.shellProject.results.map((result) => result?.backendJobId)
    : []),
]);

export const collectStoryboardBoardJobIds = (project = {}, boardId = '', context = {}) => {
  const normalizedBoardId = String(boardId || '').trim();
  const board = (Array.isArray(project.boards) ? project.boards : [])
    .find((item) => String(item?.id || '').trim() === normalizedBoardId);
  return uniqueText([
    board?.backendJobId,
    ...(Array.isArray(context.tasks)
      ? context.tasks
          .filter((task) => (
            String(task?.projectId || '').trim() === String(project?.id || '').trim()
            && String(task?.storyboardBoardId || '').trim() === normalizedBoardId
          ))
          .flatMap((task) => [task?.backendJobId, task?.id])
      : []),
    ...(Array.isArray(context.jobs)
      ? context.jobs
          .filter((job) => isStoryboardBoardJob(
            job,
            String(project?.id || '').trim(),
            normalizedBoardId,
          ))
          .map((job) => job?.id)
      : []),
    ...(Array.isArray(context.shellProject?.results)
      ? context.shellProject.results
          .filter((result) => (
            String(result?.id || '').trim() === normalizedBoardId
            || String(result?.storyboardBoardId || '').trim() === normalizedBoardId
          ))
          .map((result) => result?.backendJobId)
      : []),
  ]);
};

export const collectActiveStoryboardBoardJobIds = (project = {}, boardId = '', context = {}) => {
  const normalizedProjectId = String(project?.id || '').trim();
  const normalizedBoardId = String(boardId || '').trim();
  const board = (Array.isArray(project.boards) ? project.boards : [])
    .find((item) => String(item?.id || '').trim() === normalizedBoardId);
  return uniqueText([
    ACTIVE_JOB_STATUSES.has(String(board?.status || '').trim()) ? board?.backendJobId : '',
    ...(Array.isArray(context.tasks)
      ? context.tasks
          .filter((task) => (
            String(task?.projectId || '').trim() === normalizedProjectId
            && String(task?.storyboardBoardId || '').trim() === normalizedBoardId
            && ACTIVE_JOB_STATUSES.has(String(task?.status || '').trim())
          ))
          .flatMap((task) => [task?.backendJobId, task?.id])
      : []),
    ...(Array.isArray(context.jobs)
      ? context.jobs
          .filter((job) => (
            isStoryboardBoardJob(job, normalizedProjectId, normalizedBoardId)
            && ACTIVE_JOB_STATUSES.has(String(job?.status || '').trim())
          ))
          .map((job) => job?.id)
      : []),
    ...(Array.isArray(context.guardedJobIds) ? context.guardedJobIds : []),
  ]);
};

export const markStoryboardProjectCancelled = (project = {}) => ({
  ...project,
  status: 'failed',
  error: '任务已中断',
  boards: (Array.isArray(project.boards) ? project.boards : []).map((board) => (
    board?.status === 'generating' || board?.status === 'pending'
      ? { ...board, status: 'failed', error: '任务已中断' }
      : board
  )),
});

export const removeStoryboardBoardResult = (project = {}, boardId = '') => {
  const boards = Array.isArray(project.boards) ? project.boards : [];
  const removedBoard = boards.find((board) => board?.id === boardId);
  const removedBackendJobId = String(removedBoard?.backendJobId || '').trim();
  const nextBoards = boards.map((board) => (
    board?.id === boardId
      ? {
          ...board,
          status: 'pending',
          autoResumeBlocked: true,
          imageUrl: undefined,
          taskId: undefined,
          backendJobId: undefined,
          creditsConsumed: undefined,
          error: undefined,
          imageVersions: [],
        }
      : board
  ));
  const currentBackendJobId = String(project?.backendJobId || '').trim();
  const nextBackendJobId = removedBackendJobId && currentBackendJobId === removedBackendJobId
    ? nextBoards.map((board) => String(board?.backendJobId || '').trim()).find(Boolean)
      || String(project?.planningJobId || '').trim()
      || undefined
    : project?.backendJobId;

  return {
    ...project,
    status: 'imaging',
    completedAt: undefined,
    error: undefined,
    backendJobId: nextBackendJobId,
    boards: nextBoards,
  };
};
