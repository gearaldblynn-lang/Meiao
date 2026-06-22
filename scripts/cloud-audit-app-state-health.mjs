// 只读审计:扫描云端 app_states,统计任务身份和展示状态异常。
// 用法:node scripts/cloud-audit-app-state-health.mjs [--json] [--limit=50]
// 纯 SELECT,绝不改库;不接受 --apply。
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { analyzeAppStateRow, summarizeAppStateHealthReports } from '../server/appStateHealth.mjs';

if (process.argv.includes('--apply')) {
  console.error('本脚本为只读审计,不支持 --apply。');
  process.exit(1);
}

const rootDir = process.cwd();

const readEnvFile = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return Object.fromEntries(
      text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
        }),
    );
  } catch {
    return {};
  }
};

const getArgValue = (name) => {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
};

const limitArg = Number(getArgValue('--limit'));
const rowLimit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 0;
const wantsJson = process.argv.includes('--json');

const envFile = await readEnvFile(path.join(rootDir, '.env.server'));
const dbConfig = {
  host: process.env.MEIAO_DB_HOST || envFile.MEIAO_DB_HOST || '127.0.0.1',
  port: Number(process.env.MEIAO_DB_PORT || envFile.MEIAO_DB_PORT || 3307),
  user: process.env.MEIAO_DB_USER || envFile.MEIAO_DB_USER || 'root',
  password: process.env.MEIAO_DB_PASSWORD || envFile.MEIAO_DB_PASSWORD || '',
  database: process.env.MEIAO_DB_NAME || envFile.MEIAO_DB_NAME || 'meiao_internal',
  charset: 'utf8mb4',
};

const formatIssueCounts = (issueCounts = {}) => (
  Object.entries(issueCounts)
    .map(([type, count]) => `${type}:${count}`)
    .join(', ') || 'none'
);

let connection;
try {
  connection = await mysql.createConnection(dbConfig);
  const sql = `SELECT
      s.user_id,
      u.username,
      u.display_name,
      s.state_json,
      LENGTH(s.state_json) AS bytes,
      s.updated_at
    FROM app_states s
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY LENGTH(s.state_json) DESC${rowLimit ? ' LIMIT ?' : ''}`;
  const [rows] = await connection.query(sql, rowLimit ? [rowLimit] : []);
  const reports = rows.map((row) => analyzeAppStateRow(row));
  const summary = summarizeAppStateHealthReports(reports);
  const dirtyUsers = reports
    .filter((report) => Object.values(report.issueCounts || {}).some((count) => Number(count) > 0))
    .sort((left, right) => Number(right.bytes || 0) - Number(left.bytes || 0));

  if (wantsJson) {
    console.log(JSON.stringify({ summary, reports: dirtyUsers }, null, 2));
  } else {
    console.log('=== app_states 健康审计(只读) ===');
    console.log(`扫描用户: ${summary.userCount}`);
    console.log(`存在异常用户: ${summary.usersWithIssues}`);
    console.log(`项目总数: ${summary.projectCount}`);
    console.log(`结果总数: ${summary.resultCount}`);
    console.log(`异常计数: ${formatIssueCounts(summary.issueCounts)}`);
    console.log('\n=== 异常用户 Top 20 ===');
    dirtyUsers.slice(0, 20).forEach((report) => {
      const name = report.username || report.displayName || report.userId || 'unknown';
      console.log(`user ${name} (${report.userId || 'no-id'}), bytes=${report.bytes}, issues=${formatIssueCounts(report.issueCounts)}`);
    });
    if (dirtyUsers.length === 0) {
      console.log('未发现当前规则可识别的 app_state 异常。');
    }
    console.log('\n判读:');
    console.log('先按异常计数和具体用户样本定位真实脏数据形态;确认后再写 dry-run 修复器,不要直接迁移云端数据。');
  }
} catch (error) {
  console.error(`app_states 健康审计连接失败: ${error?.code || 'ERROR'} ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
