import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

import { getDeployDbConfig, summarizeRunningJobs } from './check-deploy-readiness.mjs';
import {
  acquireDeployJobClaimLock,
  releaseDeployJobClaimLock,
} from '../server/deployClaimLock.mjs';

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const holdDeployJobTableLock = async ({
  connection,
  env = process.env,
  acknowledgeReady,
  isReleased,
  sleep = defaultSleep,
}) => {
  let acquired = false;
  try {
    await acquireDeployJobClaimLock({ connection, env });
    acquired = true;
    const [rows] = await connection.query(
      `SELECT task_type, provider, provider_task_id, started_at
       FROM internal_jobs
       WHERE status = 'running'
       ORDER BY started_at ASC`,
    );
    const summary = summarizeRunningJobs(rows);
    const override = String(env.MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS || '') === '1';
    const result = {
      ready: summary.runningCount === 0 || override,
      override,
      ...summary,
    };
    if (!result.ready) {
      const error = new Error('部署已拦截：云上仍有运行中任务。');
      error.code = 'deploy_active_jobs';
      error.summary = result;
      throw error;
    }
    await acknowledgeReady(result);
    while (!isReleased()) {
      await sleep(250);
      await connection.query('SELECT 1 AS lock_session_alive');
    }
    return result;
  } finally {
    if (acquired) {
      await releaseDeployJobClaimLock({ connection, env }).catch(() => null);
    }
    await connection.end().catch(() => null);
  }
};

const readOption = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};

const run = async () => {
  const readyFile = readOption('--ready-file');
  const releaseFile = readOption('--release-file');
  if (!readyFile || !releaseFile) {
    throw new Error('hold-deploy-job-lock requires --ready-file and --release-file.');
  }
  const connection = await mysql.createConnection(getDeployDbConfig(process.env));
  await holdDeployJobTableLock({
    connection,
    acknowledgeReady: async (result) => {
      if (result.override && result.runningCount > 0) {
        console.error('警告：已显式允许在运行中任务存在时部署。');
      }
      writeFileSync(readyFile, `${JSON.stringify(result)}\n`, { mode: 0o600 });
    },
    isReleased: () => existsSync(releaseFile),
  });
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution) {
  try {
    await run();
  } catch (error) {
    if (error?.summary) console.error(JSON.stringify(error.summary));
    console.error(error?.message || String(error || ''));
    process.exitCode = 2;
  }
}
