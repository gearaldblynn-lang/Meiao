// 工厂托管 agent 的前端单一判据与文案。
// 错误码/marker 前缀的服务端权威定义在 server/smartFactoryAgentBridge.mjs。
export const FACTORY_MANAGED_BADGE_LABEL = '由智能工厂管理';
export const FACTORY_MANAGED_GOTO_LABEL = '去智能工厂修改';
export const FACTORY_MANAGED_AGENT_ERROR_CODE = 'factory_managed_agent';
// 对齐服务端 403 message 原文(server/index.mjs factory_managed_agent 分支)
export const FACTORY_MANAGED_AGENT_NOTICE = '该智能体由智能工厂管理，请在智能工厂修改后重新发布。';

// 判据加 description 前缀回退,对齐服务端 isFactoryManagedAgent,
// 消除"旧标记 agent 前端不显示锁但后端 403"的体验割裂。
export const isFactoryManagedAgent = (agent?: { factoryAgentId?: string; description?: string } | null): boolean =>
  Boolean(agent?.factoryAgentId) || (agent?.description ?? '').includes('[智能工厂同步:');
