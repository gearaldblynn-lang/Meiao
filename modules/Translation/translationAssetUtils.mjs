const INTERNAL_ASSET_PATH_SEGMENT = '/api/assets/file/';

export const getExecutionSourceUrl = (fileItem) => {
  if (typeof fileItem?.sourceUrl === 'string' && /^https?:\/\//i.test(fileItem.sourceUrl)) {
    return fileItem.sourceUrl;
  }

  if (typeof fileItem?.sourcePreviewUrl === 'string' && /^https?:\/\//i.test(fileItem.sourcePreviewUrl)) {
    return fileItem.sourcePreviewUrl;
  }

  return '';
};

export const getClientSafeAssetUrl = (url) => {
  const value = String(url || '').trim();
  if (!value || !value.includes(INTERNAL_ASSET_PATH_SEGMENT)) {
    return value;
  }

  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
};
