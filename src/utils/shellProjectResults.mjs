const hasCompletedMediaUrl = (result) => (
  result?.status === 'completed'
  && Boolean(result?.imageUrl || result?.videoUrl)
);

export const countCompletedProjectResults = (results = []) => (
  results.filter((result) => hasCompletedMediaUrl(result)).length
);

export const mergeGeneratedPlanResults = (existingResults = [], generatedResults = [], selectedPlanIds = []) => {
  const selectedIds = new Set(selectedPlanIds.filter(Boolean).map(String));
  if (selectedIds.size === 0) {
    return [...existingResults, ...generatedResults];
  }

  const generatedByPlanId = new Map();
  const generatedWithoutPlanId = [];
  generatedResults.forEach((result) => {
    const planId = String(result?.planId || '').trim();
    if (planId) {
      generatedByPlanId.set(planId, result);
    } else if (result) {
      generatedWithoutPlanId.push(result);
    }
  });

  const consumedPlanIds = new Set();
  const merged = [];
  existingResults.forEach((result) => {
    const planId = String(result?.planId || '').trim();
    if (planId && selectedIds.has(planId)) {
      const replacement = generatedByPlanId.get(planId);
      if (replacement) {
        merged.push(replacement);
        consumedPlanIds.add(planId);
      }
      return;
    }
    merged.push(result);
  });

  selectedPlanIds.forEach((planIdValue) => {
    const planId = String(planIdValue || '').trim();
    if (!planId || consumedPlanIds.has(planId)) return;
    const generated = generatedByPlanId.get(planId);
    if (generated) {
      merged.push(generated);
      consumedPlanIds.add(planId);
    }
  });

  return [...merged, ...generatedWithoutPlanId];
};
