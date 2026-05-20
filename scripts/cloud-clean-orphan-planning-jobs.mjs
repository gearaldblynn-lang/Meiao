#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const backupRootArg = process.argv.find((arg) => arg.startsWith('--backup-dir='));
const backupRoot = backupRootArg
  ? backupRootArg.slice('--backup-dir='.length)
  : '/www/backup/meiao-orphan-planning-jobs';

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

const env = {
  ...parseEnvFile(path.resolve(process.cwd(), '.env.server')),
  ...process.env,
};

const TERMINAL_SUCCESS_STATUSES = new Set(['succeeded', 'completed']);
const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];

const cleanId = (value) => String(value || '').trim();

const parseJsonValue = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const getResultUrls = (item = {}) => {
  const values = [];
  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    values.push(value);
  };
  push(item.resultUrl);
  push(item.imageUrl);
  push(item.videoUrl);
  push(item.url);
  push(item.resultUrls);
  push(item.imageResultUrls);
  push(item.videoResultUrls);
  push(item.outputUrls);
  push(item.result?.resultUrl);
  push(item.result?.imageUrl);
  push(item.result?.videoUrl);
  push(item.result?.url);
  push(item.result?.resultUrls);
  push(item.result?.imageResultUrls);
  push(item.result?.videoResultUrls);
  push(item.result?.outputUrls);
  return values.map(cleanId).filter(Boolean);
};

const collectProjects = (state = {}) => {
  const projects = [];
  if (Array.isArray(state.shellProjects)) projects.push(...state.shellProjects);
  const oneClickMemory = state.oneClickMemory && typeof state.oneClickMemory === 'object'
    ? state.oneClickMemory
    : {};
  ONE_CLICK_BRANCH_KEYS.forEach((key) => {
    const branchProjects = oneClickMemory[key]?.projects;
    if (Array.isArray(branchProjects)) projects.push(...branchProjects);
  });
  const oneClick = state.oneClick && typeof state.oneClick === 'object' ? state.oneClick : {};
  Object.values(oneClick).forEach((branch) => {
    if (Array.isArray(branch?.projects)) projects.push(...branch.projects);
  });
  return projects;
};

const collectStateJobKeys = (state = {}) => {
  const jobIds = new Set();
  const providerTaskIds = new Set();
  collectProjects(state).forEach((project) => {
    const projectId = cleanId(project?.id);
    if (projectId.startsWith('job-')) jobIds.add(projectId.slice(4));
    const backendJobId = cleanId(project?.backendJobId);
    const planningTaskId = cleanId(project?.planningTaskId);
    if (backendJobId) jobIds.add(backendJobId);
    if (planningTaskId) {
      jobIds.add(planningTaskId);
      providerTaskIds.add(planningTaskId);
    }
    [...(Array.isArray(project?.results) ? project.results : []), ...(Array.isArray(project?.schemes) ? project.schemes : [])]
      .forEach((item) => {
        const taskId = cleanId(item?.taskId || item?.providerTaskId || item?.kieTaskId);
        if (taskId) providerTaskIds.add(taskId);
      });
  });
  return { jobIds, providerTaskIds };
};

const isOrphanPlanningJob = (job, stateKeys) => {
  if (cleanId(job.module) !== 'one_click') return false;
  if (cleanId(job.task_type) !== 'kie_chat') return false;
  if (!TERMINAL_SUCCESS_STATUSES.has(cleanId(job.status))) return false;
  const result = parseJsonValue(job.result_json, {});
  if (getResultUrls({ result }).length > 0) return false;
  const jobId = cleanId(job.id);
  const providerTaskId = cleanId(job.provider_task_id || result?.providerTaskId);
  if (jobId && stateKeys.jobIds.has(jobId)) return false;
  if (providerTaskId && stateKeys.providerTaskIds.has(providerTaskId)) return false;
  return true;
};

const addDeletedJobTombstones = (state, jobIds) => {
  const next = JSON.parse(JSON.stringify(state || {}));
  const deletedJobIds = new Set((next.shellDraft?.deletedJobIds || []).map(cleanId).filter(Boolean));
  jobIds.forEach((jobId) => deletedJobIds.add(jobId));
  next.shellDraft = {
    ...(next.shellDraft || {}),
    deletedJobIds: Array.from(deletedJobIds).slice(-500),
  };
  return next;
};

const pool = createPool({
  host: env.MEIAO_DB_HOST || '127.0.0.1',
  port: Number(env.MEIAO_DB_PORT || 3307),
  user: env.MEIAO_DB_USER || 'root',
  password: env.MEIAO_DB_PASSWORD || '',
  database: env.MEIAO_DB_NAME || 'meiao_internal',
});

const [stateRows] = await pool.query(
  `SELECT s.user_id, u.username, u.display_name, s.state_json
   FROM app_states s
   LEFT JOIN users u ON u.id = s.user_id
   ORDER BY u.username ASC`,
);
const [jobRows] = await pool.query(
  `SELECT *
   FROM internal_jobs
   WHERE module = 'one_click'
     AND task_type = 'kie_chat'
     AND status IN ('succeeded', 'completed')
   ORDER BY user_id ASC, created_at DESC`,
);

const jobsByUser = new Map();
jobRows.forEach((job) => {
  const bucket = jobsByUser.get(job.user_id) || [];
  bucket.push(job);
  jobsByUser.set(job.user_id, bucket);
});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const reports = [];
let totalRemovedJobs = 0;

if (apply) {
  fs.mkdirSync(backupRoot, { recursive: true });
}

for (const row of stateRows) {
  let state;
  try {
    state = JSON.parse(row.state_json || '{}');
  } catch {
    reports.push({
      userId: row.user_id,
      username: row.username,
      error: 'invalid state json',
    });
    continue;
  }

  const stateKeys = collectStateJobKeys(state);
  const orphanJobs = (jobsByUser.get(row.user_id) || [])
    .filter((job) => isOrphanPlanningJob(job, stateKeys));
  if (orphanJobs.length === 0) continue;

  const orphanJobIds = orphanJobs.map((job) => cleanId(job.id)).filter(Boolean);
  totalRemovedJobs += orphanJobIds.length;

  if (apply) {
    const safeUser = cleanId(row.username || row.user_id) || row.user_id;
    fs.writeFileSync(
      path.join(backupRoot, `${safeUser}-${row.user_id}-${stamp}.state.json`),
      JSON.stringify(state, null, 2),
    );
    fs.writeFileSync(
      path.join(backupRoot, `${safeUser}-${row.user_id}-${stamp}.jobs.json`),
      JSON.stringify(orphanJobs, null, 2),
    );
    const nextState = addDeletedJobTombstones(state, orphanJobIds);
    await pool.query(
      'UPDATE app_states SET state_json = ?, updated_at = ? WHERE user_id = ?',
      [JSON.stringify(nextState), Date.now(), row.user_id],
    );
    await pool.query(
      `DELETE FROM internal_jobs WHERE user_id = ? AND id IN (${orphanJobIds.map(() => '?').join(',')})`,
      [row.user_id, ...orphanJobIds],
    );
  }

  reports.push({
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    removedJobs: orphanJobIds.length,
    examples: orphanJobIds.slice(0, 8),
  });
}

await pool.end();

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  accounts: stateRows.length,
  dirtyAccounts: reports.length,
  scannedPlanningJobs: jobRows.length,
  totalRemovedJobs,
  backupRoot: apply ? backupRoot : undefined,
  reports,
}, null, 2));
