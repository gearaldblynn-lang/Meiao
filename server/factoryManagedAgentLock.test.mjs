import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

test('编辑锁守卫是单一函数且双模式8个编辑点全接入', () => {
  assert.ok(source.includes('const rejectIfFactoryManaged'), '必须有单一守卫函数');
  const definitionCount = source.split('const rejectIfFactoryManaged').length - 1;
  assert.equal(definitionCount, 1, `守卫必须只定义一次,实际 ${definitionCount}`);
  // 计数不含定义行:定义是箭头函数(const rejectIfFactoryManaged = (res, agent) =>),
  // 不含 "rejectIfFactoryManaged(" 子串,split 只数调用点:双模式 4+4 = 8。
  const callCount = source.split('rejectIfFactoryManaged(').length - 1;
  assert.equal(callCount, 8, `双模式8个路由接入点,实际 ${callCount}`);
  assert.ok(source.includes("errorCode: 'factory_managed_agent'"));
});

test('编辑锁判据下沉 bridge 单一来源,index 不写平行判据', () => {
  assert.ok(source.includes('isFactoryManagedAgent'), '守卫必须调用 bridge 导出的单一判据');
  // index.mjs 里不许再出现前缀常量或 marker 字面量平行判据(判据已下沉 bridge)
  assert.ok(!source.includes('SMART_FACTORY_LINK_PREFIX'), 'index 不得再引用前缀常量');
  assert.ok(!source.includes('[智能工厂同步:'), 'index 不得散落 marker 字面量');
});

test('agent PATCH 仅 status 字段放行,空 body 也放行(上下线/停启用不锁)', () => {
  assert.ok(source.includes('const isStatusOnlyAgentPatch'));
  const definitionCount = source.split('const isStatusOnlyAgentPatch').length - 1;
  assert.equal(definitionCount, 1, `放行判据必须只定义一次,实际 ${definitionCount}`);
  // 计数不含定义行(箭头函数定义无 "isStatusOnlyAgentPatch(" 子串):双模式 agent PATCH 各 1 = 2。
  const callCount = source.split('isStatusOnlyAgentPatch(').length - 1;
  assert.equal(callCount, 2, `双模式agent PATCH 2处调用,实际 ${callCount}`);
  // 空 body 放行语义:函数体不得有 keys.length 非空前置——空对象 every 为 true,
  // 空 PATCH 落到既有校验而不是被编辑锁 403。
  const fnStart = source.indexOf('const isStatusOnlyAgentPatch');
  const fnBody = source.slice(fnStart, source.indexOf(';', source.indexOf('every', fnStart)));
  assert.ok(!fnBody.includes('length'), '空 body 必须放行,判据不得有非空(length)前置');
  assert.ok(fnBody.includes("every((key) => key === 'status')"));
});

test('工厂删除级联下线中心agent(不物理删,解除锁定)', () => {
  assert.ok(source.includes('const unpublishLinkedAgentCenterAgentLocal'), '本地级联下线函数');
  assert.ok(source.includes('const unpublishLinkedAgentCenterAgentDb'), 'DB级联下线函数');
  const localDeleteStart = source.indexOf("localSmartFactoryAgentMatch && req.method === 'DELETE'");
  const localDeleteEnd = source.indexOf('localSmartFactoryAgentPublishMatch');
  assert.ok(localDeleteStart > 0 && localDeleteEnd > localDeleteStart);
  assert.ok(source.slice(localDeleteStart, localDeleteEnd).includes('unpublishLinkedAgentCenterAgentLocal'));
  const dbDeleteStart = source.indexOf("dbSmartFactoryAgentMatch && req.method === 'DELETE'");
  const dbDeleteEnd = source.indexOf('dbSmartFactoryAgentPublishMatch');
  assert.ok(dbDeleteStart > 0 && dbDeleteEnd > dbDeleteStart);
  assert.ok(source.slice(dbDeleteStart, dbDeleteEnd).includes('unpublishLinkedAgentCenterAgentDb'));
});

test('级联下线是解锁不是删除:清字段+清旧标记行,不物理删', () => {
  const start = source.indexOf('const unpublishLinkedAgentCenterAgentLocal');
  const end = source.indexOf('const syncFactoryAgentToLocalAgentCenter');
  assert.ok(start > 0 && end > start, '级联函数应定义在 sync 执行器之前');
  const fns = source.slice(start, end);
  assert.ok(!fns.includes('deleteLocalAgent(') && !fns.includes('deleteDbAgent('), '不许物理删除');
  assert.ok(fns.includes("status = 'draft'") || fns.includes("status: 'draft'") || fns.includes("SET status = 'draft'") || fns.includes("'draft'"), '下线为draft');
  assert.ok(fns.includes('factoryAgentId') && fns.includes('factory_agent_id'), '双模式都要清结构化字段');
});

test('publish/rollback/validate 路由不接守卫(agent DELETE 不锁由8点调用计数间接保证)', () => {
  // 启发式:每个守卫调用行往上回看 30 行(每个路由块都远小于此窗口,守卫又插在块首附近),
  // 该窗口内出现的路由 match 判断不许是 publish/rollback/validate。
  // agent DELETE 与 version DELETE 共享 "req.method === 'DELETE'" 字样,无法用本窗口法区分,
  // 由上面"恰好 8 个调用点"的计数测试间接锁定(agent DELETE 若接入会使计数变 9+)。
  const lines = source.split('\n');
  const guardLines = lines.map((l, i) => l.includes('rejectIfFactoryManaged(') ? i : -1).filter(i => i >= 0);
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
