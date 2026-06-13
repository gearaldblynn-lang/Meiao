// @ts-nocheck

import JSZip from 'jszip';
import { safeCreateObjectURL } from './urlUtils';

const DEFAULT_UPLOAD_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export const fileToBase64 = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = error => reject(error);
  });
};

export const fileToDataUrl = (file: File | Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

export const getImageDimensionsFromUrl = (url: string): Promise<{ width: number, height: number, ratio: number }> => {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ width: 0, height: 0, ratio: 1 });
      return;
    }

    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      resolve({ width, height, ratio: height ? width / height : 1 });
    };
    img.onerror = () => resolve({ width: 0, height: 0, ratio: 1 });
    img.src = url;
  });
};

/**
 * 获取原始图片尺寸和比例值
 */
export const getImageDimensions = async (file: File | Blob): Promise<{ width: number, height: number, ratio: number }> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const { width, height } = bitmap;
        return { width, height, ratio: height ? width / height : 1 };
      } finally {
        bitmap.close?.();
      }
    } catch {
      // Fall back to HTMLImageElement decoding below.
    }
  }

  const objectUrl = safeCreateObjectURL(file);
  if (!objectUrl) {
    return { width: 0, height: 0, ratio: 1 };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      resolve({ width, height, ratio: height ? width / height : 1 });
      URL.revokeObjectURL(objectUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: 0, height: 0, ratio: 1 });
    };
    img.src = objectUrl;
  });
};

/**
 * 调整图片到目标分辨率，并支持迭代压缩文件大小
 */
export const resizeImage = async (
  blob: Blob,
  width: number,
  height: number,
  maxSizeMB?: number
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = Number(width);
  canvas.height = Number(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context error');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let decodedWithBitmap = false;
  let imageLoadError: unknown = null;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        ctx.drawImage(bitmap, 0, 0, width, height);
        decodedWithBitmap = true;
      } finally {
        bitmap.close?.();
      }
    } catch (error) {
      imageLoadError = error;
    }
  }

  if (!decodedWithBitmap) {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      const objectUrl = safeCreateObjectURL(blob);

      if (!objectUrl) {
        reject(new Error('Image object url creation failed'));
        return;
      }

      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, width, height);
          resolve();
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(imageLoadError instanceof Error ? imageLoadError : new Error('Image load failed during resizing'));
      };
      img.src = objectUrl;
    });
  }

  const targetBytes = maxSizeMB ? maxSizeMB * 1024 * 1024 : Infinity;

  // 迭代压缩质量
  let quality = 0.95;
  let finalBlob: Blob | null = null;

  const compress = (q: number): Promise<Blob | null> => {
    return new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
  };

  finalBlob = await compress(quality);

  if (maxSizeMB && finalBlob && finalBlob.size > targetBytes) {
    // 如果初始质量超过限制，开始迭代降低质量
    const steps = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25];
    for (const step of steps) {
      const b = await compress(step);
      if (b && b.size <= targetBytes) {
        finalBlob = b;
        break;
      }
      finalBlob = b; // 即使最后还是大，也保留最后一次的结果
    }
  }

  if (finalBlob) return finalBlob;
  throw new Error('Canvas compression failed');
};

const replaceFileExtension = (fileName: string, nextExtension: string) => {
  const normalizedExtension = nextExtension.startsWith('.') ? nextExtension : `.${nextExtension}`;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) {
    return `${fileName}${normalizedExtension}`;
  }
  return `${fileName.slice(0, dotIndex)}${normalizedExtension}`;
};

const getExtensionFromUrl = (url: string) => {
  try {
    const normalized = new URL(url, window.location.origin);
    const pathname = normalized.pathname || '';
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1]?.toLowerCase() || '';
  } catch {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const match = cleanUrl.match(/\.([a-zA-Z0-9]+)$/);
    return match?.[1]?.toLowerCase() || '';
  }
};

const getExtensionForMimeType = (mimeType: string) => {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
};

const ensureDownloadFileName = (fileName: string, mimeType: string, url: string) => {
  const normalizedName = (fileName || 'downloaded-image').trim();
  if (/\.[a-zA-Z0-9]+$/.test(normalizedName)) {
    return normalizedName;
  }

  const extensionFromMime = getExtensionForMimeType(mimeType);
  const extensionFromUrl = getExtensionFromUrl(url);
  const extension = extensionFromMime || extensionFromUrl || 'png';
  return `${normalizedName}.${extension}`;
};

const triggerDirectDownloadFallback = (url: string, fileName: string) => {
  if (!url) {
    throw new Error('下载失败: 结果地址为空');
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = ensureDownloadFileName(fileName, '', url);
  link.target = '_blank';
  link.rel = 'noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const fetchRemoteFileBlob = async (url: string) => {
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`);
    }
    return response.blob();
  } catch (error) {
    if (shouldUseDownloadProxy(url)) {
      return fetchRemoteFileBlobViaProxy(url);
    }
    throw error;
  }
};

const shouldUseDownloadProxy = (url: string) => {
  try {
    const parsed = new URL(url, window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.origin === window.location.origin) return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname !== 'localhost'
      && !hostname.endsWith('.localhost')
      && !hostname.endsWith('.local')
      && hostname !== '127.0.0.1'
      && hostname !== '0.0.0.0';
  } catch {
    return false;
  }
};

const fetchRemoteFileBlobViaProxy = async (url: string) => {
  const response = await fetch(`/api/assets/download-proxy?url=${encodeURIComponent(url)}`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status}`);
  }
  return response.blob();
};

export interface ImageDownloadTransform {
  targetWidth?: number;
  targetHeight?: number;
  maxFileSize?: number;
}

type ZipCompressionMode = 'STORE' | 'DEFLATE';

export interface ZipDownloadSource {
  blob?: Blob;
  url?: string;
  path: string;
  transform?: ImageDownloadTransform;
}

const ZIP_REMOTE_FETCH_CONCURRENCY = 6;

const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
};

const hasImageDownloadTransform = (transform?: ImageDownloadTransform) =>
  Boolean(transform && ((Number(transform.targetWidth) || 0) > 0 || (Number(transform.targetHeight) || 0) > 0));

const isDownloadableImage = (url: string, blob: Blob) =>
  blob.type.startsWith('image/')
  || /\.(png|jpe?g|webp|gif|bmp)$/i.test(url.split('?')[0].split('#')[0]);

const getFileNameForBlob = (fileName: string, blob: Blob, url: string, forceMimeExtension = false) => {
  const ensured = ensureDownloadFileName(fileName, blob.type, url);
  if (!forceMimeExtension || !blob.type) return ensured;
  return replaceFileExtension(ensured, getExtensionForMimeType(blob.type));
};

export const resolveRemoteFileBlobForDownload = async (
  url: string,
  transform?: ImageDownloadTransform,
) => {
  const blob = await fetchRemoteFileBlob(url);
  if (!hasImageDownloadTransform(transform) || !isDownloadableImage(url, blob)) return { blob, transformed: false };

  try {
    let width = Math.max(0, Math.round(Number(transform?.targetWidth) || 0));
    let height = Math.max(0, Math.round(Number(transform?.targetHeight) || 0));
    if (width > 0 && height === 0) {
      const dims = await getImageDimensions(blob);
      height = Math.round(width / (dims.ratio || 1));
    } else if (height > 0 && width === 0) {
      const dims = await getImageDimensions(blob);
      width = Math.round(height * (dims.ratio || 1));
    }
    if (width <= 0 || height <= 0) return { blob, transformed: false };
    const resizedBlob = await resizeImage(blob, width, height, transform?.maxFileSize);
    return { blob: resizedBlob, transformed: true };
  } catch (error) {
    console.warn('[MEIAO] download resize failed, keeping original blob', error);
    return { blob, transformed: false };
  }
};

export const downloadRemoteFile = async (url: string, fileName: string, transform?: ImageDownloadTransform) => {
  let blob: Blob;
  let transformed = false;
  try {
    const resolved = await resolveRemoteFileBlobForDownload(url, transform);
    blob = resolved.blob;
    transformed = resolved.transformed;
  } catch (error) {
    triggerDirectDownloadFallback(url, fileName);
    return;
  }
  const blobUrl = safeCreateObjectURL(blob);
  if (!blobUrl) {
    throw new Error('下载失败: 无法创建本地文件链接');
  }

  try {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = getFileNameForBlob(fileName, blob, url, transformed);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 100);
  }
};

export const downloadRemoteFilesAsZip = async (files: { url: string, path: string, transform?: ImageDownloadTransform }[], zipName: string) => {
  const zipFiles = await resolveFilesForZipDownload(files);
  await createZipAndDownload(zipFiles, zipName);
};

export const resolveFilesForZipDownload = async (
  files: ZipDownloadSource[],
  options: { concurrency?: number; skipFailed?: boolean } = {},
) => {
  const resolved = await runWithConcurrency(
    files,
    options.concurrency || ZIP_REMOTE_FETCH_CONCURRENCY,
    async (file) => {
      try {
        if (file.blob instanceof Blob) {
          return { blob: file.blob, path: file.path };
        }
        if (!file.url) {
          throw new Error('下载失败: 结果地址为空');
        }
        const { blob, transformed } = await resolveRemoteFileBlobForDownload(file.url, file.transform);
        return {
          blob,
          path: getFileNameForBlob(file.path, blob, file.url, transformed),
        };
      } catch (error) {
        if (options.skipFailed) {
          console.warn('[MEIAO] skip failed zip entry', file.path, error);
          return null;
        }
        throw error;
      }
    },
  );
  return resolved.filter(Boolean);
};

const renderImageBlob = async (
  source: File,
  width: number,
  height: number,
  mimeType: string,
  quality?: number
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context error');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  let decodedWithBitmap = false;
  let imageLoadError: unknown = null;

  try {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(source);
        try {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          decodedWithBitmap = true;
        } finally {
          bitmap.close?.();
        }
      } catch (error) {
        imageLoadError = error;
      }
    }

    if (!decodedWithBitmap) {
      const sourceUrl = safeCreateObjectURL(source);
      if (!sourceUrl) {
        throw new Error('Image object url creation failed');
      }

      try {
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve();
            } catch (error) {
              reject(error);
            }
          };
          img.onerror = () => reject(imageLoadError instanceof Error ? imageLoadError : new Error('Image load failed during upload compression'));
          img.src = sourceUrl;
        });
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('Image load failed during upload compression');
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas compression failed'));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
};

export const prepareImageForUpload = async (
  file: File,
  maxBytes = DEFAULT_UPLOAD_IMAGE_MAX_BYTES,
  enabled = true
): Promise<File> => {
  if (!enabled) return file;
  if (!file.type.startsWith('image/') || file.size <= maxBytes) {
    return file;
  }

  const { width, height } = await getImageDimensions(file);
  if (!width || !height) {
    throw new Error('图片解析失败，无法在上传前完成压缩。');
  }

  const mimeCandidates = file.type === 'image/png'
    ? ['image/jpeg', 'image/webp', 'image/png']
    : file.type === 'image/webp'
      ? ['image/webp', 'image/jpeg']
      : ['image/jpeg', 'image/webp'];
  const scaleSteps = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.32, 0.24, 0.18];
  const qualitySteps = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.28, 0.22, 0.18];

  let bestBlob: Blob | null = null;
  let bestMimeType = file.type;

  for (const scale of scaleSteps) {
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    for (const mimeType of mimeCandidates) {
      if (mimeType === 'image/png') {
        const pngBlob = await renderImageBlob(file, targetWidth, targetHeight, mimeType);
        if (!bestBlob || pngBlob.size < bestBlob.size) {
          bestBlob = pngBlob;
          bestMimeType = mimeType;
        }
        if (pngBlob.size <= maxBytes) {
          return new File(
            [pngBlob],
            replaceFileExtension(file.name, getExtensionForMimeType(mimeType)),
            { type: mimeType, lastModified: file.lastModified }
          );
        }
        continue;
      }

      for (const quality of qualitySteps) {
        const blob = await renderImageBlob(file, targetWidth, targetHeight, mimeType, quality);
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestMimeType = mimeType;
        }
        if (blob.size <= maxBytes) {
          return new File(
            [blob],
            replaceFileExtension(file.name, getExtensionForMimeType(mimeType)),
            { type: mimeType, lastModified: file.lastModified }
          );
        }
      }
    }
  }

  if (bestBlob && bestBlob.size <= maxBytes) {
    return new File(
      [bestBlob],
      replaceFileExtension(file.name, getExtensionForMimeType(bestMimeType)),
      { type: bestMimeType, lastModified: file.lastModified }
    );
  }

  throw new Error('图片压缩后仍超过 3MB，请压缩尺寸后重试。');
};

/**
 * 垂直拼合多张图片为长图
 */
export const stitchImagesVertically = async (blobs: Blob[]): Promise<Blob> => {
  if (blobs.length === 0) throw new Error("No images to stitch");

  const images = await Promise.all(blobs.map(blob => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.src = safeCreateObjectURL(blob);
      img.onload = () => resolve(img);
      img.onerror = reject;
    });
  }));

  const canvas = document.createElement('canvas');
  const maxWidth = Math.max(...images.map(img => img.width));
  const totalHeight = images.reduce((sum, img) => sum + (img.height * (maxWidth / img.width)), 0);

  canvas.width = maxWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Canvas context error");

  let currentY = 0;
  for (const img of images) {
    const drawWidth = maxWidth;
    const drawHeight = img.height * (maxWidth / img.width);
    ctx.drawImage(img, 0, currentY, drawWidth, drawHeight);
    currentY += drawHeight;
    URL.revokeObjectURL(img.src);
  }

  return new Promise((resolve) => {
    canvas.toBlob(b => resolve(b!), 'image/png', 0.95);
  });
};

const COMPRESSED_MEDIA_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp|avif|heic|mp4|mov|webm|m4v|zip|pdf)$/i;

const getZipEntryCompression = (file: { blob: Blob, path: string }): ZipCompressionMode => {
  const mimeType = String(file.blob?.type || '').toLowerCase();
  if (
    mimeType.startsWith('image/')
    || mimeType.startsWith('video/')
    || mimeType.startsWith('audio/')
    || mimeType === 'application/pdf'
    || mimeType === 'application/zip'
    || COMPRESSED_MEDIA_EXTENSION_PATTERN.test(file.path || '')
  ) {
    return 'STORE';
  }
  return 'DEFLATE';
};

export const createZipAndDownload = async (files: { blob: Blob, path: string }[], zipName: string) => {
  const zip = new JSZip();
  files.forEach(f => {
    zip.file(f.path, f.blob, { compression: getZipEntryCompression(f) });
  });
  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'STORE',
    compressionOptions: { level: 1 },
    streamFiles: true,
  });
  const url = safeCreateObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${zipName}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const getMimeType = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    default: return 'image/png';
  }
};
