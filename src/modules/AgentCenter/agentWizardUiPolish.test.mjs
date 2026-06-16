import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentWizardView.tsx', import.meta.url), 'utf8');

test('agent wizard edit page has complete productized step surfaces', () => {
  assert.match(source, /stepMeta/);
  assert.match(source, /智能体身份/);
  assert.match(source, /基础档案/);
  assert.match(source, /头像与归属/);
  assert.match(source, /提示词结构/);
  assert.match(source, /知识库范围/);
  assert.match(source, /策略面板/);
  assert.match(source, /提交前检查/);
  assert.match(source, /sticky bottom-0/);
  assert.match(source, /scrollIntoView/);
});

test('agent wizard still exposes the original creation and editing controls', () => {
  assert.match(source, /上传图标/);
  assert.match(source, /移除已上传图标/);
  assert.match(source, /自定义部门/);
  assert.match(source, /开场白/);
  assert.match(source, /全选/);
  assert.match(source, /全不选/);
  assert.match(source, /启用生图模型/);
  assert.match(source, /默认聊天模型/);
  assert.match(source, /功能接口/);
  assert.match(source, /保存草稿/);
});

test('agent wizard uses responsive content grids inside constrained shell widths', () => {
  assert.match(source, /max-w-\[1180px\]/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.doesNotMatch(source, /lg:grid-cols-\[320px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(source, /md:grid-cols-\[minmax\(0,280px\)_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(source, /2xl:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(source, /lg:grid-cols-\[minmax\(0,1\.2fr\)_minmax\(260px,0\.8fr\)\]/);
});

test('agent wizard keeps avatar choices compact and meaningful', () => {
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)\]/);
  assert.match(source, /item\.mark/);
  assert.match(source, /style=\{\{ background: item\.gradient, color: item\.foreground \}\}/);
  assert.doesNotMatch(source, /<div className=\{panelClassName\}>\s*<FieldLabel title="图标预览"/);
  assert.doesNotMatch(source, /h-9 w-9 rounded-\[15px\] bg-gradient-to-br/);
});

test('agent wizard keeps the stepper compact above the form', () => {
  assert.match(source, /grid-cols-5/);
  assert.match(source, /isCurrentStep/);
  assert.doesNotMatch(source, /2xl:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(source, /mt-5 space-y-2\.5/);
  assert.doesNotMatch(source, /w-full rounded-\[20px\] border px-3\.5 py-3 text-left/);
  assert.doesNotMatch(source, /line-clamp-2 text-\[11px\] font-medium leading-5 text-slate-500/);
});

test('agent wizard avoids black decorative avatar-like blocks in the compact header', () => {
  assert.match(source, /title=\{currentMeta\.sectionTitle\}/);
  assert.doesNotMatch(source, /icon=\{currentMeta\.icon\}/);
  assert.doesNotMatch(source, /index === currentStep \? 'bg-slate-900 text-white'/);
  assert.doesNotMatch(source, /SectionTitle eyebrow="基础档案" title="名称、头像与部门" detail=.* icon=/);
});

test('agent wizard help tooltips keep visible icons and stay inside narrow panels', () => {
  assert.match(source, /LegacyFaIcon/);
  assert.match(source, /const HelpTooltip/);
  assert.match(source, /align = 'left'/);
  assert.match(source, /max-w-\[min\(18rem,calc\(100vw-2rem\)\)\]/);
  assert.match(source, /align === 'right'/);
  assert.match(source, /<HelpTooltip label="聊天模型说明"/);
  assert.match(source, /<HelpTooltip label="检索参考数量说明" align="right"/);
  assert.doesNotMatch(source, /<i className="fas fa-circle-question/);
  assert.doesNotMatch(source, /absolute left-0 top-8 z-10 hidden w-72/);
});
