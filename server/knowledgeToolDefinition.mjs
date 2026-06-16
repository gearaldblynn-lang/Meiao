export const SEARCH_KNOWLEDGE_TOOL = {
  type: 'function',
  function: {
    name: 'search_knowledge',
    description: '检索智能体绑定的私有知识库。当用户问题涉及产品规则、政策、流程、FAQ 等专有知识时调用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或问题，用自然语言描述要查什么' },
      },
      required: ['query'],
    },
  },
};

export const normalizeSearchKnowledgeArgs = (rawArgs = {}) => {
  const query = String(rawArgs?.query || '').trim();
  if (!query) {
    const error = new Error('search_knowledge 缺少 query');
    error.code = 'invalid_tool_args';
    throw error;
  }
  return { query };
};

