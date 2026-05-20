#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from 'mysql2/promise';

const apply = process.argv.includes('--apply');
const backupRootArg = process.argv.find((arg) => arg.startsWith('--backup-dir='));
const backupRoot = backupRootArg
  ? backupRootArg.slice('--backup-dir='.length)
  : '/www/backup/meiao-invalid-state-projects';

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

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];
const TERMINAL_INVALID_STATUSES = new Set(['completed', 'error', 'failed', 'cancelled', 'interrupted', 'planning']);

const cleanId = (value) => String(value || '').trim();

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

const hasAnyResultUrl = (items) => Array.isArray(items) && items.some((item) => getResultUrls(item).length > 0);
const hasPlans = (project) => Array.isArray(project?.plans) && project.plans.length > 0;

const isInvalidShellProject = (project) => {
  if (!project || typeof project !== 'object') return false;
  if (hasPlans(project)) return false;
  if (hasAnyResultUrl(project.results)) return false;
  return TERMINAL_INVALID_STATUSES.has(cleanId(project.status));
};

const isInvalidOneClickBranchProject = (project) => {
  if (!project || typeof project !== 'object') return false;
  if (hasPlans(project)) return false;
  if (hasAnyResultUrl(project.results) || hasAnyResultUrl(project.schemes)) return false;
  return true;
};

const addTombstonesForProject = ({ project, deletedProjectIds, deletedJobIds, deletedResultIds }) => {
  const projectId = cleanId(project?.id);
  if (projectId) deletedProjectIds.add(projectId);
  const backendJobId = cleanId(project?.backendJobId || project?.planningTaskId);
  if (backendJobId) deletedJobIds.add(backendJobId);
  if (projectId.startsWith('job-')) deletedJobIds.add(projectId.slice(4));
  [...(project?.results || []), ...(project?.schemes || [])].forEach((item) => {
    const itemId = cleanId(item?.id);
    const taskId = cleanId(item?.taskId || item?.providerTaskId || item?.kieTaskId);
    if (itemId) deletedResultIds.add(itemId);
    if (taskId) deletedJobIds.add(taskId);
  });
};

const summarizeState = (state) => {
  const shellProjects = Array.isArray(state.shellProjects) ? state.shellProjects : [];
  const branchProjects = ONE_CLICK_BRANCH_KEYS.flatMap((key) => (
    Array.isArray(state.oneClickMemory?.[key]?.projects)
      ? state.oneClickMemory[key].projects.map((project) => ({ branch: key, project }))
      : []
  ));
  const invalidShellProjects = shellProjects.filter(isInvalidShellProject);
  const invalidBranchProjects = branchProjects.filter(({ project }) => isInvalidOneClickBranchProject(project));
  return {
    shellProjects,
    branchProjects,
    invalidShellProjects,
    invalidBranchProjects,
  };
};

const cleanState = (state) => {
  const next = JSON.parse(JSON.stringify(state || {}));
  const before = summarizeState(next);
  const deletedProjectIds = new Set((next.shellDraft?.deletedProjectIds || []).map(cleanId).filter(Boolean));
  const deletedJobIds = new Set((next.shellDraft?.deletedJobIds || []).map(cleanId).filter(Boolean));
  const deletedResultIds = new Set((next.shellDraft?.deletedResultIds || []).map(cleanId).filter(Boolean));
  const invalidProjectIds = new Set();
  const invalidJobIds = new Set();

  before.invalidShellProjects.forEach((project) => {
    addTombstonesForProject({ project, deletedProjectIds, deletedJobIds, deletedResultIds });
    invalidProjectIds.add(cleanId(project.id));
    const jobId = cleanId(project.backendJobId || project.planningTaskId);
    if (jobId) invalidJobIds.add(jobId);
  });
  before.invalidBranchProjects.forEach(({ project }) => {
    addTombstonesForProject({ project, deletedProjectIds, deletedJobIds, deletedResultIds });
    invalidProjectIds.add(cleanId(project.id));
  });

  next.shellProjects = before.shellProjects.filter((project) => !invalidProjectIds.has(cleanId(project.id)));
  next.oneClickMemory = { ...(next.oneClickMemory || {}) };
  ONE_CLICK_BRANCH_KEYS.forEach((key) => {
    const branch = next.oneClickMemory[key];
    if (!branch || typeof branch !== 'object') return;
    next.oneClickMemory[key] = {
      ...branch,
      projects: (Array.isArray(branch.projects) ? branch.projects : [])
        .filter((project) => !invalidProjectIds.has(cleanId(project.id))),
    };
  });
  next.shellDraft = {
    ...(next.shellDraft || {}),
    deletedProjectIds: Array.from(deletedProjectIds).slice(-500),
    deletedJobIds: Array.from(deletedJobIds).slice(-500),
    deletedResultIds: Array.from(deletedResultIds).slice(-500),
  };

  const after = summarizeState(next);
  return {
    state: next,
    removedProjectIds: Array.from(invalidProjectIds).filter(Boolean),
    removedJobIds: Array.from(invalidJobIds).filter(Boolean),
    before,
    after,
  };
};

const pool = createPool({
  host: env.MEIAO_DB_HOST || '127.0.0.1',
  port: Number(env.MEIAO_DB_PORT || 3307),
  user: env.MEIAO_DB_USER || 'root',
  password: env.MEIAO_DB_PASSWORD || '',
  database: env.MEIAO_DB_NAME || 'meiao_internal',
});

const [rows] = await pool.query(
  `SELECT s.user_id, u.username, u.display_name, s.state_json
   FROM app_states s
   LEFT JOIN users u ON u.id = s.user_id
   ORDER BY u.username ASC`,
);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const accountReports = [];
let totalRemovedProjects = 0;
let totalRemovedJobs = 0;

if (apply) {
  fs.mkdirSync(backupRoot, { recursive: true });
}

for (const row of rows) {
  let state;
  try {
    state = JSON.parse(row.state_json || '{}');
  } catch {
    accountReports.push({
      userId: row.user_id,
      username: row.username,
      error: 'invalid state json',
    });
    continue;
  }

  const cleaned = cleanState(state);
  const invalidShell = cleaned.before.invalidShellProjects.length;
  const invalidBranch = cleaned.before.invalidBranchProjects.length;
  const shouldUpdate = cleaned.removedProjectIds.length > 0 || cleaned.removedJobIds.length > 0;
  totalRemovedProjects += cleaned.removedProjectIds.length;
  totalRemovedJobs += cleaned.removedJobIds.length;

  if (apply && shouldUpdate) {
    const backupFile = path.join(backupRoot, `${cleanId(row.username || row.user_id)}-${row.user_id}-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(state, null, 2));
    await pool.query(
      'UPDATE app_states SET state_json = ?, updated_at = ? WHERE user_id = ?',
      [JSON.stringify(cleaned.state), Date.now(), row.user_id],
    );
    if (cleaned.removedJobIds.length > 0) {
      await pool.query(
        `DELETE FROM internal_jobs WHERE user_id = ? AND id IN (${cleaned.removedJobIds.map(() => '?').join(',')})`,
        [row.user_id, ...cleaned.removedJobIds],
      );
    }
  }

  if (invalidShell > 0 || invalidBranch > 0) {
    accountReports.push({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      invalidShell,
      invalidBranch,
      removedProjects: cleaned.removedProjectIds.length,
      removedJobs: cleaned.removedJobIds.length,
      examples: cleaned.removedProjectIds.slice(0, 8),
    });
  }
}

await pool.end();

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  accounts: rows.length,
  dirtyAccounts: accountReports.length,
  totalRemovedProjects,
  totalRemovedJobs,
  backupRoot: apply ? backupRoot : undefined,
  accountReports,
}, null, 2));
