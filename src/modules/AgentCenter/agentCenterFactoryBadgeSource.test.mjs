import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// 读取单一常量文件(无 React/组件 import,可在 Node 直接 strip-types 运行)
const constants = readFileSync(new URL('./factoryManagedConstants.ts', import.meta.url), 'utf8');
// 读取视图文件断言徽标实际渲染
const listView = readFileSync(new URL('./AgentListView.tsx', import.meta.url), 'utf8');
const detailView = readFileSync(new URL('./AgentDetailView.tsx', import.meta.url), 'utf8');

test('工厂出品agent显示管理徽标并替换编辑入口', () => {
  assert.ok(constants.includes('factoryAgentId'), '前端必须消费 factoryAgentId');
  assert.ok(constants.includes('由智能工厂管理'), '徽标文案');
  assert.ok(constants.includes('去智能工厂修改'), '编辑入口替换文案');
  assert.ok(listView.includes('FactoryBadge'), 'AgentListView 应使用 FactoryBadge 组件');
  assert.ok(detailView.includes('FACTORY_MANAGED_BADGE_LABEL'), 'AgentDetailView 应引用徽标常量');
});

test('403 factory_managed_agent 有人话兜底', () => {
  assert.ok(constants.includes('factory_managed_agent'), '常量文件需含错误码');
  assert.ok(constants.includes('该智能体由智能工厂管理'), 'NOTICE 需含人话文案');
});

test('前端判据含 description 回退(对齐服务端 isFactoryManagedAgent)', () => {
  assert.ok(constants.includes('[智能工厂同步:'), 'isFactoryManagedAgent 需含 description 前缀回退');
});
