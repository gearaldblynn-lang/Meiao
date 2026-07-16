import type { GeneratedResult } from '../../ShellMigratedApp';

const RETOUCH_COMPARISON_LABELS = {
  original: '原图精修',
  white_bg: '白底精修',
  product_restore: '产品还原',
} as const;

type RetouchComparisonSubFeature = keyof typeof RETOUCH_COMPARISON_LABELS;

export interface RetouchComparisonItem {
  id: string;
  originalUrl?: string;
  resultUrl: string;
  title: string;
  subFeatureLabel: string;
  originalWidth?: number;
  originalHeight?: number;
}

interface BuildRetouchComparisonItemsInput {
  module?: string;
  subFeature?: string;
  projectName?: string;
  results: Array<Partial<GeneratedResult> & { id: string }>;
}

interface ImageDimensions {
  width: number;
  height: number;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export const isRetouchComparisonScope = (module?: string, subFeature?: string) => (
  module === 'retouch'
  && Object.hasOwn(RETOUCH_COMPARISON_LABELS, String(subFeature || ''))
);

export const buildRetouchComparisonItems = ({
  module,
  subFeature,
  projectName,
  results,
}: BuildRetouchComparisonItemsInput): RetouchComparisonItem[] => {
  if (!isRetouchComparisonScope(module, subFeature)) return [];

  const subFeatureLabel = RETOUCH_COMPARISON_LABELS[
    subFeature as RetouchComparisonSubFeature
  ];

  return results
    .filter((result) => result.status === 'completed' && Boolean(result.imageUrl))
    .map((result, index) => ({
      id: result.id,
      originalUrl: String(result.sourcePreviewUrl || result.sourceUrl || '').trim() || undefined,
      resultUrl: String(result.imageUrl || ''),
      title: String(result.fileName || '').trim() || `${projectName || subFeatureLabel} #${index + 1}`,
      subFeatureLabel,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
    }));
};

export const getComparisonDividerPercent = (
  clientX: number,
  rect: { left: number; width: number },
) => (
  rect.width > 0
    ? clampPercent(((clientX - rect.left) / rect.width) * 100)
    : 50
);

export const getLoopedComparisonIndex = (
  index: number,
  delta: number,
  length: number,
) => {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
};

export const adjustComparisonDividerPercent = (
  value: number,
  key: string,
  step = 2,
) => {
  if (key === 'ArrowLeft') return clampPercent(value - step);
  if (key === 'ArrowRight') return clampPercent(value + step);
  return value;
};

export const hasDifferentImageAspectRatio = (
  original?: ImageDimensions,
  result?: ImageDimensions,
) => {
  if (!original?.width || !original.height || !result?.width || !result.height) return false;
  return Math.abs(original.width / original.height - result.width / result.height) > 0.01;
};
