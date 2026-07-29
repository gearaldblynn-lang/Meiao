const toSiteKey = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const port = parsed.port ? `:${parsed.port}` : '';
    return hostname ? `${parsed.protocol}//${hostname}${port}` : '';
  } catch {
    return '';
  }
};

export const buildManagedAssetProxyAuthHeaders = (remoteUrl, options = {}) => {
  const authorization = String(options.authorization || '').trim();
  if (!/^Bearer\s+\S+$/i.test(authorization)) return {};

  let parsedRemote;
  try {
    parsedRemote = new URL(String(remoteUrl || '').trim());
  } catch {
    return {};
  }
  if (!parsedRemote.pathname.startsWith('/api/assets/file/')) return {};

  const remoteSite = toSiteKey(parsedRemote.toString());
  const trustedSites = new Set([
    toSiteKey(options.publicBaseUrl),
    toSiteKey(options.requestBaseUrl),
  ].filter(Boolean));
  if (!remoteSite || !trustedSites.has(remoteSite)) return {};

  return { Authorization: authorization };
};
