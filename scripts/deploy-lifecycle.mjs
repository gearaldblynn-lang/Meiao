import { pathToFileURL } from 'node:url';

export const resolveDeployDrainCleanup = ({
  oldProcessStopped,
  oldProcessStopAttempted,
  newProcessStarted,
  healthReady,
  newProcessStopped,
}) => {
  const oldProcessMayBeStopped = oldProcessStopped || oldProcessStopAttempted;
  const serviceDown = Boolean(oldProcessMayBeStopped && !newProcessStarted && !healthReady);
  if (healthReady || newProcessStopped) {
    return { stopNewProcess: false, releaseDrain: true, serviceDown: false };
  }
  if (serviceDown) {
    return { stopNewProcess: false, releaseDrain: false, serviceDown: true };
  }
  if (!newProcessStarted) {
    return { stopNewProcess: false, releaseDrain: true, serviceDown: false };
  }
  return { stopNewProcess: true, releaseDrain: false, serviceDown: false };
};

export const isSuccessfulPm2StoppedStatus = ({ commandSucceeded, output }) => {
  if (!commandSucceeded) return false;
  const pids = String(output || '').trim().split(/\s+/).filter(Boolean);
  return pids.length > 0 && pids.every((pid) => /^0+$/.test(pid));
};

const isTrue = (value) => String(value || '') === '1';

const run = () => {
  const action = String(process.argv[2] || '');
  if (action === 'pm2-stopped') {
    process.exitCode = isSuccessfulPm2StoppedStatus({
      commandSucceeded: true,
      output: process.argv[3],
    }) ? 0 : 1;
    return;
  }
  if (action !== 'cleanup') {
    process.stderr.write('deploy-lifecycle action must be cleanup or pm2-stopped.\n');
    process.exitCode = 2;
    return;
  }
  const decision = resolveDeployDrainCleanup({
    oldProcessStopped: isTrue(process.argv[3]),
    oldProcessStopAttempted: isTrue(process.argv[4]),
    newProcessStarted: isTrue(process.argv[5]),
    healthReady: isTrue(process.argv[6]),
    newProcessStopped: isTrue(process.argv[7]),
  });
  process.stdout.write(decision.releaseDrain ? 'release\n' : 'retain\n');
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) run();
