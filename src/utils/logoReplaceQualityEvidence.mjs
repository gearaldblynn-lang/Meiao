import { loadBrowserImage } from './browserImageLoader.mjs';

const EVIDENCE_WIDTH = 1536;
const EVIDENCE_HEIGHT = 640;
const PANEL_WIDTH = 440;
const PANEL_HEIGHT = 440;
const PANEL_TOP = 112;
const PANEL_GAP = 36;
const PANEL_LEFT = 36;

const imageDimensions = (image) => ({
  width: Math.max(1, Number(image?.naturalWidth || image?.width || 1)),
  height: Math.max(1, Number(image?.naturalHeight || image?.height || 1)),
});

const normalizeRect = (value, index) => {
  const regionId = String(value?.regionId || '').trim();
  const regionIndex = Number(value?.regionIndex);
  const xRatio = Number(value?.xRatio);
  const yRatio = Number(value?.yRatio);
  const widthRatio = Number(value?.widthRatio);
  const heightRatio = Number(value?.heightRatio);
  if (
    !regionId
    || !Number.isInteger(regionIndex)
    || regionIndex !== index + 1
    || !Number.isFinite(xRatio)
    || !Number.isFinite(yRatio)
    || !Number.isFinite(widthRatio)
    || !Number.isFinite(heightRatio)
    || xRatio < 0
    || yRatio < 0
    || widthRatio <= 0
    || heightRatio <= 0
    || xRatio + widthRatio > 1.000001
    || yRatio + heightRatio > 1.000001
  ) {
    throw new Error(`R${index + 1} 的 Logo 质检区域无效。`);
  }
  return { regionId, regionIndex, xRatio, yRatio, widthRatio, heightRatio };
};

const computePaddedCrop = (rect, dimensions) => {
  const target = {
    x: rect.xRatio * dimensions.width,
    y: rect.yRatio * dimensions.height,
    width: rect.widthRatio * dimensions.width,
    height: rect.heightRatio * dimensions.height,
  };
  const paddingX = Math.max(target.width * 0.75, dimensions.width * 0.01);
  const paddingY = Math.max(target.height * 0.75, dimensions.height * 0.01);
  const x = Math.max(0, target.x - paddingX);
  const y = Math.max(0, target.y - paddingY);
  const maxX = Math.min(dimensions.width, target.x + target.width + paddingX);
  const maxY = Math.min(dimensions.height, target.y + target.height + paddingY);
  return {
    crop: {
      x,
      y,
      width: Math.max(1, maxX - x),
      height: Math.max(1, maxY - y),
    },
    target,
  };
};

const drawContainedImage = (ctx, image, panelX) => {
  const dimensions = imageDimensions(image);
  const scale = Math.min(PANEL_WIDTH / dimensions.width, PANEL_HEIGHT / dimensions.height);
  const width = Math.max(1, dimensions.width * scale);
  const height = Math.max(1, dimensions.height * scale);
  const x = panelX + ((PANEL_WIDTH - width) / 2);
  const y = PANEL_TOP + ((PANEL_HEIGHT - height) / 2);
  ctx.drawImage(image, x, y, width, height);
};

const drawRegionCrop = (ctx, image, rect, panelX, strokeStyle) => {
  const dimensions = imageDimensions(image);
  const { crop, target } = computePaddedCrop(rect, dimensions);
  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    panelX,
    PANEL_TOP,
    PANEL_WIDTH,
    PANEL_HEIGHT,
  );
  const scaleX = PANEL_WIDTH / crop.width;
  const scaleY = PANEL_HEIGHT / crop.height;
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 6;
  ctx.strokeRect(
    panelX + ((target.x - crop.x) * scaleX),
    PANEL_TOP + ((target.y - crop.y) * scaleY),
    target.width * scaleX,
    target.height * scaleY,
  );
  ctx.restore();
  return { crop, target };
};

const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Logo 质检证据图导出失败。'));
  }, 'image/png', 0.95);
});

/**
 * @param {{
 *   sourceUrl?: string,
 *   resultUrl?: string,
 *   identityReferenceUrls?: string[],
 *   regionRects?: Array<{
 *     regionId?: string,
 *     regionIndex?: number,
 *     xRatio?: number,
 *     yRatio?: number,
 *     widthRatio?: number,
 *     heightRatio?: number,
 *   }>,
 *   signal?: AbortSignal,
 * }} [input]
 */
export const createLogoReplaceQualityEvidenceBlobs = async ({
  sourceUrl,
  resultUrl,
  identityReferenceUrls = [],
  regionRects = [],
  signal,
} = {}) => {
  const normalizedRects = (Array.isArray(regionRects) ? regionRects : [])
    .map(normalizeRect);
  if (
    !String(sourceUrl || '').trim()
    || !String(resultUrl || '').trim()
    || normalizedRects.length === 0
    || !Array.isArray(identityReferenceUrls)
    || identityReferenceUrls.length !== normalizedRects.length
  ) {
    throw new Error('Logo 质检证据图输入不完整。');
  }

  const [sourceImage, resultImage, ...identityImages] = await Promise.all([
    loadBrowserImage(sourceUrl, 'Logo quality source', signal),
    loadBrowserImage(resultUrl, 'Logo quality result', signal),
    ...identityReferenceUrls.map((url, index) => (
      loadBrowserImage(url, `Logo quality identity R${index + 1}`, signal)
    )),
  ]);
  try {
    const sourceDimensions = imageDimensions(sourceImage);
    const resultDimensions = imageDimensions(resultImage);
    if (
      Math.abs((sourceDimensions.width / sourceDimensions.height) - (resultDimensions.width / resultDimensions.height)) > 0.02
    ) {
      throw new Error('Logo 质检原图与结果图比例不一致。');
    }

    const outputs = [];
    for (let index = 0; index < normalizedRects.length; index += 1) {
      if (signal?.aborted) throw new Error('INTERRUPTED');
      const rect = normalizedRects[index];
      const canvas = document.createElement('canvas');
      canvas.width = EVIDENCE_WIDTH;
      canvas.height = EVIDENCE_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Logo 质检证据图生成失败。');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, EVIDENCE_WIDTH, EVIDENCE_HEIGHT);
      ctx.fillStyle = '#111827';
      ctx.font = '700 32px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`R${rect.regionIndex} LOGO STRUCTURE EVIDENCE`, PANEL_LEFT, 28);

      const identityX = PANEL_LEFT;
      const beforeX = PANEL_LEFT + PANEL_WIDTH + PANEL_GAP;
      const afterX = PANEL_LEFT + ((PANEL_WIDTH + PANEL_GAP) * 2);
      for (const panelX of [identityX, beforeX, afterX]) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(panelX, PANEL_TOP, PANEL_WIDTH, PANEL_HEIGHT);
      }
      drawContainedImage(ctx, identityImages[index], identityX);
      const beforeEvidence = drawRegionCrop(ctx, sourceImage, rect, beforeX, '#f59e0b');
      const afterEvidence = drawRegionCrop(ctx, resultImage, rect, afterX, '#ef4444');

      ctx.fillStyle = '#111827';
      ctx.font = '700 24px sans-serif';
      ctx.fillText('IDENTITY REFERENCE', identityX, 78);
      ctx.fillText('BEFORE TARGET', beforeX, 78);
      ctx.fillText('AFTER TARGET', afterX, 78);
      ctx.font = '500 18px sans-serif';
      ctx.fillStyle = '#475569';
      ctx.fillText(
        `target x=${rect.xRatio.toFixed(4)} y=${rect.yRatio.toFixed(4)} w=${rect.widthRatio.toFixed(4)} h=${rect.heightRatio.toFixed(4)}`,
        PANEL_LEFT,
        580,
      );

      outputs.push({
        regionId: rect.regionId,
        regionIndex: rect.regionIndex,
        blob: await canvasToBlob(canvas),
        width: EVIDENCE_WIDTH,
        height: EVIDENCE_HEIGHT,
        beforeCrop: beforeEvidence.crop,
        afterCrop: afterEvidence.crop,
      });
    }
    return outputs;
  } finally {
    for (const image of [sourceImage, resultImage, ...identityImages]) {
      image?.close?.();
    }
  }
};
