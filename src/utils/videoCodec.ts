export type Mp4VideoCodecInfo = {
  videoCodecs: string[];
  audioCodecs: string[];
};

const MP4_CONTAINER_ATOMS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
const HEVC_CODECS = new Set(['hvc1', 'hev1', 'hvc2', 'hev2', 'dvh1', 'dvhe']);
const REMOTE_CODEC_READ_BYTES = 2 * 1024 * 1024;

type Atom = {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
  end: number;
};

const toBytes = (input: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
};

const ascii4 = (bytes: Uint8Array, offset: number) => {
  if (offset + 4 > bytes.length) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
};

const readUint32 = (bytes: Uint8Array, offset: number) => {
  if (offset + 4 > bytes.length) return 0;
  return (
    bytes[offset] * 0x1000000
    + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  ) >>> 0;
};

const readUint64 = (bytes: Uint8Array, offset: number) => {
  const high = readUint32(bytes, offset);
  const low = readUint32(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : 0;
};

const readAtom = (bytes: Uint8Array, offset: number, limit = bytes.length): Atom | null => {
  if (offset + 8 > limit) return null;
  const smallSize = readUint32(bytes, offset);
  const type = ascii4(bytes, offset + 4);
  let size = smallSize;
  let headerSize = 8;
  if (smallSize === 1) {
    if (offset + 16 > limit) return null;
    size = readUint64(bytes, offset + 8);
    headerSize = 16;
  } else if (smallSize === 0) {
    size = limit - offset;
  }
  if (!Number.isFinite(size) || size < headerSize || offset + size > limit) return null;
  return { type, offset, size, headerSize, end: offset + size };
};

const walkAtoms = (bytes: Uint8Array, start: number, end: number, visitor: (atom: Atom) => void) => {
  let offset = start;
  while (offset + 8 <= end) {
    const atom = readAtom(bytes, offset, end);
    if (!atom) break;
    visitor(atom);
    offset = atom.end;
  }
};

const findHandlerType = (bytes: Uint8Array, start: number, end: number): string => {
  let handlerType = '';
  walkAtoms(bytes, start, end, (atom) => {
    const payloadStart = atom.offset + atom.headerSize;
    if (atom.type === 'hdlr' && payloadStart + 12 <= atom.end) {
      handlerType = ascii4(bytes, payloadStart + 8);
      return;
    }
    if (!handlerType && MP4_CONTAINER_ATOMS.has(atom.type)) {
      handlerType = findHandlerType(bytes, payloadStart, atom.end);
    }
  });
  return handlerType;
};

const collectSampleEntryTypes = (bytes: Uint8Array, start: number, end: number, output: string[]) => {
  walkAtoms(bytes, start, end, (atom) => {
    const payloadStart = atom.offset + atom.headerSize;
    if (atom.type === 'stsd') {
      const entryCount = readUint32(bytes, payloadStart + 4);
      let entryOffset = payloadStart + 8;
      for (let index = 0; index < entryCount && entryOffset + 8 <= atom.end; index += 1) {
        const entrySize = readUint32(bytes, entryOffset);
        const entryType = ascii4(bytes, entryOffset + 4);
        if (entryType) output.push(entryType);
        if (!Number.isFinite(entrySize) || entrySize < 8) break;
        entryOffset += entrySize;
      }
      return;
    }
    if (MP4_CONTAINER_ATOMS.has(atom.type)) {
      collectSampleEntryTypes(bytes, payloadStart, atom.end, output);
    }
  });
};

const collectTrackCodecs = (bytes: Uint8Array, start: number, end: number, output: Mp4VideoCodecInfo) => {
  walkAtoms(bytes, start, end, (atom) => {
    const payloadStart = atom.offset + atom.headerSize;
    if (atom.type === 'trak') {
      const handlerType = findHandlerType(bytes, payloadStart, atom.end);
      const entries: string[] = [];
      collectSampleEntryTypes(bytes, payloadStart, atom.end, entries);
      if (handlerType === 'vide') output.videoCodecs.push(...entries);
      if (handlerType === 'soun') output.audioCodecs.push(...entries);
      return;
    }
    if (MP4_CONTAINER_ATOMS.has(atom.type)) {
      collectTrackCodecs(bytes, payloadStart, atom.end, output);
    }
  });
};

export const parseMp4VideoCodecs = (input: ArrayBuffer | ArrayBufferView): Mp4VideoCodecInfo => {
  const bytes = toBytes(input);
  const output: Mp4VideoCodecInfo = { videoCodecs: [], audioCodecs: [] };
  collectTrackCodecs(bytes, 0, bytes.length, output);
  return {
    videoCodecs: Array.from(new Set(output.videoCodecs.filter(Boolean))),
    audioCodecs: Array.from(new Set(output.audioCodecs.filter(Boolean))),
  };
};

export const normalizeVideoCodec = (codec = '') =>
  String(codec || '').trim().toLowerCase().split('.')[0];

export const isBrowserUnsupportedVideoCodec = (codec = '') =>
  HEVC_CODECS.has(normalizeVideoCodec(codec));

export const getBrowserVideoCodecWarning = (codec = '') => (
  isBrowserUnsupportedVideoCodec(codec)
    ? '该视频是 HEVC/H.265 编码，当前浏览器可能只能播放音频或显示黑屏。请转成 H.264/AVC 编码的 MP4 后重新上传。'
    : ''
);

export const detectMp4VideoCodecFromBlob = async (blob: Blob): Promise<string> => {
  const mimeType = String(blob.type || '').toLowerCase();
  if (mimeType && !mimeType.includes('mp4') && !mimeType.includes('quicktime')) return '';
  const buffer = await blob.arrayBuffer();
  return parseMp4VideoCodecs(buffer).videoCodecs[0] || '';
};

export const detectRemoteMp4VideoCodec = async (url: string): Promise<string> => {
  const source = String(url || '').trim();
  if (!source) return '';
  const response = await fetch(source, {
    headers: { Range: `bytes=0-${REMOTE_CODEC_READ_BYTES - 1}` },
    cache: 'no-cache',
  });
  if (!response.ok && response.status !== 206) return '';
  const buffer = await response.arrayBuffer();
  return parseMp4VideoCodecs(buffer).videoCodecs[0] || '';
};
