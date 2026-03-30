
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
export const getImageDimensions = (file: File | Blob): Promise<{ width: number, height: number, ratio: number }> => {
  return new Promise(async (resolve) => {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        try {
          const { width, height } = bitmap;
          resolve({ width, height, ratio: height ? width / height : 1 });
          return;
        } finally {
          bitmap.close?.();
        }
      } catch {
        // Fall back to HTMLImageElement decoding below.
      }
    }

    const objectUrl = safeCreateObjectURL(file);
    if (!objectUrl) {
      resolve({ width: 0, height: 0, ratio: 1 });
      return;
    }

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
  maxBytes = DEFAULT_UPLOAD_IMAGE_MAX_BYTES
): Promise<File> => {
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

export const createZipAndDownload = async (files: { blob: Blob, path: string }[], zipName: string) => {
  const zip = new JSZip();
  files.forEach(f => {
    zip.file(f.path, f.blob);
  });
  const content = await zip.generateAsync({ 
    type: 'blob',
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
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
