#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GROUPS = {
  server: { directory: 'server', stripTypes: false },
  frontend: { directory: 'src', stripTypes: true },
  scripts: { directory: 'scripts', stripTypes: false },
};

export const collectTestFiles = async (rootDir) => {
  const found = [];

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) found.push(fullPath);
    }
  };

  await visit(rootDir);
  return found.sort();
};

export const buildNodeTestArgs = (group, files) => {
  const args = [];
  if (GROUPS[group]?.stripTypes) args.push('--experimental-strip-types');
  args.push('--test', '--test-reporter=dot', ...files);
  return args;
};

export const runTestGroup = async (group, { projectRoot, spawn = spawnSync } = {}) => {
  const config = GROUPS[group];
  if (!config) throw new Error(`未知测试组: ${group}`);

  const root = projectRoot || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const files = await collectTestFiles(path.join(root, config.directory));
  if (files.length === 0) throw new Error(`${group} 没有找到 .test.mjs 文件`);

  console.log(`\n[${group}] ${files.length} 个测试文件`);
  const result = spawn(process.execPath, buildNodeTestArgs(group, files), {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status || 1;
  return result.status || 0;
};

const main = async () => {
  const requested = process.argv[2] || 'all';
  const groups = requested === 'all' ? Object.keys(GROUPS) : [requested];
  for (const group of groups) {
    const status = await runTestGroup(group);
    if (status !== 0) break;
  }
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`测试执行失败: ${error.message}`);
    process.exitCode = 1;
  });
}
