// 阶段5:工厂产出 → 智能体中心使用 的同步桥(纯函数层)。
// 工厂发布 agent 时,把 名称/人设prompt/模型/知识库原文 物化成智能体中心的
// 草稿 agent + 知识库文档;上线仍走智能体中心既有的 验证→发布 门禁,不绕过。
// 关联标记升级:智能体中心 agent/知识库 现通过结构化字段 factoryAgentId /
// factoryKnowledgeBaseId 关联工厂侧记录(单一判据,禁止在别处再写平行解析);
// 旧的 `[智能工厂同步:<factoryAgentId>]` description marker 仅作历史数据回退判据
// 保留,禁止新写入。重复发布时优先按结构化字段 find,再回退旧 marker。

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const asArray = (value) => (Array.isArray(value) ? value : []);

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

export const findLinkedAgentCenterAgent = (agents = [], factoryAgentId = '') => {
  const id = clean(factoryAgentId, 120);
  if (!id) return null;
  const list = asArray(agents);
  const byField = list.find((agent) => clean(agent?.factoryAgentId, 120) === id);
  if (byField) return byField;
  const marker = buildSmartFactoryLinkMarker(id);
  return list.find((agent) => String(agent?.description || '').includes(marker)) || null;
};

export const findLinkedKnowledgeBase = (knowledgeBases = [], factoryAgentId = '', factoryKnowledgeBaseId = '') => {
  const agentId = clean(factoryAgentId, 120);
  const kbId = clean(factoryKnowledgeBaseId, 120);
  if (!agentId || !kbId) return null;
  const list = asArray(knowledgeBases);
  const byField = list.find((kb) => clean(kb?.factoryAgentId, 120) === agentId && clean(kb?.factoryKnowledgeBaseId, 120) === kbId);
  if (byField) return byField;
  // 已知限制:旧 marker 只编码 agentId,同一 agent 多知识库的历史数据会命中第一条;
  // 已核实存量(本地库 2026-07-08)仅存在单 agent 单 KB,不做 name 消歧。
  const marker = buildSmartFactoryLinkMarker(agentId);
  return list.find((kb) => String(kb?.description || '').includes(marker)) || null;
};

// 输入:normalize 过的工厂 agent + 工厂配置;输出:物化计划(不执行任何写入)。
// knowledgeBases 只带该 agent 绑定的、有文档内容的库;文档取原文,由智能体中心
// 既有 ingestion(切片/嵌入)重新加工,不搬运工厂侧 chunk。
export const buildAgentCenterSyncPlan = ({ factoryAgent = {}, factoryConfig = {} } = {}) => {
  const factoryAgentId = clean(factoryAgent.id, 120);
  if (!factoryAgentId) return null;
  const marker = buildSmartFactoryLinkMarker(factoryAgentId);
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
    marker,
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
