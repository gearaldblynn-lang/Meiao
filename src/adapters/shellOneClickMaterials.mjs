import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';

const ONE_CLICK_MODULE = 'one_click';
const FIRST_IMAGE_SUBFEATURE = 'first_image';
const DETAIL_PAGE_SUBFEATURE = 'detail_page';

export const getShellMaterialUrl = (material, publicBaseUrl = '') => {
  const raw = String(material?.remoteUrl || material?.url || '').trim();
  return resolvePublicAssetUrl(raw, publicBaseUrl) || raw;
};

const normalizeUrlKey = (value, publicBaseUrl = '') => {
  const resolved = resolvePublicAssetUrl(String(value || '').trim(), publicBaseUrl) || String(value || '').trim();
  return resolved.replace(/[?#].*$/, '');
};

const cloneMaterials = (materials = {}) => Object.fromEntries(
  Object.entries(materials || {}).map(([type, items]) => [type, Array.isArray(items) ? [...items] : []]),
);

const collectMaterialUrls = (items, publicBaseUrl = '') =>
  (items || []).map((item) => getShellMaterialUrl(item, publicBaseUrl)).filter(Boolean);

const dedupeUrls = (urls) => Array.from(new Set((urls || []).map((url) => String(url || '').trim()).filter(Boolean)));

const findMaterialByUrl = (items, url, publicBaseUrl = '') => {
  const targetKey = normalizeUrlKey(url, publicBaseUrl);
  return (items || []).find((item) => normalizeUrlKey(getShellMaterialUrl(item, publicBaseUrl), publicBaseUrl) === targetKey);
};

const makeRemoteMaterial = ({ id, type, url, fileName, subFeature, createRemoteMaterial }) => {
  if (typeof createRemoteMaterial === 'function') {
    return createRemoteMaterial(id, type, url, fileName, subFeature);
  }
  return { id, type, url, remoteUrl: url, fileName, subFeature };
};

const appendPreviousResultReference = ({ next, plan, subFeature, publicBaseUrl, createRemoteMaterial }) => {
  if (!plan?.sourceResultUrl || plan?.editInstruction?.trim() || plan?.variationInstruction?.trim()) return next;
  const normalizedResultUrl = resolvePublicAssetUrl(plan.sourceResultUrl, publicBaseUrl) || '';
  if (!normalizedResultUrl) return next;
  next.reference = [
    makeRemoteMaterial({
      id: `prev-${plan.id || Date.now()}`,
      type: 'reference',
      url: normalizedResultUrl,
      fileName: 'first-image-variant-base.png',
      subFeature,
      createRemoteMaterial,
    }),
    ...(next.reference || []),
  ];
  return next;
};

export const buildOneClickPlanGenerationMaterials = ({
  baseMaterials = {},
  plan = {},
  subFeature = '',
  publicBaseUrl = '',
  createRemoteMaterial,
} = {}) => {
  const next = cloneMaterials(baseMaterials);
  if (subFeature !== FIRST_IMAGE_SUBFEATURE && subFeature !== DETAIL_PAGE_SUBFEATURE) {
    return appendPreviousResultReference({ next, plan, subFeature, publicBaseUrl, createRemoteMaterial });
  }

  const sourceReferenceUrl = resolvePublicAssetUrl(plan.sourceReferenceUrl, publicBaseUrl) || '';
  if (sourceReferenceUrl) {
    const existingReference = findMaterialByUrl(next.styleRef, sourceReferenceUrl, publicBaseUrl)
      || findMaterialByUrl(next.reference, sourceReferenceUrl, publicBaseUrl);
    next.styleRef = [
      existingReference || makeRemoteMaterial({
        id: `plan-ref-${plan.id || Date.now()}`,
        type: 'styleRef',
        url: sourceReferenceUrl,
        fileName: subFeature === DETAIL_PAGE_SUBFEATURE ? 'detail-page-reference.png' : 'first-image-reference.png',
        subFeature,
        createRemoteMaterial,
      }),
    ];
  } else {
    next.styleRef = Array.isArray(next.styleRef) ? next.styleRef.slice(0, 1) : [];
  }

  next.reference = [];
  return appendPreviousResultReference({ next, plan, subFeature, publicBaseUrl, createRemoteMaterial });
};

export const buildShellImageInputUrls = ({
  module,
  subFeature,
  materials = {},
  publicBaseUrl = '',
  taskMetadata = {},
} = {}) => {
  const productImageUrls = collectMaterialUrls(materials.product, publicBaseUrl);
  const giftImageUrls = collectMaterialUrls(materials.gift, publicBaseUrl);
  const logoImageUrls = collectMaterialUrls(materials.logo, publicBaseUrl);
  const styleRefUrls = collectMaterialUrls(materials.styleRef, publicBaseUrl);
  const referenceImageUrls = collectMaterialUrls(materials.reference, publicBaseUrl);
  const allMaterialUrls = Object.values(materials || {}).flatMap((items) => collectMaterialUrls(items, publicBaseUrl));
  const sourceReferenceUrl = resolvePublicAssetUrl(taskMetadata?.sourceReferenceUrl, publicBaseUrl) || '';
  const sourceResultUrl = resolvePublicAssetUrl(taskMetadata?.sourceResultUrl, publicBaseUrl) || '';
  const hasEditInstruction = Boolean(String(taskMetadata?.editInstruction || '').trim());
  const hasVariationInstruction = Boolean(String(taskMetadata?.variationInstruction || '').trim());
  const isFirstImage = module === ONE_CLICK_MODULE && subFeature === FIRST_IMAGE_SUBFEATURE;
  const isDetailPage = module === ONE_CLICK_MODULE && subFeature === DETAIL_PAGE_SUBFEATURE;

  if (!isFirstImage && !isDetailPage) {
    if (sourceResultUrl && hasEditInstruction) {
      return dedupeUrls([...productImageUrls, ...giftImageUrls, sourceResultUrl]);
    }
    if (sourceResultUrl && hasVariationInstruction) {
      return dedupeUrls([sourceResultUrl, ...allMaterialUrls]);
    }
    return dedupeUrls(allMaterialUrls);
  }

  const currentReferenceUrls = sourceReferenceUrl
    ? [sourceReferenceUrl]
    : styleRefUrls.slice(0, 1);
  if (isDetailPage) {
    return dedupeUrls([...productImageUrls, ...giftImageUrls, ...currentReferenceUrls, ...logoImageUrls]);
  }
  if (sourceResultUrl && hasEditInstruction) {
    return dedupeUrls([...productImageUrls, ...giftImageUrls, sourceResultUrl]);
  }
  if (sourceResultUrl && hasVariationInstruction) {
    return dedupeUrls([sourceResultUrl, ...productImageUrls, ...giftImageUrls, ...logoImageUrls]);
  }
  return dedupeUrls([...productImageUrls, ...giftImageUrls, ...currentReferenceUrls, ...(sourceResultUrl ? [sourceResultUrl] : []), ...logoImageUrls]);
};
