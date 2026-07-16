type DeletionTone = 'info' | 'warning';

type DeletionOutcomeInput = {
  scope: 'result' | 'project';
  tombstoneSynced: boolean;
  deletionResults: PromiseSettledResult<unknown>[];
  hasPhysicalTargets: boolean;
};

type DeletionRequestOutcome = {
  deletionStatus: 'deleted' | 'already_absent' | 'scheduled';
};

const runDeletionRequest = async (
  jobId: string,
  deleteJob: (jobId: string) => Promise<unknown>,
): Promise<DeletionRequestOutcome> => {
  try {
    await deleteJob(jobId);
    return { deletionStatus: 'deleted' };
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 0);
    const code = String((error as { code?: string })?.code || '');
    if (status === 404 || code === 'job_not_found') {
      return { deletionStatus: 'already_absent' };
    }
    if (status === 409 && [
      'job_delete_active',
      'job_delete_submitted_cancelled',
      'job_delete_submitted_recovery',
    ].includes(code)) {
      return { deletionStatus: 'scheduled' };
    }
    throw error;
  }
};

export const startDeletionOperations = <T>({
  jobIds,
  deleteJob,
  persistTombstone,
}: {
  jobIds: string[];
  deleteJob: (jobId: string) => Promise<unknown>;
  persistTombstone: () => Promise<T>;
}) => {
  const physicalDeletion = Promise.allSettled(jobIds.map((jobId) => runDeletionRequest(jobId, deleteJob)));
  const tombstonePersistence = persistTombstone();
  return Promise.all([physicalDeletion, tombstonePersistence]);
};

export const resolveDeletionOutcome = ({
  scope,
  tombstoneSynced,
  deletionResults,
  hasPhysicalTargets,
}: DeletionOutcomeInput): { message: string; tone: DeletionTone } => {
  const physicalDeleted = !hasPhysicalTargets
    || deletionResults.every((result) => result.status === 'fulfilled');
  const physicalCleanupScheduled = deletionResults.some((result) => (
    result.status === 'fulfilled'
    && (result.value as DeletionRequestOutcome)?.deletionStatus === 'scheduled'
  ));

  if (!tombstoneSynced && !physicalDeleted) {
    return { message: '远端历史同步和任务删除均未完全成功', tone: 'warning' };
  }
  if (!tombstoneSynced) {
    return {
      message: scope === 'project'
        ? '已删除当前项目，但远端历史同步失败'
        : '已删除当前任务，但远端历史同步失败',
      tone: 'warning',
    };
  }
  if (!physicalDeleted) {
    return { message: '历史任务已隐藏，远端任务删除未完全成功', tone: 'warning' };
  }
  if (physicalCleanupScheduled) {
    return { message: '历史任务已隐藏，远端任务正在清理', tone: 'info' };
  }
  if (scope === 'result' && !hasPhysicalTargets) {
    return { message: '历史任务已隐藏', tone: 'info' };
  }
  return {
    message: scope === 'project' && !hasPhysicalTargets ? '项目已删除' : '历史任务已删除',
    tone: 'info',
  };
};
