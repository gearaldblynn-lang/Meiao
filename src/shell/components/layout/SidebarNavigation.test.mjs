import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');

test('landing navigation uses the same item geometry as module navigation', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');

  assert.match(source, /const LANDING: SidebarNavDef =/);
  assert.match(source, /\{renderItem\(LANDING\)\}/);
  assert.match(source, /className=\{`group relative flex h-\[44px\] w-full items-center rounded-2xl transition-all/);
  assert.match(source, /const isActive = activeModule === item\.module/);
  assert.match(source, /background: isActive \? 'var\(--accent-soft\)' : 'transparent'/);
  assert.doesNotMatch(source, /flex h-9 w-full/);
  assert.doesNotMatch(source, /h-9 min-w-0/);
  assert.doesNotMatch(source, /collapsed \? 'w-8 justify-center'/);
});

test('sidebar exposes a lightweight system announcement entry above settings', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const app = read('src/ShellMigratedApp.tsx');

  assert.match(source, /Bell size=\{20\}/);
  assert.match(source, /onOpenAnnouncement: \(\) => void/);
  assert.match(source, /公告/);
  assert.match(source, /renderAnnouncementItem/);
  assert.match(source, /renderAnnouncementItem\(\)/);
  assert.match(app, /onOpenAnnouncement=\{handleOpenAnnouncementPanel\}/);
});

test('sidebar keeps Smart Factory withdrawn from cloud navigation', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const app = read('src/ShellMigratedApp.tsx');

  const mainStart = source.indexOf('const MAIN: NavDef[] = [');
  const agentIndex = source.indexOf('AppModuleObj.AGENT_CENTER', mainStart);
  const smartFactoryIndex = source.indexOf('AppModuleObj.SMART_FACTORY', mainStart);
  const oneClickIndex = source.indexOf('AppModuleObj.ONE_CLICK', mainStart);

  assert.ok(agentIndex > -1, 'agent center nav item should exist');
  assert.ok(oneClickIndex > agentIndex, 'one-click should sit below agent center');
  assert.equal(smartFactoryIndex, -1, 'Smart Factory should not be in cloud sidebar navigation');
  assert.doesNotMatch(source, /Factory size=\{20\}/);
  assert.doesNotMatch(source, /label: '智能工厂'/);
  assert.doesNotMatch(app, /const SmartFactoryModule = lazy\(\(\) => import\('\.\/shell\/modules\/SmartFactory\/SmartFactoryModule'\)\)/);
  assert.doesNotMatch(app, /case AppModuleObj\.SMART_FACTORY:/);
  assert.match(app, /WITHDRAWN_CLOUD_MODULES/);
  assert.match(app, /AppModuleObj\.SMART_FACTORY/);
});

test('sidebar keeps AI customer service withdrawn from cloud navigation', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const app = read('src/ShellMigratedApp.tsx');

  const mainStart = source.indexOf('const MAIN: NavDef[] = [');
  const agentIndex = source.indexOf('AppModuleObj.AGENT_CENTER', mainStart);
  const customerServiceIndex = source.indexOf('AppModuleObj.AI_CUSTOMER_SERVICE', mainStart);

  assert.ok(agentIndex > -1, 'agent center nav item should exist');
  assert.equal(customerServiceIndex, -1, 'AI customer service should not be in cloud sidebar navigation');
  assert.doesNotMatch(source, /MessagesSquare size=\{20\}/);
  assert.doesNotMatch(source, /label: 'AI客服'/);
  assert.doesNotMatch(app, /const AiCustomerServiceModule = lazy\(\(\) => import\('\.\/shell\/modules\/AiCustomerService\/AiCustomerServiceModule'\)\)/);
  assert.doesNotMatch(app, /case AppModuleObj\.AI_CUSTOMER_SERVICE:/);
  assert.match(app, /WITHDRAWN_CLOUD_MODULES/);
  assert.match(app, /AppModuleObj\.AI_CUSTOMER_SERVICE/);
});
