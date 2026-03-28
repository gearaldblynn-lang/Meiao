import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('translation module keeps submode switching in the sidebar instead of the workspace header', () => {
  const translationModule = read('../modules/Translation/TranslationModule.tsx');
  const settingsSidebar = read('../components/SettingsSidebar.tsx');

  assert.match(settingsSidebar, /headerContent=/);
  assert.match(settingsSidebar, /主图出海/);
  assert.doesNotMatch(translationModule, /<SegmentedTabs/);
});

test('translation file processor no longer renders the main start button in the workbench toolbar', () => {
  const fileProcessor = read('./FileProcessor.tsx');

  assert.doesNotMatch(fileProcessor, /启动出海翻译/);
  assert.match(fileProcessor, /出海工作台/);
});

test('one click module keeps submode switching out of the workspace header', () => {
  const oneClickModule = read('../modules/OneClick/OneClickModule.tsx');
  const oneClickSidebar = read('../modules/OneClick/ConfigSidebar.tsx');

  assert.match(oneClickSidebar, /headerContent=/);
  assert.match(oneClickSidebar, /主图/);
  assert.match(oneClickSidebar, /详情/);
  assert.doesNotMatch(oneClickModule, /<SegmentedTabs/);
});

test('one click visuals avoid decorative english labels in the main work surfaces', () => {
  const oneClickSidebar = read('../modules/OneClick/ConfigSidebar.tsx');
  const workspacePrimitives = read('./ui/workspacePrimitives.tsx');
  const mainImage = read('../modules/OneClick/MainImageSubModule.tsx');
  const detailPage = read('../modules/OneClick/DetailPageSubModule.tsx');
  const header = read('./layout/Header.tsx');

  assert.doesNotMatch(oneClickSidebar, /Systematic Design Engine/);
  assert.doesNotMatch(mainImage, /Sync Multi-Screen Strategy/);
  assert.doesNotMatch(mainImage, /Ready for Production/);
  assert.doesNotMatch(detailPage, /Sequence Editor Console/);
  assert.doesNotMatch(detailPage, /Typography Logic Editor/);
  assert.doesNotMatch(detailPage, /Standby for Visual Logic/);
  assert.doesNotMatch(header, /Meiao Workspace/);
  assert.doesNotMatch(header, /Version/);
  assert.match(oneClickSidebar, /<PopoverSelect/);
  assert.match(workspacePrimitives, /bg-white\/72/);
  assert.doesNotMatch(oneClickSidebar, /ChoiceGrid/);
});

test('sidebar navigation separates business and system groups with readable labels', () => {
  const sidebar = read('./layout/SidebarNavigation.tsx');

  assert.doesNotMatch(sidebar, /业务模块/);
  assert.doesNotMatch(sidebar, /系统管理/);
  assert.doesNotMatch(sidebar, /rounded-\[24px\] border border-white\/8 bg-white\/5/);
  assert.match(sidebar, /iconOnly/);
});

test('secondary modules use the unified sidebar shell and shared popover selects', () => {
  const settingsSidebar = read('./SettingsSidebar.tsx');
  const retouchSidebar = read('../modules/Retouch/RetouchSidebar.tsx');
  const buyerShowSidebar = read('../modules/BuyerShow/BuyerShowSidebar.tsx');
  const videoSidebar = read('../modules/Video/VideoSidebar.tsx');
  const storyboardSidebar = read('../modules/Video/StoryboardSidebar.tsx');
  const veoSidebar = read('../modules/Video/VeoSidebar.tsx');

  assert.match(settingsSidebar, /<PopoverSelect/);
  assert.match(retouchSidebar, /<PopoverSelect/);
  assert.match(buyerShowSidebar, /<PopoverSelect/);
  assert.match(videoSidebar, /<PopoverSelect/);
  assert.match(storyboardSidebar, /<SidebarShell/);
  assert.match(storyboardSidebar, /<PopoverSelect/);
  assert.match(veoSidebar, /<SidebarShell/);
  assert.match(veoSidebar, /<PopoverSelect/);
});
