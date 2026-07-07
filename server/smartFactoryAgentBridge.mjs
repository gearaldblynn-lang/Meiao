// 阶段5:工厂产出 → 智能体中心使用 的同步桥(纯函数层)。
// 工厂发布 agent 时,把 名称/人设prompt/模型/知识库原文 物化成智能体中心的
// 草稿 agent + 知识库文档;上线仍走智能体中心既有的 验证→发布 门禁,不绕过。
// 链接标记:智能体中心 agent 的 description 内嵌单一标记(单一判据,禁止在别处
// 再写平行解析);重复发布时凭标记 find,不重复建。

const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const asArray = (value) => (Array.isArray(value) ? value : []);

export const SMART_FACTORY_LINK_PREFIX = '[智能工厂同步:';

export const buildSmartFactoryLinkMarker = (factoryAgentId) => (
  `${SMART_FACTORY_LINK_PREFIX}${clean(factoryAgentId, 120)}]`
);

export const findLinkedAgentCenterAgent = (agents = [], factoryAgentId = '') => {
  const marker = buildSmartFactoryLinkMarker(factoryAgentId);
  if (marker === `${SMART_FACTORY_LINK_PREFIX}]`) return null;
  return asArray(agents).find((agent) => String(agent?.description || '').includes(marker)) || null;
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
      name: `工厂同步·${clean(kb.name, 100) || '知识库'}`,
      description: `${marker} 由智能工厂知识库「${clean(kb.name, 100)}」同步。`,
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
      description: `${clean(factoryAgent.description, 4000)}\n${marker} 由智能工厂发布同步,验证通过后即可发布上线。`.trim(),
      department: '智能工厂',
      systemPrompt: clean(factoryAgent.prompt, 20000),
      defaultChatModel: model,
      allowedChatModels: [model],
    },
    knowledgeBases,
  };
};
