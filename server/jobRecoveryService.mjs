import { isAuthorizedProviderTaskRecoverySource } from './jobSubmissionPolicy.mjs';

export const createRecoverySourceNotFoundError = () => {
  const error = new Error('未找到可恢复的历史任务。');
  error.code = 'job_recovery_source_not_found';
  error.statusCode = 404;
  return error;
};

export const createAuthorizedProviderRecovery = async ({
  userId,
  request,
  findSourceJob,
  createRecoveryJob,
}) => {
  const sourceJob = await findSourceJob(userId, request.providerTaskId);
  if (!isAuthorizedProviderTaskRecoverySource(sourceJob, { ...request, userId })) {
    throw createRecoverySourceNotFoundError();
  }
  return createRecoveryJob(sourceJob);
};
