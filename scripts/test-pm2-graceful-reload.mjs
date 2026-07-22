import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const appName = `meiao-pm2-reload-test-${process.pid}`;
const port = 32_000 + (process.pid % 1_000);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const run = (command, args, { cwd = rootDir, env = process.env } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', reject);
  child.once('exit', (code) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`));
  });
});

const createPm2Runner = (pm2Home) => {
  const env = { ...process.env, PM2_HOME: pm2Home };
  if (process.env.MEIAO_PM2_USE_NPM_EXEC === '1') {
    return (args, extraEnv = {}) => run(
      'npm',
      ['exec', '--yes', '--package=pm2@6.0.13', '--', 'pm2', ...args],
      { env: { ...env, ...extraEnv } },
    );
  }
  return (args, extraEnv = {}) => run(
    process.env.MEIAO_PM2_BIN || 'pm2',
    args,
    { env: { ...env, ...extraEnv } },
  );
};

const probe = () => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path: '/', timeout: 1_500 }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
  req.once('timeout', () => req.destroy(new Error('probe timeout')));
  req.once('error', reject);
  req.end();
});

const waitForRelease = async (releaseId, attempts = 100) => {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await probe();
      if (result.releaseId === releaseId) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw lastError || new Error(`release ${releaseId} did not become ready`);
};

const main = async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'meiao-pm2-reload-'));
  const pm2Home = path.join(workspace, 'pm2-home');
  const fixturePath = path.join(workspace, 'fixture.mjs');
  const configPath = path.join(workspace, 'ecosystem.config.cjs');
  const lifecycleUrl = pathToFileURL(path.join(rootDir, 'server', 'processLifecycle.mjs')).href;
  const basePm2Runner = createPm2Runner(pm2Home);
  let lastPm2Output = '';
  const runPm2 = async (...args) => {
    const result = await basePm2Runner(...args);
    lastPm2Output = `${result.stdout}\n${result.stderr}`;
    return result;
  };
  await mkdir(pm2Home, { recursive: true });
  await writeFile(fixturePath, `
import { createServer } from 'node:http';
import { createGracefulShutdown, listenAndNotifyReady, registerProcessShutdown } from ${JSON.stringify(lifecycleUrl)};
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ releaseId: process.env.TEST_RELEASE_ID, pid: process.pid }));
});
const shutdown = createGracefulShutdown({ server });
registerProcessShutdown({ shutdown });
await listenAndNotifyReady({ server, port: Number(process.env.PORT), host: '127.0.0.1' });
`, 'utf8');
  await writeFile(configPath, `
module.exports = { apps: [{
  name: ${JSON.stringify(appName)},
  script: ${JSON.stringify(fixturePath)},
  cwd: ${JSON.stringify(workspace)},
  instances: 1,
  exec_mode: 'cluster',
  wait_ready: true,
  listen_timeout: 10000,
  kill_timeout: 5000,
  autorestart: true,
  env: { PORT: ${JSON.stringify(String(port))}, TEST_RELEASE_ID: process.env.TEST_RELEASE_ID || 'release-a' },
}] };
`, 'utf8');

  const failures = [];
  const observed = new Set();
  let probing = true;
  try {
    await runPm2(['start', configPath, '--update-env'], { TEST_RELEASE_ID: 'release-a' });
    await waitForRelease('release-a');
    const probeLoop = (async () => {
      while (probing) {
        try {
          const result = await probe();
          observed.add(result.releaseId);
        } catch (error) {
          failures.push(error.message);
        }
        await delay(10);
      }
    })();
    await runPm2(['startOrReload', configPath, '--update-env'], { TEST_RELEASE_ID: 'release-b' });
    await waitForRelease('release-b');
    await delay(500);
    probing = false;
    await probeLoop;

    if (failures.length > 0) throw new Error(`continuous probes failed: ${failures.join(' | ')}`);
    if (!observed.has('release-a') || !observed.has('release-b')) {
      throw new Error(`did not observe both releases: ${JSON.stringify([...observed])}`);
    }
    console.log(JSON.stringify({ ok: true, failures: 0, observed: [...observed], port }));
  } catch (error) {
    const previousPm2Output = lastPm2Output;
    const diagnostics = await runPm2(['logs', appName, '--lines', '100', '--nostream']).catch(() => ({
      stdout: '',
      stderr: '',
    }));
    const processList = await runPm2(['jlist']).catch(() => ({ stdout: '', stderr: '' }));
    let processSummary = [];
    try {
      processSummary = JSON.parse(processList.stdout).map((item) => ({
        name: item.name,
        pid: item.pid,
        status: item.pm2_env?.status,
        mode: item.pm2_env?.exec_mode,
        restarts: item.pm2_env?.restart_time,
      }));
    } catch {
      processSummary = [{ parseFailed: true }];
    }
    error.message = `${error.message}\nLAST PM2 OUTPUT:\n${previousPm2Output}\nLOGS:\n${diagnostics.stdout}\n${diagnostics.stderr}\nPROCESS SUMMARY:\n${JSON.stringify(processSummary)}`;
    throw error;
  } finally {
    probing = false;
    if (process.env.MEIAO_PM2_TEST_KEEP !== '1') {
      await runPm2(['delete', appName]).catch(() => null);
      await runPm2(['kill']).catch(() => null);
      await rm(workspace, { recursive: true, force: true });
    } else {
      console.error(`PM2 reload test workspace retained: ${workspace}`);
    }
  }
};

try {
  await main();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}
