const IDENTITY_ASSET_SLOT_LABELS = {
  front_close: '正面近景',
  left_45_close: '左侧45度近景',
  right_45_close: '右侧45度近景',
  profile_close: '侧面近景',
  three_quarter_half: '四分之三侧向半身',
  front_half: '正面半身',
  front_full: '正面全身',
  three_quarter_full: '四分之三全身',
};

export const insertModelReplaceLibraryMetadata = (prompt, metadataBlock) => {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedMetadata = String(metadataBlock || '').trim();
  if (!normalizedMetadata) return normalizedPrompt;
  const formatMarker = '\n\nF Format 格式';
  const formatIndex = normalizedPrompt.indexOf(formatMarker);
  if (formatIndex < 0) return `${normalizedPrompt}\n\n${normalizedMetadata}`.trim();
  return `${normalizedPrompt.slice(0, formatIndex)}\n\n${normalizedMetadata}${normalizedPrompt.slice(formatIndex)}`;
};

export const buildVirtualModelProviderPayload = (payload, resolvedAssets = []) => {
  if (payload?.identitySource !== 'library') {
    return { payload, authorizedManagedAssetIds: new Set() };
  }
  const assets = Array.isArray(resolvedAssets)
    ? resolvedAssets.filter((asset) => asset?.assetId && asset?.url)
    : [];
  const firstFullBodyIndex = payload?.replacementScope === 'full_person'
    ? assets.findIndex((asset) => asset.slot === 'front_full' || asset.slot === 'three_quarter_full')
    : -1;
  const orderedAssets = firstFullBodyIndex > 0
    ? [assets[firstFullBodyIndex], ...assets.filter((_asset, index) => index !== firstFullBodyIndex)]
    : assets;
  const identityAnchorConstraint = orderedAssets.length > 0
    ? `【图A实际素材角度】\n${orderedAssets
      .map((asset, index) => `图A-${index + 1}（输入图${index + 1}）：${IDENTITY_ASSET_SLOT_LABELS[asset.slot] || asset.slot}。`)
      .join('\n')}`
    : '';
  const identityDescription = String(payload.identityDescription || '').trim();
  const identityDescriptionConstraint = identityDescription
    ? `身份档案补充（次于图A-1）：${JSON.stringify(identityDescription)}\n该档案只补充图A-1未清楚展示的身份特征；与图A-1冲突时一律以图A-1为准。`
    : '';
  const libraryMetadata = [
    identityAnchorConstraint,
    identityDescriptionConstraint,
  ].filter(Boolean).join('\n\n');
  return {
    payload: {
      ...payload,
      ...(libraryMetadata
        ? { prompt: insertModelReplaceLibraryMetadata(payload.prompt, libraryMetadata) }
        : {}),
      imageUrls: [
        ...orderedAssets.map((asset) => asset.url),
        ...(Array.isArray(payload.imageUrls) ? payload.imageUrls : []),
      ],
    },
    authorizedManagedAssetIds: new Set(orderedAssets.map((asset) => asset.assetId)),
  };
};

export const resolveVirtualModelProviderPayload = async (payload, resolveSelectedAssets) => {
  if (payload?.identitySource !== 'library') {
    return buildVirtualModelProviderPayload(payload);
  }
  if (typeof resolveSelectedAssets !== 'function') {
    throw new TypeError('resolveSelectedAssets must be a function');
  }
  const assets = await resolveSelectedAssets({
    virtualModelId: payload.virtualModelId,
    virtualModelVersionId: payload.virtualModelVersionId,
    selectedAssetIds: payload.selectedAssetIds,
  });
  return buildVirtualModelProviderPayload(payload, assets);
};
