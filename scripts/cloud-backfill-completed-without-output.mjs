#!/usr/bin/env node
// D3 修复:completed 但无输出的项目卡,结果 URL 其实躺在 internal_jobs.result_json 里(job succeeded)。
// 动作是回填不是删除:把 imageUrl 写回结果项,归一 taskCount/completedCount,镜像卡同步。
// 用法:node scripts/cloud-backfill-completed-without-output.mjs          (dry-run)
//       node scripts/cloud-backfill-completed-without-output.mjs --apply (备份后写库)
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const backupRootArg = process.argv.find((arg) => arg.startsWith('--backup-dir='));
const backupRoot = backupRootArg
  ? backupRootArg.slice('--backup-dir='.length)
  : '/www/backup/meiao-backfill-completed-without-output';

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        const key = index >= 0 ? line.slice(0, index).trim() : line;
        let value = index >= 0 ? line.slice(index + 1).trim() : '';
        value = value.replace(/^['"]|['"]$/g, '');
        return [key, value];
      }),
  );
};

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];
const cleanId = (value) => String(value || '').trim();
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasOutput = (item = {}) => Boolean(item.imageUrl || item.videoUrl || item.resultUrl || item.remoteUrl || item.url);

const projectBuckets = (state = {}) => {
  const buckets = [];
  if (Array.isArray(state.shellProjects)) {
    buckets.push({ path: 'shellProjects', projects: state.shellProjects });
  }
  if (isObject(state.oneClickMemory)) {
    ONE_CLICK_BRANCH_KEYS.forEach((key) => {
      if (Array.isArray(state.oneClickMemory?.[key]?.projects)) {
        buckets.push({ path: `oneClickMemory.${key}.projects`, projects: state.oneClickMemory[key].projects });
      }
    });
  }
  return buckets;
};

const isCompletedWithoutOutput = (project = {}) => {
  if (cleanId(project.status).toLowerCase() !== 'completed') return false;
  if (hasOutput(project)) return false;
  const results = Array.isArray(project.results) ? project.results.filter(isObject) : [];
  return !results.some(hasOutput);
};

// 纯函数:给定 state 与 jobId→成功结果 的映射,回填 URL + 归一计数 + 镜像同步。导出供测试。
export const backfillState = (state, jobResultById) => {
  const actions = [];
  const repairedShellById = new Map();

  projectBuckets(state).forEach((bucket) => {
    bucket.projects.filter(isObject).forEach((project, projectIndex) => {
      if (!isCompletedWithoutOutput(project)) return;
      const projectPath = `${bucket.path}[${projectIndex}]`;
      const results = Array.isArray(project.results) ? project.results : [];
      let backfilled = 0;
      results.filter(isObject).forEach((item) => {
        if (hasOutput(item)) return;
        const jobId = cleanId(item.backendJobId);
        const jobResult = jobId ? jobResultById.get(jobId) : null;
        if (!jobResult?.imageUrl) return;
        item.imageUrl = jobResult.imageUrl;
        if (jobResult.imageUrlAssetId && !item.imageUrlAssetId) item.imageUrlAssetId = jobResult.imageUrlAssetId;
        item.status = 'completed';
        backfilled += 1;
        actions.push({ type: 'backfill_result_image_url', path: projectPath, projectId: cleanId(project.id), jobId });
      });
      if (backfilled === 0) return;
      const outputCount = results.filter(isObject).filter(hasOutput).length;
      if (Number(project.taskCount || 0) !== outputCount || Number(project.completedCount || 0) !== outputCount) {
        actions.push({
          type: 'normalize_counts_after_backfill',
          path: projectPath,
          projectId: cleanId(project.id),
          beforeTaskCount: project.taskCount,
          beforeCompletedCount: project.completedCount,
          outputCount,
        });
        project.taskCount = outputCount;
        project.completedCount = outputCount;
      }
      if (bucket.path === 'shellProjects' && cleanId(project.id)) {
        repairedShellById.set(cleanId(project.id), project);
      }
    });
  });

  // 镜像卡(oneClickMemory 各分支里同 id、零结果、completed)同步修好的 shell 卡结果
  projectBuckets(state).forEach((bucket) => {
    if (bucket.path === 'shellProjects') return;
    bucket.projects.filter(isObject).forEach((project, projectIndex) => {
      const source = repairedShellById.get(cleanId(project.id));
      if (!source) return;
      if (!isCompletedWithoutOutput(project)) return;
      const results = Array.isArray(project.results) ? project.results.filter(isObject) : [];
      if (results.length > 0) return;
      project.results = JSON.parse(JSON.stringify(source.results || []));
      project.taskCount = source.taskCount;
      project.completedCount = source.completedCount;
      actions.push({
        type: 'sync_mirror_results_from_shell',
        path: `${bucket.path}[${projectIndex}]`,
        projectId: cleanId(project.id),
      });
    });
  });

  return actions;
};

const main = async () => {
  const env = { ...parseEnvFile(path.resolve(process.cwd(), '.env.server')), ...process.env };
  const pool = createPool({
    host: env.MEIAO_DB_HOST || '127.0.0.1',
    port: Number(env.MEIAO_DB_PORT || 3307),
    user: env.MEIAO_DB_USER || 'root',
    password: env.MEIAO_DB_PASSWORD || '',
    database: env.MEIAO_DB_NAME || 'meiao_internal',
  });

  const [stateRows] = await pool.query(
    `SELECT s.user_id, u.username, s.state_json
     FROM app_states s LEFT JOIN users u ON u.id = s.user_id
     ORDER BY u.username ASC`,
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (apply) fs.mkdirSync(backupRoot, { recursive: true });
  let totalActions = 0;
  let updatedUsers = 0;

  for (const row of stateRows) {
    let state;
    try {
      state = JSON.parse(row.state_json || '{}');
    } catch {
      console.log(`[skip] ${row.username || row.user_id}: invalid state json`);
      continue;
    }

    // 收集本用户所有待回填 jobId,一次性查 succeeded 结果
    const wantedJobIds = new Set();
    projectBuckets(state).forEach((bucket) => {
      bucket.projects.filter(isObject).forEach((project) => {
        if (!isCompletedWithoutOutput(project)) return;
        (Array.isArray(project.results) ? project.results : []).filter(isObject).forEach((item) => {
          const jobId = cleanId(item.backendJobId);
          if (jobId && !hasOutput(item)) wantedJobIds.add(jobId);
        });
      });
    });
    const jobResultById = new Map();
    if (wantedJobIds.size > 0) {
      const ids = Array.from(wantedJobIds);
      const [jobRows] = await pool.query(
        `SELECT id, result_json FROM internal_jobs WHERE status = 'succeeded' AND id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      jobRows.forEach((job) => {
        try {
          const parsed = JSON.parse(job.result_json || '{}');
          if (parsed.imageUrl) jobResultById.set(cleanId(job.id), parsed);
        } catch { /* 无法解析的 result_json 不回填 */ }
      });
    }

    const actions = backfillState(state, jobResultById);
    if (actions.length === 0) continue;
    totalActions += actions.length;
    updatedUsers += 1;
    console.log(`=== ${row.username || row.user_id} (${actions.length} actions)`);
    actions.forEach((action) => console.log('   ', JSON.stringify(action)));

    if (apply) {
      const safeUser = cleanId(row.username) || row.user_id;
      fs.writeFileSync(
        path.join(backupRoot, `${safeUser}-${row.user_id}-${stamp}.state.json`),
        JSON.stringify(JSON.parse(row.state_json), null, 2),
      );
      await pool.query('UPDATE app_states SET state_json = ? WHERE user_id = ?', [JSON.stringify(state), row.user_id]);
    }
  }

  console.log(`\n${apply ? 'APPLY' : 'DRY-RUN'} 完成:${updatedUsers} 用户,${totalActions} 个动作${apply ? `,备份在 ${backupRoot}` : ''}`);
  await pool.end();
};

const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
