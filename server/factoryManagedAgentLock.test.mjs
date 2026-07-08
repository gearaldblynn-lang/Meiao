import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('编辑锁守卫是单一函数且双模式8个编辑点全接入', () => {
  assert.ok(source.includes('const rejectIfFactoryManaged'), '必须有单一守卫函数');
  const count = source.split('rejectIfFactoryManaged(').length - 1;
  assert.equal(count, 9, `定义1+8路由接入点,实际 ${count}`);
  assert.ok(source.includes("errorCode: 'factory_managed_agent'"));
});

test('agent PATCH 仅 status 字段放行(上下线/停启用不锁)', () => {
  assert.ok(source.includes('const isStatusOnlyAgentPatch'));
  const count = source.split('isStatusOnlyAgentPatch(').length - 1;
  assert.equal(count, 3, `定义1+双模式agent PATCH 2处,实际 ${count}`);
});

test('publish/rollback/validate/DELETE 路由不接守卫', () => {
  // 抽取所有 rejectIfFactoryManaged 调用行,确认没有出现在 publish/rollback/validate 路由块内
  const lines = source.split('\n');
  const guardLines = lines.map((l, i) => l.includes('rejectIfFactoryManaged(') ? i : -1).filter(i => i >= 0);
  // 每个调用行往上找最近的路由判断行,不许出现在 publish/rollback/validate 路由块内
  for (const idx of guardLines) {
    const context = lines.slice(Math.max(0, idx - 30), idx).join('\n');
    assert.ok(
      !context.includes('agentPublishMatch') || context.lastIndexOf('agentDetailMatch') > context.lastIndexOf('agentPublishMatch'),
      `行${idx + 1}疑似接入了publish路由`
    );
    assert.ok(!context.includes('agentRollbackMatch'), `行${idx + 1}疑似接入了rollback路由`);
    assert.ok(!context.includes('agentVersionValidateMatch'), `行${idx + 1}疑似接入了validate路由`);
  }
});
