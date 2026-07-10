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

const SHELL_CONTROL_JOB_MODULES = new Set([
  'buyer_show',
  'translation',
  'retouch',
  'video',
]);

export const isShellControlJob = (
  job: JobLike = {},
  module: AppModule | string = String(job.module || ''),
) => {
  if (!/chat|responses|analysis/i.test(String(job.taskType || ''))) return false;
  if (SHELL_CONTROL_JOB_MODULES.has(String(module || ''))) return true;
  const payload = (job.payload || {}) as Record<string, unknown>;
  return [payload.shellPlanningPurpose, payload.taskPurpose].some((value) => (
    ['one_click_planning', 'buyer_show_planning', 'translation_copy_analysis', 'retouch_analysis', 'storyboard_planning']
      .includes(String(value || '').trim())
  ));
};

export const isBuyerShowPlanningControlJob = (
  job: JobLike = {},
  module: AppModule | string = String(job.module || ''),
) => module === 'buyer_show' && isShellControlJob(job, module);

export const shouldExposeActiveJobResult = ({
  job,
  module,
  payloadProjectId = '',
}: {
  job: JobLike;
  module: AppModule | string;
  payloadProjectId?: string;
}) => {
  if (isShellControlJob(job, module) && !String(payloadProjectId || '').trim()) {
    return false;
  }
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
