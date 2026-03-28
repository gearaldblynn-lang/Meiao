const GENERIC_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const EXTENSION_MIME_MAP = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
]);

const hasSignature = (bytes, signature, offset = 0) => signature.every((value, index) => bytes[offset + index] === value);

const inferMimeTypeFromBytes = async (blob) => {
  if (!(blob instanceof Blob) || blob.size === 0) return '';
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());

  if (hasSignature(header, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (hasSignature(header, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (hasSignature(header, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';

  const riff = hasSignature(header, [0x52, 0x49, 0x46, 0x46]);
  const webp = hasSignature(header, [0x57, 0x45, 0x42, 0x50], 8);
  if (riff && webp) return 'image/webp';

  const ftyp = hasSignature(header, [0x66, 0x74, 0x79, 0x70], 4);
  if (ftyp) {
    const brand = String.fromCharCode(...header.slice(8, 12));
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
  }

  return '';
};

const inferMimeTypeFromUrl = (sourceUrl = '') => {
  try {
    const { pathname } = new URL(String(sourceUrl || ''));
    const lowerPath = pathname.toLowerCase();
    for (const [extension, mimeType] of EXTENSION_MIME_MAP.entries()) {
      if (lowerPath.endsWith(extension)) return mimeType;
    }
  } catch {
    return '';
  }
  return '';
};

export const normalizeFetchedImageBlob = async (blob, sourceUrl = '') => {
  if (!(blob instanceof Blob)) return blob;
  if (!GENERIC_MIME_TYPES.has(String(blob.type || '').trim().toLowerCase())) {
    return blob;
  }

  const inferredMimeType = (await inferMimeTypeFromBytes(blob)) || inferMimeTypeFromUrl(sourceUrl) || 'image/png';
  return new Blob([blob], { type: inferredMimeType });
};
