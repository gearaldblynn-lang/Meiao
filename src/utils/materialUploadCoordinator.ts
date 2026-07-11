export interface MaterialUploadCoordinator {
  run: (key: string, upload: () => Promise<string>) => Promise<string>;
  size: () => number;
}

export const createMaterialUploadCoordinator = (): MaterialUploadCoordinator => {
  const inFlight = new Map<string, Promise<string>>();
  const completed = new Map<string, string>();

  return {
    run(key, upload) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return upload();
      const completedUrl = completed.get(normalizedKey);
      if (completedUrl) return Promise.resolve(completedUrl);
      const existing = inFlight.get(normalizedKey);
      if (existing) return existing;

      let request: Promise<string>;
      request = Promise.resolve()
        .then(upload)
        .then((url) => {
          if (url) completed.set(normalizedKey, url);
          return url;
        })
        .finally(() => {
          if (inFlight.get(normalizedKey) === request) {
            inFlight.delete(normalizedKey);
          }
        });
      inFlight.set(normalizedKey, request);
      return request;
    },
    size: () => inFlight.size,
  };
};
