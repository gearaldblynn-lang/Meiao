#!/usr/bin/env node

import { ESLint } from 'eslint';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_WARNING_BUDGET = 660;

export const summarizeLintResults = (results) => {
  const rules = new Map();
  let errorCount = 0;
  let warningCount = 0;
  let affectedFiles = 0;

  for (const result of results) {
    errorCount += Number(result.errorCount || 0);
    warningCount += Number(result.warningCount || 0);
    if (result.errorCount || result.warningCount) affectedFiles += 1;
    for (const message of result.messages || []) {
      const rule = message.ruleId || 'unknown';
      rules.set(rule, (rules.get(rule) || 0) + 1);
    }
  }

  return {
    errorCount,
    warningCount,
    affectedFiles,
    topRules: [...rules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
};

const readWarningBudget = (env = process.env) => {
  const parsed = Number(env.MEIAO_ESLINT_WARNING_BUDGET || DEFAULT_WARNING_BUDGET);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_WARNING_BUDGET;
};

const main = async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['src', 'server', 'scripts']);
  const summary = summarizeLintResults(results);
  const budget = readWarningBudget();

  console.log(`ESLint: ${summary.errorCount} errors, ${summary.warningCount} warnings, ${summary.affectedFiles} affected files (budget ${budget})`);
  if (summary.topRules.length > 0) {
    console.log(`Top rules: ${summary.topRules.map(([rule, count]) => `${rule}=${count}`).join(', ')}`);
  }

  if (summary.errorCount > 0 || summary.warningCount > budget) {
    const formatter = await eslint.loadFormatter('stylish');
    console.error(formatter.format(results));
    if (summary.warningCount > budget) {
      console.error(`ESLint warning budget exceeded by ${summary.warningCount - budget}. Historical debt may decrease, but must not increase.`);
    }
    process.exitCode = 1;
  }
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`ESLint 检查失败: ${error.message}`);
    process.exitCode = 1;
  });
}
