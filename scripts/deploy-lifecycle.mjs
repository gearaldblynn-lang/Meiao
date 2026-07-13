import { pathToFileURL } from 'node:url';

export const resolveDeployDrainCleanup = ({
  newProcessStarted,
  healthReady,
  newProcessStopped,
}) => {
  if (healthReady || !newProcessStarted || newProcessStopped) {
    return { stopNewProcess: false, releaseDrain: true };
  }
  return { stopNewProcess: true, releaseDrain: false };
};

const isTrue = (value) => String(value || '') === '1';

const run = () => {
  const decision = resolveDeployDrainCleanup({
    newProcessStarted: isTrue(process.argv[2]),
    healthReady: isTrue(process.argv[3]),
    newProcessStopped: isTrue(process.argv[4]),
  });
  process.stdout.write(decision.releaseDrain ? 'release\n' : 'retain\n');
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) run();
