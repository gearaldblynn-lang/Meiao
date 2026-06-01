export const normalizeAgentImageUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const markdownTarget = raw.match(/^\[[^\]]*]\(([^)\s]+)\)$/);
  if (markdownTarget?.[1]) return markdownTarget[1].trim();
  const absoluteUrl = raw.match(/https?:\/\/[^\s"'<>，。；、）)\]】]+/i);
  return absoluteUrl?.[0]?.trim() || raw;
};

export const extractAgentImageUrlsFromText = (value) => Array.from(new Set(
  String(value || '')
    .match(/https?:\/\/[^\s"'<>，。；、）)\]】]+/gi)
    ?.map((item) => normalizeAgentImageUrl(item))
    .filter(Boolean) || []
));

export const filterAvailableAgentImageUrls = (urls = [], imageReferences = [], limit = 1) => {
  const availableUrls = new Set(
    (Array.isArray(imageReferences) ? imageReferences : [])
      .map((item) => normalizeAgentImageUrl(item?.url))
      .filter(Boolean)
  );
  return Array.from(new Set(
    (Array.isArray(urls) ? urls : [])
      .map((item) => normalizeAgentImageUrl(item))
      .filter((url) => url && availableUrls.has(url))
  )).slice(0, Math.max(1, Number(limit || 1)));
};

const getReferenceUrls = (imageReferences = []) => (Array.isArray(imageReferences) ? imageReferences : [])
  .map((item) => normalizeAgentImageUrl(item?.url))
  .filter(Boolean);

const getParsedReferenceUrls = (parsed = {}, normalizedRefs = []) => {
  if (!Array.isArray(parsed?.imageReferences)) return [];
  const byIndex = new Map((Array.isArray(normalizedRefs) ? normalizedRefs : [])
    .map((item) => [Number(item?.index || 0), item]));
  return parsed.imageReferences.flatMap((item) => {
    const url = normalizeAgentImageUrl(item?.url || item?.imageUrl || item?.image_url);
    if (url) return [url];
    const indexedReference = byIndex.get(Number(item?.index || 0));
    return indexedReference?.url ? [indexedReference.url] : [];
  });
};

export const hasAgentImageReferenceIntent = (...values) => {
  const text = values.map((value) => String(value || '')).join('\n');
  return /图\s*[1-9]\d*|原图|参考图|输入图|基于图|基于原图|修改|改成|替换|去掉|清除|擦除|保持|不变|局部|编辑|精修|优化背景|背景优化|换字|改字|(?:文案|文字).{0,20}(?:改|换|替换|修改)|(?:改|换|替换|修改).{0,20}(?:文案|文字)/.test(text);
};

export const isAgentImageEditTaskType = (value) => /edit|image[-_ ]?to[-_ ]?image|imageediting|retouch|resize|modify|variation|局部|修改|编辑|精修/.test(String(value || '').toLowerCase());

export const shouldRequireAgentImageInput = ({ parsed = {}, currentMessage = '' } = {}) =>
  isAgentImageEditTaskType(parsed?.taskType)
    || hasAgentImageReferenceIntent(currentMessage, parsed?.prompt, parsed?.reasoningSummary);

export const resolveAgentImagePlanInputUrlDetails = ({
  parsed = {},
  normalizedRefs = [],
  imageCapability = {},
  currentMessage = '',
} = {}) => {
  const refs = Array.isArray(normalizedRefs) ? normalizedRefs : [];
  const maxInputImages = Math.max(1, Number(imageCapability?.maxInputImages || 1));
  const parsedInputUrls = Array.isArray(parsed?.inputImageUrls)
    ? parsed.inputImageUrls
    : null;
  const parsedReferenceUrls = getParsedReferenceUrls(parsed, refs);
  const promptUrls = extractAgentImageUrlsFromText([
    parsed?.prompt,
    parsed?.reasoningSummary,
  ].filter(Boolean).join('\n'));
  const defaultReferenceUrls = parsedInputUrls === null ? getReferenceUrls(refs) : [];
  const candidateItems = [
    ...(parsedInputUrls || []).map((url) => ({ url, source: 'analysis_input_urls' })),
    ...parsedReferenceUrls.map((url) => ({ url, source: 'analysis_image_references' })),
    ...promptUrls.map((url) => ({ url, source: 'analysis_prompt_urls' })),
    ...defaultReferenceUrls.map((url) => ({ url, source: 'default_selected_references' })),
  ];
  const availableUrls = new Set(getReferenceUrls(refs));
  const seenUrls = new Set();
  const usedSources = new Set();
  const availableCandidateUrls = [];
  candidateItems.forEach((item) => {
    const url = normalizeAgentImageUrl(item?.url);
    if (!url || !availableUrls.has(url) || seenUrls.has(url) || availableCandidateUrls.length >= maxInputImages) return;
    seenUrls.add(url);
    usedSources.add(item.source);
    availableCandidateUrls.push(url);
  });
  if (availableCandidateUrls.length > 0) {
    return {
      urls: availableCandidateUrls,
      source: Array.from(usedSources).join('+') || 'unknown',
      analysisInputImageUrls: parsedInputUrls || [],
      parsedReferenceUrls,
      promptUrls,
      recovered: false,
    };
  }

  const analysisReturnedEmptyInput = Array.isArray(parsedInputUrls) && parsedInputUrls.length === 0;
  const analysisReturnedUnusableInput = Array.isArray(parsedInputUrls) && parsedInputUrls.length > 0;
  const shouldRecoverSelectedReferences = (analysisReturnedEmptyInput || analysisReturnedUnusableInput)
    && refs.length > 0
    && (
      shouldRequireAgentImageInput({ parsed, currentMessage })
      || parsedReferenceUrls.length > 0
      || promptUrls.length > 0
    );
  if (!shouldRecoverSelectedReferences) {
    return {
      urls: [],
      source: 'no_input_images',
      analysisInputImageUrls: parsedInputUrls || [],
      parsedReferenceUrls,
      promptUrls,
      recovered: false,
    };
  }

  return {
    urls: getReferenceUrls(refs).slice(0, maxInputImages),
    source: analysisReturnedUnusableInput
      ? 'recovered_selected_references_from_unusable_analysis_input'
      : 'recovered_selected_references',
    analysisInputImageUrls: parsedInputUrls || [],
    parsedReferenceUrls,
    promptUrls,
    recovered: true,
  };
};

export const resolveAgentImagePlanInputUrls = (options = {}) =>
  resolveAgentImagePlanInputUrlDetails(options).urls;
