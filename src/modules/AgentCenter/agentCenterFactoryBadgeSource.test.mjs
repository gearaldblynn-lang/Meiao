import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const module_ = readFileSync(new URL('./AgentCenterModule.tsx', import.meta.url), 'utf8');

test('工厂出品agent显示管理徽标并替换编辑入口', () => {
  assert.ok(module_.includes('factoryAgentId'), '前端必须消费 factoryAgentId');
  assert.ok(module_.includes('由智能工厂管理'), '徽标文案');
  assert.ok(module_.includes('去智能工厂修改'), '编辑入口替换文案');
});

test('403 factory_managed_agent 有人话兜底', () => {
  assert.ok(module_.includes('factory_managed_agent'), '对后端锁错误码要有识别/兜底');
});
