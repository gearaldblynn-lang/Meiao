import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const rootDir = process.cwd();
const backupDir = process.env.MEIAO_CLEANUP_BACKUP_DIR || '/www/backup/meiao-internal';
const assetDir = process.env.MEIAO_ASSET_DIR || path.join(rootDir, 'server', 'data', 'assets');
const stamp = process.env.MEIAO_CLEANUP_STAMP || '20260516-frontend-shell-predeploy';

const readEnvFile = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return Object.fromEntries(
      text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          const key = line.slice(0, index).trim();
          const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
          return [key, value];
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

const isSafeStorageKey = (value) => {
  const key = String(value || '');
  return key && !path.isAbsolute(key) && !key.split(/[\\/]+/).includes('..');
};

const removeEmptyDirs = async (dir) => {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const empty = await removeEmptyDirs(path.join(dir, entry.name));
      if (empty) {
        await fs.rmdir(path.join(dir, entry.name)).catch(() => {});
      }
    }
  }
  const remaining = await fs.readdir(dir).catch(() => []);
  return remaining.length === 0 && dir !== assetDir;
};

const connection = await mysql.createConnection(dbConfig);

try {
  const [deletedRows] = await connection.query(
    `SELECT id, user_id, module, asset_type, storage_key, public_url, file_size, deleted_at
     FROM stored_assets
     WHERE deleted_at IS NOT NULL`,
  );
  const [expiredRows] = await connection.query(
    `SELECT id, user_id, module, asset_type, storage_key, public_url, file_size, expires_at
     FROM stored_assets
     WHERE deleted_at IS NULL
       AND expires_at > 0
       AND expires_at < UNIX_TIMESTAMP(NOW(3))*1000`,
  );

  const expiredUnreferenced = [];
  const expiredReferenced = [];
  for (const row of expiredRows) {
    const [refRows] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM app_states WHERE state_json LIKE CONCAT('%', ?, '%')) AS state_refs,
        (SELECT COUNT(*) FROM internal_jobs WHERE payload_json LIKE CONCAT('%', ?, '%') OR result_json LIKE CONCAT('%', ?, '%')) AS job_refs`,
      [row.id, row.id, row.id],
    );
    const refs = Number(refRows?.[0]?.state_refs || 0) + Number(refRows?.[0]?.job_refs || 0);
    if (refs > 0) expiredReferenced.push({ ...row, refs });
    else expiredUnreferenced.push({ ...row, refs });
  }

  const candidates = [...deletedRows, ...expiredUnreferenced];
  const manifest = {
    stamp,
    applied: apply,
    assetDir,
    counts: {
      softDeleted: deletedRows.length,
      expiredUnreferenced: expiredUnreferenced.length,
      expiredReferencedKept: expiredReferenced.length,
      candidates: candidates.length,
    },
    bytes: candidates.reduce((sum, row) => sum + Number(row.file_size || 0), 0),
    expiredReferencedKept: expiredReferenced.map((row) => ({ id: row.id, refs: row.refs, publicUrl: row.public_url })),
    candidates: candidates.map((row) => ({
      id: row.id,
      userId: row.user_id,
      module: row.module,
      assetType: row.asset_type,
      storageKey: row.storage_key,
      publicUrl: row.public_url,
      fileSize: Number(row.file_size || 0),
    })),
  };

  await fs.mkdir(backupDir, { recursive: true });
  const manifestPath = path.join(backupDir, `asset_cleanup_${stamp}${apply ? '' : '_dry_run'}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, manifestPath, ...manifest.counts, bytes: manifest.bytes }, null, 2));
    process.exit(0);
  }

  let removedFiles = 0;
  let missingFiles = 0;
  let skippedUnsafeKeys = 0;
  for (const row of candidates) {
    if (!isSafeStorageKey(row.storage_key)) {
      skippedUnsafeKeys += 1;
      continue;
    }
    const filePath = path.join(assetDir, row.storage_key);
    try {
      await fs.unlink(filePath);
      removedFiles += 1;
    } catch (error) {
      if (error?.code === 'ENOENT') missingFiles += 1;
      else throw error;
    }
  }

  if (candidates.length > 0) {
    const ids = candidates.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    await connection.query(`DELETE FROM stored_assets WHERE id IN (${placeholders})`, ids);
  }
  await removeEmptyDirs(assetDir);

  console.log(JSON.stringify({
    dryRun: false,
    manifestPath,
    candidates: candidates.length,
    removedFiles,
    missingFiles,
    skippedUnsafeKeys,
    expiredReferencedKept: expiredReferenced.length,
    bytes: manifest.bytes,
  }, null, 2));
} finally {
  await connection.end();
}
