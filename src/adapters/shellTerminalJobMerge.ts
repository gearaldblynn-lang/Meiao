type TerminalResultLike = {
  id?: unknown;
  backendJobId?: unknown;
  taskId?: unknown;
  planId?: unknown;
  imageUrl?: unknown;
  videoUrl?: unknown;
  status?: unknown;
};

const normalizeText = (value: unknown) => String(value || '').trim();

const isTerminalPersistedResult = (result: TerminalResultLike = {}) => Boolean(
  normalizeText(result.imageUrl)
  || normalizeText(result.videoUrl)
  || result.status === 'error'
);

export const hasPersistedTerminalJobResult = ({
  results = [],
  jobId = '',
  providerTaskId = '',
  payloadPlanId = '',
}: {
  results?: TerminalResultLike[];
  jobId?: unknown;
  providerTaskId?: unknown;
  payloadPlanId?: unknown;
}) => {
  const normalizedJobId = normalizeText(jobId);
  const normalizedProviderTaskId = normalizeText(providerTaskId);
  const normalizedPayloadPlanId = normalizeText(payloadPlanId);
  const hasConcreteJobIdentity = Boolean(normalizedJobId || normalizedProviderTaskId);

  return results.some((result) => {
    const resultJobId = normalizeText(result.backendJobId);
    const resultTaskId = normalizeText(result.taskId || result.id);
    const resultPlanId = normalizeText(result.planId);
    const matches = Boolean(
      (resultJobId && resultJobId === normalizedJobId)
      || (normalizedProviderTaskId && resultTaskId === normalizedProviderTaskId)
      || (
        !hasConcreteJobIdentity
        && normalizedPayloadPlanId
        && resultPlanId === normalizedPayloadPlanId
        && isTerminalPersistedResult(result)
      )
    );
    return matches && isTerminalPersistedResult(result);
  });
};
