import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('current cloud app exposes filing title and homepage-only filing footer', () => {
  const html = read('index.html');
  const filingFooter = read('src/components/IcpFilingFooter.tsx');
  const shellApp = read('src/ShellMigratedApp.tsx');
  const loginScreen = read('src/shell/components/Internal/LoginScreen.tsx');
  const landingPage = read('src/shell/components/LandingPage.tsx');
  const deployDoc = read('docs/tencent-cloud-deploy.md');
  const agentsDoc = read('AGENTS.md');
  const all = `${filingFooter}\n${loginScreen}\n${landingPage}\n${deployDoc}\n${agentsDoc}`;

  assert.match(html, /<title>杭州梅奥AI工作台<\/title>/);
  assert.match(filingFooter, /浙ICP备2026015528号-1/);
  assert.match(filingFooter, /https:\/\/beian\.miit\.gov\.cn\//);
  assert.match(filingFooter, /target="_blank"/);
  assert.match(filingFooter, /rel="noopener noreferrer"/);
  assert.match(filingFooter, /杭州梅奥AI工作台/);
  assert.match(loginScreen, /<IcpFilingFooter \/>/);
  assert.match(landingPage, /className="relative z-10 flex min-h-full flex-1 flex-col items-center px-6 pt-10 pb-8"/);
  assert.match(landingPage, /className="mt-auto w-full pt-12"/);
  assert.match(landingPage, /<IcpFilingFooter \/>/);
  assert.doesNotMatch(shellApp, /<IcpFilingFooter \/>/);
  assert.doesNotMatch(filingFooter, /fixed bottom/);
  assert.match(all, /http:\/\/meiaoyuntai\.com/);
  assert.match(all, /www\.meiaoyuntai\.com/);
});
