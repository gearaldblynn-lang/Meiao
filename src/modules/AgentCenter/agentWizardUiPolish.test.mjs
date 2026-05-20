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
