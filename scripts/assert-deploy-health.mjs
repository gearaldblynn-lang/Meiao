import { pathToFileURL } from 'node:url';

export const isDeployHealthReady = (health) => (
  health?.ok === true
  && health?.worker?.healthy === true
  && health?.managedImageUpload?.ready === true
  && health?.tombstonedJobCleanup?.alerting === false
  && Number(health?.tombstonedJobCleanup?.lastCycleAt || 0) > 0
);

const run = async () => {
  let body = '';
  for await (const chunk of process.stdin) body += chunk;
  const health = JSON.parse(body);
  if (!isDeployHealthReady(health)) {
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
