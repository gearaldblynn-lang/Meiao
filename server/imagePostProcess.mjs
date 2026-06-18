import sharp from 'sharp';

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseAspectRatio = (value) => {
  const [rawWidth, rawHeight] = String(value || '').split(':');
  const width = toPositiveNumber(rawWidth);
  const height = toPositiveNumber(rawHeight);
  if (!width || !height) return null;
  return width / height;
};

const normalizeMaxFileSize = (payload = {}) => {
  const size = toPositiveNumber(payload.maxFileSize ?? payload.maxSize, 0);
  return size > 0 ? size : undefined;
};

const normalizeDimension = (value) => {
  const number = toPositiveNumber(value);
  return number > 0 ? Math.round(number) : 0;
};

export const buildImageOutputTransformFromJob = (job = {}) => {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  const resolutionMode = String(payload.resolutionMode || payload.sizeMode || '').trim();
  const isOriginalMode = resolutionMode === 'original' || resolutionMode.includes('原图');
  const finalSize = payload.finalSize && typeof payload.finalSize === 'object' ? payload.finalSize : {};
  const maxFileSize = normalizeMaxFileSize(payload);
  let width = 0;
  let height = 0;

  if (isOriginalMode) {
    width = normalizeDimension(finalSize.width);
    height = normalizeDimension(finalSize.height);
  } else if (resolutionMode === 'custom' || resolutionMode.includes('自定义') || resolutionMode.includes('固定')) {
    width = normalizeDimension(payload.targetWidth ?? payload.width);
    height = normalizeDimension(payload.targetHeight ?? payload.height);
    const ratio = parseAspectRatio(payload.aspectRatio || payload.ratio);
    if (ratio && width > 0 && height <= 0) height = Math.max(1, Math.round(width / ratio));
    if (ratio && height > 0 && width <= 0) width = Math.max(1, Math.round(height * ratio));
  }

  if (width <= 0 && height <= 0 && !maxFileSize) return null;
  return {
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
    ...(maxFileSize ? { maxFileSize } : {}),
  };
};

const encodeJpegWithinLimit = async (pipeline, maxFileSize) => {
  const targetBytes = maxFileSize ? maxFileSize * 1024 * 1024 : Infinity;
  const qualities = [95, 88, 80, 72, 64, 56, 48, 40, 32, 24];
  let latest = null;

  for (const quality of qualities) {
    latest = await pipeline.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (latest.length <= targetBytes) return latest;
  }

  return latest;
};

export const transformImageOutputBuffer = async (fileBuffer, transform = {}) => {
  const width = normalizeDimension(transform.width);
  const height = normalizeDimension(transform.height);
  const maxFileSize = toPositiveNumber(transform.maxFileSize, 0);
  const pipeline = sharp(fileBuffer, { failOn: 'none' }).rotate();
  const metadata = await pipeline.metadata();
  let targetWidth = width;
  let targetHeight = height;

  if (targetWidth > 0 && targetHeight <= 0 && metadata.width && metadata.height) {
    targetHeight = Math.max(1, Math.round(targetWidth * metadata.height / metadata.width));
  }
  if (targetHeight > 0 && targetWidth <= 0 && metadata.width && metadata.height) {
    targetWidth = Math.max(1, Math.round(targetHeight * metadata.width / metadata.height));
  }

  const resized = targetWidth > 0 || targetHeight > 0
    ? pipeline.resize({
        width: targetWidth || null,
        height: targetHeight || null,
        fit: 'fill',
      })
    : pipeline;
  const buffer = await encodeJpegWithinLimit(resized, maxFileSize);
  const outputMetadata = await sharp(buffer).metadata();

  return {
    buffer,
    mimeType: 'image/jpeg',
    fileNameExtension: '.jpg',
    width: normalizeDimension(outputMetadata.width),
    height: normalizeDimension(outputMetadata.height),
  };
};
