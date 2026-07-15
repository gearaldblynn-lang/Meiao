import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadServerEnvFile } from '../server/envLoader.mjs';
import { writeManagedImageProbeStatus } from '../server/managedImageUploadHealth.mjs';
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
  requireCondition(
    String(env?.MEIAO_MANAGED_IMAGE_UPLOAD_MODE || '').trim().toLowerCase() === 'cos',
    'managed image upload mode must be cos before running the production probe',
  );
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

export const runManagedImageCosProbeCli = async ({
  runProbe = runManagedImageCosProbe,
  writeLine = (line) => console.log(line),
  writeError = (line) => console.error(line),
  startKeepAlive = () => setInterval(() => {}, 1_000),
  stopKeepAlive = (handle) => clearInterval(handle),
  recordResult = ({ ok, errorCode = '' }) => writeManagedImageProbeStatus({
    env: process.env,
    ok,
    errorCode,
  }),
} = {}) => {
  // COS retries intentionally use unref'd timers so server shutdown is not held open.
  // A standalone probe has no server handles, so keep the CLI alive until the awaited
  // lifecycle either completes or reports a real failure.
  const keepAliveHandle = startKeepAlive();
  try {
    await runProbe();
    await recordResult({ ok: true });
    writeLine('managed image COS probe: PASS');
    return true;
  } catch (error) {
    try {
      await recordResult({ ok: false, errorCode: error?.code || 'probe_failed' });
    } catch (statusError) {
      writeError(`managed image COS readiness status write failed (${String(statusError?.message || 'unknown error')})`);
    }
    writeError(`managed image COS probe: FAIL (${String(error?.message || 'unknown error')})`);
    return false;
  } finally {
    stopKeepAlive(keepAliveHandle);
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  loadServerEnvFile({ envPath: path.resolve('.env.server') });
  loadServerEnvFile({ envPath: path.resolve('.env.local') });
  const ok = await runManagedImageCosProbeCli();
  if (!ok) process.exitCode = 1;
}
