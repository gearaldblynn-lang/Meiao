import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

const increment = (record, key) => {
  const normalized = String(key || 'unknown').trim() || 'unknown';
  record[normalized] = (record[normalized] || 0) + 1;
};

export const summarizeRunningJobs = (rows = []) => {
  const summary = {
    runningCount: 0,
    providerlessCount: 0,
    submittedCount: 0,
    oldestStartedAt: 0,
    byTaskType: {},
    byProvider: {},
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    summary.runningCount += 1;
    if (String(row?.provider_task_id || '').trim()) summary.submittedCount += 1;
    else summary.providerlessCount += 1;
    const startedAt = Number(row?.started_at || 0);
    if (startedAt > 0 && (!summary.oldestStartedAt || startedAt < summary.oldestStartedAt)) {
      summary.oldestStartedAt = startedAt;
    }
    increment(summary.byTaskType, row?.task_type);
    increment(summary.byProvider, row?.provider);
  }
  return summary;
};

export const getDeployDbConfig = (env = process.env) => ({
  host: env.MEIAO_DB_HOST || '127.0.0.1',
  port: Number(env.MEIAO_DB_PORT || 3306),
  user: env.MEIAO_DB_USER || 'root',
  password: env.MEIAO_DB_PASSWORD || '',
  database: env.MEIAO_DB_NAME || 'meiao_internal',
  connectTimeout: 10_000,
});

export const checkDeployReadiness = async ({ env = process.env, createConnection = mysql.createConnection } = {}) => {
  const connection = await createConnection(getDeployDbConfig(env));
  try {
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
  } finally {
    await connection.end();
  }
};

const run = async () => {
  try {
    const result = await checkDeployReadiness();
    console.log(JSON.stringify(result));
    if (!result.ready) {
      console.error('部署已拦截：云上仍有运行中任务，请等待任务结束后重试。');
      process.exitCode = 2;
    } else if (result.override && result.runningCount > 0) {
      console.error('警告：已显式允许在运行中任务存在时部署。');
    }
  } catch (error) {
    console.error(`部署就绪检查失败：${error?.message || String(error || '')}`);
    process.exitCode = 2;
  }
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isDirectExecution || process.env.MEIAO_DEPLOY_READINESS_RUN === '1') {
  await run();
}
