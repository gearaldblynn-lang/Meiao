
import {
  createTrackedObjectUrl,
  revokeAllTrackedObjectUrls,
  revokeTrackedObjectUrl,
  revokeTrackedObjectUrls,
} from './objectUrlRegistry.mjs';

/**
 * Safely creates a URL for a Blob or File object.
 * Returns undefined if the object is invalid or not a Blob/File.
 */
export const safeCreateObjectURL = (obj: any): string | undefined => {
  if (!obj) return undefined;
  
  // Check if it's a real Blob or File
  // Note: After restoration from localStorage, these might be plain objects {}
  if (obj instanceof Blob || obj instanceof File) {
    try {
      return createTrackedObjectUrl(obj) || undefined;
    } catch (e) {
      console.error('Failed to create object URL', e);
      return undefined;
    }
  }
  
  // If it's a string (already a URL), return it
  if (typeof obj === 'string') return obj;
  
  return undefined;
};

export const releaseObjectURL = (obj: unknown) => {
  revokeTrackedObjectUrl(obj);
};

export const releaseObjectURLs = (items: Array<unknown>) => {
  revokeTrackedObjectUrls(items);
};

export const releaseAllObjectURLs = () => {
  revokeAllTrackedObjectUrls();
};
