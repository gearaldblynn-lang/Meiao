#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from 'mysql2/promise';
import { mergeAppStateForStorage } from '../server/appStateMerge.mjs';

const apply = process.argv.includes('--apply');
const userIdArg = process.argv.find((arg) => arg.startsWith('--user-id='));
const usernameArg = process.argv.find((arg) => arg.startsWith('--username='));
const allUsers = process.argv.includes('--all');
const backupRootArg = process.argv.find((arg) => arg.startsWith('--backup-dir='));
const backupRoot = backupRootArg
  ? backupRootArg.slice('--backup-dir='.length)
  : '/www/backup/meiao-invalid-oneclick-state';

if (!allUsers && !userIdArg && !usernameArg) {
  console.error('Usage: node scripts/cloud-repair-invalid-oneclick-state.mjs [--apply] (--user-id=<id>|--username=<name>|--all)');
  process.exit(1);
}

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

const cleanText = (value) => String(value || '').trim().replace(/\s+/g, ' ');
const safeName = (value) => cleanText(value).replace(/[^a-zA-Z0-9_.-]+/g, '_') || 'user';

const getOneClickPlanContent = (item = {}) => cleanText(
  item?.schemeContent
  || item?.textLayout
  || item?.sceneDescription
  || item?.styleDirection
  || item?.colorPalette
  || item?.composition
  || item?.originalContent
  || item?.editedContent
  || item?.prompt
  || item?.error
  || item?.title,
);

const isInvalidOneClickPlanText = (value) => {
  const content = cleanText(value);
  if (!content) return false;
  return [
    /fetch failed/i,
    /共\s*\d+\s*张参考图，其中\s*\d+\s*张策划失败/,
    /Failed to get (?:the )?file information/i,
    /I cannot fulfill this request/i,
    /Cannot read properties of undefined/i,
    /providerTaskId/i,
    /网络连接失败，请检查网络后重试/,
    /AI\s*分析请求失败/,
    /SKU方案策划失败/,
    /策划失败/,
    /任务状态同步失败/,
  ].some((pattern) => pattern.test(content));
};

const isInvalidOneClickPlanLike = (item = {}) => isInvalidOneClickPlanText(getOneClickPlanContent(item));
const hasMedia = (item = {}) => Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl);

const collectOneClickProjects = (state = {}) => ONE_CLICK_BRANCH_KEYS.flatMap((branch) => {
  const projects = state?.oneClickMemory?.[branch]?.projects;
  return Array.isArray(projects)
    ? projects.map((project) => ({ branch, project }))
    : [];
});

const summarizeState = (state = {}) => {
  const projects = collectOneClickProjects(state);
  const invalidPlanProjects = projects.filter(({ project }) => (
    (Array.isArray(project?.plans) ? project.plans : []).some(isInvalidOneClickPlanLike)
  ));
  const invalidCompletedMediaProjects = projects.filter(({ project }) => (
    (Array.isArray(project?.results) ? project.results : [])
      .some((result) => hasMedia(result) && isInvalidOneClickPlanLike(result))
  ));
  const may29Projects = projects
    .filter(({ project }) => /5月29日项目/.test(cleanText(project?.title || project?.name)))
    .map(({ branch, project }) => ({
      branch,
      id: project?.id,
      title: project?.title || project?.name,
      status: project?.status,
      taskCount: project?.taskCount,
      completedCount: project?.completedCount,
      plans: Array.isArray(project?.plans) ? project.plans.length : 0,
      invalidPlans: (Array.isArray(project?.plans) ? project.plans : []).filter(isInvalidOneClickPlanLike).length,
      results: Array.isArray(project?.results) ? project.results.length : 0,
      completedMedia: (Array.isArray(project?.results) ? project.results : []).filter(hasMedia).length,
      invalidCompletedMedia: (Array.isArray(project?.results) ? project.results : [])
        .filter((result) => hasMedia(result) && isInvalidOneClickPlanLike(result)).length,
      resultPlanIds: (Array.isArray(project?.results) ? project.results : [])
        .map((result) => result?.planId || result?.id)
        .filter(Boolean)
        .slice(0, 5),
      promptSamples: (Array.isArray(project?.results) ? project.results : [])
        .map((result) => cleanText(result?.prompt || result?.error || ''))
        .filter(Boolean)
        .slice(0, 3),
    }));

  return {
    projectCount: projects.length,
    invalidPlanProjects: invalidPlanProjects.length,
    invalidCompletedMediaProjects: invalidCompletedMediaProjects.length,
    may29Projects,
  };
};

const pool = createPool({
  host: env.MEIAO_DB_HOST || '127.0.0.1',
  port: Number(env.MEIAO_DB_PORT || 3307),
  user: env.MEIAO_DB_USER || 'root',
  password: env.MEIAO_DB_PASSWORD || '',
  database: env.MEIAO_DB_NAME || 'meiao_internal',
});

const where = [];
const params = [];
if (userIdArg) {
  where.push('s.user_id = ?');
  params.push(userIdArg.slice('--user-id='.length));
}
if (usernameArg) {
  where.push('(u.username = ? OR u.display_name = ?)');
  const username = usernameArg.slice('--username='.length);
  params.push(username, username);
}

const [rows] = await pool.query(
  `SELECT s.user_id, u.username, u.display_name, s.state_json
   FROM app_states s
   LEFT JOIN users u ON u.id = s.user_id
   ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
   ORDER BY u.username ASC`,
  params,
);

const reports = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
if (apply) fs.mkdirSync(backupRoot, { recursive: true });

for (const row of rows) {
  let beforeState;
  try {
    beforeState = JSON.parse(row.state_json || '{}');
  } catch {
    reports.push({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      error: 'invalid state json',
    });
    continue;
  }

  const afterState = mergeAppStateForStorage(beforeState, {});
  const beforeJson = JSON.stringify(beforeState);
  const afterJson = JSON.stringify(afterState);
  const changed = beforeJson !== afterJson;
  const report = {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    changed,
    before: summarizeState(beforeState),
    after: summarizeState(afterState),
  };

  if (apply && changed) {
    const backupFile = path.join(
      backupRoot,
      `${safeName(row.username || row.display_name || row.user_id)}-${row.user_id}-${stamp}.json`,
    );
    fs.writeFileSync(backupFile, JSON.stringify(beforeState, null, 2));
    await pool.query(
      'UPDATE app_states SET state_json = ?, updated_at = ? WHERE user_id = ?',
      [afterJson, Date.now(), row.user_id],
    );
    report.backupFile = backupFile;
  }

  reports.push(report);
}

await pool.end();

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  scannedAccounts: rows.length,
  changedAccounts: reports.filter((report) => report.changed).length,
  backupRoot: apply ? backupRoot : undefined,
  reports,
}, null, 2));
