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

test('sidebar exposes Smart Factory to admins only during phase-5 tuning', () => {
  // 2026-07-07 阶段5:智能工厂从"整体撤下"改为"仅管理员可见"——商家侧仍不可见,
  // admin 可进入实测删除/停用/链路调通。整体验收后再挪进 MAIN 对全员开放。
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const app = read('src/ShellMigratedApp.tsx');

  const mainStart = source.indexOf('const MAIN: NavDef[] = [');
  const mainEnd = source.indexOf('];', mainStart);
  const mainBlock = source.slice(mainStart, mainEnd);
  assert.ok(!mainBlock.includes('AppModuleObj.SMART_FACTORY'), 'Smart Factory must NOT be in MAIN (merchant-visible) nav');

  const adminStart = source.indexOf('const ADMIN_ONLY: NavDef[] = [');
  assert.ok(adminStart > -1, 'ADMIN_ONLY nav list should exist');
  const adminBlock = source.slice(adminStart, source.indexOf('];', adminStart));
  assert.ok(adminBlock.includes('AppModuleObj.SMART_FACTORY'), 'Smart Factory should be in ADMIN_ONLY nav');
  assert.match(source, /showAdminModules \? ADMIN_ONLY : \[\]/);

  assert.match(app, /const SmartFactoryModule = lazy\(\(\) => import\('\.\/shell\/modules\/SmartFactory\/SmartFactoryModule'\)\)/);
  assert.match(app, /case AppModuleObj\.SMART_FACTORY:/);
  assert.match(app, /showAdminModules=\{currentUser\?\.role === 'admin'\}/);
  // 非 admin 的 URL 直达/本地记忆恢复也必须被挡回 ONE_CLICK
  assert.match(app, /const isModuleWithdrawnForUser = \(module: AppModule, user\?: AuthUser \| null\): boolean => \{/);
  assert.match(app, /if \(user\?\.role === 'admin' && ADMIN_PREVIEW_MODULES\.has\(module\)\) return false;/);
  assert.match(app, /WITHDRAWN_CLOUD_MODULES/);
});

test('sidebar exposes Virtual Model Library to admins only', () => {
  const source = read('src/shell/components/layout/SidebarNavigation.tsx');
  const app = read('src/ShellMigratedApp.tsx');

  const adminStart = source.indexOf('const ADMIN_ONLY: NavDef[] = [');
  const adminBlock = source.slice(adminStart, source.indexOf('];', adminStart));
  assert.ok(adminBlock.includes('AppModuleObj.VIRTUAL_MODEL_LIBRARY'));
  assert.match(source, /module: AppModuleObj\.VIRTUAL_MODEL_LIBRARY[^\n]+label: '虚拟模特库'/);
  assert.doesNotMatch(source, /label: 'VirtualModelLibrary'/);
  assert.match(app, /const VirtualModelLibraryModule = lazy\(\(\) => import\('\.\/modules\/VirtualModelLibrary\/VirtualModelLibraryModule'\)\)/);
  assert.match(app, /case AppModuleObj\.VIRTUAL_MODEL_LIBRARY:/);
  assert.match(app, /AppModuleObj\.VIRTUAL_MODEL_LIBRARY/);
  assert.match(app, /ADMIN_PREVIEW_MODULES/);
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
