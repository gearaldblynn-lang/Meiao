const isTransparentContent = (alpha, alphaThreshold) => alpha > alphaThreshold;

const isNonWhiteContent = (r, g, b, a, tolerance) => {
  if (a <= 8) return false;
  return r < 255 - tolerance || g < 255 - tolerance || b < 255 - tolerance;
};

const luminance = (r, g, b) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const updateBounds = (bounds, x, y) => ({
  minX: Math.min(bounds.minX, x),
  minY: Math.min(bounds.minY, y),
  maxX: Math.max(bounds.maxX, x),
  maxY: Math.max(bounds.maxY, y),
});

const emptyBounds = () => ({
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: -1,
  maxY: -1,
});

const boundsToRect = (bounds, width, height) => {
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    return { x: 0, y: 0, width, height };
  }
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX + 1,
    height: bounds.maxY - bounds.minY + 1,
  };
};

export const expandLogoCropRectWithPadding = ({
  rect,
  width,
  height,
  paddingRatio = 0.06,
} = {}) => {
  const sourceWidth = Math.max(1, Math.round(Number(width) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(height) || 1));
  const safeRect = {
    x: Math.max(0, Math.round(Number(rect?.x) || 0)),
    y: Math.max(0, Math.round(Number(rect?.y) || 0)),
    width: Math.max(1, Math.round(Number(rect?.width) || sourceWidth)),
    height: Math.max(1, Math.round(Number(rect?.height) || sourceHeight)),
  };
  const padding = Math.max(0, Math.round(Math.max(safeRect.width, safeRect.height) * paddingRatio));
  const x = Math.max(0, safeRect.x - padding);
  const y = Math.max(0, safeRect.y - padding);
  const right = Math.min(sourceWidth, safeRect.x + safeRect.width + padding);
  const bottom = Math.min(sourceHeight, safeRect.y + safeRect.height + padding);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
};

export const findNonTransparentBounds = (imageData, alphaThreshold = 8) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return { x: 0, y: 0, width: width || 0, height: height || 0 };
  let bounds = emptyBounds();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (isTransparentContent(data[offset + 3], alphaThreshold)) {
        bounds = updateBounds(bounds, x, y);
      }
    }
  }
  return boundsToRect(bounds, width, height);
};

export const findOpaqueWhiteTrimBounds = (imageData, tolerance = 10) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return { x: 0, y: 0, width: width || 0, height: height || 0 };
  let bounds = emptyBounds();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (isNonWhiteContent(data[offset], data[offset + 1], data[offset + 2], data[offset + 3], tolerance)) {
        bounds = updateBounds(bounds, x, y);
      }
    }
  }
  return boundsToRect(bounds, width, height);
};

const sampleEdgeLuminance = ({ data, width, height }) => {
  const samples = [];
  for (let x = 0; x < width; x += 1) {
    samples.push((0 * width + x) * 4);
    samples.push(((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y += 1) {
    samples.push((y * width + 0) * 4);
    samples.push((y * width + (width - 1)) * 4);
  }
  const values = samples
    .filter((offset) => data[offset + 3] > 220)
    .map((offset) => luminance(data[offset], data[offset + 1], data[offset + 2]));
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.abs(value - average), 0) / values.length;
  return { average, variance, count: values.length };
};

const sampleEdgeColor = ({ data, width, height }) => {
  const offsets = [];
  for (let x = 0; x < width; x += 1) {
    offsets.push((0 * width + x) * 4);
    offsets.push(((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y += 1) {
    offsets.push((y * width + 0) * 4);
    offsets.push((y * width + (width - 1)) * 4);
  }
  const samples = offsets.filter((offset) => data[offset + 3] > 220);
  if (!samples.length) return null;
  const color = samples.reduce((sum, offset) => {
    sum.r += data[offset];
    sum.g += data[offset + 1];
    sum.b += data[offset + 2];
    return sum;
  }, { r: 0, g: 0, b: 0 });
  const average = {
    r: color.r / samples.length,
    g: color.g / samples.length,
    b: color.b / samples.length,
  };
  const variance = samples.reduce((sum, offset) => {
    const channelDiff = Math.max(
      Math.abs(data[offset] - average.r),
      Math.abs(data[offset + 1] - average.g),
      Math.abs(data[offset + 2] - average.b),
    );
    return sum + channelDiff;
  }, 0) / samples.length;
  return { ...average, variance, count: samples.length };
};

const colorDistance = (r, g, b, color) => Math.max(
  Math.abs(r - color.r),
  Math.abs(g - color.g),
  Math.abs(b - color.b),
);

const createImageDataLike = (data, width, height) => {
  if (typeof ImageData === 'function') return new ImageData(data, width, height);
  return { data, width, height };
};

const isBackgroundLikePixel = (output, offset, edge, backgroundLum, backgroundTolerance, minContentContrast) => {
  if (output[offset + 3] <= 8) return false;
  const diff = colorDistance(output[offset], output[offset + 1], output[offset + 2], edge);
  const lumDiff = Math.abs(luminance(output[offset], output[offset + 1], output[offset + 2]) - backgroundLum);
  return diff <= backgroundTolerance && lumDiff < minContentContrast;
};

const transparentizeConnectedEdgeBackground = ({
  output,
  width,
  height,
  edge,
  backgroundLum,
  backgroundTolerance,
  minContentContrast,
}) => {
  const visited = new Uint8Array(width * height);
  const queue = [];
  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    const offset = index * 4;
    if (!isBackgroundLikePixel(output, offset, edge, backgroundLum, backgroundTolerance, minContentContrast)) return;
    visited[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  let transparentized = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    output[index * 4 + 3] = 0;
    transparentized += 1;
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
  return transparentized;
};

const sampleRectEdgeColor = ({ data, width, height, rect }) => {
  const offsets = [];
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(width - 1, Math.round(rect.x + rect.width - 1));
  const y1 = Math.min(height - 1, Math.round(rect.y + rect.height - 1));
  for (let x = x0; x <= x1; x += 1) {
    offsets.push((y0 * width + x) * 4);
    offsets.push((y1 * width + x) * 4);
  }
  for (let y = y0 + 1; y < y1; y += 1) {
    offsets.push((y * width + x0) * 4);
    offsets.push((y * width + x1) * 4);
  }
  const samples = offsets.filter((offset) => data[offset + 3] > 220);
  if (!samples.length) return null;
  const color = samples.reduce((sum, offset) => {
    sum.r += data[offset];
    sum.g += data[offset + 1];
    sum.b += data[offset + 2];
    return sum;
  }, { r: 0, g: 0, b: 0 });
  const average = {
    r: color.r / samples.length,
    g: color.g / samples.length,
    b: color.b / samples.length,
  };
  const variance = samples.reduce((sum, offset) => {
    const channelDiff = Math.max(
      Math.abs(data[offset] - average.r),
      Math.abs(data[offset + 1] - average.g),
      Math.abs(data[offset + 2] - average.b),
    );
    return sum + channelDiff;
  }, 0) / samples.length;
  return { ...average, variance, count: samples.length };
};

export const transparentizeFlatLogoBackground = (imageData, {
  maxEdgeVariance = 16,
  backgroundTolerance = 28,
  minContentContrast = 36,
  maxTransparentRatio = 0.92,
} = {}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return { imageData, changed: false };
  const edge = sampleEdgeColor({ data, width, height });
  if (!edge) return { imageData, changed: false };
  const edgeLum = luminance(edge.r, edge.g, edge.b);
  const darkNoisyBacking = edgeLum <= 80 && edge.variance <= 44;
  if (edge.variance > maxEdgeVariance && !darkNoisyBacking) return { imageData, changed: false };
  const effectiveBackgroundTolerance = darkNoisyBacking
    ? Math.max(backgroundTolerance, 58)
    : backgroundTolerance;
  const effectiveMinContentContrast = darkNoisyBacking
    ? Math.max(minContentContrast, 86)
    : minContentContrast;

  const output = new Uint8ClampedArray(data);
  let contentPixels = 0;
  let opaquePixels = 0;
  const backgroundLum = edgeLum;

  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] <= 8) continue;
    opaquePixels += 1;
    if (!isBackgroundLikePixel(output, offset, edge, backgroundLum, effectiveBackgroundTolerance, effectiveMinContentContrast)) {
      contentPixels += 1;
    }
  }

  const transparentized = transparentizeConnectedEdgeBackground({
    output,
    width,
    height,
    edge,
    backgroundLum,
    backgroundTolerance: effectiveBackgroundTolerance,
    minContentContrast: effectiveMinContentContrast,
  });

  if (!transparentized || !contentPixels || !opaquePixels) return { imageData, changed: false };
  if (transparentized / opaquePixels > maxTransparentRatio) {
    const contentRatio = contentPixels / opaquePixels;
    const sparseHighContrastLogo = contentRatio >= 0.01
      && contentRatio <= 0.2
      && maxEdgeVariance <= 16;
    if (!sparseHighContrastLogo) return { imageData, changed: false };
  }
  return {
    imageData: createImageDataLike(output, width, height),
    changed: true,
    background: {
      r: Math.round(edge.r),
      g: Math.round(edge.g),
      b: Math.round(edge.b),
    },
  };
};

export const transparentizeDarkLogoBacking = (imageData, {
  darkMax = 96,
  lightMin = 150,
  minDarkRatio = 0.2,
  minLightRatio = 0.005,
  maxLightRatio = 0.55,
  minBackingDensity = 0.45,
  minBackingToLogoAreaRatio = 1.8,
} = {}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return { imageData, changed: false };
  const darkBounds = emptyBounds();
  const lightBounds = emptyBounds();
  let opaquePixels = 0;
  let darkPixels = 0;
  let lightPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] <= 8) continue;
      opaquePixels += 1;
      const lum = luminance(data[offset], data[offset + 1], data[offset + 2]);
      if (lum <= darkMax) {
        darkPixels += 1;
        Object.assign(darkBounds, updateBounds(darkBounds, x, y));
      } else if (lum >= lightMin) {
        lightPixels += 1;
        Object.assign(lightBounds, updateBounds(lightBounds, x, y));
      }
    }
  }

  if (!opaquePixels || !darkPixels || !lightPixels) return { imageData, changed: false };
  const darkRatio = darkPixels / opaquePixels;
  const lightRatio = lightPixels / opaquePixels;
  if (darkRatio < minDarkRatio || lightRatio < minLightRatio || lightRatio > maxLightRatio) {
    return { imageData, changed: false };
  }

  const darkRect = boundsToRect(darkBounds, width, height);
  const lightRect = boundsToRect(lightBounds, width, height);
  const darkArea = Math.max(1, darkRect.width * darkRect.height);
  const lightArea = Math.max(1, lightRect.width * lightRect.height);
  if (darkArea / lightArea < minBackingToLogoAreaRatio || darkPixels / darkArea < minBackingDensity) {
    return { imageData, changed: false };
  }

  const output = new Uint8ClampedArray(data);
  let changedPixels = 0;
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] <= 8) continue;
    const lum = luminance(output[offset], output[offset + 1], output[offset + 2]);
    if (lum <= darkMax) {
      output[offset + 3] = 0;
      changedPixels += 1;
    }
  }

  if (!changedPixels) return { imageData, changed: false };
  return {
    imageData: createImageDataLike(output, width, height),
    changed: true,
  };
};

export const transparentizeOpaqueLogoBackingPlate = (imageData, {
  maxEdgeVariance = 18,
  backgroundTolerance = 30,
  minContentContrast = 42,
  minBackgroundRatio = 0.35,
  minContentRatio = 0.005,
  maxContentRatio = 0.55,
} = {}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return { imageData, changed: false };
  const rect = findNonTransparentBounds(imageData);
  if (!rect.width || !rect.height) return { imageData, changed: false };
  const edge = sampleRectEdgeColor({ data, width, height, rect });
  if (!edge || edge.variance > maxEdgeVariance) return { imageData, changed: false };
  const backgroundLum = luminance(edge.r, edge.g, edge.b);
  const output = new Uint8ClampedArray(data);
  let opaquePixels = 0;
  let backgroundPixels = 0;
  let contentPixels = 0;

  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * width + x) * 4;
      if (output[offset + 3] <= 8) continue;
      opaquePixels += 1;
      if (isBackgroundLikePixel(output, offset, edge, backgroundLum, backgroundTolerance, minContentContrast)) {
        backgroundPixels += 1;
      } else {
        contentPixels += 1;
      }
    }
  }

  if (!opaquePixels || !backgroundPixels || !contentPixels) return { imageData, changed: false };
  const backgroundRatio = backgroundPixels / opaquePixels;
  const contentRatio = contentPixels / opaquePixels;
  if (
    backgroundRatio < minBackgroundRatio
    || contentRatio < minContentRatio
    || contentRatio > maxContentRatio
  ) {
    return { imageData, changed: false };
  }

  let changedPixels = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * width + x) * 4;
      if (isBackgroundLikePixel(output, offset, edge, backgroundLum, backgroundTolerance, minContentContrast)) {
        output[offset + 3] = 0;
        changedPixels += 1;
      }
    }
  }

  if (!changedPixels) return { imageData, changed: false };
  return {
    imageData: createImageDataLike(output, width, height),
    changed: true,
  };
};

export const findDarkBackgroundLightContentBounds = (imageData, {
  darkBackgroundMax = 72,
  maxEdgeVariance = 18,
  minContrast = 64,
} = {}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return null;
  const edge = sampleEdgeLuminance({ data, width, height });
  if (!edge || edge.average > darkBackgroundMax || edge.variance > maxEdgeVariance) return null;

  let bounds = emptyBounds();
  let lightPixels = 0;
  let opaquePixels = 0;
  const threshold = edge.average + minContrast;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] <= 32) continue;
      opaquePixels += 1;
      if (luminance(data[offset], data[offset + 1], data[offset + 2]) >= threshold) {
        lightPixels += 1;
        bounds = updateBounds(bounds, x, y);
      }
    }
  }

  if (!lightPixels || !opaquePixels) return null;
  if (lightPixels / opaquePixels > 0.45) return null;
  return boundsToRect(bounds, width, height);
};

const shouldUseDownloadProxy = (url) => {
  try {
    if (typeof window === 'undefined' || !window.location?.href) return false;
    const parsed = new URL(String(url || ''), window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
};

const getSessionToken = () => {
  try {
    return window.localStorage?.getItem('MEIAO_INTERNAL_SESSION_TOKEN') || '';
  } catch {
    return '';
  }
};

const isSameOriginUrl = (url) => {
  try {
    if (typeof window === 'undefined' || !window.location?.href) return false;
    return new URL(String(url || ''), window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

const fetchImageBlobWithProxy = async (url, label) => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) throw new Error(`${label} URL is empty`);
  const fetchDirect = async (targetUrl) => {
    const token = getSessionToken();
    const response = await fetch(targetUrl, {
      cache: 'no-cache',
      credentials: isSameOriginUrl(targetUrl) ? 'include' : 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error(`${label} download failed: ${response.status}`);
    return response.blob();
  };
  try {
    return await fetchDirect(safeUrl);
  } catch (error) {
    if (!shouldUseDownloadProxy(safeUrl)) throw error;
    return fetchDirect(`/api/assets/download-proxy?url=${encodeURIComponent(safeUrl)}`);
  }
};

const decodeImageFromBlob = async (blob, label) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(`${label}解码失败`);
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL?.(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL?.(objectUrl);
      reject(new Error(`${label}加载失败`));
    };
    img.src = objectUrl;
  });
};

const isWholeImage = (rect, width, height) => rect.x === 0 && rect.y === 0 && rect.width === width && rect.height === height;

export const createWhitespaceCroppedLogoBlob = async (logoUrl) => {
  const image = await decodeImageFromBlob(await fetchImageBlobWithProxy(logoUrl, 'Logo图'), 'Logo图');
  const width = image.width || image.naturalWidth || 1;
  const height = image.height || image.naturalHeight || 1;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) throw new Error('Logo裁边失败');
  sourceCtx.drawImage(image, 0, 0, width, height);
  const imageData = sourceCtx.getImageData(0, 0, width, height);
  let rect = findNonTransparentBounds(imageData);
  if (isWholeImage(rect, width, height)) {
    rect = findOpaqueWhiteTrimBounds(imageData);
  }
  if (isWholeImage(rect, width, height)) {
    rect = findDarkBackgroundLightContentBounds(imageData) || rect;
  }
  const transparentized = transparentizeFlatLogoBackground(imageData);
  if (transparentized.changed) {
    if (typeof sourceCtx.putImageData === 'function') {
      sourceCtx.putImageData(transparentized.imageData, 0, 0);
    }
    rect = findNonTransparentBounds(transparentized.imageData);
  }
  const darkBackingTransparentized = transparentizeDarkLogoBacking(transparentized.changed ? transparentized.imageData : imageData);
  if (darkBackingTransparentized.changed) {
    if (typeof sourceCtx.putImageData === 'function') {
      sourceCtx.putImageData(darkBackingTransparentized.imageData, 0, 0);
    }
    rect = findNonTransparentBounds(darkBackingTransparentized.imageData);
  }
  const backingPlateTransparentized = transparentizeOpaqueLogoBackingPlate(
    darkBackingTransparentized.changed
      ? darkBackingTransparentized.imageData
      : transparentized.changed ? transparentized.imageData : imageData,
  );
  if (backingPlateTransparentized.changed) {
    if (typeof sourceCtx.putImageData === 'function') {
      sourceCtx.putImageData(backingPlateTransparentized.imageData, 0, 0);
    }
    rect = findNonTransparentBounds(backingPlateTransparentized.imageData);
  }
  rect = expandLogoCropRectWithPadding({ rect, width, height });
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = Math.max(1, rect.width);
  outputCanvas.height = Math.max(1, rect.height);
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error('Logo裁边导出失败');
  outputCtx.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/png', 0.95));
  if (!blob) throw new Error('Logo裁边导出失败');
  return { blob, rect, originalWidth: width, originalHeight: height };
};
