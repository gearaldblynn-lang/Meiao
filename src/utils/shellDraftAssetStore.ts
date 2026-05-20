import { applyRestoredShellDraftAssetUrls } from './shellDraftAssetRestore.mjs';

export { applyRestoredShellDraftAssetUrls };

const DB_NAME = 'MEIAO_SHELL_DRAFT_ASSETS_V1';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

export type ShellDraftAssetRecord = {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  updatedAt: number;
};

export type ShellDraftAssetReference = {
  id?: string;
  localAssetId?: string;
  url?: string;
  remoteUrl?: string;
};

const canUseIndexedDb = () =>
  typeof window !== 'undefined'
  && typeof window.indexedDB !== 'undefined';

const openAssetDb = (): Promise<IDBDatabase | null> => {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | null> => {
  const db = await openAssetDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let settled = false;
    const settle = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = action(store);
    if (request) {
      request.onsuccess = () => settle(request.result ?? null);
      request.onerror = () => settle(null);
    }
    transaction.oncomplete = () => {
      if (!request) settle(null);
      db.close();
    };
    transaction.onerror = () => {
      settle(null);
      db.close();
    };
    transaction.onabort = () => {
      settle(null);
      db.close();
    };
  });
};

export const saveShellDraftAsset = async (
  id: string,
  blob: Blob,
  metadata: { fileName?: string; mimeType?: string } = {},
) => {
  if (!id || !(blob instanceof Blob)) return false;
  const record: ShellDraftAssetRecord = {
    id,
    blob,
    fileName: metadata.fileName || (blob instanceof File ? blob.name : 'uploaded-asset'),
    mimeType: metadata.mimeType || blob.type || 'application/octet-stream',
    updatedAt: Date.now(),
  };
  const result = await withStore<IDBValidKey>('readwrite', (store) => store.put(record));
  return Boolean(result);
};

export const loadShellDraftAsset = async (id: string) => {
  if (!id) return null;
  return withStore<ShellDraftAssetRecord>('readonly', (store) => store.get(id));
};

export const deleteShellDraftAsset = async (id: string) => {
  if (!id) return false;
  await withStore<undefined>('readwrite', (store) => store.delete(id));
  return true;
};

export const pruneShellDraftAssets = async (keepIds: string[]) => {
  const keep = new Set(keepIds.filter(Boolean));
  const db = await openAssetDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as ShellDraftAssetRecord;
      if (value?.id && !keep.has(value.id)) {
        cursor.delete();
      }
      cursor.continue();
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
    transaction.onabort = () => {
      db.close();
      resolve();
    };
  });
};

export const restoreShellDraftAssetUrls = async <T extends ShellDraftAssetReference>(
  materials: Record<string, T[]>,
): Promise<Record<string, T[]>> => {
  const assetIds = Array.from(new Set(
    Object.values(materials)
      .flatMap((list) => list || [])
      .map((item) => item.localAssetId || '')
      .filter(Boolean),
  ));
  if (assetIds.length === 0) return materials;

  const records = await Promise.all(assetIds.map((id) => loadShellDraftAsset(id)));
  return applyRestoredShellDraftAssetUrls(
    materials,
    records.filter((record): record is ShellDraftAssetRecord => Boolean(record)),
  ) as Record<string, T[]>;
};
