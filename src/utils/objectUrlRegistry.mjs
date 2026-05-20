const trackedUrlMap = new WeakMap();
const trackedEntries = new Set();

const isBlobLike = (value) => value instanceof Blob || value instanceof File;

export const createTrackedObjectUrl = (value) => {
  if (!isBlobLike(value)) return null;

  const existing = trackedUrlMap.get(value);
  if (existing) return existing;

  const nextUrl = URL.createObjectURL(value);
  trackedUrlMap.set(value, nextUrl);
  trackedEntries.add({ value, url: nextUrl });
  return nextUrl;
};

export const revokeTrackedObjectUrl = (value) => {
  if (!isBlobLike(value)) return;

  const trackedUrl = trackedUrlMap.get(value);
  if (!trackedUrl) return;

  URL.revokeObjectURL(trackedUrl);
  trackedUrlMap.delete(value);

  for (const entry of trackedEntries) {
    if (entry.value === value) {
      trackedEntries.delete(entry);
    }
  }
};

export const revokeTrackedObjectUrls = (values = []) => {
  values.forEach((value) => revokeTrackedObjectUrl(value));
};

export const revokeAllTrackedObjectUrls = () => {
  for (const entry of trackedEntries) {
    URL.revokeObjectURL(entry.url);
    trackedUrlMap.delete(entry.value);
    trackedEntries.delete(entry);
  }
};
