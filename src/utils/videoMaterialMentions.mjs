export const VIDEO_MATERIAL_MENTION_PARAM = 'videoMaterialMentionBindings';

const MAX_BINDINGS = 32;
const MAX_FIELD_LENGTH = 160;
const MAX_ORDINAL = 999;
const KIND_LABEL = Object.freeze({
  image: '图片',
  video: '视频',
  audio: '音频',
});
const SOURCE_KIND = Object.freeze({
  product: 'image',
  scene: 'image',
  referenceVideo: 'video',
  audio: 'audio',
});
const SOURCE_ORDER = Object.freeze([
  ['product', 'image'],
  ['scene', 'image'],
  ['referenceVideo', 'video'],
  ['audio', 'audio'],
]);
const MENTION_TOKEN_PATTERN = /@(图片|视频|音频)([1-9]\d{0,2})(?!\d)/g;

const safeString = (value) => String(value || '').trim().slice(0, MAX_FIELD_LENGTH);

const parseMentionLabel = (label) => {
  const match = /^@(图片|视频|音频)([1-9]\d{0,2})$/.exec(safeString(label));
  if (!match) return null;
  const ordinal = Number.parseInt(match[2], 10);
  if (!Number.isFinite(ordinal) || ordinal < 1 || ordinal > MAX_ORDINAL) return null;
  const kind = Object.entries(KIND_LABEL).find(([, value]) => value === match[1])?.[0];
  return kind ? { kind, ordinal } : null;
};

const normalizeBinding = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const label = safeString(value.label);
  const materialId = safeString(value.materialId);
  const kind = safeString(value.kind);
  const sourceType = safeString(value.sourceType);
  const parsedLabel = parseMentionLabel(label);
  if (!materialId || !parsedLabel || parsedLabel.kind !== kind || SOURCE_KIND[sourceType] !== kind) return null;
  return { label, materialId, kind, sourceType };
};

export const parseVideoMaterialMentionBindings = (raw) => {
  let values = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      values = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(values)) return [];

  const labels = new Set();
  const materials = new Set();
  const result = [];
  for (const value of values) {
    const binding = normalizeBinding(value);
    if (!binding) continue;
    const materialKey = binding.kind + ':' + binding.materialId;
    if (labels.has(binding.label) || materials.has(materialKey)) continue;
    labels.add(binding.label);
    materials.add(materialKey);
    result.push(binding);
    if (result.length >= MAX_BINDINGS) break;
  }
  return result;
};

const nextAvailableOrdinal = (kind, usedOrdinals, preferredOrdinal = 0) => {
  if (preferredOrdinal > 0 && preferredOrdinal <= MAX_ORDINAL && !usedOrdinals.has(preferredOrdinal)) {
    usedOrdinals.add(preferredOrdinal);
    return preferredOrdinal;
  }
  for (let ordinal = 1; ordinal <= MAX_ORDINAL; ordinal += 1) {
    if (usedOrdinals.has(ordinal)) continue;
    usedOrdinals.add(ordinal);
    return ordinal;
  }
  throw new Error((KIND_LABEL[kind] || '素材') + '引用数量过多，请删除不再使用的引用后重试。');
};

export const buildVideoMaterialMentionCandidates = (materials = {}, rawBindings = []) => {
  const bindings = parseVideoMaterialMentionBindings(rawBindings);
  const bindingByMaterial = new Map(bindings.map((binding) => [binding.kind + ':' + binding.materialId, binding]));
  const usedOrdinals = {
    image: new Set(),
    video: new Set(),
    audio: new Set(),
  };
  for (const binding of bindings) {
    const parsed = parseMentionLabel(binding.label);
    if (parsed) usedOrdinals[parsed.kind].add(parsed.ordinal);
  }

  const providerCounts = { image: 0, video: 0, audio: 0 };
  const result = [];
  for (const [sourceType, kind] of SOURCE_ORDER) {
    for (const material of Array.isArray(materials[sourceType]) ? materials[sourceType] : []) {
      const materialId = safeString(material?.id);
      if (!materialId) continue;
      providerCounts[kind] += 1;
      const existing = bindingByMaterial.get(kind + ':' + materialId);
      const ordinal = existing
        ? parseMentionLabel(existing.label).ordinal
        : nextAvailableOrdinal(kind, usedOrdinals[kind], providerCounts[kind]);
      result.push({
        label: existing?.label || '@' + KIND_LABEL[kind] + ordinal,
        materialId,
        kind,
        sourceType,
        fileName: safeString(material?.fileName) || KIND_LABEL[kind] + '素材',
        url: String(material?.url || material?.remoteUrl || '').trim(),
      });
    }
  }
  return result;
};

export const upsertVideoMaterialMentionBinding = (rawBindings, candidate) => {
  const bindings = parseVideoMaterialMentionBindings(rawBindings);
  const normalizedCandidate = normalizeBinding(candidate);
  if (!normalizedCandidate) return bindings;
  const materialKey = normalizedCandidate.kind + ':' + normalizedCandidate.materialId;
  const existing = bindings.find((binding) => binding.kind + ':' + binding.materialId === materialKey);
  if (existing) return bindings;
  if (bindings.length >= MAX_BINDINGS) {
    throw new Error('素材引用数量已达上限，请删除不再使用的引用后重试。');
  }

  const usedOrdinals = new Set(
    bindings
      .filter((binding) => binding.kind === normalizedCandidate.kind)
      .map((binding) => parseMentionLabel(binding.label)?.ordinal)
      .filter(Boolean),
  );
  const preferredOrdinal = parseMentionLabel(normalizedCandidate.label)?.ordinal || 0;
  const ordinal = nextAvailableOrdinal(normalizedCandidate.kind, usedOrdinals, preferredOrdinal);
  return [
    ...bindings,
    {
      ...normalizedCandidate,
      label: '@' + KIND_LABEL[normalizedCandidate.kind] + ordinal,
    },
  ];
};

export const findVideoMaterialMentionQuery = (prompt, caret) => {
  const text = String(prompt || '');
  const end = Math.max(0, Math.min(Number.isFinite(Number(caret)) ? Number(caret) : text.length, text.length));
  const beforeCaret = text.slice(0, end);
  const start = beforeCaret.lastIndexOf('@');
  if (start < 0) return null;
  const token = beforeCaret.slice(start);
  if (!/^@[^\s@，。！？；：,.!?;:()[\]{}]*$/.test(token)) return null;
  return { start, end, query: token.slice(1) };
};

export const insertVideoMaterialMention = ({ prompt, start, end, label }) => {
  const text = String(prompt || '');
  const safeStart = Math.max(0, Math.min(Number(start) || 0, text.length));
  const safeEnd = Math.max(safeStart, Math.min(Number(end) || safeStart, text.length));
  const normalizedLabel = safeString(label);
  if (!parseMentionLabel(normalizedLabel)) {
    return { prompt: text, caret: safeEnd };
  }
  const after = text.slice(safeEnd);
  const suffix = after.length === 0 || /^\s/.test(after) ? '' : ' ';
  const nextPrompt = text.slice(0, safeStart) + normalizedLabel + suffix + after;
  return {
    prompt: nextPrompt,
    caret: safeStart + normalizedLabel.length + suffix.length,
  };
};

const collectCurrentMaterialIds = (materials = {}) => {
  const result = new Set();
  for (const [sourceType, kind] of SOURCE_ORDER) {
    for (const material of Array.isArray(materials[sourceType]) ? materials[sourceType] : []) {
      const materialId = safeString(material?.id);
      if (materialId) result.add(kind + ':' + materialId);
    }
  }
  return result;
};

const normalizeReference = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const materialId = safeString(value.materialId);
  const kind = safeString(value.kind);
  const sourceType = safeString(value.sourceType);
  const providerOrdinal = Number.parseInt(String(value.providerOrdinal || ''), 10);
  if (
    !materialId
    || SOURCE_KIND[sourceType] !== kind
    || !Number.isFinite(providerOrdinal)
    || providerOrdinal < 1
    || providerOrdinal > MAX_ORDINAL
  ) {
    return null;
  }
  return { materialId, kind, sourceType, providerOrdinal };
};

export const compileVideoMaterialMentions = ({
  prompt,
  materials = {},
  references = [],
  bindings: rawBindings = [],
}) => {
  const sourcePrompt = String(prompt || '');
  const bindings = parseVideoMaterialMentionBindings(rawBindings);
  if (bindings.length === 0 || !sourcePrompt.includes('@')) {
    return { compiledPrompt: sourcePrompt, manifest: [] };
  }

  const currentMaterialIds = collectCurrentMaterialIds(materials);
  const referenceByMaterial = new Map();
  for (const value of Array.isArray(references) ? references : []) {
    const reference = normalizeReference(value);
    if (!reference) continue;
    referenceByMaterial.set(reference.kind + ':' + reference.materialId, reference);
  }

  const replacementByLabel = new Map();
  const manifest = [];
  const usedLabels = new Set(sourcePrompt.match(MENTION_TOKEN_PATTERN) || []);
  MENTION_TOKEN_PATTERN.lastIndex = 0;

  for (const binding of bindings) {
    if (!usedLabels.has(binding.label)) continue;
    const materialKey = binding.kind + ':' + binding.materialId;
    const reference = referenceByMaterial.get(materialKey);
    if (!reference) {
      if (currentMaterialIds.has(materialKey)) {
        throw new Error(binding.label + ' 对应素材尚未准备完成，请等待上传完成或重新上传后重试。');
      }
      throw new Error(binding.label + ' 对应素材已移除，请删除该引用或重新选择素材。');
    }
    const providerLabel = '@' + KIND_LABEL[reference.kind] + reference.providerOrdinal;
    replacementByLabel.set(binding.label, providerLabel);
    manifest.push({
      ...binding,
      sourceType: reference.sourceType,
      providerOrdinal: reference.providerOrdinal,
      providerLabel,
    });
  }

  const compiledPrompt = sourcePrompt.replace(MENTION_TOKEN_PATTERN, (token) => replacementByLabel.get(token) || token);
  MENTION_TOKEN_PATTERN.lastIndex = 0;
  return { compiledPrompt, manifest };
};
