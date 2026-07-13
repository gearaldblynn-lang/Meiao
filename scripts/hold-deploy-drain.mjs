import { execFile } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';

import {
  getDeployDbConfig,
  summarizeRunningJobs,
} from './check-deploy-readiness.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const execFileAsync = promisify(execFile);

export const acquireBootstrapJobTableLock = async ({ connection, env = process.env }) => {
  await connection.query('LOCK TABLES internal_jobs WRITE');
  const [rows] = await connection.query(
    `SELECT task_type, provider, provider_task_id, started_at
     FROM internal_jobs
     WHERE status = 'running'
     ORDER BY started_at ASC`,
  );
  const summary = summarizeRunningJobs(rows);
  const override = String(env.MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS || '') === '1';
  return {
    ready: summary.runningCount === 0 || override,
    override,
    ...summary,
  };
};

export const stopOldProcessWithLockVerification = async ({
  connection,
  processManager,
  acknowledgeStopped,
}) => {
  const appExisted = await processManager.exists();
  if (appExisted) await processManager.stop();
  if (!await processManager.isStopped()) {
    throw new Error('PM2 process is still running after stop request.');
  }
  await connection.query('SELECT 1 AS lock_session_alive');
  await acknowledgeStopped(appExisted);
  return { appExisted, stopped: true };
};

const createPm2ProcessManager = (processName) => ({
  exists: async () => {
    try {
      await execFileAsync('pm2', ['describe', processName]);
      return true;
    } catch (error) {
      if (Number(error?.code) === 1) return false;
      throw error;
    }
  },
  stop: async () => {
    await execFileAsync('pm2', ['stop', processName]);
  },
  isStopped: async () => {
    const { stdout } = await execFileAsync('pm2', ['pid', processName], { encoding: 'utf8' });
    const pids = String(stdout || '').trim().split(/\s+/).filter(Boolean);
    return pids.length === 0 || pids.every((pid) => pid === '0');
  },
});

const readOption = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};

const run = async () => {
  const readyFile = readOption('--ready-file');
  const stoppedFile = readOption('--stopped-file');
  const releaseFile = readOption('--release-file');
  const processName = readOption('--process-name') || 'meiao-internal';
  if (!readyFile || !stoppedFile || !releaseFile) {
    throw new Error('hold-deploy-drain requires --ready-file, --stopped-file and --release-file.');
  }

  const connection = await mysql.createConnection(getDeployDbConfig(process.env));
  let tableLocked = false;
  try {
    const result = await acquireBootstrapJobTableLock({ connection });
    tableLocked = true;
    if (!result.ready) {
      console.error(JSON.stringify(result));
      throw Object.assign(new Error('部署已拦截：云上仍有运行中任务。'), { exitCode: 2 });
    }
    if (result.override && result.runningCount > 0) {
      console.error('警告：已显式允许在运行中任务存在时部署。');
    }
    writeFileSync(readyFile, `${JSON.stringify(result)}\n`, { mode: 0o600 });

    await stopOldProcessWithLockVerification({
      connection,
      processManager: createPm2ProcessManager(processName),
      acknowledgeStopped: async (appExisted) => {
        writeFileSync(stoppedFile, appExisted ? '1\n' : '0\n', { mode: 0o600 });
      },
    });

    while (!existsSync(releaseFile)) {
      await sleep(250);
      await connection.query('SELECT 1');
    }
  } finally {
    if (tableLocked) {
      await connection.query('UNLOCK TABLES').catch(() => {});
    }
    await connection.end().catch(() => {});
  }
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) {
  try {
    await run();
  } catch (error) {
    console.error(error?.message || String(error || ''));
    process.exitCode = Number(error?.exitCode || 2);
  }
}
