export interface ShellRuntimeEntityLike {
  id: string;
  backendJobId?: string | null;
}

const entityKey = (entity: ShellRuntimeEntityLike) =>
  entity.backendJobId ? `job:${entity.backendJobId}` : `id:${entity.id}`;

const entityKeys = (entity: ShellRuntimeEntityLike) => {
  const keys = new Set<string>();
  const id = String(entity.id || '').trim();
  const backendJobId = String(entity.backendJobId || '').trim();
  if (id) {
    keys.add(`id:${id}`);
    if (id.startsWith('job-') && id.length > 4) keys.add(`job:${id.slice(4)}`);
  }
  if (backendJobId) keys.add(`job:${backendJobId}`);
  return Array.from(keys);
};

export const mergeShellRuntimeEntities = <T extends ShellRuntimeEntityLike>(
  primary: T[],
  secondary: T[],
): T[] => {
  const byKey = new Map<string, T>();
  const aliasToKey = new Map<string, string>();
  [...primary, ...secondary].forEach((entity) => {
    const keys = entityKeys(entity);
    const canonicalKey = keys.find((key) => aliasToKey.has(key))
      ? aliasToKey.get(keys.find((key) => aliasToKey.has(key)) as string) as string
      : (keys[0] || entityKey(entity));
    keys.forEach((key) => aliasToKey.set(key, canonicalKey));
    byKey.set(canonicalKey, entity);
  });
  return Array.from(byKey.values());
};
