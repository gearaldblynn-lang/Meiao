export const SHELL_DRAFT_STATE_KEY = 'MEIAO_SHELL_DRAFT_STATE_V1';
const MAX_SHELL_DRAFT_STORAGE_BYTES = 2 * 1024 * 1024;

export const getShellDraftStateKey = (userId?: string | null) => {
  const scope = String(userId || '').trim();
  return scope ? `${SHELL_DRAFT_STATE_KEY}:${encodeURIComponent(scope)}` : SHELL_DRAFT_STATE_KEY;
};

const getStorageByteLength = (value: string) =>
  typeof Blob !== 'undefined' ? new Blob([value]).size : value.length;

const readBoundedShellDraftStorage = (key: string) => {
  const raw = window.localStorage.getItem(key) || '';
  if (!raw) return '';
  if (getStorageByteLength(raw) <= MAX_SHELL_DRAFT_STORAGE_BYTES) return raw;
  window.localStorage.removeItem(key);
  console.warn(`[MEIAO] ignored oversized shell draft localStorage item ${key}`);
  return '';
};

export type ShellDraftInputState = Record<string, {
  promptText: string;
  params: Record<string, string>;
}>;

export type ShellDraftMaterial = {
  id: string;
  type: string;
  url: string;
  remoteUrl?: string;
  localAssetId?: string;
  fileName: string;
  relativePath?: string;
  subFeature?: string;
  giftIndex?: number;
  originalWidth?: number;
  originalHeight?: number;
};

export type ShellDraftState = {
  inputStateByScope: ShellDraftInputState;
  materials: Record<string, ShellDraftMaterial[]>;
  deletedJobIds: string[];
  deletedProjectIds: string[];
  deletedResultIds: string[];
  updatedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

type NormalizeShellDraftOptions = {
  allowInlineAssets?: boolean;
};

const isPersistableUrl = (value: string, options: NormalizeShellDraftOptions = {}) => {
  const url = value.trim();
  if (!url || url.startsWith('blob:')) return false;
  if (url.startsWith('data:')) return options.allowInlineAssets === true;
  return true;
};

const sanitizePersistedUrl = (value: string, options: NormalizeShellDraftOptions = {}) => {
  const url = value.trim();
  return isPersistableUrl(url, options) ? url : '';
};

const normalizeInputState = (value: unknown): ShellDraftInputState => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([scopeKey, entry]) => {
      if (!isRecord(entry)) return [];
      const params = isRecord(entry.params)
        ? Object.fromEntries(
            Object.entries(entry.params)
              .filter(([, paramValue]) => typeof paramValue === 'string')
              .map(([paramKey, paramValue]) => [paramKey, paramValue as string]),
          )
        : {};
      return [[scopeKey, {
        promptText: typeof entry.promptText === 'string' ? entry.promptText : '',
        params,
      }]];
    }),
  );
};

const normalizeMaterial = (value: unknown, options: NormalizeShellDraftOptions = {}): ShellDraftMaterial | null => {
  if (!isRecord(value)) return null;
  const type = typeof value.type === 'string' ? value.type : '';
  const remoteUrl = typeof value.remoteUrl === 'string' ? value.remoteUrl : '';
  const url = typeof value.url === 'string' ? value.url : '';
  const persistableUrl = [remoteUrl, url].map((item) => sanitizePersistedUrl(item || '', options)).find(Boolean) || '';
  const localAssetId = typeof value.localAssetId === 'string' && value.localAssetId.trim()
    ? value.localAssetId.trim()
    : '';
  if (!type || (!persistableUrl && !localAssetId)) return null;
  return {
    id: typeof value.id === 'string' && value.id.trim()
      ? value.id
      : `${type}-${persistableUrl || localAssetId}`,
    type,
    url: persistableUrl,
    remoteUrl: persistableUrl || undefined,
    localAssetId: localAssetId || undefined,
    fileName: typeof value.fileName === 'string' && value.fileName.trim()
      ? value.fileName
      : 'uploaded-asset',
    relativePath: typeof value.relativePath === 'string' ? value.relativePath : undefined,
    subFeature: typeof value.subFeature === 'string' ? value.subFeature : undefined,
    giftIndex: typeof value.giftIndex === 'number' && Number.isFinite(value.giftIndex)
      ? value.giftIndex
      : undefined,
    originalWidth: typeof value.originalWidth === 'number' && Number.isFinite(value.originalWidth)
      ? value.originalWidth
      : undefined,
    originalHeight: typeof value.originalHeight === 'number' && Number.isFinite(value.originalHeight)
      ? value.originalHeight
      : undefined,
  };
};

const normalizeMaterials = (value: unknown, options: NormalizeShellDraftOptions = {}): Record<string, ShellDraftMaterial[]> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([type, list]) => {
      if (!Array.isArray(list)) return [];
      const normalized = list
        .map((item) => normalizeMaterial(item, options))
        .filter((item): item is ShellDraftMaterial => Boolean(item));
      return normalized.length > 0 ? [[type, normalized]] : [];
    }),
  );
};

const normalizeDeletedIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  value.forEach((item) => {
    const id = String(item || '').trim();
    if (id) seen.add(id);
  });
  return Array.from(seen).slice(-500);
};

export const normalizeShellDraftState = (value: unknown, options: NormalizeShellDraftOptions = {}): ShellDraftState => {
  const source = isRecord(value) ? value : {};
  return {
    inputStateByScope: normalizeInputState(source.inputStateByScope),
    materials: normalizeMaterials(source.materials, options),
    deletedJobIds: normalizeDeletedIds(source.deletedJobIds),
    deletedProjectIds: normalizeDeletedIds(source.deletedProjectIds),
    deletedResultIds: normalizeDeletedIds(source.deletedResultIds),
    updatedAt: typeof source.updatedAt === 'number' && Number.isFinite(source.updatedAt)
      ? source.updatedAt
      : 0,
  };
};

export const mergeShellDraftMaterials = (
  ...materialMaps: Array<Record<string, ShellDraftMaterial[]> | undefined | null>
): Record<string, ShellDraftMaterial[]> => {
  const next: Record<string, ShellDraftMaterial[]> = {};
  materialMaps.forEach((materials) => {
    Object.entries(normalizeMaterials(materials)).forEach(([type, list]) => {
      const existing = next[type] || [];
      const seen = new Set(existing.map((item) => `${item.id}:${item.remoteUrl || item.url || item.localAssetId || ''}`));
      const additions = list.filter((item) => {
        const key = `${item.id}:${item.remoteUrl || item.url || item.localAssetId || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      next[type] = [...existing, ...additions];
    });
  });
  return next;
};

const hasDraftContent = (draft: ShellDraftState) =>
  draft.updatedAt > 0
  || Object.keys(draft.inputStateByScope).length > 0
  || Object.values(draft.materials).some((list) => (list || []).length > 0)
  || draft.deletedJobIds.length > 0
  || draft.deletedProjectIds.length > 0
  || draft.deletedResultIds.length > 0;

export const resolveHydratedShellDraftState = ({
  localDraft,
  remoteDraft,
  legacyMaterials,
}: {
  localDraft?: unknown;
  remoteDraft?: unknown;
  legacyMaterials?: Record<string, ShellDraftMaterial[]> | null;
}): ShellDraftState => {
  const local = normalizeShellDraftState(localDraft);
  const remote = normalizeShellDraftState(remoteDraft);
  const preferred = remote.updatedAt > local.updatedAt ? remote : local;

  if (hasDraftContent(preferred)) {
    return preferred;
  }

  return normalizeShellDraftState({
    inputStateByScope: preferred.inputStateByScope,
    materials: mergeShellDraftMaterials(legacyMaterials, preferred.materials),
    deletedJobIds: preferred.deletedJobIds,
    deletedProjectIds: preferred.deletedProjectIds,
    deletedResultIds: preferred.deletedResultIds,
    updatedAt: preferred.updatedAt,
  });
};

export const loadShellDraftState = (userId?: string | null): ShellDraftState => {
  if (typeof window === 'undefined') return normalizeShellDraftState(null);
  try {
    return normalizeShellDraftState(JSON.parse(readBoundedShellDraftStorage(getShellDraftStateKey(userId)) || '{}'));
  } catch {
    return normalizeShellDraftState(null);
  }
};

export const saveShellDraftState = (
  state: Pick<ShellDraftState, 'inputStateByScope' | 'materials'> & Partial<Pick<ShellDraftState, 'deletedJobIds' | 'deletedProjectIds' | 'deletedResultIds'>>,
  userId?: string | null,
) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getShellDraftStateKey(userId), JSON.stringify(normalizeShellDraftState({
      ...state,
      updatedAt: Date.now(),
    })));
  } catch {
    // Draft recovery is best-effort and should never block generation.
  }
};
