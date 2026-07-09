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

test('中心存量智能体接管分区:单一判据 + 现成接口 + 接管后刷新', () => {
  assert.ok(panel.includes('中心存量智能体'), '工作台必须有存量分区');
  assert.ok(panel.includes('接管到工厂'), '每项必须有接管按钮');
  assert.ok(panel.includes('fetchAgentSummaries'), '列表必须走现成 /api/agents 接口,不新增列表端点');
  assert.ok(panel.includes("import { isFactoryManagedAgent } from './factoryManagedConstants'"), '过滤必须复用前端单一判据');
  assert.ok(panel.includes('!isFactoryManagedAgent(agent)'), '只列未被工厂管理的智能体');
  assert.ok(panel.includes('adoptSmartFactoryCenterAgent'), '接管必须走专用 API');
  assert.ok(panel.includes('applyConfig(response.config)'), '接管成功必须刷新工厂配置');
  assert.ok(panel.includes('reloadCenterAgentSummaries'), '接管成功必须重拉存量列表');
  assert.ok(panel.includes('adoptableCenterAgents.length > 0'), '空列表不渲染分区');
  assert.ok(!panel.includes("factoryAgentId)').length === 0"), '禁止在面板里写平行的托管判据');
});
