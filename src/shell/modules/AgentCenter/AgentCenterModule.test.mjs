import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellAppSource = readFileSync(new URL('../../../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const shellModuleSource = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');
const managerSource = readFileSync(new URL('../../../modules/AgentCenter/AgentCenterManager.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../../../modules/AgentCenter/AgentDetailView.tsx', import.meta.url), 'utf8');

test('shell app mounts the upgraded shell agent center instead of directly copying the old module', () => {
  assert.match(shellAppSource, /lazy\(\(\) => import\('\.\/shell\/modules\/AgentCenter\/AgentCenterModule'\)\)/);
  assert.doesNotMatch(shellModuleSource, /export \{ default \} from/);
  assert.match(shellModuleSource, /var\(--bg-surface\)/);
  assert.match(shellModuleSource, /moduleCopy/);
});

test('agent center keeps plaza, factory, and real studio workflows available', () => {
  assert.match(shellModuleSource, /workspaceMode/);
  assert.match(shellModuleSource, /智能体广场/);
  assert.match(shellModuleSource, /智能体工厂/);
  assert.match(shellModuleSource, /AgentCenterManager/);
  assert.match(shellModuleSource, /AgentCenterChatWorkspace/);
  assert.match(managerSource, /page === 'agent_studio'/);
  assert.match(detailSource, /智能体工作室/);
});
