export const MIN_SUBTITLE_REGION_SIZE = 0.02;

export const DEFAULT_SUBTITLE_REGION = Object.freeze({
  x: 0,
  y: 0.7,
  width: 1,
  height: 0.3,
});

const RESIZE_HANDLES = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizedNumber = (value) => Number(value.toFixed(6));

const createRegionError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

export function clampSubtitleRegion(region = DEFAULT_SUBTITLE_REGION) {
  const width = clamp(
    finiteNumber(region?.width, MIN_SUBTITLE_REGION_SIZE),
    MIN_SUBTITLE_REGION_SIZE,
    1,
  );
  const height = clamp(
    finiteNumber(region?.height, MIN_SUBTITLE_REGION_SIZE),
    MIN_SUBTITLE_REGION_SIZE,
    1,
  );
  const x = clamp(finiteNumber(region?.x, 0), 0, 1 - width);
  const y = clamp(finiteNumber(region?.y, 0), 0, 1 - height);
  return {
    x: normalizedNumber(x),
    y: normalizedNumber(y),
    width: normalizedNumber(width),
    height: normalizedNumber(height),
  };
}

export function moveSubtitleRegion(region, delta = {}) {
  const current = clampSubtitleRegion(region);
  return clampSubtitleRegion({
    ...current,
    x: current.x + finiteNumber(delta?.x, 0),
    y: current.y + finiteNumber(delta?.y, 0),
  });
}

export function resizeSubtitleRegion(region, handle, delta = {}) {
  if (!RESIZE_HANDLES.has(String(handle || ''))) {
    throw createRegionError('subtitle_region_invalid_handle', '字幕区域缩放方向无效');
  }
  const current = clampSubtitleRegion(region);
  const dx = finiteNumber(delta?.x, 0);
  const dy = finiteNumber(delta?.y, 0);
  let left = current.x;
  let top = current.y;
  let right = current.x + current.width;
  let bottom = current.y + current.height;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SUBTITLE_REGION_SIZE);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_SUBTITLE_REGION_SIZE, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SUBTITLE_REGION_SIZE);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SUBTITLE_REGION_SIZE, 1);

  return clampSubtitleRegion({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function subtitleRegionToPixels(region, width, height) {
  const frameWidth = Math.round(finiteNumber(width, 0));
  const frameHeight = Math.round(finiteNumber(height, 0));
  if (frameWidth <= 0 || frameHeight <= 0) {
    throw createRegionError('subtitle_region_invalid_dimensions', '视频分辨率无效');
  }
  const normalized = clampSubtitleRegion(region);
  const x1 = clamp(Math.round(normalized.x * frameWidth), 0, frameWidth - 1);
  const y1 = clamp(Math.round(normalized.y * frameHeight), 0, frameHeight - 1);
  const x2 = clamp(Math.round((normalized.x + normalized.width) * frameWidth), x1 + 1, frameWidth);
  const y2 = clamp(Math.round((normalized.y + normalized.height) * frameHeight), y1 + 1, frameHeight);
  return { x1, y1, x2, y2 };
}
