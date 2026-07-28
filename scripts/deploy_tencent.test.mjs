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

test('deploy_tencent never archives local-only environment or voiceover runtime files', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const archiveStart = source.indexOf('tar \\\n');
  const archiveEnd = source.indexOf('| ssh ', archiveStart);
  const archive = source.slice(archiveStart, archiveEnd);

  assert.ok(archiveStart >= 0 && archiveEnd > archiveStart, 'deploy archive command must exist');
  assert.match(archive, /--exclude='\.\/\.env\.server'/);
  assert.match(archive, /--exclude='\.\/\.env\.local'/);
  assert.match(archive, /--exclude='\.\/deploy\/voiceover\/\.runtime'/);
});

test('deploy_tencent restores nginx traversal permission on the remote app root after copying source', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const copyIndex = source.indexOf('cp -R \\\"$REMOTE_TMP_DIR\\\"/. \\\"$REMOTE_APP_DIR\\\"/');
  const permissionIndex = source.indexOf("chmod 0755 '$REMOTE_APP_DIR'");
  const installBoundaryIndex = source.indexOf("cd '$REMOTE_APP_DIR'", copyIndex);

  assert.ok(copyIndex >= 0, 'deploy must copy the staged source into the remote app root');
  assert.ok(
    permissionIndex > copyIndex,
    'deploy must restore root traversal after source copy so nginx X-Accel can read stored assets',
  );
  assert.ok(
    permissionIndex < installBoundaryIndex,
    'deploy must restore root traversal before install/build and any later cutover',
  );
  assert.doesNotMatch(
    source,
    /chmod\s+(?:--recursive|-\S*R\S*)\s/,
    'deploy must not recursively broaden source or secret permissions',
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

test('deploy_tencent refuses to reload while cloud jobs are running', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');

  const initialReadinessIndex = source.indexOf('\nrun_remote_deploy_readiness\n');
  const archiveIndex = source.indexOf('tar \\\n');
  const finalReadinessIndex = source.lastIndexOf('node scripts/check-deploy-readiness.mjs');
  const finalEnvGuardIndex = source.lastIndexOf("if [ ! -f '.env.server' ]");
  const finalEnvLoadIndex = source.lastIndexOf('source .env.server');
  const reloadIndex = source.indexOf('pm2 startOrReload ecosystem.config.cjs --update-env');

  assert.ok(initialReadinessIndex >= 0, 'deploy must define and invoke the cloud readiness preflight');
  assert.ok(initialReadinessIndex < archiveIndex, 'initial readiness must run before uploading or replacing code');
  assert.ok(finalReadinessIndex >= 0, 'deploy must recheck readiness after the remote build');
  assert.ok(finalEnvGuardIndex < finalReadinessIndex, 'final readiness must verify .env.server first');
  assert.ok(finalEnvLoadIndex < finalReadinessIndex, 'final readiness must load database settings first');
  assert.ok(finalReadinessIndex < reloadIndex, 'final readiness must run before PM2 reload');
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

test('deploy_tencent drains writes and releases the job lock before ready-gated reload', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const markerIndex = source.indexOf('\n    write_owned_deploy_marker\n');
  const drainedIndex = source.indexOf('node scripts/assert-deploy-health.mjs --drained');
  const lockIndex = source.indexOf('node scripts/hold-deploy-job-lock.mjs');
  const lockReleaseIndex = source.indexOf('touch \\"\\$DRAIN_RELEASE_FILE\\"', lockIndex);
  const lockWaitIndex = source.indexOf('wait \\"\\$DRAIN_PID\\"', lockReleaseIndex);
  const reloadIndex = source.indexOf('pm2 startOrReload ecosystem.config.cjs --update-env');
  const healthIndex = source.indexOf('node scripts/assert-deploy-health.mjs --release-id', reloadIndex);
  const cleanupIndex = source.lastIndexOf('\n    remove_owned_deploy_marker\n');

  assert.ok(markerIndex >= 0, 'deploy must create the application-visible drain marker');
  assert.ok(drainedIndex > markerIndex, 'write drain proof must follow the marker');
  assert.ok(lockIndex > drainedIndex, 'the final DB barrier must follow in-flight write drain');
  assert.ok(lockReleaseIndex > lockIndex && lockWaitIndex > lockReleaseIndex);
  assert.ok(reloadIndex > lockWaitIndex, 'the table lock must be released before bootstrap');
  assert.ok(healthIndex > reloadIndex, 'the expected release must be checked after reload');
  assert.ok(cleanupIndex > healthIndex, 'drain marker is removed only after health passes');
  assert.match(source, /MEIAO_RELEASE_ID/);
  assert.match(source, /\^\[A-Za-z0-9\._-\]\+\$/);
  assert.match(source, /DRAIN_CLEANUP_ARMED=1/);
  assert.match(source, /MEIAO_DEPLOY_DRAIN_FILE/);
  assert.doesNotMatch(source, /node scripts\/backend-network-drain\.mjs enter/);
  assert.doesNotMatch(source, /pm2 stop meiao-internal/);
  assert.doesNotMatch(source, /pm2 restart meiao-internal/);
  assert.doesNotMatch(source, /node scripts\/hold-deploy-drain\.mjs/);
});

test('deploy_tencent proves managed image COS readiness before entering the drain', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const buildIndex = source.indexOf('npm run build -- --outDir dist-next');
  const probeIndex = source.indexOf('npm run probe:managed-image-cos');
  const finalReadinessIndex = source.indexOf(
    "MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' node scripts/check-deploy-readiness.mjs",
  );
  const markerIndex = source.indexOf('\n    write_owned_deploy_marker\n');

  assert.ok(buildIndex >= 0, 'remote build must exist');
  assert.ok(probeIndex > buildIndex, 'COS probe must run after the new source is installed and built');
  assert.ok(finalReadinessIndex > probeIndex, 'job readiness must be rechecked after the COS probe');
  assert.ok(markerIndex > finalReadinessIndex, 'COS probe and readiness must pass before the marker');
});

test('deploy_tencent fully loads the enabled voiceover model before zero-downtime reload', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const voiceoverProbeIndex = source.indexOf('npm run probe:voiceover-translation -- --readiness');
  const enabledGuardIndex = source.indexOf('case \\"\\${MEIAO_VOICEOVER_TRANSLATION_ENABLED:-0}\\"');
  const finalReadinessIndex = source.lastIndexOf(
    "MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS='$DEPLOY_ALLOW_ACTIVE_JOBS' node scripts/check-deploy-readiness.mjs",
  );
  const reloadIndex = source.indexOf('pm2 startOrReload ecosystem.config.cjs --update-env');
  assert.ok(enabledGuardIndex >= 0 && enabledGuardIndex < voiceoverProbeIndex);
  assert.ok(voiceoverProbeIndex < finalReadinessIndex);
  assert.ok(finalReadinessIndex < reloadIndex);
});

test('deploy_tencent cleanup never stops the last process and restores static assets on failed release health', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const ownershipSource = readFileSync(new URL('./deploy-ownership.mjs', import.meta.url), 'utf8');
  const cleanup = source.match(/cleanup_deploy_reload\(\) \{[\s\S]*?\n    \}/)?.[0] || '';

  assert.match(cleanup, /HEALTH_READY/);
  assert.match(cleanup, /assert-deploy-health\.mjs --release-id/);
  assert.match(cleanup, /dist-prev/);
  assert.match(cleanup, /assert-deploy-health\.mjs/);
  assert.match(cleanup, /retain_deploy_drain/);
  assert.match(cleanup, /remove_owned_deploy_marker/);
  assert.doesNotMatch(cleanup, /pm2 (?:stop|restart)/);
  assert.doesNotMatch(cleanup, /backend-network-drain/);
  assert.match(source, /retain-manual/);
  assert.match(ownershipSource, /writeFileSync\(markerFile, 'manual\\n', \{ flag: 'wx'/);
  assert.match(cleanup, /保留 manual marker/);
});

test('failed exact-release health retains a manual marker even when the old process is healthy', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const cleanupStart = source.indexOf('cleanup_deploy_reload() {');
  const cleanupEnd = source.indexOf('\n    if [ -e \\"\\$DRAIN_MARKER_FILE\\" ]', cleanupStart);
  const cleanup = source.slice(cleanupStart, cleanupEnd);
  const exactHealthBranchIndex = cleanup.indexOf(`if [ \\"\\$HEALTH_READY\\" = '1' ]; then`);
  const markerRemovalIndex = cleanup.indexOf('remove_owned_deploy_marker', exactHealthBranchIndex);
  const manualRetainIndex = cleanup.indexOf('retain_deploy_drain', markerRemovalIndex);

  assert.doesNotMatch(cleanup, /HEALTH_READY.*\|\|.*SERVICE_HEALTHY/);
  assert.ok(exactHealthBranchIndex >= 0, 'marker removal must require exact release health');
  assert.ok(markerRemovalIndex > exactHealthBranchIndex, 'exact release health may remove its owner marker');
  assert.ok(manualRetainIndex > markerRemovalIndex, 'failed exact release health must retain a manual marker');
  assert.match(cleanup, /SERVICE_HEALTHY[\s\S]*manual marker/);
});

test('deploy_tencent always joins the job lock holder before starting PM2', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const helperStart = source.indexOf('node scripts/hold-deploy-job-lock.mjs');
  const releaseIndex = source.indexOf('touch \\"\\$DRAIN_RELEASE_FILE\\"', helperStart);
  const waitIndex = source.indexOf('wait \\"\\$DRAIN_PID\\"', releaseIndex);
  const reloadIndex = source.indexOf('pm2 startOrReload ecosystem.config.cjs --update-env');

  assert.ok(helperStart >= 0 && releaseIndex > helperStart);
  assert.ok(waitIndex > releaseIndex && reloadIndex > waitIndex);
  assert.doesNotMatch(source, /DRAIN_STOP_ATTEMPTED_FILE|DRAIN_STOPPED_FILE/);
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
  const cleanupIndex = source.indexOf('cleanup_deploy_reload', source.indexOf('finish_remote_mutation()'));
  const childCheckIndex = source.indexOf('kill -0 \\"\\$DRAIN_CHILD_PID\\"', cleanupIndex);
  const completionIndex = source.indexOf('complete-mutation', childCheckIndex);

  assert.ok(mutationIndex >= 0 && mutationIndex < source.indexOf('tar \\\n'));
  assert.ok(remoteTrapIndex > mutationIndex);
  assert.ok(cleanupIndex > mutationIndex && childCheckIndex > cleanupIndex);
  assert.ok(completionIndex > childCheckIndex, 'completion must be written after cleanup and child liveness proof');
  assert.match(source, /--mutation-started '\$REMOTE_MUTATION_STARTED'/);
  assert.match(source, /DRAIN_CHILD_PID=\\\$DRAIN_PID/);
});

test('retain failure makes remote reload cleanup fail and prevents completion proof', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const tempDir = mkdtempSync(join(tmpdir(), 'meiao-deploy-cleanup-'));
  const completionLog = join(tempDir, 'completion.log');
  const finishFunction = extractRemoteShellFunction(source, 'finish_remote_mutation');
  const cleanupFunction = extractRemoteShellFunction(source, 'cleanup_deploy_reload');
  assert.doesNotMatch(cleanupFunction, /retain_deploy_drain\s*\|\|\s*true/);
  const shell = `
${finishFunction}
${cleanupFunction}
retain_deploy_drain() { return 7; }
node() { case "$*" in *"complete-mutation"*) printf 'called\\n' > "$COMPLETION_LOG"; return 0 ;; *) return 0 ;; esac; }
curl() { return 1; }
CLEANUP_RUNNING=0
DRAIN_CLEANUP_ARMED=1
DRAIN_CHILD_PID=''
DRAIN_PID=''
DRAIN_READY_FILE="$TEMP_DIR/ready"
DRAIN_RELEASE_FILE="$TEMP_DIR/release"
DRAIN_MARKER_CREATED=1
DIST_SWITCHED=0
HEALTH_READY=0
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
