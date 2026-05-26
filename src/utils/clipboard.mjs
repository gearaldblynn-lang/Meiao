export const copyTextToClipboard = async (value, env = globalThis) => {
  const text = String(value || '');
  if (!text) return false;

  const clipboard = env?.navigator?.clipboard;
  if (clipboard?.writeText) {
    const copied = await clipboard.writeText(text).then(() => true).catch(() => false);
    if (copied) return true;
  }

  const documentRef = env?.document;
  if (!documentRef?.createElement || !documentRef?.body?.appendChild || !documentRef?.execCommand) {
    return false;
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute?.('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';

  try {
    documentRef.body.appendChild(textarea);
    textarea.select?.();
    return Boolean(documentRef.execCommand('copy'));
  } catch {
    return false;
  } finally {
    textarea.remove?.();
  }
};
