export const normalizeExactAspectRatio = (value: unknown, fallback = ''): string => {
  const match = String(value || '').replace(/\s+/g, '').trim().match(/^([1-9]\d{0,5}):([1-9]\d{0,5})$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
};

export const getExactAspectRatioFromDimensions = (width?: number, height?: number, fallback = ''): string => {
  const safeWidth = Math.round(Number(width || 0));
  const safeHeight = Math.round(Number(height || 0));
  if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth <= 0 || safeHeight <= 0) {
    return fallback;
  }
  return normalizeExactAspectRatio(`${safeWidth}:${safeHeight}`, fallback);
};

export const resolveNearestSupportedAspectRatio = (
  value: unknown,
  supportedRatios: unknown[] = [],
  fallback = '',
): string => {
  const normalized = normalizeExactAspectRatio(value);
  if (!normalized) return fallback;
  const supported = supportedRatios
    .map((ratio) => normalizeExactAspectRatio(ratio))
    .filter(Boolean);
  if (supported.includes(normalized)) return normalized;

  const target = toRatioValue(normalized);
  if (!Number.isFinite(target) || target <= 0 || supported.length === 0) return fallback;

  return supported
    .map((ratio) => ({ ratio, distance: Math.abs(Math.log(toRatioValue(ratio) / target)) }))
    .filter((item) => Number.isFinite(item.distance))
    .sort((a, b) => a.distance - b.distance)[0]?.ratio || fallback;
};

const toRatioValue = (ratio: string) => {
  const [width, height] = ratio.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : Number.NaN;
};

const gcd = (a: number, b: number): number => {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
};
