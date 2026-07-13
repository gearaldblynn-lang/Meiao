import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER_FILE = 'owner';
const COMPLETION_FILE = 'remote-complete';
const HELPER_FILE = 'ownership-helper.mjs';

export const pathExists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

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

const createPrivateClaim = ({ livePath, purpose }) => {
  const claimParent = mkdtempSync(join(
    dirname(livePath),
    `.${basename(livePath)}.${purpose}-`,
  ));
  const claimPath = join(claimParent, 'claimed');
  try {
    renameSync(livePath, claimPath);
  } catch (error) {
    rmdirSync(claimParent);
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  return { claimParent, claimPath };
};

const removeFileClaim = ({ claimParent, claimPath }) => {
  unlinkSync(claimPath);
  rmdirSync(claimParent);
};

const restoreFileClaim = ({ claimParent, claimPath, livePath }) => {
  try {
    writeFileSync(livePath, readFileSync(claimPath), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
  removeFileClaim({ claimParent, claimPath });
  return true;
};

const restoreMutexClaim = ({ claimParent, claimPath, mutexDir }) => {
  let entries;
  try {
    entries = readdirSync(claimPath);
    for (const name of entries) readFileSync(join(claimPath, name));
    mkdirSync(mutexDir, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    return false;
  }

  try {
    for (const name of entries) {
      writeFileSync(join(mutexDir, name), readFileSync(join(claimPath, name)), {
        flag: 'wx',
        mode: 0o600,
      });
    }
  } catch {
    // Keep both the private claim and any partial exclusive restore for inspection.
    return false;
  }

  for (const name of entries) unlinkSync(join(claimPath, name));
  rmdirSync(claimPath);
  rmdirSync(claimParent);
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

  const claim = createPrivateClaim({ livePath: mutexDir, purpose: 'release' });
  if (!claim) return { released: false, reason: 'mutex_missing' };
  const { claimParent, claimPath } = claim;
  afterClaim?.(claim);

  const claimedOwnerMatches = readExact(join(claimPath, OWNER_FILE)) === ownerContent(ownerToken);
  const claimedCompletionMatches = !mutationStarted
    || readExact(join(claimPath, COMPLETION_FILE)) === ownerContent(ownerToken);
  if (!claimedOwnerMatches || !claimedCompletionMatches) {
    const restored = restoreMutexClaim({ claimParent, claimPath, mutexDir });
    return {
      released: false,
      reason: 'claimed_owner_mismatch',
      restored,
      ...(!restored && { claimParent, claimPath }),
    };
  }

  const allowedFiles = new Set([
    OWNER_FILE,
    COMPLETION_FILE,
    HELPER_FILE,
  ]);
  const entries = readdirSync(claimPath);
  const unexpectedFiles = entries.filter((name) => !allowedFiles.has(name));
  if (unexpectedFiles.length > 0) {
    const restored = restoreMutexClaim({ claimParent, claimPath, mutexDir });
    return {
      released: false,
      reason: 'unexpected_mutex_state',
      restored,
      ...(!restored && { claimParent, claimPath }),
    };
  }

  for (const name of entries) unlinkSync(join(claimPath, name));
  rmdirSync(claimPath);
  rmdirSync(claimParent);
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
  const claim = createPrivateClaim({ livePath: markerFile, purpose: 'quarantine' });
  if (!claim) return { removed: false, reason: 'missing' };
  const { claimParent, claimPath } = claim;
  afterClaim?.(claim);

  try {
    verifyDeployMutex({ mutexDir, ownerToken });
  } catch (error) {
    restoreFileClaim({ claimParent, claimPath, livePath: markerFile });
    throw error;
  }

  if (readExact(claimPath) === ownerContent(ownerToken)) {
    removeFileClaim({ claimParent, claimPath });
    return { removed: true };
  }

  const restored = restoreFileClaim({ claimParent, claimPath, livePath: markerFile });
  return {
    removed: false,
    reason: 'owner_mismatch',
    restored,
    ...(!restored && { claimParent, claimPath }),
  };
};

export const retainManualDeployMarker = ({ markerFile, mutexDir, ownerToken }) => {
  verifyDeployMutex({ mutexDir, ownerToken });
  const claim = createPrivateClaim({ livePath: markerFile, purpose: 'manual' });
  if (!claim) {
    writeFileSync(markerFile, 'manual\n', { flag: 'wx', mode: 0o600 });
    verifyDeployMutex({ mutexDir, ownerToken });
    return { retained: true };
  }
  const { claimParent, claimPath } = claim;

  try {
    verifyDeployMutex({ mutexDir, ownerToken });
  } catch (error) {
    restoreFileClaim({ claimParent, claimPath, livePath: markerFile });
    throw error;
  }

  const claimedContent = readExact(claimPath);
  if (claimedContent === 'manual\n') {
    const restored = restoreFileClaim({ claimParent, claimPath, livePath: markerFile });
    return restored
      ? { retained: true, restored: true }
      : { retained: false, reason: 'restore_blocked', restored: false, claimParent, claimPath };
  }
  if (claimedContent !== ownerContent(ownerToken)) {
    const restored = restoreFileClaim({ claimParent, claimPath, livePath: markerFile });
    return {
      retained: false,
      reason: 'owner_mismatch',
      restored,
      ...(!restored && { claimParent, claimPath }),
    };
  }

  verifyDeployMutex({ mutexDir, ownerToken });
  try {
    writeFileSync(markerFile, 'manual\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return {
      retained: false,
      reason: 'live_marker_exists',
      restored: false,
      claimParent,
      claimPath,
    };
  }
  removeFileClaim({ claimParent, claimPath });
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
