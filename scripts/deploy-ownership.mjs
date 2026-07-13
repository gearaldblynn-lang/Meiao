import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER_FILE = 'owner';
const COMPLETION_FILE = 'remote-complete';
const HELPER_FILE = 'ownership-helper.mjs';

export const pathExists = (path) => existsSync(path);

const assertOwnerToken = (ownerToken) => {
  if (!/^[A-Za-z0-9._-]+$/.test(ownerToken || '')) {
    throw new Error('invalid deployment owner token');
  }
};

const ownerContent = (ownerToken) => `${ownerToken}\n`;

const readExact = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const restoreClaim = (claimPath, livePath) => {
  if (existsSync(livePath)) return false;
  renameSync(claimPath, livePath);
  return true;
};

export const verifyDeployMutex = ({ mutexDir, ownerToken }) => {
  assertOwnerToken(ownerToken);
  if (readExact(join(mutexDir, OWNER_FILE)) !== ownerContent(ownerToken)) {
    throw new Error('deployment mutex owner mismatch');
  }
  return true;
};

export const acquireDeployMutex = ({ mutexDir, ownerToken }) => {
  assertOwnerToken(ownerToken);
  try {
    mkdirSync(mutexDir, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('deployment mutex already exists');
    throw error;
  }

  try {
    writeFileSync(join(mutexDir, OWNER_FILE), ownerContent(ownerToken), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    try {
      rmdirSync(mutexDir);
    } catch {
      // Preserve non-empty state for manual inspection.
    }
    throw error;
  }
  return true;
};

export const recordRemoteMutationCompletion = ({ mutexDir, ownerToken }) => {
  verifyDeployMutex({ mutexDir, ownerToken });
  const completionFile = join(mutexDir, COMPLETION_FILE);
  const existing = readExact(completionFile);
  if (existing === ownerContent(ownerToken)) return true;
  if (existing !== null) throw new Error('remote completion owner mismatch');
  writeFileSync(completionFile, ownerContent(ownerToken), { flag: 'wx', mode: 0o600 });
  verifyDeployMutex({ mutexDir, ownerToken });
  return true;
};

export const releaseDeployMutex = ({
  mutexDir,
  ownerToken,
  mutationStarted = false,
  afterClaim,
}) => {
  verifyDeployMutex({ mutexDir, ownerToken });
  if (
    mutationStarted
    && readExact(join(mutexDir, COMPLETION_FILE)) !== ownerContent(ownerToken)
  ) {
    return { released: false, reason: 'completion_missing' };
  }

  const releaseDir = `${mutexDir}.release-${ownerToken}`;
  if (existsSync(releaseDir)) throw new Error('deployment mutex release claim already exists');
  renameSync(mutexDir, releaseDir);
  afterClaim?.();

  const claimedOwnerMatches = readExact(join(releaseDir, OWNER_FILE)) === ownerContent(ownerToken);
  const claimedCompletionMatches = !mutationStarted
    || readExact(join(releaseDir, COMPLETION_FILE)) === ownerContent(ownerToken);
  if (!claimedOwnerMatches || !claimedCompletionMatches) {
    const restored = restoreClaim(releaseDir, mutexDir);
    return { released: false, reason: 'claimed_owner_mismatch', restored };
  }

  const allowedFiles = new Set([
    OWNER_FILE,
    COMPLETION_FILE,
    HELPER_FILE,
  ]);
  const unexpectedFiles = readdirSync(releaseDir).filter((name) => !allowedFiles.has(name));
  if (unexpectedFiles.length > 0) {
    const restored = restoreClaim(releaseDir, mutexDir);
    return { released: false, reason: 'unexpected_mutex_state', restored };
  }

  for (const name of [COMPLETION_FILE, HELPER_FILE, OWNER_FILE]) {
    const path = join(releaseDir, name);
    if (existsSync(path)) unlinkSync(path);
  }
  rmdirSync(releaseDir);
  return { released: true };
};

export const createOwnedDeployMarker = ({ markerFile, mutexDir, ownerToken }) => {
  verifyDeployMutex({ mutexDir, ownerToken });
  try {
    writeFileSync(markerFile, ownerContent(ownerToken), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('deploy marker already exists');
    throw error;
  }
  verifyDeployMutex({ mutexDir, ownerToken });
  return true;
};

export const removeOwnedDeployMarker = ({
  markerFile,
  mutexDir,
  ownerToken,
  afterClaim,
}) => {
  verifyDeployMutex({ mutexDir, ownerToken });
  const quarantineFile = `${markerFile}.quarantine-${ownerToken}`;
  if (existsSync(quarantineFile)) throw new Error('deploy marker quarantine already exists');
  try {
    renameSync(markerFile, quarantineFile);
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed: false, reason: 'missing' };
    throw error;
  }
  afterClaim?.();

  try {
    verifyDeployMutex({ mutexDir, ownerToken });
  } catch (error) {
    restoreClaim(quarantineFile, markerFile);
    throw error;
  }

  if (readExact(quarantineFile) === ownerContent(ownerToken)) {
    unlinkSync(quarantineFile);
    return { removed: true };
  }

  const restored = restoreClaim(quarantineFile, markerFile);
  return { removed: false, reason: 'owner_mismatch', restored };
};

export const retainManualDeployMarker = ({ markerFile, mutexDir, ownerToken }) => {
  verifyDeployMutex({ mutexDir, ownerToken });
  const quarantineFile = `${markerFile}.manual-${ownerToken}`;
  if (existsSync(quarantineFile)) throw new Error('deploy marker manual claim already exists');

  try {
    renameSync(markerFile, quarantineFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    writeFileSync(markerFile, 'manual\n', { flag: 'wx', mode: 0o600 });
    verifyDeployMutex({ mutexDir, ownerToken });
    return { retained: true };
  }

  try {
    verifyDeployMutex({ mutexDir, ownerToken });
  } catch (error) {
    restoreClaim(quarantineFile, markerFile);
    throw error;
  }

  const claimedContent = readExact(quarantineFile);
  if (claimedContent === 'manual\n') {
    const restored = restoreClaim(quarantineFile, markerFile);
    return { retained: true, restored };
  }
  if (claimedContent !== ownerContent(ownerToken)) {
    const restored = restoreClaim(quarantineFile, markerFile);
    return { retained: false, reason: 'owner_mismatch', restored };
  }

  verifyDeployMutex({ mutexDir, ownerToken });
  try {
    writeFileSync(markerFile, 'manual\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    restoreClaim(quarantineFile, markerFile);
    throw error;
  }
  unlinkSync(quarantineFile);
  return { retained: true };
};

const readOption = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const runCli = () => {
  const [action, ...args] = process.argv.slice(2);
  const mutexDir = readOption(args, '--mutex-dir');
  const ownerToken = readOption(args, '--owner');
  const common = { mutexDir, ownerToken };
  let result;

  if (action === 'acquire-mutex') result = acquireDeployMutex(common);
  else if (action === 'verify-mutex') result = verifyDeployMutex(common);
  else if (action === 'complete-mutation') result = recordRemoteMutationCompletion(common);
  else if (action === 'release-mutex') {
    result = releaseDeployMutex({
      ...common,
      mutationStarted: readOption(args, '--mutation-started') === '1',
    });
    if (!result.released) throw new Error(`deployment mutex retained: ${result.reason}`);
  } else {
    const markerFile = readOption(args, '--marker-file');
    if (action === 'create-marker') {
      result = createOwnedDeployMarker({ ...common, markerFile });
    } else if (action === 'remove-marker') {
      result = removeOwnedDeployMarker({ ...common, markerFile });
      if (!result.removed && result.reason !== 'missing') {
        throw new Error(`deploy marker retained: ${result.reason}`);
      }
    } else if (action === 'retain-manual') {
      result = retainManualDeployMarker({ ...common, markerFile });
      if (!result.retained) throw new Error(`deploy marker retained unchanged: ${result.reason}`);
    } else {
      throw new Error(`unknown action: ${action || '<empty>'}`);
    }
  }

  if (result && typeof result === 'object') process.stdout.write(`${JSON.stringify(result)}\n`);
};

const isDirectExecution = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution || process.env.MEIAO_DEPLOY_OWNERSHIP_RUN === '1') {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
