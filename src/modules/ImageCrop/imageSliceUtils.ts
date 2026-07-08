export interface SliceRange {
  index: number;
  y: number;
  height: number;
}

export interface ImageSliceBlob {
  index: number;
  y: number;
  height: number;
  width: number;
  blob: Blob;
  fileName: string;
  mimeType: string;
}

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const normalizeSplitLines = (lines: number[], imageHeight: number, minSliceHeight = 16): number[] => {
  const height = Math.floor(Number(imageHeight || 0));
  if (height <= 0) return [];
  const lower = Math.max(1, Math.floor(minSliceHeight));
  const upper = Math.max(lower, height - lower);
  const seen = new Set<number>();

  for (const value of lines) {
    const line = Math.round(Number(value));
    if (!Number.isFinite(line)) continue;
    if (line < lower || line > upper) continue;
    seen.add(line);
  }

  return [...seen].sort((a, b) => a - b);
};

export const buildSliceRanges = (imageHeight: number, lines: number[], minSliceHeight = 16): SliceRange[] => {
  const height = Math.floor(Number(imageHeight || 0));
  if (height <= 0) throw new Error('Image height must be greater than zero');

  const normalized = normalizeSplitLines(lines, height, minSliceHeight);
  const points = [0, ...normalized, height];
  const ranges: SliceRange[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const y = points[index];
    const nextY = points[index + 1];
    if (nextY <= y) continue;
    ranges.push({ index, y, height: nextY - y });
  }

  return ranges;
};

export const buildVisibleAreaSplitLine = ({
  imageHeight,
  viewportHeight,
  renderedHeight,
  scrollTop,
  minSliceHeight = 16,
}: {
  imageHeight: number;
  viewportHeight: number;
  renderedHeight: number;
  scrollTop: number;
  minSliceHeight?: number;
}) => {
  const sourceHeight = Math.max(1, Math.floor(Number(imageHeight || 0)));
  const displayHeight = Math.max(1, Number(renderedHeight || 0));
  const visibleHeight = Math.max(1, Number(viewportHeight || 0));
  const visibleMiddle = Math.max(0, Number(scrollTop || 0)) + visibleHeight / 2;
  const imageY = Math.round(visibleMiddle * (sourceHeight / displayHeight));
  return Math.min(sourceHeight - minSliceHeight, Math.max(minSliceHeight, imageY));
};

const normalizeSourceBaseName = (sourceName: string) => {
  const rawBase = String(sourceName || 'detail-long-image').replace(/\.[^.]+$/, '').trim();
  const ascii = rawBase
    .replace(/[详詳]/g, ' detail ')
    .replace(/[长長]/g, ' long ')
    .replace(/[图圖]/g, ' image ')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || 'detail-long-image';
};

export const buildSliceFileName = (
  sourceName: string,
  index: number,
  total: number,
  mimeType = 'image/jpeg',
) => {
  const ext = MIME_EXTENSION[mimeType] || 'jpg';
  const width = Math.max(2, String(Math.max(1, total)).length);
  const current = String(index + 1).padStart(width, '0');
  const count = String(Math.max(1, total)).padStart(width, '0');
  return `${normalizeSourceBaseName(sourceName)}-${current}-of-${count}.${ext}`;
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

export const sliceImageFile = async (
  file: File,
  lines: number[],
  options: { mimeType?: string; quality?: number; minSliceHeight?: number } = {},
): Promise<ImageSliceBlob[]> => {
  const image = await createLoadedImage(file);
  const mimeType = options.mimeType || (file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg');
  const quality = options.quality ?? 0.92;
  const ranges = buildSliceRanges(image.naturalHeight || image.height, lines, options.minSliceHeight);
  const total = ranges.length;

  try {
    const slices = await Promise.all(ranges.map(async (range) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = range.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(
        image,
        0,
        range.y,
        canvas.width,
        range.height,
        0,
        0,
        canvas.width,
        range.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error('Image slice export failed'));
        }, mimeType, quality);
      });
      return {
        ...range,
        width: canvas.width,
        blob,
        fileName: buildSliceFileName(file.name, range.index, total, mimeType),
        mimeType,
      };
    }));
    return slices;
  } finally {
    URL.revokeObjectURL(image.src);
  }
};
