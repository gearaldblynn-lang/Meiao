import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const rootDir = process.cwd();
const backupDir = process.env.MEIAO_CLEANUP_BACKUP_DIR || '/www/backup/meiao-internal';
const stamp = process.env.MEIAO_CLEANUP_STAMP || '20260516-frontend-shell-predeploy';
const assetUrlPattern = /\/api\/assets\/file\/([^/?#"\s]+)/g;

const readEnvFile = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return Object.fromEntries(
      text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          return [
            line.slice(0, index).trim(),
            line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ''),
          ];
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

const collectAssetIds = (value, output = new Set()) => {
  if (typeof value === 'string') {
    for (const match of value.matchAll(assetUrlPattern)) {
      output.add(decodeURIComponent(match[1] || ''));
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssetIds(item, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectAssetIds(item, output));
  }
  return output;
};

const scrubInvalidAssetRefs = (value, validIds, stats) => {
  if (typeof value === 'string') {
    const ids = Array.from(collectAssetIds(value));
    const hasInvalid = ids.some((id) => id && !validIds.has(id));
    if (!hasInvalid) return value;
    stats.clearedStrings += 1;
    ids.filter((id) => id && !validIds.has(id)).forEach((id) => stats.invalidIds.add(id));
    return '';
  }
  if (Array.isArray(value)) return value.map((item) => scrubInvalidAssetRefs(item, validIds, stats));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, scrubInvalidAssetRefs(child, validIds, stats)]));
  }
  return value;
};

try {
  const [assetRows] = await connection.query('SELECT id FROM stored_assets WHERE deleted_at IS NULL');
  const validIds = new Set(assetRows.map((row) => String(row.id)));
  const [stateRows] = await connection.query(`
    SELECT a.user_id, u.username, a.state_json
    FROM app_states a
    JOIN users u ON u.id = a.user_id
    WHERE a.state_json LIKE '%/api/assets/file/%'
  `);

  const manifest = {
    stamp,
    applied: apply,
    checkedUsers: stateRows.length,
    changedUsers: [],
  };

  for (const row of stateRows) {
    const stats = { clearedStrings: 0, invalidIds: new Set() };
    let parsed;
    try {
      parsed = JSON.parse(row.state_json || '{}');
    } catch {
      continue;
    }
    const nextState = scrubInvalidAssetRefs(parsed, validIds, stats);
    if (stats.clearedStrings === 0) continue;
    const nextJson = JSON.stringify(nextState);
    manifest.changedUsers.push({
      userId: row.user_id,
      username: row.username,
      clearedStrings: stats.clearedStrings,
      invalidIds: Array.from(stats.invalidIds).slice(0, 50),
      invalidIdCount: stats.invalidIds.size,
      bytesBefore: Buffer.byteLength(row.state_json || ''),
      bytesAfter: Buffer.byteLength(nextJson),
    });
    if (apply) {
      await connection.query(
        'UPDATE app_states SET state_json = ?, updated_at = ? WHERE user_id = ?',
        [nextJson, Date.now(), row.user_id],
      );
    }
  }

  await fs.mkdir(backupDir, { recursive: true });
  const manifestPath = path.join(backupDir, `state_asset_ref_scrub_${stamp}${apply ? '' : '_dry_run'}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({
    dryRun: !apply,
    manifestPath,
    checkedUsers: manifest.checkedUsers,
    changedUsers: manifest.changedUsers.length,
    clearedStrings: manifest.changedUsers.reduce((sum, item) => sum + item.clearedStrings, 0),
    invalidIds: manifest.changedUsers.reduce((sum, item) => sum + item.invalidIdCount, 0),
  }, null, 2));
} finally {
  await connection.end();
}
