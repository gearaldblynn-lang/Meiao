import { safeCreateObjectURL } from './urlUtils.ts';

export const applyRestoredShellDraftAssetUrls = (
  materials = {},
  records = [],
  createUrl = safeCreateObjectURL,
) => {
  const recordById = new Map(records.filter(Boolean).map((record) => [record.id, record]));

  return Object.fromEntries(
    Object.entries(materials).map(([type, list]) => [
      type,
      (list || []).map((item) => {
        if (!item.localAssetId) return item;
        const record = recordById.get(item.localAssetId);
        const restoredUrl = record ? createUrl(record.blob) : undefined;
        if (!restoredUrl || restoredUrl === item.url) return item;
        return { ...item, url: restoredUrl };
      }),
    ]),
  );
};
