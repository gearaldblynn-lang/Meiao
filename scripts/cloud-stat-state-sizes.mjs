// 只读统计:app_states 单行 state_json 的大小分布,判断是否有用户逼近/超过 4 MiB 写入闸
// (根因库 #4 决策依据:有人在丢老项目才值得做数据模型治本)
// 用法:node scripts/cloud-stat-state-sizes.mjs
// 纯 SELECT,绝不写库;不接受 --apply。
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

if (process.argv.includes('--apply')) {
  console.error('本脚本为只读统计,不支持 --apply。');
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

const envFile = await readEnvFile(path.join(rootDir, '.env.server'));
const connection = await mysql.createConnection({
  host: process.env.MEIAO_DB_HOST || envFile.MEIAO_DB_HOST || '127.0.0.1',
  port: Number(process.env.MEIAO_DB_PORT || envFile.MEIAO_DB_PORT || 3307),
  user: process.env.MEIAO_DB_USER || envFile.MEIAO_DB_USER || 'root',
  password: process.env.MEIAO_DB_PASSWORD || envFile.MEIAO_DB_PASSWORD || '',
  database: process.env.MEIAO_DB_NAME || envFile.MEIAO_DB_NAME || 'meiao_internal',
  charset: 'utf8mb4',
});

const CAP = Number(process.env.APP_STATE_MAX_BYTES) || 4 * 1024 * 1024; // 与线上同口径
const MiB = 1024 * 1024;

try {
  const [[agg]] = await connection.query(
    `SELECT
       COUNT(*)                          AS users,
       COALESCE(MAX(LENGTH(state_json)),0) AS max_bytes,
       COALESCE(AVG(LENGTH(state_json)),0) AS avg_bytes,
       SUM(LENGTH(state_json) >= ?)        AS over_cap,
       SUM(LENGTH(state_json) >= ?)        AS over_80pct,
       SUM(LENGTH(state_json) >= ?)        AS over_50pct
     FROM app_states`,
    [CAP, Math.floor(CAP * 0.8), Math.floor(CAP * 0.5)],
  );

  console.log('=== app_states state_json 大小分布 ===');
  console.log(`写入闸 (APP_STATE_MAX_BYTES): ${(CAP / MiB).toFixed(2)} MiB`);
  console.log(`用户行数:              ${agg.users}`);
  console.log(`最大单行:              ${(Number(agg.max_bytes) / MiB).toFixed(3)} MiB`);
  console.log(`平均单行:              ${(Number(agg.avg_bytes) / MiB).toFixed(3)} MiB`);
  console.log(`>= 闸值(在丢老项目):   ${agg.over_cap} 人`);
  console.log(`>= 80% 闸值(临近):     ${agg.over_80pct} 人`);
  console.log(`>= 50% 闸值:           ${agg.over_50pct} 人`);

  // Top 10 最大行,便于看是不是个别极端用户
  const [top] = await connection.query(
    `SELECT user_id, LENGTH(state_json) AS bytes
     FROM app_states ORDER BY LENGTH(state_json) DESC LIMIT 10`,
  );
  console.log('\n=== Top 10 最大单行 ===');
  for (const row of top) {
    console.log(`  user ${row.user_id}: ${(Number(row.bytes) / MiB).toFixed(3)} MiB`);
  }

  console.log('\n判读:');
  if (Number(agg.over_cap) > 0) {
    console.log(`  ⚠ 有 ${agg.over_cap} 个用户已超闸值,正在裁掉最老项目 → #4 数据模型治本有真实价值,值得做。`);
  } else if (Number(agg.over_80pct) > 0) {
    console.log(`  △ 暂无人超闸,但有 ${agg.over_80pct} 人逼近 → 趋势需关注,可先调高闸值缓冲,治本择期。`);
  } else {
    console.log('  ✓ 无人接近闸值 → #4 现状已够好,治本可暂缓,等数据触发再做。');
  }
} finally {
  await connection.end();
}
