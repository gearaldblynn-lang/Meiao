const TRANSLATION_RESULT_SUBFEATURES = new Set(['main', 'detail']);

export class TranslationAssetMirrorScopeExpiredError extends Error {
  constructor() {
    super('Translation asset mirror scope expired');
    this.name = 'TranslationAssetMirrorScopeExpiredError';
  }
}

export const isTranslationAssetMirrorScopeExpiredError = (error) => (
  error instanceof TranslationAssetMirrorScopeExpiredError
  || error?.name === 'TranslationAssetMirrorScopeExpiredError'
);

export const isManagedTranslationAssetUrl = (url) => {
  const value = String(url || '').trim();
  if (!value) return false;
  try {
    return new URL(value, 'http://localhost').pathname.startsWith('/api/assets/file/');
  } catch {
    return false;
  }
};

export const isTranslationAssetMirrorScopeCurrent = ({
  scope,
  currentScope,
  currentUserId,
  signal,
} = {}) => Boolean(
  scope
  && currentScope === scope
  && scope.userId
  && scope.userId === currentUserId
  && !scope.controller?.signal?.aborted
  && !signal?.aborted
);

export const replaceTranslationResultAssetUrl = (projects, input = {}) => {
  const currentProjects = Array.isArray(projects) ? projects : [];
  const projectIndex = currentProjects.findIndex((project) => (
    project?.id === input.projectId
    && project?.module === 'translation'
    && TRANSLATION_RESULT_SUBFEATURES.has(String(project?.subFeature || ''))
  ));
  if (projectIndex < 0 || !input.sourceUrl || !input.managedUrl) {
    return { projects: currentProjects, updated: false, project: null, result: null };
  }

  const currentProject = currentProjects[projectIndex];
  const currentResults = Array.isArray(currentProject.results) ? currentProject.results : [];
  const resultIndex = currentResults.findIndex((result) => result?.id === input.resultId);
  if (resultIndex < 0) {
    return { projects: currentProjects, updated: false, project: null, result: null };
  }

  const currentResult = currentResults[resultIndex];
  if (
    (currentResult?.module && currentResult.module !== 'translation')
    || (currentResult?.subFeature && currentResult.subFeature !== currentProject.subFeature)
  ) {
    return { projects: currentProjects, updated: false, project: null, result: null };
  }
  const replaceResultUrl = currentResult?.imageUrl === input.sourceUrl
    && currentResult.imageUrl !== input.managedUrl;
  let replacedVersionUrl = false;
  const currentVersions = Array.isArray(currentResult?.translationEditVersions)
    ? currentResult.translationEditVersions
    : [];
  const nextVersions = currentVersions.map((version) => {
    if (
      version?.status !== 'completed'
      || version?.imageUrl !== input.sourceUrl
      || version.imageUrl === input.managedUrl
    ) {
      return version;
    }
    replacedVersionUrl = true;
    return { ...version, imageUrl: input.managedUrl };
  });

  if (!replaceResultUrl && !replacedVersionUrl) {
    return { projects: currentProjects, updated: false, project: null, result: null };
  }

  const nextResult = {
    ...currentResult,
    ...(replaceResultUrl ? { imageUrl: input.managedUrl } : {}),
    ...(replacedVersionUrl ? { translationEditVersions: nextVersions } : {}),
  };
  const nextResults = [...currentResults];
  nextResults[resultIndex] = nextResult;
  const nextProject = { ...currentProject, results: nextResults };
  const nextProjects = [...currentProjects];
  nextProjects[projectIndex] = nextProject;

  return {
    projects: nextProjects,
    updated: true,
    project: nextProject,
    result: nextResult,
  };
};
