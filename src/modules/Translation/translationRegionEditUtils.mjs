export const MAX_TRANSLATION_EDIT_REGIONS = 5;
export const MIN_TRANSLATION_EDIT_REGION_RATIO = 0.02;
export const TRANSLATION_EDIT_EDGE_HIT_SLOP_PX = 12;
export const MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH = 1000;
export const MAX_TRANSLATION_EDIT_TOTAL_INSTRUCTION_LENGTH = 4000;
export const TRANSLATION_EDIT_REGION_COLORS = ['#2563eb', '#d97706', '#059669', '#dc2626', '#7c3aed'];

const cleanRatio = (value) => Math.round(value * 1e12) / 1e12;
const clampRatio = (value, min = 0, max = 1) => cleanRatio(Math.min(max, Math.max(min, value)));
const finiteNumberOr = (value, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export const getContainedImageRect = (containerRect, imageSize) => {
  const containerWidth = Number(containerRect?.width) || 0;
  const containerHeight = Number(containerRect?.height) || 0;
  const imageWidth = Number(imageSize?.width) || 0;
  const imageHeight = Number(imageSize?.height) || 0;
  const left = Number(containerRect?.left) || 0;
  const top = Number(containerRect?.top) || 0;

  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { left, top, width: 0, height: 0 };
  }

  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = cleanRatio(imageWidth * scale);
  const height = cleanRatio(imageHeight * scale);
  return {
    left: cleanRatio(left + ((containerWidth - width) / 2)),
    top: cleanRatio(top + ((containerHeight - height) / 2)),
    width,
    height,
  };
};

export const clientPointToImageRatio = (point, imageRect, options = {}) => {
  const width = Number(imageRect?.width) || 0;
  const height = Number(imageRect?.height) || 0;
  const x = Number(point?.x);
  const y = Number(point?.y);
  const left = Number(imageRect?.left) || 0;
  const top = Number(imageRect?.top) || 0;
  const shouldClamp = options?.clamp === true;
  const allowOverflow = options?.allowOverflow === true;
  const rawTolerance = Number(options?.tolerancePx);
  const tolerance = rawTolerance === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Number.isFinite(rawTolerance) ? rawTolerance : 0);

  if (
    width <= 0
    || height <= 0
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || (!allowOverflow && (
      x < left - tolerance
      || y < top - tolerance
      || x > left + width + tolerance
      || y > top + height + tolerance
    ))
  ) return null;

  if (!allowOverflow && !shouldClamp && (
    x < left
    || y < top
    || x > left + width
    || y > top + height
  )) return null;

  const xRatio = (x - left) / width;
  const yRatio = (y - top) / height;
  return {
    xRatio: allowOverflow ? cleanRatio(xRatio) : clampRatio(xRatio),
    yRatio: allowOverflow ? cleanRatio(yRatio) : clampRatio(yRatio),
  };
};

export const createTranslationEditRegion = (start, end, id, options = {}) => {
  const normalize = options?.allowOverflow === true ? cleanRatio : clampRatio;
  const startX = normalize(finiteNumberOr(start?.xRatio));
  const startY = normalize(finiteNumberOr(start?.yRatio));
  const endX = normalize(finiteNumberOr(end?.xRatio));
  const endY = normalize(finiteNumberOr(end?.yRatio));
  return {
    id: String(id),
    index: 1,
    xRatio: Math.min(startX, endX),
    yRatio: Math.min(startY, endY),
    widthRatio: cleanRatio(Math.abs(endX - startX)),
    heightRatio: cleanRatio(Math.abs(endY - startY)),
    instruction: '',
  };
};

export const moveTranslationEditRegion = (region, delta, options = {}) => {
  if (options?.allowOverflow === true) {
    return {
      ...region,
      xRatio: cleanRatio(finiteNumberOr(region?.xRatio) + finiteNumberOr(delta?.xRatio)),
      yRatio: cleanRatio(finiteNumberOr(region?.yRatio) + finiteNumberOr(delta?.yRatio)),
    };
  }
  return {
    ...region,
    xRatio: clampRatio(
      Number(region?.xRatio) + (Number(delta?.xRatio) || 0),
      0,
      Math.max(0, 1 - Number(region?.widthRatio)),
    ),
    yRatio: clampRatio(
      Number(region?.yRatio) + (Number(delta?.yRatio) || 0),
      0,
      Math.max(0, 1 - Number(region?.heightRatio)),
    ),
  };
};

export const resizeTranslationEditRegion = (region, handle, delta, options = {}) => {
  const allowOverflow = options?.allowOverflow === true;
  const originalLeft = allowOverflow
    ? cleanRatio(finiteNumberOr(region?.xRatio))
    : clampRatio(
      Number(region?.xRatio) || 0,
      0,
      1 - MIN_TRANSLATION_EDIT_REGION_RATIO,
    );
  const originalTop = allowOverflow
    ? cleanRatio(finiteNumberOr(region?.yRatio))
    : clampRatio(
      Number(region?.yRatio) || 0,
      0,
      1 - MIN_TRANSLATION_EDIT_REGION_RATIO,
    );
  const originalWidth = allowOverflow
    ? cleanRatio(Math.max(MIN_TRANSLATION_EDIT_REGION_RATIO, finiteNumberOr(region?.widthRatio)))
    : clampRatio(
      Math.max(0, Number(region?.widthRatio) || 0),
      MIN_TRANSLATION_EDIT_REGION_RATIO,
      1 - originalLeft,
    );
  const originalHeight = allowOverflow
    ? cleanRatio(Math.max(MIN_TRANSLATION_EDIT_REGION_RATIO, finiteNumberOr(region?.heightRatio)))
    : clampRatio(
      Math.max(0, Number(region?.heightRatio) || 0),
      MIN_TRANSLATION_EDIT_REGION_RATIO,
      1 - originalTop,
    );
  const originalRight = cleanRatio(originalLeft + originalWidth);
  const originalBottom = cleanRatio(originalTop + originalHeight);
  const dx = Number(delta?.xRatio) || 0;
  const dy = Number(delta?.yRatio) || 0;
  let left = originalLeft;
  let right = originalRight;
  let top = originalTop;
  let bottom = originalBottom;

  if (String(handle).includes('w')) {
    left = allowOverflow
      ? cleanRatio(Math.min(originalLeft + dx, originalRight - MIN_TRANSLATION_EDIT_REGION_RATIO))
      : clampRatio(
        originalLeft + dx,
        0,
        originalRight - MIN_TRANSLATION_EDIT_REGION_RATIO,
      );
  }
  if (String(handle).includes('e')) {
    right = allowOverflow
      ? cleanRatio(Math.max(originalRight + dx, originalLeft + MIN_TRANSLATION_EDIT_REGION_RATIO))
      : clampRatio(
        originalRight + dx,
        originalLeft + MIN_TRANSLATION_EDIT_REGION_RATIO,
        1,
      );
  }
  if (String(handle).includes('n')) {
    top = allowOverflow
      ? cleanRatio(Math.min(originalTop + dy, originalBottom - MIN_TRANSLATION_EDIT_REGION_RATIO))
      : clampRatio(
        originalTop + dy,
        0,
        originalBottom - MIN_TRANSLATION_EDIT_REGION_RATIO,
      );
  }
  if (String(handle).includes('s')) {
    bottom = allowOverflow
      ? cleanRatio(Math.max(originalBottom + dy, originalTop + MIN_TRANSLATION_EDIT_REGION_RATIO))
      : clampRatio(
        originalBottom + dy,
        originalTop + MIN_TRANSLATION_EDIT_REGION_RATIO,
        1,
      );
  }

  return {
    ...region,
    xRatio: left,
    yRatio: top,
    widthRatio: cleanRatio(right - left),
    heightRatio: cleanRatio(bottom - top),
  };
};

export const removeTranslationEditRegion = (regions, regionId) => regions
  .filter((region) => region.id !== regionId)
  .map((region, offset) => ({ ...region, index: offset + 1 }));

export const tryAddTranslationEditRegion = (
  regions,
  region,
  maxRegions = MAX_TRANSLATION_EDIT_REGIONS,
) => {
  if (regions.length >= maxRegions) {
    return { regions, added: false, limitReached: true };
  }
  return {
    regions: [...regions, { ...region, index: regions.length + 1 }],
    added: true,
    limitReached: false,
  };
};

export const cancelTranslationRegionInteraction = (regions, interaction) => {
  if (!interaction?.regionId) return regions;
  if (Array.isArray(interaction.originalRegions)) return interaction.originalRegions;
  if (interaction.mode === 'draw') {
    return removeTranslationEditRegion(regions, interaction.regionId);
  }
  return regions.map((region) => (
    region.id === interaction.regionId
      ? { ...interaction.original }
      : region
  ));
};

export const runTranslationRegionSubmit = async (submit) => {
  try {
    await submit();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : '提交失败，请重试';
    return { ok: false, error: message };
  }
};

const normalizeFiniteRatio = (value, min, max) => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : value
);
const OVERLAP_EPSILON = Number.EPSILON * 4;

export const normalizeTranslationEditRegions = (regions = []) => regions.map((region, offset) => {
  const widthRatio = normalizeFiniteRatio(region?.widthRatio, 0, 1);
  const heightRatio = normalizeFiniteRatio(region?.heightRatio, 0, 1);
  const instruction = region?.instruction;
  const maxXRatio = Number.isFinite(widthRatio) ? 1 - widthRatio : 1;
  const maxYRatio = Number.isFinite(heightRatio) ? 1 - heightRatio : 1;

  return {
    id: String(region?.id || `translation-edit-region-${offset + 1}`),
    index: offset + 1,
    xRatio: normalizeFiniteRatio(region?.xRatio, 0, maxXRatio),
    yRatio: normalizeFiniteRatio(region?.yRatio, 0, maxYRatio),
    widthRatio,
    heightRatio,
    instruction: typeof instruction === 'string' ? instruction.trim() : instruction,
  };
});

export const clipTranslationEditRegionsToImageBounds = (regions = []) => (
  Array.isArray(regions) ? regions : []
).map((region, offset) => {
  const rawX = finiteNumberOr(region?.xRatio, Number.NaN);
  const rawY = finiteNumberOr(region?.yRatio, Number.NaN);
  const rawWidth = finiteNumberOr(region?.widthRatio, Number.NaN);
  const rawHeight = finiteNumberOr(region?.heightRatio, Number.NaN);
  const left = Number.isFinite(rawX) ? Math.max(0, rawX) : rawX;
  const top = Number.isFinite(rawY) ? Math.max(0, rawY) : rawY;
  const right = Number.isFinite(rawX) && Number.isFinite(rawWidth)
    ? Math.min(1, rawX + Math.max(0, rawWidth))
    : Number.NaN;
  const bottom = Number.isFinite(rawY) && Number.isFinite(rawHeight)
    ? Math.min(1, rawY + Math.max(0, rawHeight))
    : Number.NaN;
  const instruction = region?.instruction;

  return {
    id: String(region?.id || `translation-edit-region-${offset + 1}`),
    index: offset + 1,
    xRatio: Number.isFinite(left) ? cleanRatio(Math.min(1, left)) : left,
    yRatio: Number.isFinite(top) ? cleanRatio(Math.min(1, top)) : top,
    widthRatio: Number.isFinite(left) && Number.isFinite(right)
      ? cleanRatio(Math.max(0, right - Math.min(1, left)))
      : Number.NaN,
    heightRatio: Number.isFinite(top) && Number.isFinite(bottom)
      ? cleanRatio(Math.max(0, bottom - Math.min(1, top)))
      : Number.NaN,
    instruction: typeof instruction === 'string' ? instruction.trim() : instruction,
  };
});

const overlaps = (left, right) => (
  left.xRatio < right.xRatio + right.widthRatio - OVERLAP_EPSILON
  && left.xRatio + left.widthRatio > right.xRatio + OVERLAP_EPSILON
  && left.yRatio < right.yRatio + right.heightRatio - OVERLAP_EPSILON
  && left.yRatio + left.heightRatio > right.yRatio + OVERLAP_EPSILON
);

export const validateTranslationEditRegions = (input = []) => {
  if (!Array.isArray(input)) {
    return { ok: false, code: 'invalid_regions', regions: [] };
  }
  const regions = normalizeTranslationEditRegions(input);

  if (regions.length === 0) {
    return { ok: false, code: 'empty_regions', regions };
  }
  if (regions.length > MAX_TRANSLATION_EDIT_REGIONS) {
    return { ok: false, code: 'too_many_regions', regions };
  }

  const invalidInstructionType = regions.find((region) => (
    region.instruction !== undefined
    && region.instruction !== null
    && typeof region.instruction !== 'string'
  ));
  if (invalidInstructionType) {
    return {
      ok: false,
      code: 'invalid_instruction_type',
      regionId: invalidInstructionType.id,
      regions,
    };
  }

  const missingInstruction = regions.find((region) => !region.instruction);
  if (missingInstruction) {
    return {
      ok: false,
      code: 'missing_instruction',
      regionId: missingInstruction.id,
      regions,
    };
  }

  const invalidCoordinates = regions.find((region) => (
    !Number.isFinite(region.xRatio)
    || !Number.isFinite(region.yRatio)
    || !Number.isFinite(region.widthRatio)
    || !Number.isFinite(region.heightRatio)
  ));
  if (invalidCoordinates) {
    return {
      ok: false,
      code: 'invalid_region_coordinates',
      regionId: invalidCoordinates.id,
      regions,
    };
  }

  const longInstruction = regions.find((region) => (
    region.instruction.length > MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH
  ));
  if (longInstruction) {
    return {
      ok: false,
      code: 'instruction_too_long',
      regionId: longInstruction.id,
      regions,
    };
  }

  const totalInstructionLength = regions.reduce((total, region) => (
    total + region.instruction.length
  ), 0);
  if (totalInstructionLength > MAX_TRANSLATION_EDIT_TOTAL_INSTRUCTION_LENGTH) {
    return { ok: false, code: 'total_instruction_too_long', regions };
  }

  const tooSmall = regions.find((region) => (
    region.widthRatio < MIN_TRANSLATION_EDIT_REGION_RATIO
    || region.heightRatio < MIN_TRANSLATION_EDIT_REGION_RATIO
  ));
  if (tooSmall) {
    return {
      ok: false,
      code: 'region_too_small',
      regionId: tooSmall.id,
      regions,
    };
  }

  for (let left = 0; left < regions.length; left += 1) {
    for (let right = left + 1; right < regions.length; right += 1) {
      if (overlaps(regions[left], regions[right])) {
        return {
          ok: false,
          code: 'overlapping_regions',
          regionId: regions[right].id,
          regions,
        };
      }
    }
  }

  return { ok: true, regions };
};

export const ensureTranslationEditVersions = (result) => {
  const existing = Array.isArray(result?.translationEditVersions)
    ? result.translationEditVersions
    : [];

  if (existing.length > 0) return existing;
  if (!result?.imageUrl) return [];

  return [{
    id: `${result.id}-base`,
    imageUrl: result.imageUrl,
    createdAt: Number(result.createdAt || Date.now()),
    status: 'completed',
    regions: [],
  }];
};

export const getCompletedTranslationEditVersions = (result) => (
  ensureTranslationEditVersions(result).filter((version) => (
    version.status === 'completed' && version.imageUrl
  ))
);

export const getVisibleTranslationEditVersions = (result) => (
  ensureTranslationEditVersions(result).filter((version) => (
    (version.status === 'completed' && version.imageUrl)
    || version.status === 'generating'
    || version.status === 'error'
  ))
);

export const getTranslationEditCreditsConsumed = (result = {}) => {
  const creditsByVersionId = new Map();
  const versions = Array.isArray(result?.translationEditVersions)
    ? result.translationEditVersions
    : [];
  versions.forEach((version) => {
    const id = String(version?.id || '').trim();
    const sourceVersionId = String(version?.sourceVersionId || '').trim();
    const creditsConsumed = Number(version?.creditsConsumed);
    if (
      !id
      || !sourceVersionId
      || !['completed', 'error'].includes(version?.status)
      || !Number.isFinite(creditsConsumed)
      || creditsConsumed <= 0
    ) return;
    creditsByVersionId.set(id, Math.max(creditsByVersionId.get(id) || 0, creditsConsumed));
  });
  return Array.from(creditsByVersionId.values()).reduce((sum, value) => sum + value, 0);
};

export const reconcileTranslationVersionIndexes = (
  currentIndexes = {},
  previousLengths = {},
  nextLengths = {},
) => Object.fromEntries(Object.entries(nextLengths).map(([resultId, rawLength]) => {
  const length = Math.max(0, Number(rawLength) || 0);
  const previousLength = Math.max(0, Number(previousLengths[resultId]) || 0);
  const currentIndex = Number.isFinite(currentIndexes[resultId])
    ? Number(currentIndexes[resultId])
    : Math.max(previousLength - 1, 0);
  if (length <= 0) return [resultId, 0];
  if (length > previousLength) return [resultId, length - 1];
  return [resultId, Math.min(Math.max(currentIndex, 0), length - 1)];
}));

const hasTranslationEditVersionValue = (value) => (
  value !== undefined
  && value !== null
  && value !== ''
  && (!Array.isArray(value) || value.length > 0)
);

const isValidTranslationEditCanvasDimension = (value) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
);

const getTranslationEditCanvasDimensions = (source) => (
  isValidTranslationEditCanvasDimension(source?.canvasWidth)
  && isValidTranslationEditCanvasDimension(source?.canvasHeight)
    ? { canvasWidth: source.canvasWidth, canvasHeight: source.canvasHeight }
    : {}
);

const getInitialTranslationEditCanvasDimensions = (source) => ({
  ...(isValidTranslationEditCanvasDimension(source?.initialCanvasWidth)
    ? { initialCanvasWidth: source.initialCanvasWidth }
    : {}),
  ...(isValidTranslationEditCanvasDimension(source?.initialCanvasHeight)
    ? { initialCanvasHeight: source.initialCanvasHeight }
    : {}),
});

const TERMINAL_TRANSLATION_EDIT_REASONS = new Set([
  'user_cancelled',
  'client_output_rejected',
]);

const cloneTranslationEditVersion = (version) => {
  const cloned = {
    ...version,
    ...getTranslationEditCanvasDimensions(version),
    ...(Array.isArray(version?.regions)
      ? { regions: version.regions.map((region) => ({ ...region })) }
      : {}),
  };
  if (!isValidTranslationEditCanvasDimension(cloned.canvasWidth)) delete cloned.canvasWidth;
  if (!isValidTranslationEditCanvasDimension(cloned.canvasHeight)) delete cloned.canvasHeight;
  return cloned;
};

const mergeTranslationEditVersion = (existing, incoming) => {
  if (existing?.status === 'completed' && incoming?.status !== 'completed') {
    return cloneTranslationEditVersion(existing);
  }
  if (
    existing?.status === 'error'
    && (
      incoming?.status === 'generating'
      || (
        incoming?.status === 'completed'
        && TERMINAL_TRANSLATION_EDIT_REASONS.has(existing?.translationEditTerminalReason)
      )
    )
  ) {
    const terminal = cloneTranslationEditVersion(existing);
    for (const key of ['backendJobId', 'taskId', 'creditsConsumed']) {
      if (!hasTranslationEditVersionValue(terminal[key]) && hasTranslationEditVersionValue(incoming?.[key])) {
        terminal[key] = incoming[key];
      }
    }
    return terminal;
  }
  const merged = cloneTranslationEditVersion(existing);
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (key === 'canvasWidth' || key === 'canvasHeight') return;
    if (!hasTranslationEditVersionValue(value)) return;
    merged[key] = key === 'regions' && Array.isArray(value)
      ? value.map((region) => ({ ...region }))
      : value;
  });
  Object.assign(merged, getTranslationEditCanvasDimensions(incoming));
  if (merged.status === 'completed') {
    delete merged.error;
    delete merged.pendingProtectedSourceUrl;
  }
  return merged;
};

export const mergeTranslationEditVersions = (existingVersions = [], incomingVersions = []) => {
  const merged = [];
  const idToIndex = new Map();
  const push = (version) => {
    if (!version || typeof version !== 'object') return;
    const id = String(version.id || '').trim();
    const matchedIndex = id ? idToIndex.get(id) : undefined;
    if (typeof matchedIndex === 'number') {
      merged[matchedIndex] = mergeTranslationEditVersion(merged[matchedIndex], version);
      return;
    }
    const nextIndex = merged.length;
    merged.push(cloneTranslationEditVersion(version));
    if (id) idToIndex.set(id, nextIndex);
  };
  if (Array.isArray(existingVersions)) existingVersions.forEach(push);
  if (Array.isArray(incomingVersions)) incomingVersions.forEach(push);
  return merged;
};

export const getLatestCompletedTranslationEditVersionUrl = (result = {}) => {
  const versions = Array.isArray(result?.translationEditVersions)
    ? result.translationEditVersions
    : [];
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const version = versions[index];
    if (version?.status === 'completed' && version?.imageUrl) return version.imageUrl;
  }
  return result?.imageUrl || result?.resultUrl || '';
};

const normalizeTranslationRegionEditOptionalIdentity = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const normalizeTranslationRegionEditCredits = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const listTranslationRegionEditProtectionCandidates = (projects = []) => {
  const candidates = [];
  const seen = new Set();
  for (const project of Array.isArray(projects) ? projects : []) {
    const projectId = String(project?.id || '').trim();
    const subFeature = String(project?.subFeature || '').trim();
    if (!projectId || project?.module !== 'translation' || !['main', 'detail'].includes(subFeature)) continue;
    for (const result of Array.isArray(project?.results) ? project.results : []) {
      const resultId = String(result?.id || '').trim();
      if (
        !resultId
        || result?.module !== 'translation'
        || (result?.subFeature && result.subFeature !== subFeature)
        || result?.status !== 'completed'
      ) continue;
      const latestResultImageUrl = String(getLatestCompletedTranslationEditVersionUrl(result) || '').trim();
      if (!latestResultImageUrl) continue;
      const versions = Array.isArray(result?.translationEditVersions) ? result.translationEditVersions : [];
      const latestCompletedVersion = [...versions].reverse().find((item) => (
        item?.status === 'completed' && String(item?.imageUrl || '').trim()
      ));
      for (const version of versions) {
        const versionId = String(version?.id || '').trim();
        const sourceVersionId = String(version?.sourceVersionId || '').trim();
        const pendingProtectedSourceUrl = String(version?.pendingProtectedSourceUrl || '').trim();
        if (
          !versionId
          || version?.status !== 'generating'
          || String(version?.imageUrl || '').trim()
          || !pendingProtectedSourceUrl
          || version?.translationEditProcessingMode === 'direct_full_image_v1'
        ) continue;
        const key = `${projectId}:${resultId}:${versionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const sourceVersion = versions.find((item) => (
          item?.id === sourceVersionId
          && item?.status === 'completed'
          && String(item?.imageUrl || '').trim()
        ));
        const validation = validateTranslationEditRegions(version?.regions);
        candidates.push({
          key,
          projectId,
          resultId,
          versionId,
          sourceVersionId,
          subFeature,
          sourceImageUrl: String(sourceVersion?.imageUrl || '').trim(),
          pendingProtectedSourceUrl,
          latestResultImageUrl,
          latestCompletedVersionId: String(latestCompletedVersion?.id || '').trim(),
          regions: validation.ok ? validation.regions : [],
          ...getTranslationEditCanvasDimensions(version),
          backendJobId: normalizeTranslationRegionEditOptionalIdentity(version?.backendJobId),
          taskId: normalizeTranslationRegionEditOptionalIdentity(version?.taskId),
          creditsConsumed: normalizeTranslationRegionEditCredits(version?.creditsConsumed),
          validation,
          sourceVersion,
        });
      }
    }
  }
  return candidates;
};

const toRecoverableTranslationRegionEdit = ({ validation: _validation, sourceVersion: _sourceVersion, ...item }) => item;

export const listRecoverableTranslationRegionEdits = (projects = []) => (
  listTranslationRegionEditProtectionCandidates(projects)
    .filter((item) => item.sourceVersion && item.validation.ok)
    .map(toRecoverableTranslationRegionEdit)
);

export const listUnrecoverableTranslationRegionEdits = (projects = []) => (
  listTranslationRegionEditProtectionCandidates(projects)
    .filter((item) => !item.sourceVersion || !item.validation.ok)
    .map((item) => ({
      ...toRecoverableTranslationRegionEdit(item),
      errorCode: item.sourceVersion ? item.validation.code : 'missing_source_version',
      errorMessage: item.sourceVersion
        ? `Invalid translation edit regions: ${item.validation.code}`
        : 'Translation edit source version is missing or incomplete',
    }))
);

const copyTranslationEditVersions = (source) => (
  Array.isArray(source?.translationEditVersions)
    ? mergeTranslationEditVersions([], source.translationEditVersions)
    : undefined
);

export const copyTranslationEditVersionFields = (source = {}, urlField = 'imageUrl') => {
  const translationEditVersions = copyTranslationEditVersions(source);
  return {
    [urlField]: getLatestCompletedTranslationEditVersionUrl({ ...source, translationEditVersions }),
    ...getInitialTranslationEditCanvasDimensions(source),
    translationEditVersions,
  };
};

export const translationEditFileToResultFields = (file = {}) => (
  copyTranslationEditVersionFields(file, 'imageUrl')
);

export const translationEditResultToFileFields = (result = {}) => (
  copyTranslationEditVersionFields(result, 'resultUrl')
);

export const startTranslationEditVersion = (result, input) => [
  ...ensureTranslationEditVersions(result),
  {
    id: input.versionId,
    sourceVersionId: input.sourceVersionId,
    ...(input.translationEditProcessingMode
      ? { translationEditProcessingMode: input.translationEditProcessingMode }
      : {}),
    ...getTranslationEditCanvasDimensions({
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
    }),
    createdAt: input.createdAt,
    status: 'generating',
    regions: normalizeTranslationEditRegions(input.regions),
  },
];

export const completeTranslationEditVersion = (versions, versionId, patch = {}) => {
  const { canvasWidth: _canvasWidth, canvasHeight: _canvasHeight, ...safePatch } = patch || {};
  const canvasDimensions = getTranslationEditCanvasDimensions(patch);
  return versions.map((version) => (
    version.id === versionId
      ? { ...version, ...safePatch, ...canvasDimensions, status: 'completed', error: undefined }
      : version
  ));
};

export const failTranslationEditVersion = (versions, versionId, error) => versions.map((version) => (
  version.id === versionId
    ? { ...version, status: 'error', error: String(error || '修改失败') }
    : version
));

const findTranslationEditMutationTarget = (projects, input) => {
  const projectIndex = projects.findIndex((project) => project?.id === input.projectId);
  const project = projects[projectIndex];
  const resultIndex = project?.results?.findIndex((result) => result?.id === input.resultId) ?? -1;
  const result = resultIndex >= 0 ? project.results[resultIndex] : undefined;
  const versions = Array.isArray(result?.translationEditVersions)
    ? result.translationEditVersions
    : ensureTranslationEditVersions(result);
  const versionIndex = versions.findIndex((version) => version?.id === input.versionId);
  return { projectIndex, project, resultIndex, result, versions, versionIndex, version: versions[versionIndex] };
};

export const isOwnedGeneratingTranslationEditVersion = (projects = [], input = {}) => {
  const { project, result, version } = findTranslationEditMutationTarget(projects, input);
  const storedBackendJobId = String(version?.backendJobId || '').trim();
  const callerBackendJobId = String(input?.backendJobId || '').trim();
  return Boolean(
    project?.module === 'translation'
    && ['main', 'detail'].includes(project?.subFeature)
    && result?.module === 'translation'
    && (!result?.subFeature || result.subFeature === project.subFeature)
    && version?.status === 'generating'
    && (storedBackendJobId
      ? (!callerBackendJobId || storedBackendJobId === callerBackendJobId)
      : !callerBackendJobId)
  );
};

export const reduceTranslationRegionEditProjectMutation = (projects = [], input = {}) => {
  const target = findTranslationEditMutationTarget(projects, input);
  const { projectIndex, project, resultIndex, result, versions, versionIndex, version } = target;
  if (!project || !result || projectIndex < 0 || resultIndex < 0) {
    return { updated: false, projects };
  }

  let nextVersions;
  if (input.kind === 'start') {
    if (versionIndex >= 0 || versions.some((item) => item?.status === 'generating')) {
      return { updated: false, projects };
    }
    nextVersions = startTranslationEditVersion(result, input);
  } else {
    if (!version) return { updated: false, projects };
    if (input.kind === 'terminal_identity') {
      if (!['generating', 'error', 'completed'].includes(version.status)) {
        return { updated: false, projects };
      }
      const terminalStatus = version.status === 'completed' ? 'completed' : 'error';
      nextVersions = versions.map((item) => item.id === input.versionId ? {
        ...item,
        status: terminalStatus,
        ...(terminalStatus === 'error'
          ? { error: item.error || input.error || '修改已取消' }
          : { error: undefined }),
        ...(!item.backendJobId && input.backendJobId ? { backendJobId: input.backendJobId } : {}),
        ...(!item.taskId && input.taskId ? { taskId: input.taskId } : {}),
        ...(item.creditsConsumed === undefined
          && input.creditsConsumed !== undefined
          && Number.isFinite(Number(input.creditsConsumed))
          ? { creditsConsumed: Number(input.creditsConsumed) }
          : {}),
      } : item);
    } else {
      if (version.status !== 'generating') return { updated: false, projects };
    if (
      input.kind === 'cancel'
      && (
        String(version.backendJobId || '').trim()
          ? Boolean(input.backendJobId) && String(version.backendJobId).trim() !== String(input.backendJobId).trim()
          : Boolean(String(input.backendJobId || '').trim())
      )
    ) return { updated: false, projects };

    if (input.kind === 'identity') {
      nextVersions = versions.map((item) => item.id === input.versionId ? {
        ...item,
        ...(input.backendJobId ? { backendJobId: input.backendJobId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
      } : item);
    } else if (input.kind === 'raw_success') {
      nextVersions = versions.map((item) => item.id === input.versionId ? {
        ...item,
        ...(input.pendingProtectedSourceUrl ? { pendingProtectedSourceUrl: input.pendingProtectedSourceUrl } : {}),
        ...(input.backendJobId ? { backendJobId: input.backendJobId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.creditsConsumed !== undefined && Number.isFinite(Number(input.creditsConsumed))
          ? { creditsConsumed: Number(input.creditsConsumed) }
          : {}),
      } : item);
    } else if (input.kind === 'success') {
      nextVersions = completeTranslationEditVersion(versions, input.versionId, {
        imageUrl: input.imageUrl,
        canvasWidth: input.canvasWidth,
        canvasHeight: input.canvasHeight,
        backendJobId: input.backendJobId || version.backendJobId,
        taskId: input.taskId || version.taskId,
        creditsConsumed: input.creditsConsumed,
        pendingProtectedSourceUrl: undefined,
      });
    } else if (input.kind === 'failure' || input.kind === 'cancel') {
      const terminalPatch = {
        ...(input.backendJobId ? { backendJobId: input.backendJobId } : {}),
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(TERMINAL_TRANSLATION_EDIT_REASONS.has(input.translationEditTerminalReason)
          ? { translationEditTerminalReason: input.translationEditTerminalReason }
          : {}),
        ...(input.creditsConsumed !== undefined && Number.isFinite(Number(input.creditsConsumed))
          ? { creditsConsumed: Number(input.creditsConsumed) }
          : {}),
      };
      nextVersions = failTranslationEditVersion(versions, input.versionId, input.error)
        .map((item) => item.id === input.versionId ? { ...item, ...terminalPatch } : item);
    } else {
      return { updated: false, projects };
    }
    }
  }

  const nextResult = {
    ...result,
    ...getInitialTranslationEditCanvasDimensions(input),
    ...(input.kind === 'success'
      ? { imageUrl: input.imageUrl, status: 'completed', error: undefined }
      : {}),
    translationEditVersions: nextVersions,
  };
  const nextResults = [...project.results];
  nextResults[resultIndex] = nextResult;
  const nextProject = { ...project, results: nextResults };
  const nextProjects = [...projects];
  nextProjects[projectIndex] = nextProject;
  return {
    updated: true,
    projects: nextProjects,
    project: nextProject,
    result: nextResult,
    version: nextVersions.find((item) => item.id === input.versionId),
  };
};

export const claimTranslationRegionEditLockOwner = (owners, actionKey, ownerId) => {
  owners.set(actionKey, ownerId);
  return ownerId;
};

export const releaseTranslationRegionEditLockOwner = (owners, actionKey, ownerId, release) => {
  if (owners.get(actionKey) !== ownerId) return false;
  owners.delete(actionKey);
  release?.();
  return true;
};

const createTranslationEditPersistenceError = (code, cause) => {
  const message = cause instanceof Error && cause.message
    ? cause.message
    : code === 'translation_region_edit_project_persist_failed'
      ? 'Project persistence failed'
      : 'Translation file persistence failed';
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
};

export const TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED = Symbol(
  'translation-region-edit-persistence-skipped',
);

export const runGuardedTranslationRegionEditPersistenceWrite = async ({
  resolveBase,
  guard,
  write,
  signal,
} = {}) => {
  const canWrite = () => !signal?.aborted && guard?.() !== false;
  if (!canWrite()) return TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED;
  const base = await resolveBase?.();
  if (!canWrite()) return TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED;
  const result = await write?.(base);
  return canWrite() ? result : TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED;
};

/**
 * @template T
 * @param {T[]} items
 * @param {{
 *   concurrency?: number;
 *   shouldContinue?: () => boolean;
 *   worker?: (item: T, index: number) => unknown | Promise<unknown>;
 * }} options
 */
export const runTranslationRegionEditRecoveryQueue = async (items = [], options = {}) => {
  const { concurrency = 1, shouldContinue, worker } = options;
  const queue = Array.isArray(items) ? items : [];
  const workerCount = Math.min(queue.length, Math.max(1, Math.floor(Number(concurrency) || 1)));
  const canContinue = typeof shouldContinue === 'function' ? shouldContinue : () => true;
  let nextIndex = 0;
  const runWorker = async () => {
    while (canContinue()) {
      const index = nextIndex;
      if (index >= queue.length) return;
      nextIndex += 1;
      if (!canContinue()) return;
      await worker?.(queue[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, runWorker));
};

export const persistTranslationRegionEditTransition = async ({
  candidate,
  persistProject,
  persistFiles,
  commit,
} = {}) => {
  const persistOne = async (persist, code) => {
    try {
      const result = await persist(candidate);
      if (result === false) throw createTranslationEditPersistenceError(code);
      return result;
    } catch (error) {
      if (error?.code === code) throw error;
      throw createTranslationEditPersistenceError(code, error);
    }
  };
  const results = await Promise.all([
    persistOne(persistProject, 'translation_region_edit_project_persist_failed'),
    persistOne(persistFiles, 'translation_region_edit_files_persist_failed'),
  ]);
  if (results.includes(TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED)) return null;
  return commit(candidate);
};

const stableTranslationEditRegionsSnapshot = (regions = []) => JSON.stringify(
  (Array.isArray(regions) ? regions : []).map((region) => ({
    id: region?.id,
    index: region?.index,
    xRatio: region?.xRatio,
    yRatio: region?.yRatio,
    widthRatio: region?.widthRatio,
    heightRatio: region?.heightRatio,
    instruction: region?.instruction,
  })),
);

export const isSameTranslationRegionEditRecovery = (current, expected) => Boolean(
  current
  && current.key === expected.key
  && current.sourceVersionId === expected.sourceVersionId
  && current.sourceImageUrl === expected.sourceImageUrl
  && current.pendingProtectedSourceUrl === expected.pendingProtectedSourceUrl
  && current.subFeature === expected.subFeature
  && current.latestResultImageUrl === expected.latestResultImageUrl
  && current.latestCompletedVersionId === expected.latestCompletedVersionId
  && current.canvasWidth === expected.canvasWidth
  && current.canvasHeight === expected.canvasHeight
  && current.backendJobId === expected.backendJobId
  && current.taskId === expected.taskId
  && current.creditsConsumed === expected.creditsConsumed
  && stableTranslationEditRegionsSnapshot(current.regions) === stableTranslationEditRegionsSnapshot(expected.regions)
);

const persistTranslationRegionEditRecoveryFailure = async (
  item,
  error,
  deps,
  listCurrent = listRecoverableTranslationRegionEdits,
) => {
  const current = deps.signal?.aborted || deps.isScopeCurrent?.() === false
    ? null
    : listCurrent(deps.getProjects?.()).find((entry) => entry.key === item.key);
  if (!isSameTranslationRegionEditRecovery(current, item)) return { status: 'skipped' };
  const mutation = {
    kind: 'failure',
    projectId: current.projectId,
    resultId: current.resultId,
    versionId: current.versionId,
    error: error instanceof Error ? error.message : String(error || 'Translation edit protection recovery failed'),
    backendJobId: current.backendJobId || undefined,
    taskId: current.taskId || undefined,
    creditsConsumed: current.creditsConsumed,
  };
  const failed = reduceTranslationRegionEditProjectMutation(deps.getProjects?.(), mutation);
  if (!failed.updated || !failed.project || !failed.result) return { status: 'skipped' };
  const candidate = { project: failed.project, result: failed.result };
  const outcomes = await Promise.allSettled([
    deps.persistProject?.(candidate),
    deps.persistFiles?.(candidate),
  ]);
  const persistenceErrors = outcomes.flatMap((outcome, index) => {
    if (outcome.status === 'rejected') return [outcome.reason];
    if (outcome.value === false) {
      return [new Error(index === 0 ? 'Project persistence failed' : 'Translation file persistence failed')];
    }
    return [];
  });
  const latest = deps.signal?.aborted || deps.isScopeCurrent?.() === false
    ? null
    : listCurrent(deps.getProjects?.()).find((entry) => entry.key === item.key);
  if (!isSameTranslationRegionEditRecovery(latest, item)) return { status: 'skipped', persistenceErrors };
  const committed = deps.commit?.(mutation);
  if (!committed) return { status: 'skipped', persistenceErrors };
  deps.logFailure?.({ item: latest, error, persistenceErrors });
  return { status: 'failed', error, persistenceErrors };
};

export const runTranslationRegionEditProtectionRecovery = async (item, deps = {}) => {
  const locks = deps.locks;
  if (!item?.key || !locks) return { status: 'skipped' };
  const lockKey = String(deps.lockKey || item.key);
  if (locks.has(lockKey)) return { status: 'locked' };
  locks.add(lockKey);
  try {
    const getCurrent = () => {
      if (deps.signal?.aborted || deps.isScopeCurrent?.() === false) return null;
      const current = listRecoverableTranslationRegionEdits(deps.getProjects?.())
        .find((entry) => entry.key === item.key);
      return isSameTranslationRegionEditRecovery(current, item) ? current : null;
    };
    let current = getCurrent();
    if (!current) return { status: 'skipped' };
    try {
      const protectedEdit = await deps.composite?.({
        sourceUrl: current.sourceImageUrl,
        generatedUrl: current.pendingProtectedSourceUrl,
        ...(current.canvasWidth && current.canvasHeight
          ? { targetWidth: current.canvasWidth, targetHeight: current.canvasHeight }
          : {}),
        regions: current.regions,
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      current = getCurrent();
      if (!current) return { status: 'skipped' };
      if (!protectedEdit?.blob) throw new Error('Translation edit protection composite returned no image');
      if (current.canvasWidth && current.canvasHeight && deps.getImageDimensions) {
        const dimensions = await deps.getImageDimensions(protectedEdit.blob);
        current = getCurrent();
        if (!current) return { status: 'skipped' };
        if (
          dimensions?.width !== current.canvasWidth
          || dimensions?.height !== current.canvasHeight
        ) {
          throw new Error(`修改结果尺寸不一致，已停止保存。期望 ${current.canvasWidth}×${current.canvasHeight}，实际 ${dimensions?.width || 0}×${dimensions?.height || 0}`);
        }
      }
      const upload = await deps.upload?.({
        blob: protectedEdit.blob,
        fileName: 'translation-edit-recovered-version.png',
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      current = getCurrent();
      if (!current) return { status: 'skipped' };
      const imageUrl = String(upload?.fileUrl || '').trim();
      if (!imageUrl) throw new Error('Translation edit protection upload returned no file URL');
      const mutation = {
        kind: 'success',
        projectId: current.projectId,
        resultId: current.resultId,
        versionId: current.versionId,
        imageUrl,
        backendJobId: current.backendJobId || undefined,
        taskId: current.taskId || undefined,
        creditsConsumed: current.creditsConsumed,
      };
      const succeeded = reduceTranslationRegionEditProjectMutation(deps.getProjects?.(), mutation);
      if (!succeeded.updated || !succeeded.project || !succeeded.result) return { status: 'skipped' };
      const candidate = { project: succeeded.project, result: succeeded.result };
      const completed = await persistTranslationRegionEditTransition({
        candidate,
        persistProject: deps.persistProject,
        persistFiles: deps.persistFiles,
        commit: () => getCurrent() ? deps.commit?.(mutation) : null,
      });
      if (!completed) return { status: 'skipped' };
      deps.logSuccess?.({ item: current, imageUrl });
      return { status: 'completed', imageUrl };
    } catch (error) {
      return persistTranslationRegionEditRecoveryFailure(item, error, deps);
    }
  } finally {
    locks.delete(lockKey);
  }
};

export const failUnrecoverableTranslationRegionEditProtection = async (item, deps = {}) => {
  const locks = deps.locks;
  if (!item?.key || !locks) return { status: 'skipped' };
  const lockKey = String(deps.lockKey || item.key);
  if (locks.has(lockKey)) return { status: 'locked' };
  locks.add(lockKey);
  try {
    const current = deps.signal?.aborted || deps.isScopeCurrent?.() === false
      ? null
      : listUnrecoverableTranslationRegionEdits(deps.getProjects?.())
        .find((entry) => entry.key === item.key);
    if (!isSameTranslationRegionEditRecovery(current, item)) return { status: 'skipped' };
    const error = new Error(current.errorMessage || 'Translation edit protection cannot be recovered');
    error.code = current.errorCode || 'translation_region_edit_recovery_invalid';
    return persistTranslationRegionEditRecoveryFailure(
      item,
      error,
      deps,
      listUnrecoverableTranslationRegionEdits,
    );
  } finally {
    locks.delete(lockKey);
  }
};

export const settleLateTranslationRegionEditJobIdentity = async ({
  backendJobId,
  candidate,
  cancelJob,
  persist,
}) => {
  let cancelError = null;
  let persistenceError = null;
  if (backendJobId) {
    try {
      await cancelJob(backendJobId);
    } catch (error) {
      cancelError = error;
    }
  }
  if (candidate) {
    try {
      await persist(candidate);
    } catch (error) {
      persistenceError = error;
    }
  }
  return { cancelError, persistenceError };
};

export const persistTranslationRegionEditCancelTransition = async ({
  candidate,
  persistProject,
  persistFiles,
  commit,
  getCurrentVersion,
} = {}) => {
  const committed = await persistTranslationRegionEditTransition({
    candidate,
    persistProject,
    persistFiles,
    commit,
  });
  if (committed !== null && committed !== undefined && committed !== false) return committed;

  const currentVersion = getCurrentVersion?.();
  const raceOutcome = currentVersion?.status === 'completed' ? 'already_completed' : 'state_changed';
  const error = new Error(
    raceOutcome === 'already_completed'
      ? '任务已完成，取消未生效'
      : '任务状态已变化，取消未生效',
  );
  error.code = 'translation_region_edit_cancel_not_applied';
  error.raceOutcome = raceOutcome;
  throw error;
};

const classifyTranslationRegionEditError = (error) => {
  const errorCode = String(error?.code || error?.errorCode || '').trim();
  let errorCategory = 'runtime';
  if (errorCode.includes('_persist_failed')) errorCategory = 'persistence';
  else if (errorCode.startsWith('provider_')) errorCategory = 'provider';
  else if (error?.name === 'AbortError' || errorCode === 'interrupted') errorCategory = 'interrupted';
  else if (errorCode) errorCategory = 'coded';
  return {
    errorCategory,
    errorCode,
    errorMessage: error instanceof Error && error.message
      ? error.message
      : String(error || '翻译区域修改失败'),
  };
};

export const buildTranslationRegionEditLogMeta = (input = {}) => {
  const meta = {
    shellProjectId: String(input.shellProjectId || '').trim(),
    shellResultId: String(input.shellResultId || '').trim(),
    sourceVersionId: String(input.sourceVersionId || '').trim(),
    targetVersionId: String(input.targetVersionId || '').trim(),
    regionCount: Array.isArray(input.regions)
      ? input.regions.length
      : Math.max(0, Number(input.regionCount) || 0),
    backendJobId: String(input.backendJobId || '').trim(),
    providerTaskId: String(input.providerTaskId || '').trim(),
    creditsConsumed: Number.isFinite(Number(input.creditsConsumed))
      ? Number(input.creditsConsumed)
      : undefined,
    ...(input.recovered === true ? { recovered: true } : {}),
  };
  const persistence = input.persistenceStatus
    ? {
        persistenceStatus: String(input.persistenceStatus),
        persistenceError: String(input.persistenceError || ''),
        ...(input.raceOutcome ? { raceOutcome: String(input.raceOutcome) } : {}),
      }
    : {};
  const cancelFailure = input.cancelError
    ? {
        cancelErrorCode: String(input.cancelError?.code || input.cancelError?.errorCode || '').trim(),
        cancelErrorMessage: input.cancelError instanceof Error && input.cancelError.message
          ? input.cancelError.message
          : String(input.cancelError),
      }
    : {};
  return input.error
    ? { ...meta, ...persistence, ...cancelFailure, ...classifyTranslationRegionEditError(input.error) }
    : { ...meta, ...persistence, ...cancelFailure };
};
