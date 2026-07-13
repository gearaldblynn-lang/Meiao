type DeletionTone = 'info' | 'warning';

type DeletionOutcomeInput = {
  scope: 'result' | 'project';
  tombstoneSynced: boolean;
  deletionResults: PromiseSettledResult<unknown>[];
  hasPhysicalTargets: boolean;
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
  const physicalDeletion = Promise.allSettled(jobIds.map((jobId) => deleteJob(jobId)));
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
  return {
    message: scope === 'project' && !hasPhysicalTargets ? '项目已删除' : '历史任务已删除',
    tone: 'info',
  };
};
