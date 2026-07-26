const COMPILED_MODEL_REPLACE_MARKERS = Object.freeze([
  'R Role',
  'T Task',
  'C Constraint',
  'F Format',
  'E Example',
]);

export const isCompiledModelReplacePrompt = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return COMPILED_MODEL_REPLACE_MARKERS.every((marker) => (
    new RegExp(`(?:^|\\n)\\s*${marker}(?:\\s|$)`, 'm').test(text)
  ));
};

export const normalizeModelReplaceRawUserPrompt = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '模特替换' || isCompiledModelReplacePrompt(text) ? '' : text;
};
