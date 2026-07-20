let fallbackSequence = 0;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const createRuntimeId = (prefix = '', options = {}) => {
  const cryptoObject = hasOwn(options, 'cryptoObject')
    ? options.cryptoObject
    : globalThis.crypto;
  const randomUUID = cryptoObject?.randomUUID;
  if (typeof randomUUID === 'function') {
    try {
      const uuid = String(randomUUID.call(cryptoObject) || '').trim();
      if (uuid) return `${String(prefix || '')}${uuid}`;
    } catch {
      // Older or restricted browsers can expose randomUUID without supporting calls.
    }
  }

  fallbackSequence += 1;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const timestampPart = Math.max(0, Number(now()) || 0).toString(36);
  const sequencePart = fallbackSequence.toString(36);
  const randomPart = String(random().toString(36).slice(2) || '0').replace(/[^a-z0-9]/gi, '') || '0';
  return `${String(prefix || '')}${timestampPart}-${sequencePart}-${randomPart}`;
};
