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

test('sidebar exposes Smart Factory as a main module below agent center', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const shellTypes = read('src/shell/types.ts');
  const appTypes = read('src/types.ts');
  const app = read('src/ShellMigratedApp.tsx');

  const mainStart = source.indexOf('const MAIN: NavDef[] = [');
  const agentIndex = source.indexOf('AppModuleObj.AGENT_CENTER', mainStart);
  const smartFactoryIndex = source.indexOf('AppModuleObj.SMART_FACTORY', mainStart);
  const customerServiceIndex = source.indexOf('AppModuleObj.AI_CUSTOMER_SERVICE', mainStart);
  const oneClickIndex = source.indexOf('AppModuleObj.ONE_CLICK', mainStart);

  assert.ok(agentIndex > -1, 'agent center nav item should exist');
  assert.ok(smartFactoryIndex > agentIndex, 'Smart Factory should sit below agent center');
  assert.ok(customerServiceIndex > smartFactoryIndex, 'Smart Factory should sit immediately above AI customer service');
  assert.ok(oneClickIndex > smartFactoryIndex, 'Smart Factory should sit above one-click main detail');
  assert.match(source, /Factory size=\{20\}/);
  assert.match(source, /label: '智能工厂'/);
  assert.match(shellTypes, /\| 'smart_factory'/);
  assert.match(shellTypes, /SMART_FACTORY: 'smart_factory' as AppModule/);
  assert.match(appTypes, /SMART_FACTORY = 'smart_factory'/);
  assert.match(app, /const SmartFactoryModule = lazy\(\(\) => import\('\.\/shell\/modules\/SmartFactory\/SmartFactoryModule'\)\)/);
  assert.match(app, /case AppModuleObj\.SMART_FACTORY:/);
});

test('sidebar exposes AI customer service as a global main module below agent center', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const shellTypes = read('src/shell/types.ts');
  const appTypes = read('src/types.ts');
  const app = read('src/ShellMigratedApp.tsx');

  const mainStart = source.indexOf('const MAIN: NavDef[] = [');
  const agentIndex = source.indexOf('AppModuleObj.AGENT_CENTER', mainStart);
  const customerServiceIndex = source.indexOf('AppModuleObj.AI_CUSTOMER_SERVICE', mainStart);
  const smartFactoryIndex = source.indexOf('AppModuleObj.SMART_FACTORY', mainStart);

  assert.ok(agentIndex > -1, 'agent center nav item should exist');
  assert.ok(customerServiceIndex > agentIndex, 'AI customer service should sit below agent center');
  assert.ok(customerServiceIndex > smartFactoryIndex, 'AI customer service should sit below Smart Factory');
  assert.match(source, /MessagesSquare size=\{20\}/);
  assert.match(source, /label: 'AI客服'/);
  assert.match(shellTypes, /\| 'ai_customer_service'/);
  assert.match(shellTypes, /AI_CUSTOMER_SERVICE: 'ai_customer_service' as AppModule/);
  assert.match(appTypes, /AI_CUSTOMER_SERVICE = 'ai_customer_service'/);
  assert.match(app, /const AiCustomerServiceModule = lazy\(\(\) => import\('\.\/shell\/modules\/AiCustomerService\/AiCustomerServiceModule'\)\)/);
  assert.match(app, /case AppModuleObj\.AI_CUSTOMER_SERVICE:/);
});
