import { OneClickSubMode } from '../../types';

const createId = () => `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeUrls = (urls) =>
  Array.isArray(urls)
    ? Array.from(new Set(
        urls
          .filter((value) => typeof value === 'string' && value.trim())
          .map((value) => value.trim())
      ))
    : [];

const buildReferenceItems = (urls, prefix) =>
  normalizeUrls(urls).map((url, index) => ({
    id: `${prefix}_${Date.now()}_${index}`,
    file: null,
    uploadedUrl: url,
  }));

const buildPresetContentType = (subMode) =>
  subMode === OneClickSubMode.FIRST_IMAGE || subMode === OneClickSubMode.SKU
    ? 'images_only'
    : 'images_with_analysis';

const buildAnalysisText = (subMode, fallbackName, summary) =>
  buildPresetContentType(subMode) === 'images_with_analysis'
    ? (summary || fallbackName)
    : '';

export const createReferencePresetFromState = ({ subMode, name, state }) => {
  const now = Date.now();
  const fallbackName = name?.trim() || '未命名预设';
  const contentType = buildPresetContentType(subMode);

  if (subMode === OneClickSubMode.SKU) {
    const styleRef = state.images.find((item) => item.role === 'style_ref' && item.uploadedUrl);
    const imageUrl = styleRef?.uploadedUrl?.trim() || '';
    return {
      id: createId(),
      name: fallbackName,
      subMode,
      contentType,
      coverImageUrl: imageUrl,
      referenceImageUrls: imageUrl ? [imageUrl] : [],
      summary: '',
      detail: '',
      referenceDimensions: Array.isArray(state.referenceDimensions) ? state.referenceDimensions : [],
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  const referenceImageUrls = normalizeUrls([
    ...(state.uploadedDesignReferenceUrls || []),
    state.lastStyleUrl || '',
  ]);
  const analysisText = buildAnalysisText(subMode, fallbackName, state.referenceAnalysis?.summary?.trim() || '');

  return {
    id: createId(),
    name: fallbackName,
    subMode,
    contentType,
    coverImageUrl: referenceImageUrls[0] || '',
    referenceImageUrls,
    summary: analysisText,
    detail: analysisText,
    referenceDimensions: Array.isArray(state.referenceDimensions) ? state.referenceDimensions : [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const createReferencePresetsFromFirstImageState = ({ namePrefix, state }) => {
  const urls = normalizeUrls(state.uploadedDesignReferenceUrls || []);
  const now = Date.now();

  return urls.map((url, index) => ({
    id: createId(),
    name: `${namePrefix || '首图主图参考预设'} ${index + 1}`,
    subMode: OneClickSubMode.FIRST_IMAGE,
    contentType: buildPresetContentType(OneClickSubMode.FIRST_IMAGE),
    coverImageUrl: url,
    referenceImageUrls: [url],
    summary: '',
    detail: '',
    referenceDimensions: Array.isArray(state.referenceDimensions) ? state.referenceDimensions : [],
    tags: [],
    createdAt: now + index,
    updatedAt: now + index,
  }));
};

export const updateReferencePreset = (presets, id, updates) =>
  presets.map((preset) =>
    preset.id === id
      ? {
          ...preset,
          ...updates,
          updatedAt: Date.now(),
        }
      : preset
  );

export const deleteReferencePreset = (presets, id) =>
  presets.filter((preset) => preset.id !== id);

export const upsertReferencePreset = (presets, nextPreset) => {
  const existing = presets.some((preset) => preset.id === nextPreset.id);
  if (existing) {
    return updateReferencePreset(presets, nextPreset.id, nextPreset);
  }
  return [nextPreset, ...presets];
};

export const filterReferencePresets = (presets, { subMode, query }) => {
  const keyword = typeof query === 'string' ? query.trim().toLowerCase() : '';
  return presets.filter((preset) => {
    if (subMode && preset.subMode !== subMode) return false;
    if (!keyword) return true;
    return (
      preset.name.toLowerCase().includes(keyword) ||
      preset.summary.toLowerCase().includes(keyword) ||
      preset.detail.toLowerCase().includes(keyword)
    );
  });
};

export const applyReferencePresetToState = (preset, currentState) => {
  const shouldRestoreAnalysis = preset.contentType === 'images_with_analysis';
  const referenceAnalysis = shouldRestoreAnalysis
    ? {
        status: 'success',
        summary: shouldRestoreAnalysis ? preset.summary : '',
        error: '',
        analyzedAt: Date.now(),
      }
    : {
        status: 'idle',
        summary: '',
        error: '',
        analyzedAt: null,
      };

  if (preset.subMode === OneClickSubMode.SKU) {
    return {
      ...currentState,
      images: [
        ...currentState.images.filter((item) => item.role !== 'style_ref'),
        ...(preset.coverImageUrl
          ? [{
              id: `sku_style_ref_${Date.now()}`,
              file: null,
              role: 'style_ref',
              uploadedUrl: preset.coverImageUrl,
            }]
          : []),
      ],
      lastStyleUrl: preset.coverImageUrl || null,
      referenceDimensions: preset.referenceDimensions || [],
      referenceAnalysis,
    };
  }

  return {
    ...currentState,
    designReferences: buildReferenceItems(preset.referenceImageUrls, `${preset.subMode}_reference`),
    uploadedDesignReferenceUrls: normalizeUrls(preset.referenceImageUrls),
    lastStyleUrl: preset.coverImageUrl || preset.referenceImageUrls[0] || null,
    referenceDimensions: preset.referenceDimensions || [],
    referenceAnalysis,
  };
};
