type SubmissionMaterial = {
  id?: unknown;
  localAssetId?: unknown;
  fileName?: unknown;
  type?: unknown;
};

type GenerationSubmissionInput = {
  module?: unknown;
  subFeature?: unknown;
  prompt?: unknown;
  params?: Record<string, unknown>;
  materials?: Record<string, SubmissionMaterial[]>;
};

const stableObject = (value: Record<string, unknown> = {}) => Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
);

const hashText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const buildGenerationSubmissionKey = ({
  module = '',
  subFeature = '',
  prompt = '',
  params = {},
  materials = {},
}: GenerationSubmissionInput = {}) => {
  const normalizedMaterials = Object.fromEntries(
    Object.entries(materials)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, items]) => [type, (Array.isArray(items) ? items : []).map((item) => ({
        id: String(item?.localAssetId || item?.id || '').trim(),
        fileName: String(item?.fileName || '').trim(),
        type: String(item?.type || type || '').trim(),
      }))]),
  );
  const semanticPayload = JSON.stringify({
    materials: normalizedMaterials,
    module: String(module || '').trim(),
    params: stableObject(params),
    prompt: String(prompt || '').trim(),
    subFeature: String(subFeature || '').trim(),
  });
  return `${String(module || 'unknown')}:${String(subFeature || 'default')}:${hashText(semanticPayload)}`;
};
