export interface PlanResultMatchPlan {
  id: string;
}

export interface PlanResultMatchResult {
  id: string;
  planId?: string;
  backendJobId?: string;
  taskId?: string;
  status?: string;
  imageUrl?: string;
  videoUrl?: string;
}

const compact = (value: unknown) => String(value || '').trim();

export const stableResultIdentity = (result: PlanResultMatchResult) =>
  compact(result.backendJobId || result.taskId || result.id);

export const sortResultsForSinglePlanDisplay = <TResult extends PlanResultMatchResult>(results: TResult[]) => {
  if (results.length <= 1) return results;
  return results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftCompletedMedia = left.result.status === 'completed' && Boolean(left.result.imageUrl || left.result.videoUrl);
      const rightCompletedMedia = right.result.status === 'completed' && Boolean(right.result.imageUrl || right.result.videoUrl);
      if (leftCompletedMedia !== rightCompletedMedia) return leftCompletedMedia ? -1 : 1;
      const leftIdentity = stableResultIdentity(left.result);
      const rightIdentity = stableResultIdentity(right.result);
      if (leftIdentity && rightIdentity && leftIdentity !== rightIdentity) {
        return leftIdentity.localeCompare(rightIdentity);
      }
      if (leftIdentity !== rightIdentity) return leftIdentity ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ result }) => result);
};

export const findResultsForPlanDisplay = <
  TPlan extends PlanResultMatchPlan,
  TResult extends PlanResultMatchResult,
>(
  plans: TPlan[] = [],
  results: TResult[] = [],
  plan: TPlan,
  index: number,
) => {
  if (!results.length) return [];

  const planId = compact(plan.id);
  const byPlanId = planId
    ? results.filter((result) => compact(result.planId) === planId)
    : [];
  if (byPlanId.length > 0) return sortResultsForSinglePlanDisplay(byPlanId);

  const planIds = new Set(plans.map((item) => compact(item.id)).filter(Boolean));
  const unmatchedPlans = plans.filter((item) => {
    const candidatePlanId = compact(item.id);
    if (!candidatePlanId) return true;
    return !results.some((result) => compact(result.planId) === candidatePlanId);
  });
  const unmatchedPlanIndex = unmatchedPlans.findIndex((item) => item === plan || compact(item.id) === planId);
  const fallbackIndex = unmatchedPlanIndex >= 0 ? unmatchedPlanIndex : index;
  const orphanResults = sortResultsForSinglePlanDisplay(results.filter((result) => {
    const resultPlanId = compact(result.planId);
    return !resultPlanId || !planIds.has(resultPlanId);
  }));

  return orphanResults[fallbackIndex] ? [orphanResults[fallbackIndex]] : [];
};
