export const extractShellSchemeField = (scheme: string, labels: string[]) => {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = scheme.match(new RegExp(`(?:^|\\n)\\s*-?\\s*${escaped}\\s*[：:]\\s*([^\\n]+(?:\\n(?!\\s*-?\\s*[^\\n：:]{1,18}\\s*[：:]).+)*)`, 'u'));
    if (match?.[1]) return match[1].trim();
  }
  return '';
};
