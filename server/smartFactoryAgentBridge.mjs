// 阶段5:工厂产出 → 智能体中心使用 的同步桥(纯函数层)。
// 工厂发布 agent 时,把 名称/人设prompt/模型/知识库原文 物化成智能体中心的
// 草稿 agent + 知识库文档;上线仍走智能体中心既有的 验证→发布 门禁,不绕过。
// 关联标记升级:智能体中心 agent/知识库 现通过结构化字段 factoryAgentId /
// factoryKnowledgeBaseId 关联工厂侧记录(单一判据,禁止在别处再写平行解析);
// 旧的 `[智能工厂同步:<factoryAgentId>]` description marker 仅作历史数据回退判据
// 保留,禁止新写入。重复发布时优先按结构化字段 find,再回退旧 marker。

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const asArray = (value) => (Array.isArray(value) ? value : []);

// 工厂 ID 清理函数:120 字符上限(与 description marker 编码保持一致),
// 供 index.mjs 的 findDb*/findLocal* 链接查找函数复用,消除散落的 120 硬编码。
export const cleanFactoryId = (value) => clean(value, 120);

export const SMART_FACTORY_LINK_PREFIX = '[智能工厂同步:';

// 同步管道错误码/验证探针文案单一来源:本地/MySQL 两条管道共用,
// 禁止在管道里再写字面量(散落的魔法字符串是根因库点名的反模式)。
export const SYNC_ERROR_CODES = {
  KB_REFRESH_FAILED: 'kb_refresh_failed',
  DRAFT_CREATE_FAILED: 'draft_create_failed',
  AGENT_MATERIALIZE_FAILED: 'agent_materialize_failed',
};

export const VALIDATION_PROBE_MESSAGE = '请用一句话说明这个智能体能做什么。';

export const buildSmartFactoryLinkMarker = (factoryAgentId) => (
  `${SMART_FACTORY_LINK_PREFIX}${clean(factoryAgentId, 120)}]`
);

// 解锁工厂 agent 时,从 description 中剥除旧 marker 行(结构化字段另行清空)。
// 放在 bridge 单一实现,index.mjs 调用此函数,避免在 index 里再出现前缀常量字面量。
export const stripFactoryMarkerLines = (description = '') => String(description || '')
  .split('\n')
  .filter((line) => !line.includes(SMART_FACTORY_LINK_PREFIX))
  .join('\n');

// 中心侧"是否工厂出品 agent"的单一判据:结构化字段 factoryAgentId 优先,
// 旧 description marker 前缀仅作历史数据回退。编辑锁等所有消费方一律调这里,
// 禁止在别处再写平行判据(散落判据是根因库点名的反模式)。
export const isFactoryManagedAgent = (agent) => (
  Boolean(agent?.factoryAgentId)
  || String(agent?.description || '').includes(SMART_FACTORY_LINK_PREFIX)
);

// 共享内部骨架:空判断 → 结构化字段 find → 旧 marker 回退。
// 导出函数各自传 field predicate(matchByField),签名和行为不变。
const findByFactoryLink = (list, factoryAgentId, matchByField) => {
  const id = clean(factoryAgentId, 120);
  if (!id) return null;
  const items = asArray(list);
  const byField = items.find(matchByField);
  if (byField) return byField;
  const marker = buildSmartFactoryLinkMarker(id);
  return items.find((item) => String(item?.description || '').includes(marker)) || null;
};

export const findLinkedAgentCenterAgent = (agents = [], factoryAgentId = '') => {
  const id = clean(factoryAgentId, 120);
  return findByFactoryLink(
    agents,
    factoryAgentId,
    (agent) => clean(agent?.factoryAgentId, 120) === id,
  );
};

export const findLinkedKnowledgeBase = (knowledgeBases = [], factoryAgentId = '', factoryKnowledgeBaseId = '') => {
  const agentId = clean(factoryAgentId, 120);
  const kbId = clean(factoryKnowledgeBaseId, 120);
  if (!kbId) return null;
  // 已知限制:旧 marker 只编码 agentId,同一 agent 多知识库的历史数据会命中第一条;
  // 已核实存量(本地库 2026-07-08)仅存在单 agent 单 KB,不做 name 消歧。
  return findByFactoryLink(
    knowledgeBases,
    factoryAgentId,
    (kb) => clean(kb?.factoryAgentId, 120) === agentId && clean(kb?.factoryKnowledgeBaseId, 120) === kbId,
  );
};

// 输入:normalize 过的工厂 agent + 工厂配置;输出:物化计划(不执行任何写入)。
// knowledgeBases 只带该 agent 绑定的、有文档内容的库;文档取原文,由智能体中心
// 既有 ingestion(切片/嵌入)重新加工,不搬运工厂侧 chunk。
// 反向桥:把中心存量 agent(无工厂来源)"接管"进工厂的物化计划(不执行任何写入)。
// 与 buildAgentCenterSyncPlan 互为镜像:那边是 工厂→中心 发布物化,这边是 中心→工厂 接管导入。
// 工厂侧 id 用确定性前缀派生,保证同一中心 agent 重复接管幂等(实际会被 isFactoryManagedAgent 守卫拦下)。
export const FACTORY_ADOPTED_AGENT_ID_PREFIX = 'agent-center-';
export const FACTORY_ADOPTED_KB_ID_PREFIX = 'kb-center-';

export const buildFactoryAdoptionPlan = ({ centerAgent = {}, centerVersion = {}, knowledgeBases = [] } = {}) => {
  const centerAgentId = clean(centerAgent.id, 100);
  if (!centerAgentId) return null;
  if (isFactoryManagedAgent(centerAgent)) return null;
  if (!clean(centerVersion.id, 120)) return null;
  const factoryAgentId = `${FACTORY_ADOPTED_AGENT_ID_PREFIX}${centerAgentId}`;
  const factoryKnowledgeBases = [];
  const kbLinks = [];
  const knowledgeBaseIds = [];
  for (const kb of asArray(knowledgeBases)) {
    const centerKnowledgeBaseId = clean(kb?.id, 100);
    if (!centerKnowledgeBaseId) continue;
    // 已被更早的接管/发布关联过的中心库:复用工厂侧同一份,不重复导入、不改写既有关联
    const alreadyLinked = clean(kb?.alreadyLinkedFactoryKnowledgeBaseId, 120);
    if (alreadyLinked) {
      knowledgeBaseIds.push(alreadyLinked);
      continue;
    }
    const factoryKnowledgeBaseId = `${FACTORY_ADOPTED_KB_ID_PREFIX}${centerKnowledgeBaseId}`;
    factoryKnowledgeBases.push({
      id: factoryKnowledgeBaseId,
      name: clean(kb?.name, 200) || '知识库',
      description: clean(kb?.description, 600),
      documents: asArray(kb?.documents)
        .map((document) => ({
          title: clean(document?.title, 200) || '未命名文档',
          content: String(document?.rawText ?? '').trim(),
          sourceType: clean(document?.sourceType, 40) || 'text',
        }))
        .filter((document) => document.content),
    });
    knowledgeBaseIds.push(factoryKnowledgeBaseId);
    kbLinks.push({ centerKnowledgeBaseId, factoryKnowledgeBaseId });
  }
  return {
    factoryAgentId,
    agentCenterAgentId: centerAgentId,
    factoryAgentPayload: {
      id: factoryAgentId,
      name: clean(centerAgent.name, 120) || '中心智能体',
      description: clean(centerAgent.description, 500),
      prompt: clean(centerVersion.systemPrompt, 20000),
      model: { provider: 'openai_compatible', model: clean(centerVersion.defaultChatModel, 160) || 'gpt-5.5' },
      knowledgeBaseIds,
    },
    factoryKnowledgeBases,
    centerLinks: { factoryAgentId, kbLinks },
    publishAfterCreate: clean(centerAgent.status, 40) === 'published',
  };
};

export const buildAgentCenterSyncPlan = ({ factoryAgent = {}, factoryConfig = {} } = {}) => {
  const factoryAgentId = clean(factoryAgent.id, 120);
  if (!factoryAgentId) return null;
  const boundKbIds = new Set(asArray(factoryAgent.knowledgeBaseIds).map((id) => clean(id, 120)).filter(Boolean));
  const knowledgeBases = asArray(factoryConfig.knowledgeBases)
    .filter((kb) => boundKbIds.has(clean(kb?.id, 120)))
    .map((kb) => ({
      factoryKnowledgeBaseId: clean(kb.id, 120),
      factoryAgentId,
      name: `工厂同步·${clean(kb.name, 100) || '知识库'}`,
      description: `由智能工厂知识库「${clean(kb.name, 100)}」同步。`,
      documents: asArray(kb.documents)
        .map((document) => ({
          title: clean(document?.title || document?.fileName, 255) || '未命名文档',
          rawText: String(document?.content ?? '').trim(),
          sourceType: clean(document?.sourceType, 40) || 'text',
        }))
        .filter((document) => document.rawText),
    }))
    .filter((kb) => kb.documents.length > 0);
  const model = clean(factoryAgent.model?.model, 160) || 'gpt-5.5';
  return {
    factoryAgentId,
    agentPayload: {
      name: clean(factoryAgent.name, 120) || '工厂智能体',
      description: `${clean(factoryAgent.description, 4000)}\n由智能工厂发布同步。`.trim(),
      factoryAgentId,
      department: '智能工厂',
      systemPrompt: clean(factoryAgent.prompt, 20000),
      defaultChatModel: model,
      allowedChatModels: [model],
    },
    knowledgeBases,
  };
};
