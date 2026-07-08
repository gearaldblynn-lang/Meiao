export interface ImageResizeBlob {
  width: number;
  height: number;
  blob: Blob;
  fileName: string;
  mimeType: string;
}

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const normalizeResizeDimension = (value: unknown) => {
  const parsed = Math.round(Number(String(value ?? '').trim()));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const calculateContainedResize = (
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) => {
  const width = normalizeResizeDimension(sourceWidth);
  const height = normalizeResizeDimension(sourceHeight);
  const requestedWidth = normalizeResizeDimension(targetWidth);
  const requestedHeight = normalizeResizeDimension(targetHeight);
  if (width <= 0 || height <= 0) throw new Error('Image dimensions must be greater than zero');
  if (requestedWidth <= 0 && requestedHeight <= 0) throw new Error('Target width or height is required');

  if (requestedWidth > 0 && requestedHeight > 0) {
    const scale = Math.min(requestedWidth / width, requestedHeight / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  if (requestedWidth > 0) {
    return {
      width: requestedWidth,
      height: Math.max(1, Math.round(requestedWidth * (height / width))),
    };
  }

  return {
    width: Math.max(1, Math.round(requestedHeight * (width / height))),
    height: requestedHeight,
  };
};

const normalizeSourceBaseName = (sourceName: string) => {
  const rawBase = String(sourceName || 'image-resize').replace(/\.[^.]+$/, '').trim();
  const ascii = rawBase
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || 'image-resize';
};

export const buildResizeFileName = (
  sourceName: string,
  width: number,
  height: number,
  mimeType = 'image/jpeg',
) => {
  const ext = MIME_EXTENSION[mimeType] || 'jpg';
  return `${normalizeSourceBaseName(sourceName)}-${Math.round(width)}x${Math.round(height)}.${ext}`;
};

const createLoadedImage = async (file: File): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
};

export const resizeImageFile = async (
  file: File,
  targetWidth: number,
  targetHeight: number,
  options: { mimeType?: string; quality?: number } = {},
): Promise<ImageResizeBlob> => {
  const image = await createLoadedImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const size = calculateContainedResize(sourceWidth, sourceHeight, targetWidth, targetHeight);
  const mimeType = options.mimeType || (file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg');
  const quality = options.quality ?? 0.92;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) resolve(nextBlob);
        else reject(new Error('Image resize export failed'));
      }, mimeType, quality);
    });
    return {
      ...size,
      blob,
      fileName: buildResizeFileName(file.name, size.width, size.height, mimeType),
      mimeType,
    };
  } finally {
    URL.revokeObjectURL(image.src);
  }
};
