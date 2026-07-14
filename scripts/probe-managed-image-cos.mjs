import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadServerEnvFile } from '../server/envLoader.mjs';
import {
  createTencentCosImageReadUrl,
  deleteTencentCosImage,
  headTencentCosImage,
  putTencentCosImage,
} from '../server/tencentCosImageStore.mjs';

const DEFAULT_PROBE_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const defaultDeps = {
  randomId: () => randomBytes(12).toString('hex'),
  putImage: putTencentCosImage,
  headImage: headTencentCosImage,
  createReadUrl: createTencentCosImageReadUrl,
  fetchUrl: globalThis.fetch,
  deleteImage: deleteTencentCosImage,
};

const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const runManagedImageCosProbe = async ({
  env = process.env,
  imageBytes = DEFAULT_PROBE_IMAGE,
  writeLine = (line) => console.log(line),
  deps = {},
} = {}) => {
  const operations = { ...defaultDeps, ...deps };
  const probeId = String(operations.randomId()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  requireCondition(probeId, 'managed image COS probe id is empty');
  const storageKey = `managed-images/users/_probe/source/${probeId}/probe.png`;
  const expectedBytes = Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes || []);
  let objectCreated = false;
  let cleanupVerified = false;
  const report = (step) => writeLine(`${step}: ok`);

  try {
    await operations.putImage({
      storageKey,
      fileBuffer: expectedBytes,
      mimeType: 'image/png',
    }, env);
    objectCreated = true;
    report('put');

    const uploadedHead = await operations.headImage(storageKey, env);
    requireCondition(uploadedHead?.exists, 'managed image COS probe head did not find the uploaded object');
    report('head');

    const signedUrl = await operations.createReadUrl(storageKey, 'browser', env);
    const response = await operations.fetchUrl(signedUrl, { redirect: 'follow' });
    requireCondition(response?.ok, `managed image COS probe signed GET failed with HTTP ${Number(response?.status || 0)}`);
    const receivedBytes = Buffer.from(await response.arrayBuffer());
    requireCondition(receivedBytes.equals(expectedBytes), 'managed image COS probe byte equality verification failed');
    report('signed-get-byte-equality');

    await operations.deleteImage(storageKey, env);
    report('delete');
    const deletedHead = await operations.headImage(storageKey, env);
    requireCondition(!deletedHead?.exists, 'managed image COS probe object still exists after delete');
    cleanupVerified = true;
    report('head-not-found');

    return {
      ok: true,
      steps: ['put', 'head', 'signed-get-byte-equality', 'delete', 'head-not-found'],
    };
  } finally {
    if (objectCreated && !cleanupVerified) {
      await operations.deleteImage(storageKey, env).catch(() => null);
    }
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  loadServerEnvFile({ envPath: path.resolve('.env.server') });
  loadServerEnvFile({ envPath: path.resolve('.env.local') });
  runManagedImageCosProbe()
    .then(() => {
      console.log('managed image COS probe: PASS');
    })
    .catch((error) => {
      console.error(`managed image COS probe: FAIL (${String(error?.message || 'unknown error')})`);
      process.exitCode = 1;
    });
}
