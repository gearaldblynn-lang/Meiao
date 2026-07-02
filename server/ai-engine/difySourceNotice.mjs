export const DIFY_UPSTREAM_NOTICE = {
  repository: 'https://github.com/langgenius/dify.git',
  commit: '599d92ef6b59adcaffc82f5231391749fa1ef94c',
  license: 'Apache-2.0 with Dify additional conditions',
};

export const createDifySourceNotice = (paths = []) => ({
  ...DIFY_UPSTREAM_NOTICE,
  paths: Array.from(new Set((Array.isArray(paths) ? paths : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))),
});
