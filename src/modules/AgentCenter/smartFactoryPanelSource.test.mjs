import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const panel = readFileSync(new URL('./SmartFactoryPanel.tsx', import.meta.url), 'utf8');

test('发布反馈:区分上线成功/验证失败/同步失败,展示人话原因', () => {
  assert.ok(panel.includes('agentCenterSync'), '发布 handler 必须消费 agentCenterSync');
  assert.ok(panel.includes('validationFailed'), '验证失败要单独提示');
  assert.ok(panel.includes('已发布并上线到智能体中心'), '上线成功文案');
  assert.ok(panel.includes('syncError'), '同步失败要透出原因');
});

test('删除确认文案含级联下线提示', () => {
  assert.ok(panel.includes('同时在智能体中心下线'), '删除确认必须告知级联下线');
});
