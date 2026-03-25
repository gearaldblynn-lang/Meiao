
import JSZip from 'jszip';
import { safeCreateObjectURL } from './urlUtils';

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

/**
 * 获取原始图片尺寸和比例值
 */
export const getImageDimensions = (file: File | Blob): Promise<{ width: number, height: number, ratio: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = safeCreateObjectURL(file);
    img.onload = () => {
      const { width, height } = img;
      resolve({ width, height, ratio: width / height });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve({ width: 0, height: 0, ratio: 1 });
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
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = safeCreateObjectURL(blob);
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = Number(width);
      canvas.height = Number(height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context error'));

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      
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
      
      if (finalBlob) resolve(finalBlob);
      else reject(new Error('Canvas compression failed'));
      
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Image load failed during resizing'));
  });
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
