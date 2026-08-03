const clean = (value) => String(value || '').trim();

const materialKey = (material, index = 0) => (
  clean(material?.id) || clean(material?.localAssetId) || `material-${index + 1}`
);

const createUniqueGroupId = (prefix, usedIds, disallowedId = '') => {
  let candidate = prefix;
  let suffix = 2;
  while (!candidate || candidate === disallowedId || usedIds.has(candidate)) {
    candidate = `${prefix}:${suffix}`;
    suffix += 1;
  }
  return candidate;
};

export const getEffectiveProductGroupId = (material, index = 0) => (
  clean(material?.productGroupId) || `product-group:auto:${materialKey(material, index)}`
);

export const buildProductGroupAssignmentPatches = (materials = []) => {
  const usedIds = new Set();
  const patches = [];
  materials.forEach((material, index) => {
    const currentGroupId = clean(material?.productGroupId);
    const assignment = clean(material?.productGroupAssignment);
    const duplicateAutomaticGroup = currentGroupId
      && usedIds.has(currentGroupId)
      && assignment !== 'manual';
    if (!currentGroupId || duplicateAutomaticGroup) {
      const productGroupId = createUniqueGroupId(
        `product-group:auto:${materialKey(material, index)}`,
        usedIds,
        duplicateAutomaticGroup ? currentGroupId : '',
      );
      patches.push({
        id: clean(material?.id),
        productGroupId,
        productGroupAssignment: 'auto',
      });
      usedIds.add(productGroupId);
      return;
    }
    usedIds.add(currentGroupId);
  });
  return patches.filter((patch) => patch.id);
};

/**
 * @param {{
 *   groupIds?: string[];
 *   targetNumber?: number | string;
 *   materialId?: string;
 *   currentGroupId?: string;
 * }} [options]
 */
export const resolveProductGroupIdForSelection = (options = {}) => {
  const {
    groupIds = [],
    targetNumber,
    materialId,
    currentGroupId,
  } = options;
  const normalizedTargetNumber = Math.max(1, Math.floor(Number(targetNumber) || 1));
  const existingGroupId = clean(groupIds[normalizedTargetNumber - 1]);
  if (existingGroupId) return existingGroupId;
  return createUniqueGroupId(
    `product-group:manual:${clean(materialId) || 'material'}:${normalizedTargetNumber}`,
    new Set(groupIds.map(clean).filter(Boolean)),
    clean(currentGroupId),
  );
};
