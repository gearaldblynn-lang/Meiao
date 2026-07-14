export const PRODUCT_RESTORE_ROLLOUT_MODES = Object.freeze(['off', 'admin', 'all']);

export const normalizeProductRestoreRollout = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return PRODUCT_RESTORE_ROLLOUT_MODES.includes(normalized) ? normalized : 'off';
};

export const canCreateProductRestore = (mode, role) => {
  const normalized = normalizeProductRestoreRollout(mode);
  if (normalized === 'all') return Boolean(role);
  if (normalized === 'admin') return role === 'admin';
  return false;
};
