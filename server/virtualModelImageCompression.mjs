import sharp from 'sharp';

const MIB = 1024 * 1024;
const DEFAULT_TARGET_BYTES = 3 * MIB;
const MIN_TARGET_BYTES = 1 * MIB;
const MAX_TARGET_BYTES = 20 * MIB;
const CONSERVATIVE_QUALITY_STEPS = [90, 86, 82];
const OPTIMIZED_MODULES = new Set([
  'virtual_model',
  'virtual_model_generation',
]);

const FORMAT_OUTPUT = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
};

export const getVirtualModelImageTargetBytes = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_VIRTUAL_MODEL_IMAGE_TARGET_BYTES || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TARGET_BYTES;
  return Math.max(MIN_TARGET_BYTES, Math.min(MAX_TARGET_BYTES, parsed));
};

export const shouldOptimizeVirtualModelImageModule = (moduleName = '') => (
  OPTIMIZED_MODULES.has(String(moduleName || '').trim().toLowerCase())
);

const replaceFileExtension = (fileName, extension) => {
  const normalized = String(fileName || 'virtual-model-image').trim() || 'virtual-model-image';
  const baseName = normalized.replace(/\.[a-z0-9]{1,8}$/i, '');
  return `${baseName}.${extension}`;
};

const preserveMetadata = (pipeline, density) => (
  Number.isFinite(density) && density > 0
    ? pipeline.withMetadata({ density })
    : pipeline.keepMetadata()
);

const encodeCandidate = async ({ fileBuffer, format, quality, density }) => {
  let pipeline = sharp(fileBuffer, { failOn: 'error' });
  if (format === 'jpeg') {
    pipeline = pipeline.jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    });
  } else if (format === 'webp') {
    pipeline = pipeline.webp({
      quality,
      alphaQuality: 100,
      smartSubsample: true,
      effort: 5,
    });
  } else {
    pipeline = pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: false,
    });
  }
  return preserveMetadata(pipeline, density).toBuffer();
};

const buildCandidateSpecs = (metadata) => {
  const specs = [];
  if (metadata.format === 'png') {
    specs.push({ format: 'png' });
    const outputFormat = metadata.hasAlpha ? 'webp' : 'jpeg';
    CONSERVATIVE_QUALITY_STEPS.forEach((quality) => specs.push({ format: outputFormat, quality }));
    return specs;
  }
  if (metadata.format === 'jpeg' || metadata.format === 'webp') {
    CONSERVATIVE_QUALITY_STEPS.forEach((quality) => specs.push({
      format: metadata.format,
      quality,
    }));
  }
  return specs;
};

const buildResult = ({
  fileBuffer,
  fileName,
  format,
  sourceBytes,
  metadata,
  compressed,
}) => {
  const output = FORMAT_OUTPUT[format] || {
    mimeType: 'application/octet-stream',
    extension: 'bin',
  };
  return {
    fileBuffer,
    fileName: replaceFileExtension(fileName, output.extension),
    mimeType: output.mimeType,
    sourceBytes,
    outputBytes: fileBuffer.length,
    compressed,
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
    density: Number(metadata.density || 0),
  };
};

export const optimizeVirtualModelImage = async ({
  fileBuffer,
  mimeType = '',
  fileName = 'virtual-model-image',
  targetBytes = getVirtualModelImageTargetBytes(),
}) => {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw Object.assign(new Error('虚拟模特图片内容不能为空'), {
      code: 'virtual_model_image_empty',
    });
  }

  const sourceBytes = fileBuffer.length;
  let metadata;
  try {
    metadata = await sharp(fileBuffer, { failOn: 'error' }).metadata();
  } catch {
    throw Object.assign(new Error('虚拟模特图片格式无效或无法解码'), {
      code: 'virtual_model_image_invalid',
      statusCode: 400,
    });
  }
  const sourceFormat = String(metadata.format || '').toLowerCase();
  const sourceOutput = FORMAT_OUTPUT[sourceFormat];
  if (
    !sourceOutput
    || !Number.isInteger(metadata.width)
    || metadata.width <= 0
    || !Number.isInteger(metadata.height)
    || metadata.height <= 0
    || Number(metadata.pages || 1) > 1
  ) {
    return {
      fileBuffer,
      fileName,
      mimeType: String(mimeType || 'application/octet-stream').trim().toLowerCase(),
      sourceBytes,
      outputBytes: sourceBytes,
      compressed: false,
      width: Number(metadata.width || 0),
      height: Number(metadata.height || 0),
      density: Number(metadata.density || 0),
    };
  }

  if (sourceBytes <= targetBytes) {
    return buildResult({
      fileBuffer,
      fileName,
      format: sourceFormat,
      sourceBytes,
      metadata,
      compressed: false,
    });
  }

  let best = null;
  for (const spec of buildCandidateSpecs(metadata)) {
    let candidateBuffer;
    try {
      candidateBuffer = await encodeCandidate({
        fileBuffer,
        format: spec.format,
        quality: spec.quality,
        density: metadata.density,
      });
    } catch {
      throw Object.assign(new Error('虚拟模特图片格式无效或无法解码'), {
        code: 'virtual_model_image_invalid',
        statusCode: 400,
      });
    }
    const candidateMetadata = await sharp(candidateBuffer, { failOn: 'error' }).metadata();
    const preservesGeometry = (
      candidateMetadata.width === metadata.width
      && candidateMetadata.height === metadata.height
    );
    const preservesDensity = (
      !Number.isFinite(metadata.density)
      || metadata.density <= 0
      || candidateMetadata.density === metadata.density
    );
    const preservesAlpha = !metadata.hasAlpha || candidateMetadata.hasAlpha === true;
    if (
      !preservesGeometry
      || !preservesDensity
      || !preservesAlpha
      || candidateBuffer.length >= sourceBytes
    ) {
      continue;
    }
    const candidate = {
      fileBuffer: candidateBuffer,
      fileName,
      format: spec.format,
      sourceBytes,
      metadata: candidateMetadata,
      compressed: true,
    };
    if (!best || candidateBuffer.length < best.fileBuffer.length) {
      best = candidate;
    }
    if (candidateBuffer.length <= targetBytes) {
      return buildResult(candidate);
    }
  }

  return best
    ? buildResult(best)
    : buildResult({
      fileBuffer,
      fileName,
      format: sourceFormat,
      sourceBytes,
      metadata,
      compressed: false,
    });
};
