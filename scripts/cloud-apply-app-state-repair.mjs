// 默认 dry-run。只有带 --apply --confirm=APPLY_APP_STATE_REPAIR 且限制范围时才会写回 app_states。
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

import { buildAppStateRepairPlan } from '../server/appStateRepairPlan.mjs';

const rootDir = process.cwd();
const APPLY_CONFIRMATION = 'APPLY_APP_STATE_REPAIR';

const getArgValue = (name) => {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
};

const compactKey = (value) => String(value || '').trim();
const wantsApply = process.argv.includes('--apply');
const wantsJson = process.argv.includes('--json');
const confirmation = compactKey(getArgValue('--confirm'));
const usernameFilter = compactKey(getArgValue('--username'));
const limitArg = Number(getArgValue('--limit'));
const rowLimit = Number.isFinite(limitArg) && limitArg > 0 ? Math.floor(limitArg) : 0;

const refusesApply = (message) => {
  console.error(`refuses apply: ${message}`);
  process.exit(1);
};

if (wantsApply && confirmation !== APPLY_CONFIRMATION) {
  refusesApply(`missing --confirm=${APPLY_CONFIRMATION}`);
}

if (wantsApply && !usernameFilter && !rowLimit) {
  refusesApply('missing scope limiter; pass --username=... or --limit=N');
}

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

const timestampKey = () => new Date().toISOString().replace(/[:.]/g, '-');

const backupDir = path.join(rootDir, 'backups/app-state-repair');
const backupPath = path.join(backupDir, `app-state-repair-${timestampKey()}.jsonl`);

const writeBackupEntry = async ({ row, plan, repairedStateJson }) => {
  await fs.mkdir(backupDir, { recursive: true });
  const originalStateJson = String(row.state_json || '{}');
  const entry = {
    backedUpAt: new Date().toISOString(),
    userId: compactKey(row.user_id),
    username: compactKey(row.username),
    displayName: compactKey(row.display_name),
    updatedAt: row.updated_at,
    originalBytes: Buffer.byteLength(originalStateJson, 'utf8'),
    repairedBytes: Buffer.byteLength(repairedStateJson, 'utf8'),
    beforeIssueCounts: plan.before.issueCounts,
    afterIssueCounts: plan.after.issueCounts,
    actionCount: plan.actionCount,
    actionTypes: summarizeActionTypes(plan.actions),
    actions: plan.actions,
    originalStateJson,
    repairedStateJson,
  };
  await fs.appendFile(backupPath, `${JSON.stringify(entry)}\n`, 'utf8');
};

const buildRowReport = (row) => {
  const base = {
    userId: compactKey(row.user_id),
    username: compactKey(row.username),
    displayName: compactKey(row.display_name),
    updatedAt: row.updated_at,
    beforeBytes: Number(row.bytes || 0) || 0,
  };
  try {
    const state = JSON.parse(row.state_json || '{}');
    const plan = buildAppStateRepairPlan(state);
    const repairedStateJson = JSON.stringify(plan.nextState);
    return {
      ...base,
      parseOk: true,
      changed: plan.changed,
      actionCount: plan.actionCount,
      actionTypes: summarizeActionTypes(plan.actions),
      beforeIssueCounts: plan.before.issueCounts,
      afterIssueCounts: plan.after.issueCounts,
      afterBytes: Buffer.byteLength(repairedStateJson, 'utf8'),
      sampleActions: plan.actions.slice(0, 8),
      plan,
      repairedStateJson,
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
};

const summarizeReports = (reports = []) => {
  const changedReports = reports.filter((report) => report.changed);
  const summary = {
    mode: wantsApply ? 'apply' : 'dry-run',
    scannedUsers: reports.length,
    changedUsers: changedReports.length,
    actionCount: changedReports.reduce((sum, report) => sum + Number(report.actionCount || 0), 0),
    updatedUsers: 0,
    failedUsers: 0,
    backupPath: wantsApply ? backupPath : '',
    actionTypes: changedReports.reduce((counts, report) => addCounts(counts, report.actionTypes), {}),
    beforeIssueCounts: reports.reduce((counts, report) => addCounts(counts, report.beforeIssueCounts), {}),
    afterIssueCounts: reports.reduce((counts, report) => addCounts(counts, report.afterIssueCounts), {}),
  };
  summary.actionTypes = Object.fromEntries(Object.entries(summary.actionTypes).sort(([left], [right]) => left.localeCompare(right)));
  summary.beforeIssueCounts = Object.fromEntries(Object.entries(summary.beforeIssueCounts).sort(([left], [right]) => left.localeCompare(right)));
  summary.afterIssueCounts = Object.fromEntries(Object.entries(summary.afterIssueCounts).sort(([left], [right]) => left.localeCompare(right)));
  return { summary, changedReports };
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
  const reports = rows.map(buildRowReport);
  const { summary, changedReports } = summarizeReports(reports);

  if (wantsApply) {
    for (const report of changedReports) {
      const row = rows.find((item) => compactKey(item.user_id) === report.userId);
      if (!row || !report.plan || !report.repairedStateJson) {
        report.applyStatus = 'failed';
        report.applyError = 'missing repair plan';
        summary.failedUsers += 1;
        continue;
      }
      try {
        await writeBackupEntry({ row, plan: report.plan, repairedStateJson: report.repairedStateJson });
        const [result] = await connection.execute(
          `UPDATE app_states
            SET state_json = ?, updated_at = NOW()
            WHERE user_id = ? AND state_json = ?`,
          [report.repairedStateJson, row.user_id, row.state_json],
        );
        if (result.affectedRows !== 1) {
          report.applyStatus = 'failed';
          report.applyError = `optimistic update affectedRows=${result.affectedRows}`;
          summary.failedUsers += 1;
          continue;
        }
        report.applyStatus = 'updated';
        summary.updatedUsers += 1;
      } catch (error) {
        report.applyStatus = 'failed';
        report.applyError = String(error?.message || error);
        summary.failedUsers += 1;
      }
    }
  }

  if (wantsJson) {
    const safeReports = changedReports.map(({ plan, repairedStateJson, ...report }) => report);
    console.log(JSON.stringify({ summary, reports: safeReports }, null, 2));
  } else {
    console.log(`=== app_states 修复 ${wantsApply ? 'apply' : 'dry-run'} ===`);
    console.log(`扫描用户: ${summary.scannedUsers}`);
    console.log(`预计变化用户: ${summary.changedUsers}`);
    console.log(`预计动作数: ${summary.actionCount}`);
    console.log(`动作类型: ${formatCounts(summary.actionTypes)}`);
    console.log(`修复前异常: ${formatCounts(summary.beforeIssueCounts)}`);
    console.log(`修复后异常: ${formatCounts(summary.afterIssueCounts)}`);
    if (wantsApply) {
      console.log(`已更新用户: ${summary.updatedUsers}`);
      console.log(`失败用户: ${summary.failedUsers}`);
      console.log(`备份文件: ${summary.backupPath}`);
    } else {
      console.log('\n判读:这是预览结果,未写数据库。真正执行需要 --apply --confirm=APPLY_APP_STATE_REPAIR 并限制 --username 或 --limit。');
    }
    console.log('\n=== 变化用户 Top 20 ===');
    changedReports.slice(0, 20).forEach((report) => {
      const name = report.username || report.displayName || report.userId || 'unknown';
      console.log(`user ${name} (${report.userId || 'no-id'}), actions=${report.actionCount}, before=${formatCounts(report.beforeIssueCounts)}, after=${formatCounts(report.afterIssueCounts)}, status=${report.applyStatus || 'preview'}`);
    });
  }

  if (wantsApply && summary.failedUsers > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`app_states 修复脚本连接失败: ${error?.code || 'ERROR'} ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end();
}
