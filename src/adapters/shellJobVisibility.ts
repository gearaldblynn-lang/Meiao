import type { AppModule, InternalJob } from '../types.ts';

type JobLike = Partial<InternalJob> & {
  result?: Partial<NonNullable<InternalJob['result']>> & { providerTaskId?: unknown };
};

export const getVisibleProviderTaskId = (job: JobLike = {}) => String(
  job.providerTaskId
  || job.result?.providerTaskId
  || ''
).trim();

export const isProviderMediaJob = (job: JobLike = {}) => (
  String(job.provider || '') === 'kie'
  && /image|video|seedance|veo/i.test(String(job.taskType || ''))
);

export const shouldExposeActiveJobResult = ({
  job,
  module,
  payloadProjectId = '',
}: {
  job: JobLike;
  module: AppModule | string;
  payloadProjectId?: string;
}) => {
  const visibleProviderTaskId = getVisibleProviderTaskId(job);
  if (
    isProviderMediaJob(job)
    && !visibleProviderTaskId
    && !(module === 'buyer_show' && String(payloadProjectId || '').trim())
  ) {
    return false;
  }
  return true;
};
