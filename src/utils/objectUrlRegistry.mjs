const trackedUrlMap = new WeakMap();
const trackedValueByUrl = new Map();
const trackedEntries = new Set();

const isBlobLike = (value) => value instanceof Blob || value instanceof File;

export const createTrackedObjectUrl = (value) => {
  if (!isBlobLike(value)) return null;

  const existing = trackedUrlMap.get(value);
  if (existing) return existing;

  const nextUrl = URL.createObjectURL(value);
  trackedUrlMap.set(value, nextUrl);
  trackedValueByUrl.set(nextUrl, value);
  trackedEntries.add({ value, url: nextUrl });
  return nextUrl;
};

export const revokeTrackedObjectUrl = (value) => {
  const trackedValue = typeof value === 'string'
    ? trackedValueByUrl.get(value)
    : value;
  if (!isBlobLike(trackedValue)) return;

  const trackedUrl = trackedUrlMap.get(trackedValue);
  if (!trackedUrl) return;

  URL.revokeObjectURL(trackedUrl);
  trackedUrlMap.delete(trackedValue);
  trackedValueByUrl.delete(trackedUrl);

  for (const entry of trackedEntries) {
    if (entry.value === trackedValue) {
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
    trackedValueByUrl.delete(entry.url);
    trackedEntries.delete(entry);
  }
};
