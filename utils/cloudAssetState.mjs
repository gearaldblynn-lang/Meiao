export const hasAvailableAssetSources = (localFiles, uploadedUrls = []) => {
  const hasLocalFiles = Array.isArray(localFiles) && localFiles.some(Boolean);
  const hasUploadedUrls = Array.isArray(uploadedUrls)
    && uploadedUrls.some((url) => typeof url === 'string' && url.trim().length > 0);

  return hasLocalFiles || hasUploadedUrls;
};

export const hasReusableTaskAsset = (task) => {
  if (!task || typeof task !== 'object') return false;

  if (task.file instanceof File) return true;

  return ['sourceUrl', 'resultUrl', 'taskId'].some((field) => {
    const value = task[field];
    return typeof value === 'string' && value.trim().length > 0;
  });
};

export const getTaskDisplayName = (task, fallback = '未命名任务') => {
  if (!task || typeof task !== 'object') return fallback;

  const candidates = [
    task.fileName,
    task.relativePath,
    task.file?.name,
    task.taskId,
  ];

  const matched = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return matched || fallback;
};

export const buildPersistedResultFileName = (baseName, suffix = 'result', fallbackExtension = '.png') => {
  const rawName = String(baseName || '').trim() || 'asset';
  const sanitized = rawName.replace(/[\\/:*?"<>|]+/g, '_');
  const dotIndex = sanitized.lastIndexOf('.');
  const hasExtension = dotIndex > 0 && dotIndex < sanitized.length - 1;
  const name = hasExtension ? sanitized.slice(0, dotIndex) : sanitized;
  const extension = hasExtension ? sanitized.slice(dotIndex) : fallbackExtension;
  return `${name}_${suffix}${extension}`;
};
