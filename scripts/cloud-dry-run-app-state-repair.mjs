// 只读 dry-run:扫描 app_states 并报告保守修复计划,不落库。
// 用法:node scripts/cloud-dry-run-app-state-repair.mjs [--json] [--limit=20] [--username=张三]
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { buildAppStateRepairPlan } from '../server/appStateRepairPlan.mjs';

if (process.argv.includes('--apply')) {
  console.error('本脚本为只读 dry-run,不支持 --apply。');
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

const compactKey = (value) => String(value || '').trim();

const limitArg = Number(getArgValue('--limit'));
const rowLimit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 0;
const usernameFilter = compactKey(getArgValue('--username'));
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

const formatCounts = (counts = {}) => (
  Object.entries(counts)
    .map(([type, count]) => `${type}:${count}`)
    .join(', ') || 'none'
);

const addCounts = (target, source = {}) => {
  Object.entries(source).forEach(([type, count]) => {
    target[type] = (target[type] || 0) + Number(count || 0);
  });
  return target;
};

const summarizeActionTypes = (actions = []) => {
  const counts = {};
  actions.forEach((item) => {
    counts[item.type] = (counts[item.type] || 0) + 1;
  });
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
};

let connection;
try {
  connection = await mysql.createConnection(dbConfig);
  const where = [];
  const params = [];
  if (usernameFilter) {
    where.push('(u.username = ? OR u.display_name = ?)');
    params.push(usernameFilter, usernameFilter);
  }
  const sql = `SELECT
      s.user_id,
      u.username,
      u.display_name,
      s.state_json,
      LENGTH(s.state_json) AS bytes,
      s.updated_at
    FROM app_states s
    LEFT JOIN users u ON u.id = s.user_id
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY LENGTH(s.state_json) DESC${rowLimit ? ' LIMIT ?' : ''}`;
  if (rowLimit) params.push(rowLimit);
  const [rows] = await connection.query(sql, params);

  const reports = rows.map((row) => {
    const base = {
      userId: compactKey(row.user_id),
      username: compactKey(row.username),
      displayName: compactKey(row.display_name),
      bytes: Number(row.bytes || 0) || 0,
      updatedAt: row.updated_at,
    };
    try {
      const state = JSON.parse(row.state_json || '{}');
      const plan = buildAppStateRepairPlan(state);
      const nextJson = JSON.stringify(plan.nextState);
      return {
        ...base,
        parseOk: true,
        changed: plan.changed,
        actionCount: plan.actionCount,
        actionTypes: summarizeActionTypes(plan.actions),
        beforeIssueCounts: plan.before.issueCounts,
        afterIssueCounts: plan.after.issueCounts,
        beforeBytes: base.bytes,
        afterBytes: Buffer.byteLength(nextJson, 'utf8'),
        sampleActions: plan.actions.slice(0, 8),
      };
    } catch (error) {
      return {
        ...base,
        parseOk: false,
        changed: false,
        actionCount: 0,
        actionTypes: {},
        beforeIssueCounts: { invalid_json: 1 },
        afterIssueCounts: { invalid_json: 1 },
        error: String(error?.message || error),
      };
    }
  });

  const changedReports = reports.filter((report) => report.changed);
  const summary = {
    scannedUsers: reports.length,
    changedUsers: changedReports.length,
    actionCount: changedReports.reduce((sum, report) => sum + Number(report.actionCount || 0), 0),
    actionTypes: changedReports.reduce((counts, report) => addCounts(counts, report.actionTypes), {}),
    beforeIssueCounts: reports.reduce((counts, report) => addCounts(counts, report.beforeIssueCounts), {}),
    afterIssueCounts: reports.reduce((counts, report) => addCounts(counts, report.afterIssueCounts), {}),
  };
  summary.actionTypes = Object.fromEntries(Object.entries(summary.actionTypes).sort(([left], [right]) => left.localeCompare(right)));
  summary.beforeIssueCounts = Object.fromEntries(Object.entries(summary.beforeIssueCounts).sort(([left], [right]) => left.localeCompare(right)));
  summary.afterIssueCounts = Object.fromEntries(Object.entries(summary.afterIssueCounts).sort(([left], [right]) => left.localeCompare(right)));

  if (wantsJson) {
    console.log(JSON.stringify({ summary, reports: changedReports }, null, 2));
  } else {
    console.log('=== app_states 修复 dry-run(只读) ===');
    console.log(`扫描用户: ${summary.scannedUsers}`);
    console.log(`预计变化用户: ${summary.changedUsers}`);
    console.log(`预计动作数: ${summary.actionCount}`);
    console.log(`动作类型: ${formatCounts(summary.actionTypes)}`);
    console.log(`修复前异常: ${formatCounts(summary.beforeIssueCounts)}`);
    console.log(`修复后异常: ${formatCounts(summary.afterIssueCounts)}`);
    console.log('\n=== 预计变化用户 Top 20 ===');
    changedReports.slice(0, 20).forEach((report) => {
      const name = report.username || report.displayName || report.userId || 'unknown';
      console.log(`user ${name} (${report.userId || 'no-id'}), actions=${report.actionCount}, before=${formatCounts(report.beforeIssueCounts)}, after=${formatCounts(report.afterIssueCounts)}`);
    });
    if (changedReports.length === 0) {
      console.log('没有生成修复动作。');
    }
    console.log('\n判读:');
    console.log('这是 dry-run 结果。确认样本动作和备份方案后,再另开带备份的小批量执行脚本。');
  }
} catch (error) {
  console.error(`app_states 修复 dry-run 连接失败: ${error?.code || 'ERROR'} ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
