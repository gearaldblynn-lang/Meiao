import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const extractRemoteShellFunction = (source, name) => {
  const start = source.indexOf(`    ${name}() {`);
  const end = source.indexOf('\n    }\n', start);
  assert.ok(start >= 0 && end > start, `${name} must exist in the remote deploy shell`);
  return source
    .slice(start, end + '\n    }'.length)
    .replace(/^    /gm, '')
    .replaceAll('\\$', '$')
    .replaceAll('\\"', '"');
};

test('deploy_tencent keeps inner quotes escaped inside the remote SSH payload', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes('| ssh ') && line.endsWith(' "'));
  const end = lines.findIndex((line, index) => index > start && line === '  "');

  assert.ok(start >= 0 && end > start, 'remote SSH payload boundaries must exist');

  const unescaped = [];
  for (let index = start + 1; index < end; index += 1) {
    for (let offset = 0; offset < lines[index].length; offset += 1) {
      if (lines[index][offset] === '"' && lines[index][offset - 1] !== '\\') {
        unescaped.push(`${index + 1}:${offset + 1}`);
      }
    }
  }

  assert.deepEqual(unescaped, [], `remote payload has unescaped quotes at ${unescaped.join(', ')}`);

  const decoded = lines
    .slice(start + 1, end)
    .join('\n')
    .replaceAll('\\"', '"')
    .replaceAll('\\$', '$');
  const syntax = spawnSync('bash', ['-n'], { input: decoded, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('deploy_tencent preserves remote server data directory', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');

  assert.match(
    source,
    /! -name 'server'/,
    'deploy script should avoid deleting the remote server directory root'
  );
  assert.match(
    source,
    /! -name 'data'/,
    'deploy script should preserve remote persisted server data'
  );
});

test('deploy_tencent reuses a persistent remote FFmpeg binary during dependency installation', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');

  assert.match(
    source,
    /REMOTE_FFMPEG_BIN="\$\{MEIAO_REMOTE_FFMPEG_BIN:-\/opt\/meiao\/bin\/ffmpeg\}"/,
    'deploy should expose a configurable persistent FFmpeg path',
  );
  assert.match(source, /if \[ -x '\$REMOTE_FFMPEG_BIN' \]; then/);
  assert.match(source, /FFMPEG_BIN='\$REMOTE_FFMPEG_BIN' npm install/);
  assert.match(source, /else\n\s+npm install\n\s+fi/);
});

test('deploy_tencent blocks releases with high severity dependency vulnerabilities', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(
    packageJson.scripts['security:audit'],
    'npm audit --audit-level=high --omit=dev',
    'package.json should expose the release security audit command'
  );

  const installIndex = source.indexOf('npm install');
  const auditIndex = source.indexOf('npm run security:audit');
  const buildIndex = source.indexOf('npm run build');

  assert.ok(installIndex >= 0, 'deploy script should install dependencies');
  assert.ok(auditIndex > installIndex, 'deploy script should audit after installing dependencies');
  assert.ok(buildIndex > auditIndex, 'deploy script should block before building unsafe dependencies');
  assert.match(source, /run_security_audit_with_retry\(\)/);
  assert.match(source, /if npm run security:audit; then/);
  assert.match(source, /npm ls --omit=dev --depth=0/);
  assert.match(source, /run_security_audit_with_retry\n/);
});

test('deploy_tencent refuses to restart while cloud jobs are running', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');

  const initialReadinessIndex = source.indexOf('\nrun_remote_deploy_readiness\n');
  const archiveIndex = source.indexOf('tar \\\n');
  const finalReadinessIndex = source.lastIndexOf('node scripts/check-deploy-readiness.mjs');
  const finalEnvGuardIndex = source.lastIndexOf("if [ ! -f '.env.server' ]");
  const finalEnvLoadIndex = source.lastIndexOf('source .env.server');
  const restartIndex = source.indexOf('pm2 restart meiao-internal --update-env');

  assert.ok(initialReadinessIndex >= 0, 'deploy must define and invoke the cloud readiness preflight');
  assert.ok(initialReadinessIndex < archiveIndex, 'initial readiness must run before uploading or replacing code');
  assert.ok(finalReadinessIndex >= 0, 'deploy must recheck readiness after the remote build');
  assert.ok(finalEnvGuardIndex < finalReadinessIndex, 'final readiness must verify .env.server first');
  assert.ok(finalEnvLoadIndex < finalReadinessIndex, 'final readiness must load database settings first');
  assert.ok(finalReadinessIndex < restartIndex, 'final readiness must run immediately before PM2 restart');
  assert.match(source, /MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS/);
});

test('deploy_tencent rejects any remote marker, including an empty file, before source upload', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const functionStart = source.indexOf('run_remote_deploy_readiness() {');
  const functionEnd = source.indexOf('\n}\n\nrun_remote_deploy_readiness', functionStart);
  const preflight = source.slice(functionStart, functionEnd);
  const envLoadIndex = preflight.indexOf('source .env.server');
  const markerResolveIndex = preflight.indexOf('MEIAO_DEPLOY_DRAIN_FILE');
  const markerExistenceIndex = preflight.indexOf('[ -e \\"\\$DRAIN_MARKER_FILE\\" ]');
  const invocationIndex = source.indexOf('\nrun_remote_deploy_readiness\n', functionEnd);
  const archiveIndex = source.indexOf('tar \\\n');

  assert.ok(envLoadIndex >= 0, 'preflight must source the remote environment');
  assert.ok(markerResolveIndex > envLoadIndex, 'custom drain marker path must resolve after env load');
  assert.ok(markerExistenceIndex > markerResolveIndex, 'marker existence must be checked before readiness');
  assert.match(preflight, /\[ -e \\"\\\$DRAIN_MARKER_FILE\\" \]/);
  assert.doesNotMatch(preflight, /DRAIN_MARKER_CONTENT/);
  assert.match(preflight, /ownership-helper\.mjs' verify-mutex/);
  assert.ok(invocationIndex >= 0 && invocationIndex < archiveIndex, 'marker preflight must run before upload');
  const finalMarkerCheckIndex = source.lastIndexOf('if [ -e \\"\\$DRAIN_MARKER_FILE\\" ]');
  assert.ok(finalMarkerCheckIndex > archiveIndex, 'deploy must keep a final marker-existence race check after upload');
});

test('deploy_tencent holds an owner-checked remote mutex across readiness and upload', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const ownershipSource = readFileSync(new URL('./deploy-ownership.mjs', import.meta.url), 'utf8');
  const acquireStart = source.indexOf('acquire_remote_deploy_mutex() {');
  const acquireEnd = source.indexOf('\n}\n', acquireStart);
  const acquire = source.slice(acquireStart, acquireEnd);
  const releaseStart = source.indexOf('release_remote_deploy_mutex() {');
  const releaseEnd = source.indexOf('\n}\n', releaseStart);
  const release = source.slice(releaseStart, releaseEnd);
  const acquireInvocation = source.indexOf('\nacquire_remote_deploy_mutex\n');
  const readinessInvocation = source.indexOf('\nrun_remote_deploy_readiness\n');
  const verifyInvocation = source.indexOf('\nverify_remote_deploy_mutex\n', readinessInvocation);
  const archiveIndex = source.indexOf('tar \\\n');

  assert.match(acquire, /acquire-mutex[\s\S]*DEPLOY_OWNER_TOKEN/);
  assert.match(ownershipSource, /mkdirSync\(mutexDir/);
  assert.match(ownershipSource, /flag: 'wx'/);
  assert.match(source, /trap cleanup_remote_deploy_mutex EXIT/);
  assert.ok(acquireInvocation >= 0 && acquireInvocation < readinessInvocation);
  assert.ok(readinessInvocation < verifyInvocation && verifyInvocation < archiveIndex);

  assert.match(release, /release-mutex/);
  assert.match(release, /--mutation-started '\$REMOTE_MUTATION_STARTED'/);
  assert.match(ownershipSource, /mkdtempSync\(join\(/);
  assert.match(ownershipSource, /renameSync\(livePath, claimPath\)/);
  assert.match(ownershipSource, /mkdirSync\(mutexDir, \{ mode: 0o700 \}\)/);
  assert.doesNotMatch(release, /rm -f '\$REMOTE_DEPLOY_MUTEX_DIR\/owner'/);
});

test('deploy_tencent re-verifies mutex ownership before remote mutation and cutover', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const ownerChecks = [...source.matchAll(/\n    assert_remote_deploy_mutex_owner\n/g)]
    .map((match) => match.index);
  const sourceMutationIndex = source.indexOf("find '$REMOTE_APP_DIR'");
  const cutoverIndex = source.indexOf('# 原子切换:');

  assert.ok(ownerChecks.length >= 3, 'owner must be checked at upload, source replacement and cutover');
  assert.ok(ownerChecks[0] < sourceMutationIndex);
  assert.ok(ownerChecks.some((index) => index > sourceMutationIndex && index < cutoverIndex));
  assert.ok(ownerChecks.at(-1) < cutoverIndex);
});

test('deploy_tencent uses a bootstrap network drain before the lock holder stops the old process', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const lockHolderSource = readFileSync(new URL('./hold-deploy-drain.mjs', import.meta.url), 'utf8');
  const networkIndex = source.indexOf('node scripts/backend-network-drain.mjs enter');
  const markerIndex = source.indexOf('\n    write_owned_deploy_marker\n');
  const bootstrapLockIndex = source.indexOf('node scripts/hold-deploy-drain.mjs');
  const stoppedAckIndex = source.indexOf('--stopped-file');
  const restartIndex = source.indexOf('pm2 restart meiao-internal --update-env');
  const networkReleaseIndex = source.indexOf('\n    disable_network_drain\n', restartIndex);
  const healthIndex = source.indexOf('/api/health');
  const cleanupIndex = source.lastIndexOf('\n    remove_owned_deploy_marker\n');

  assert.ok(networkIndex >= 0, 'bootstrap drain must block NEW backend connections');
  assert.ok(networkIndex < markerIndex, 'network gate must protect the old marker-unaware process first');
  assert.ok(markerIndex >= 0, 'deploy must create the application-visible drain marker');
  assert.ok(bootstrapLockIndex > markerIndex, 'bootstrap DB lock must follow the marker');
  assert.ok(stoppedAckIndex > bootstrapLockIndex, 'deploy must wait for the lock holder stopped acknowledgement');
  assert.match(lockHolderSource, /stopOldProcessWithLockVerification/);
  assert.match(lockHolderSource, /SELECT 1 AS lock_session_alive/);
  assert.ok(restartIndex > stoppedAckIndex, 'new process starts only after the lock holder acknowledges stop');
  assert.ok(networkReleaseIndex > restartIndex, 'network gate remains until marker-aware code starts');
  assert.ok(networkReleaseIndex < healthIndex, 'network gate opens only to run health while marker remains');
  assert.ok(healthIndex > restartIndex, 'drain remains active until health is checked');
  assert.ok(cleanupIndex > healthIndex, 'drain marker is removed only after health passes');
  assert.match(source, /DRAIN_CLEANUP_ARMED=1/);
  assert.match(source, /MEIAO_DEPLOY_DRAIN_FILE/);
});

test('deploy_tencent proves managed image COS readiness before entering the drain', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const buildIndex = source.indexOf('npm run build -- --outDir dist-next');
  const probeIndex = source.indexOf('npm run probe:managed-image-cos');
  const finalReadinessIndex = source.indexOf(
    "MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' node scripts/check-deploy-readiness.mjs",
  );
  const networkDrainIndex = source.indexOf('node scripts/backend-network-drain.mjs enter');

  assert.ok(buildIndex >= 0, 'remote build must exist');
  assert.ok(probeIndex > buildIndex, 'COS probe must run after the new source is installed and built');
  assert.ok(finalReadinessIndex > probeIndex, 'job readiness must be rechecked after the COS probe');
  assert.ok(networkDrainIndex > finalReadinessIndex, 'COS probe must pass before any network drain');
});

test('deploy_tencent keeps the drain on failed health until the new process is verified stopped', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const ownershipSource = readFileSync(new URL('./deploy-ownership.mjs', import.meta.url), 'utf8');
  const cleanup = source.match(/cleanup_deploy_drain\(\) \{[\s\S]*?\n    \}/)?.[0] || '';

  assert.match(cleanup, /NEW_PROCESS_STARTED/);
  assert.match(cleanup, /HEALTH_READY/);
  assert.match(cleanup, /enable_network_drain \|\| true/);
  assert.match(cleanup, /pm2 stop meiao-internal/);
  assert.match(cleanup, /pm2 pid meiao-internal/);
  assert.doesNotMatch(cleanup, /pm2 pid meiao-internal[^\n]*\|\| true/);
  assert.match(cleanup, /if PM2_PID_OUTPUT=\\\$\(pm2 pid meiao-internal/);
  assert.match(cleanup, /pm2-stopped/);
  assert.match(cleanup, /OLD_PROCESS_STOPPED/);
  assert.match(cleanup, /retain_deploy_drain/);
  assert.match(source, /retain-manual/);
  assert.match(ownershipSource, /writeFileSync\(markerFile, 'manual\\n', \{ flag: 'wx'/);
  assert.match(cleanup, /服务已停止/);
  assert.match(cleanup, /node scripts\/deploy-lifecycle\.mjs/);
  assert.match(cleanup, /RELEASE_DRAIN/);
  assert.match(cleanup, /if \[ \\"\\\$RELEASE_DRAIN\\" = '1' \]/);
  assert.match(cleanup, /保留维护门禁/);
});

test('deploy_tencent retains gates when old-process stop was attempted but stop or pid proof failed', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const cleanup = source.match(/cleanup_deploy_drain\(\) \{[\s\S]*?\n    \}/)?.[0] || '';
  const helperStart = source.indexOf('node scripts/hold-deploy-drain.mjs');
  const stopAttemptedArgIndex = source.indexOf('--stop-attempted-file', helperStart);
  const stoppedArgIndex = source.indexOf('--stopped-file', helperStart);

  assert.match(source, /DRAIN_STOP_ATTEMPTED_FILE/);
  assert.ok(stopAttemptedArgIndex > helperStart && stopAttemptedArgIndex < stoppedArgIndex);
  assert.match(cleanup, /if \[ -f \\"\\\$DRAIN_STOP_ATTEMPTED_FILE\\" \]; then OLD_PROCESS_STOP_ATTEMPTED=1; fi/);
  assert.match(cleanup, /\\"\\\$OLD_PROCESS_STOPPED\\" \\"\\\$OLD_PROCESS_STOP_ATTEMPTED\\"/);
  assert.match(cleanup, /停机尝试已登记但状态未核实/);
  assert.doesNotMatch(cleanup, /OLD_PROCESS_STOP_ATTEMPTED=1; OLD_PROCESS_STOPPED=1/);
});

test('deploy_tencent writes and removes active drain markers only for its owner token', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const ownershipSource = readFileSync(new URL('./deploy-ownership.mjs', import.meta.url), 'utf8');

  assert.match(source, /ownership-helper\.mjs' create-marker/);
  assert.match(source, /ownership-helper\.mjs' remove-marker/);
  assert.match(ownershipSource, /writeFileSync\(markerFile, ownerContent\(ownerToken\), \{ flag: 'wx'/);
  assert.match(ownershipSource, /purpose: 'quarantine'/);
  assert.match(ownershipSource, /writeFileSync\(livePath, readFileSync\(claimPath\), \{ flag: 'wx'/);
  assert.match(ownershipSource, /verifyDeployMutex\(\{ mutexDir, ownerToken \}\)/);
  assert.doesNotMatch(source, /rm -f \\"\\\$DRAIN_MARKER_FILE\\"/);
});

test('deploy_tencent releases a mutation-started mutex only after remote cleanup completion', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const mutationIndex = source.indexOf('REMOTE_MUTATION_STARTED=1');
  const remoteTrapIndex = source.indexOf('trap finish_remote_mutation EXIT');
  const cleanupIndex = source.indexOf('cleanup_deploy_drain', source.indexOf('finish_remote_mutation()'));
  const childCheckIndex = source.indexOf('kill -0 \\"\\$DRAIN_CHILD_PID\\"', cleanupIndex);
  const completionIndex = source.indexOf('complete-mutation', childCheckIndex);

  assert.ok(mutationIndex >= 0 && mutationIndex < source.indexOf('tar \\\n'));
  assert.ok(remoteTrapIndex > mutationIndex);
  assert.ok(cleanupIndex > mutationIndex && childCheckIndex > cleanupIndex);
  assert.ok(completionIndex > childCheckIndex, 'completion must be written after cleanup and child liveness proof');
  assert.match(source, /--mutation-started '\$REMOTE_MUTATION_STARTED'/);
  assert.match(source, /DRAIN_CHILD_PID=\\\$DRAIN_PID/);
});

test('retain failure makes real remote cleanup fail and prevents completion proof', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const tempDir = mkdtempSync(join(tmpdir(), 'meiao-deploy-cleanup-'));
  const completionLog = join(tempDir, 'completion.log');
  const finishFunction = extractRemoteShellFunction(source, 'finish_remote_mutation');
  const cleanupFunction = extractRemoteShellFunction(source, 'cleanup_deploy_drain');
  assert.doesNotMatch(cleanupFunction, /retain_deploy_drain\s*\|\|\s*true/);
  const shell = `
${finishFunction}
${cleanupFunction}
retain_deploy_drain() { return 7; }
node() {
  case "$*" in
    *"deploy-lifecycle.mjs cleanup"*) printf 'retain\\n'; return 0 ;;
    *"complete-mutation"*) printf 'called\\n' > "$COMPLETION_LOG"; return 0 ;;
    *) return 0 ;;
  esac
}
CLEANUP_RUNNING=0
DRAIN_CLEANUP_ARMED=1
DRAIN_CHILD_PID=''
DRAIN_PID=''
DRAIN_STOP_ATTEMPTED_FILE="$TEMP_DIR/stop-attempted"
DRAIN_STOPPED_FILE="$TEMP_DIR/stopped"
OLD_PROCESS_STOPPED=0
OLD_PROCESS_STOP_ATTEMPTED=0
NEW_PROCESS_STARTED=0
HEALTH_READY=0
NEW_PROCESS_STOPPED=0
true
finish_remote_mutation
`;

  try {
    const result = spawnSync('bash', ['-c', shell], {
      encoding: 'utf8',
      env: { ...process.env, COMPLETION_LOG: completionLog, TEMP_DIR: tempDir },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /清理失败/);
    assert.equal(existsSync(completionLog), false, 'cleanup failure must not write completion');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
