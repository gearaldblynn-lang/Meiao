import type { InternalJob } from '../types.ts';

export interface FailedOneClickPlanningPlan {
  id: string;
  title: string;
  sellingPoints: string[];
  sceneDescription: string;
  styleDirection: string;
  colorPalette: string;
  composition: string;
  textLayout: string;
  selected: boolean;
  schemeContent: string;
  sourceReferenceUrl?: string;
  status: 'error';
  error: string;
  planningFailed: true;
}

const FAILED_JOB_STATUSES = new Set(['failed', 'cancelled', 'error', 'interrupted']);

const toPayload = (job: InternalJob | null | undefined) => (
  (job?.payload && typeof job.payload === 'object')
    ? job.payload as Record<string, unknown>
    : {}
);

export const getPlanningReferenceIndex = (job: InternalJob | null | undefined) => {
  const parsed = Number(toPayload(job).shellReferenceIndex || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const getPlanningProviderTaskId = (job: InternalJob | null | undefined) => String(
  job?.providerTaskId
  || ((job?.result || {}) as Record<string, unknown>).providerTaskId
  || ''
).trim();

export const isFailedOneClickPlanningJob = (
  job: InternalJob | null | undefined,
  projectId = '',
) => {
  if (!job) return false;
  if (String(job.taskType || '') !== 'kie_chat') return false;
  if (!FAILED_JOB_STATUSES.has(String(job.status || '').trim())) return false;
  const payload = toPayload(job);
  const payloadProjectId = String(payload.shellProjectId || '').trim();
  if (projectId && payloadProjectId !== projectId) return false;
  return Boolean(
    payloadProjectId
    || String(payload.shellPlanningPurpose || '').trim() === 'one_click_planning'
  );
};

export const getOneClickPlanningErrorMessage = (
  job: InternalJob | null | undefined,
  fallbackErrorMessage = '策划失败',
) => String(
  job?.errorMessage
  || job?.errorCode
  || fallbackErrorMessage
  || '策划失败'
).trim();

export const buildFailedOneClickPlanningPlan = (
  job: InternalJob,
  projectName: string,
  errorMessage: string,
): FailedOneClickPlanningPlan => {
  const payload = toPayload(job);
  const referenceIndex = getPlanningReferenceIndex(job);
  const indexLabel = referenceIndex > 0 ? String(referenceIndex) : '1';
  const title = projectName
    ? `${projectName} ${indexLabel}`
    : `首图裂变${indexLabel}-策划失败`;
  const message = String(errorMessage || getOneClickPlanningErrorMessage(job)).trim() || '策划失败';
  return {
    id: `${job.id}-error`,
    title,
    sellingPoints: [],
    sceneDescription: message,
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: message,
    selected: false,
    schemeContent: message,
    sourceReferenceUrl: String(payload.shellReferenceUrl || '').trim() || undefined,
    status: 'error',
    error: message,
    planningFailed: true,
  };
};

const jobTimeValue = (job: InternalJob) => {
  const raw = Number(job.createdAt || job.updatedAt || 0);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const parsed = Date.parse(String(job.createdAt || job.updatedAt || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const collectFailedOneClickPlanningPlans = (
  jobs: Array<InternalJob | null | undefined>,
  options: {
    projectId: string;
    projectName: string;
    fallbackErrorMessage?: string;
  },
) => {
  const byJobId = new Map<string, InternalJob>();
  jobs.forEach((job) => {
    if (!isFailedOneClickPlanningJob(job, options.projectId)) return;
    const id = String(job?.id || '').trim();
    if (!id || byJobId.has(id)) return;
    byJobId.set(id, job as InternalJob);
  });

  return Array.from(byJobId.values())
    .sort((a, b) => {
      const aIndex = getPlanningReferenceIndex(a);
      const bIndex = getPlanningReferenceIndex(b);
      if (aIndex !== bIndex) return (aIndex || Number.MAX_SAFE_INTEGER) - (bIndex || Number.MAX_SAFE_INTEGER);
      return jobTimeValue(a) - jobTimeValue(b);
    })
    .map((job) => buildFailedOneClickPlanningPlan(
      job,
      options.projectName,
      getOneClickPlanningErrorMessage(job, options.fallbackErrorMessage),
    ));
};
