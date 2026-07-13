import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

import {
  getDeployDbConfig,
  summarizeRunningJobs,
} from './check-deploy-readiness.mjs';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

const readOption = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};

const run = async () => {
  const readyFile = readOption('--ready-file');
  const releaseFile = readOption('--release-file');
  if (!readyFile || !releaseFile) {
    throw new Error('hold-deploy-drain requires --ready-file and --release-file.');
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
