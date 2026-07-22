import { pathToFileURL } from 'node:url';

export const isDeployHealthReady = (health, {
  expectedReleaseId = '',
  requireDrainedWrites = false,
} = {}) => (
  health?.ok === true
  && (!expectedReleaseId || health?.release?.id === expectedReleaseId)
  && (!requireDrainedWrites || (
    health?.deployment?.active === true
    && health?.deployment?.activeWriteRequests === 0
  ))
  && health?.worker?.healthy === true
  && health?.managedImageUpload?.ready === true
  && Number(health?.tombstonedJobCleanup?.lastCycleAt || 0) > 0
  && Number.isFinite(health?.tombstonedJobCleanup?.errors)
  && health.tombstonedJobCleanup.errors === 0
);

const run = async () => {
  let body = '';
  for await (const chunk of process.stdin) body += chunk;
  const health = JSON.parse(body);
  const releaseIdIndex = process.argv.indexOf('--release-id');
  const expectedReleaseId = releaseIdIndex >= 0
    ? String(process.argv[releaseIdIndex + 1] || '').trim()
    : '';
  const requireDrainedWrites = process.argv.includes('--drained');
  if (!isDeployHealthReady(health, { expectedReleaseId, requireDrainedWrites })) {
    console.error(JSON.stringify(health));
    process.exitCode = 2;
  }
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) {
  try {
    await run();
  } catch (error) {
    console.error(`部署健康检查失败：${error?.message || String(error || '')}`);
    process.exitCode = 2;
  }
}
