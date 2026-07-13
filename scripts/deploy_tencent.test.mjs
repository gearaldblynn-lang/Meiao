import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('deploy_tencent holds a drain marker through restart and health verification', () => {
  const source = readFileSync(new URL('./deploy_tencent.sh', import.meta.url), 'utf8');
  const markerIndex = source.search(/touch "\\\$DRAIN_MARKER_FILE"/);
  const bootstrapLockIndex = source.indexOf('node scripts/hold-deploy-drain.mjs');
  const stopIndex = source.indexOf('pm2 stop meiao-internal');
  const restartIndex = source.indexOf('pm2 restart meiao-internal --update-env');
  const healthIndex = source.indexOf('/api/health');
  const cleanupIndex = source.search(/rm -f "\\\$DRAIN_MARKER_FILE"\n    trap - EXIT INT TERM/);

  assert.ok(markerIndex >= 0, 'deploy must create the application-visible drain marker');
  assert.ok(bootstrapLockIndex > markerIndex, 'bootstrap DB lock must follow the marker');
  assert.ok(stopIndex > bootstrapLockIndex, 'old process must stop while its DB writes are frozen');
  assert.ok(restartIndex > stopIndex, 'new process starts only after old process is stopped');
  assert.ok(healthIndex > restartIndex, 'drain remains active until health is checked');
  assert.ok(cleanupIndex > healthIndex, 'drain marker is removed only after health passes');
  assert.match(source, /trap cleanup_deploy_drain EXIT INT TERM/);
  assert.match(source, /MEIAO_DEPLOY_DRAIN_FILE/);
});
