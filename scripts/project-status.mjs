#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { collectTestFiles } from './run-test-suite.mjs';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const git = (args, fallback = '') => {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

const countTestCases = async (files) => {
  let count = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    count += (source.match(/^\s*(?:test|it)\s*\(/gm) || []).length;
  }
  return count;
};

export const buildCurrentStatusMarkdown = (status) => {
  const mainDifference = status.aheadOfMain || status.behindMain
    ? `领先 \`origin/main\` ${status.aheadOfMain} 个提交，落后 ${status.behindMain} 个提交`
    : '与 `origin/main` 一致';

  return `# 当前项目状态

> 这是给项目负责人、开发伙伴、Claude Code 和 Codex 共同查看的动态状态页。
> 运行 \`npm run status:write\` 可重新生成。

## 真正开发基线

- 生成时间：${status.generatedAt}
- 当前分支：\`${status.branch}\`
- 当前提交：\`${status.commit}\`
- 最近版本标签：\`${status.latestTag || '暂无'}\`
- 与主分支关系：${mainDifference}
- 本地状态：${status.clean ? '工作树干净' : '存在未提交改动，接手前先确认归属'}

伙伴开始子功能开发时，必须从上面的明确提交或负责人指定的更新版本标签开始，不能只凭默认分支名称猜测。

## 当前工程基线

- package 版本字段：\`${status.packageVersion}\`
- 测试文件：${status.testFiles} 个
- 测试用例：约 ${status.testCases} 个
- 统一验证命令：\`npm run verify\`

不要仅凭 \`package.json\` 版本号判断线上版本；发布事实以版本标签、当前提交和云上健康信息共同确认。

## 协作规则

1. 开始任务前先读 \`AGENTS.md\`、\`CLAUDE.md\`、\`CONTEXT.md\`。
2. 每个伙伴从同一个明确基线创建独立分支。
3. 交付前必须运行 \`npm run verify\`。
4. 复发问题修好后，把根因、修复、如何避免写回 Hermes 记忆文件。
5. 未提交改动、部署状态和云上版本必须明确说明，不能靠口头猜测。
`;
};

export const collectProjectStatus = async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const groups = ['server', 'src', 'scripts'];
  const files = (await Promise.all(groups.map((directory) => collectTestFiles(path.join(projectRoot, directory))))).flat();
  const [left = '0', right = '0'] = git(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], '0\t0').split(/\s+/);

  return {
    generatedAt: new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'Asia/Shanghai',
    }).format(new Date()),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    commit: git(['rev-parse', '--short', 'HEAD'], 'unknown'),
    latestTag: git(['describe', '--tags', '--abbrev=0'], ''),
    behindMain: Number(left || 0),
    aheadOfMain: Number(right || 0),
    clean: git(['status', '--porcelain'], '') === '',
    packageVersion: packageJson.version || 'unknown',
    testFiles: files.length,
    testCases: await countTestCases(files),
  };
};

const main = async () => {
  const markdown = buildCurrentStatusMarkdown(await collectProjectStatus());
  if (process.argv.includes('--write')) {
    const outputPath = path.join(projectRoot, 'docs', 'CURRENT.md');
    await writeFile(outputPath, markdown, 'utf8');
    console.log(`当前状态已写入 ${outputPath}`);
  } else {
    console.log(markdown);
  }
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`生成当前状态失败: ${error.message}`);
    process.exitCode = 1;
  });
}
