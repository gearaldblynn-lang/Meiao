const compact = (value) => String(value || '').trim();

export const SHELL_SUBFEATURE_IDS = Object.freeze({
  one_click: Object.freeze(['first_image', 'main_image', 'detail_page', 'sku']),
  translation: Object.freeze(['main', 'detail', 'remove_text']),
  retouch: Object.freeze(['original', 'white_bg', 'product_restore', 'background_replace', 'enhance']),
  everything_replace: Object.freeze(['product_replace', 'background_replace', 'logo_replace']),
  image_crop: Object.freeze(['long_slice', 'resize']),
  buyer_show: Object.freeze(['image', 'copy']),
  video: Object.freeze(['generation', 'storyboard', 'voiceover_translation', 'subtitle_removal', 'diagnosis']),
  xhs_cover: Object.freeze(['cover']),
  agent_center: Object.freeze(['chat', 'management', 'knowledge', 'versions']),
  smart_factory: Object.freeze(['factory']),
});

const SHELL_SUBFEATURE_ALIASES = Object.freeze({
  one_click: Object.freeze({
    首图: 'first_image',
    主图: 'main_image',
    详情: 'detail_page',
    详情页: 'detail_page',
    SKU: 'sku',
  }),
  translation: Object.freeze({
    removeText: 'remove_text',
    主图出海: 'main',
    详情出海: 'detail',
    去文案: 'remove_text',
  }),
  retouch: Object.freeze({
    原图精修: 'original',
    白底精修: 'white_bg',
    产品还原: 'product_restore',
    背景替换: 'background_replace',
    智能增强: 'enhance',
  }),
  everything_replace: Object.freeze({
    产品替换: 'product_replace',
    背景替换: 'background_replace',
    Logo替换: 'logo_replace',
    logo替换: 'logo_replace',
  }),
  image_crop: Object.freeze({
    长图切片: 'long_slice',
    修改尺寸: 'resize',
  }),
  buyer_show: Object.freeze({
    买家秀图片: 'image',
    纯文案: 'copy',
  }),
  video: Object.freeze({
    短视频生成: 'generation',
    分镜生成: 'storyboard',
    口播翻译: 'voiceover_translation',
    去字幕: 'subtitle_removal',
    视频诊断: 'diagnosis',
  }),
  xhs_cover: Object.freeze({ 封面生成: 'cover' }),
});

export const normalizeStructuredShellSubFeature = (module, value) => {
  const normalizedModule = compact(module);
  const raw = compact(value);
  if (!normalizedModule || !raw) return '';
  const aliased = SHELL_SUBFEATURE_ALIASES[normalizedModule]?.[raw] || raw;
  return SHELL_SUBFEATURE_IDS[normalizedModule]?.includes(aliased) ? aliased : '';
};

const hasProductRestoreSubmissionIdentity = (value) => (
  compact(value).includes(':product_restore:')
);

const projectResults = (project) => Array.isArray(project?.results) ? project.results : [];

const hasDirectProductRestoreScope = (record = {}, moduleFallback = '') => {
  if (compact(record?.module || moduleFallback) !== 'retouch') return false;
  return normalizeStructuredShellSubFeature('retouch', record?.subFeature) === 'product_restore'
    || normalizeStructuredShellSubFeature('retouch', record?.generationContext?.params?.mode) === 'product_restore'
    || Boolean(record?.generationContext?.productRestore && typeof record.generationContext.productRestore === 'object')
    || hasProductRestoreSubmissionIdentity(record?.clientSubmissionKey);
};

export const hasDurableProductRestoreScope = (project = {}) => {
  if (hasDirectProductRestoreScope(project)) return true;
  const results = projectResults(project);
  return results.length > 0
    && results.every((result) => hasDirectProductRestoreScope(result, project?.module));
};

const productRestoreProjectIds = (project) => {
  const ids = new Set();
  const add = (value) => {
    const id = compact(value);
    if (id.startsWith('proj-')) ids.add(id);
  };
  add(project?.id);
  if (hasDirectProductRestoreScope(project)) add(project?.projectId);
  const collectSubmissionId = (value) => {
    const submissionKey = compact(value);
    const markerIndex = submissionKey.indexOf(':product_restore:');
    if (markerIndex > 0) add(submissionKey.slice(0, markerIndex));
  };
  collectSubmissionId(project?.clientSubmissionKey);
  projectResults(project).forEach((result) => {
    collectSubmissionId(result?.clientSubmissionKey);
    if (hasDirectProductRestoreScope(result, project?.module)) add(result?.projectId);
  });
  return [...ids];
};

export const resolveShellProjectSubFeature = (project = {}) => {
  if (hasDurableProductRestoreScope(project)) return 'product_restore';
  const rawProjectScope = compact(project?.subFeature);
  const projectScope = normalizeStructuredShellSubFeature(project?.module, rawProjectScope);
  if (rawProjectScope) return projectScope || rawProjectScope;
  const resultScopes = new Set(projectResults(project)
    .map((result) => normalizeStructuredShellSubFeature(result?.module || project?.module, result?.subFeature))
    .filter(Boolean));
  if (resultScopes.size === 1) return [...resultScopes][0];
  return compact(project?.subFeature);
};

export const normalizeShellProjectScope = (project = {}) => {
  if (!project || typeof project !== 'object') return project;
  const productRestore = hasDurableProductRestoreScope(project);
  const subFeature = resolveShellProjectSubFeature(project);
  const canonicalIds = productRestore ? productRestoreProjectIds(project) : [];
  const id = canonicalIds.length === 1 ? canonicalIds[0] : compact(project?.id);
  let changed = id !== compact(project?.id) || subFeature !== compact(project?.subFeature);
  const results = projectResults(project).map((result) => {
    const rawResultScope = compact(result?.subFeature);
    const resultModule = compact(result?.module || project?.module);
    const normalizedResultScope = normalizeStructuredShellSubFeature(resultModule, rawResultScope);
    const inheritsProductRestoreScope = productRestore
      && resultModule === 'retouch'
      && (!rawResultScope || normalizedResultScope === 'original');
    const resultSubFeature = hasDirectProductRestoreScope(result, project?.module) || inheritsProductRestoreScope
      ? 'product_restore'
      : normalizedResultScope
        || rawResultScope
        || subFeature;
    if (resultSubFeature === rawResultScope) return result;
    changed = true;
    return { ...result, subFeature: resultSubFeature || undefined };
  });
  if (!changed) return project;
  return {
    ...project,
    id: id || project?.id,
    subFeature: subFeature || undefined,
    ...(Array.isArray(project?.results) ? { results } : {}),
  };
};

export const getShellProjectIdentityAliases = (project = {}) => {
  const aliases = new Set();
  const add = (value) => {
    const id = compact(value);
    if (!id) return;
    aliases.add(id);
    if (id.startsWith('job-') && id.length > 4) aliases.add(id.slice(4));
  };
  add(project?.id);
  add(project?.backendJobId);
  add(normalizeShellProjectScope(project)?.id);
  return [...aliases];
};
