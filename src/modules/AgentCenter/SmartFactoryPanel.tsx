import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  FilePlus2,
  FileText,
  Filter,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  MessageSquareText,
  PackagePlus,
  Plus,
  RefreshCcw,
  Rocket,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Video,
  Wrench,
} from 'lucide-react';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import { formatTime } from '../../utils/timeFormat';
import {
  addSmartFactoryKnowledgeDocument,
  createSmartFactoryAgent,
  createSmartFactoryKnowledgeBase,
  deleteSmartFactoryAgent,
  deleteSmartFactoryKnowledgeBase,
  deleteSmartFactoryTool,
  deleteSmartFactoryKnowledgeDocument,
  fetchSmartFactoryConfig,
  publishSmartFactoryAgent,
  retrainSmartFactoryKnowledgeDocument,
  saveSmartFactoryTool,
  searchSmartFactoryKnowledge,
  sendSmartFactoryChat,
  testSmartFactoryTool,
  updateSmartFactoryAgent,
  updateSmartFactoryKnowledgeBase,
  type SmartFactoryAgentCenterSync,
  type SmartFactoryConfig,
  type SmartFactoryPreviewResult,
} from '../../services/internalApi';
import SmartFactoryKnowledgeManager from './SmartFactoryKnowledgeManager';
import { resolveSmartFactoryConfigLoadErrorMessage } from './smartFactoryPreviewMode';

interface Props {
  onStatusMessage: (value: string) => void;
  onErrorMessage: (value: string) => void;
  onLoadingChange: (value: boolean) => void;
}

type SurfaceKey = 'home' | 'studio';
type MainArea = 'workspace' | 'knowledge' | 'tools';
type StudioTab = 'edit' | 'api' | 'logs' | 'monitor';
type AgentFilter = 'all' | 'chat' | 'workflow' | 'knowledge' | 'tool';
type EditorSection = 'prompt' | 'variables' | 'knowledge' | 'metadata' | 'tools' | 'vision' | 'model' | 'publish';

type AgentVariable = { key: string; label?: string; type?: string; required?: boolean; defaultValue?: string };
type MetadataFilter = { key: string; operator?: string; value?: string };
type VisionConfig = { enabled?: boolean; transferMethods?: string[]; imageFileSizeLimit?: number };
type KnowledgeChunkStrategy = 'general' | 'rule' | 'sop' | 'faq' | 'case';

const samplePrompts = ['退货规则是什么', '帮我创建飞书日报表格', '把售后规则整理成今天的处理清单'];

const mainAreas: Array<{ id: MainArea; label: string; icon: React.ElementType; description: string }> = [
  { id: 'workspace', label: '工作室', icon: Bot, description: '应用和智能体工作台' },
  { id: 'knowledge', label: '知识库', icon: Database, description: '数据集、文档训练和召回测试' },
  { id: 'tools', label: '工具', icon: Wrench, description: 'CLI、插件和工具授权' },
];

const studioTabs: Array<{ id: StudioTab; label: string; icon: React.ElementType; description: string }> = [
  { id: 'edit', label: '编辑', icon: SlidersHorizontal, description: '提示词、变量、知识库、工具、模型和发布' },
  { id: 'api', label: '访问 API', icon: Code2, description: '当前智能体内部调用 endpoint 和 payload' },
  { id: 'logs', label: '日志与标注', icon: FileText, description: '运行记录、Trace、人工标注入口' },
  { id: 'monitor', label: '监测', icon: BarChart3, description: '调用量、知识引用、工具调用和错误统计' },
];

const filters: Array<{ id: AgentFilter; label: string; icon: React.ElementType }> = [
  { id: 'all', label: '全部', icon: Sparkles },
  { id: 'chat', label: '聊天助手', icon: MessageSquareText },
  { id: 'workflow', label: '工作流', icon: SlidersHorizontal },
  { id: 'knowledge', label: '知识增强', icon: Database },
  { id: 'tool', label: '工具型', icon: Wrench },
];

const editorSections: Array<{ id: EditorSection; label: string; icon: React.ElementType; hint: string }> = [
  { id: 'prompt', label: '提示词', icon: FileText, hint: '编写智能体的系统提示词' },
  { id: 'variables', label: '变量', icon: SlidersHorizontal, hint: '表单变量和提示词变量插入' },
  { id: 'knowledge', label: '知识库', icon: Database, hint: '知识库选择、文件上传、训练、检索' },
  { id: 'metadata', label: '元数据过滤', icon: Filter, hint: '检索前的过滤条件' },
  { id: 'tools', label: '工具', icon: TerminalSquare, hint: 'CLI 工具注册、授权、测试' },
  { id: 'vision', label: '视觉', icon: Globe2, hint: '多模态输入开关与文件限制' },
  { id: 'model', label: '模型', icon: Settings2, hint: '从统一模型中心选择当前智能体运行模型' },
  { id: 'publish', label: '发布', icon: Rocket, hint: '发布前检查和运行验收' },
];

const emptyAgentDraft = {
  name: '',
  description: '',
  prompt: '你是梅奥智能工厂智能体，请优先使用绑定知识库和授权工具。',
  modelProvider: '',
  modelName: '',
  knowledgeBaseIds: [] as string[],
  toolNames: [] as string[],
  variables: [] as AgentVariable[],
  metadataFilters: [] as MetadataFilter[],
  vision: { enabled: false, transferMethods: ['local_file'], imageFileSizeLimit: 10 } as VisionConfig,
};

const emptyToolDraft = {
  name: 'feishu_create_sheet',
  type: 'cli' as 'cli' | 'builtin',
  description: '创建飞书表格',
  executorRef: 'feishu.create_sheet',
  riskLevel: 'safe',
  capability: '',
  icon: 'terminal',
  modelProvider: '',
  model: '',
  inputSchemaText: JSON.stringify({
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
    additionalProperties: false,
  }, null, 2),
};

const modelModeLabels: Record<string, string> = {
  chat: '对话模型',
  embedding: 'Embedding',
  rerank: 'Rerank',
  image: '图片生成',
  video: '视频生成',
};

const getModelMode = (mode?: string) => {
  const normalized = String(mode || 'chat').trim().toLowerCase();
  if (normalized === 'llm' || normalized === 'completion') return 'chat';
  if (normalized === 'text-embedding') return 'embedding';
  if (normalized === 'image-generation') return 'image';
  if (normalized === 'video-generation') return 'video';
  return modelModeLabels[normalized] ? normalized : 'chat';
};

const toModelOptionValue = (provider = '', model = '') => (provider && model ? `${provider}::${model}` : '');
const parseModelOptionValue = (value = '') => {
  const [provider = '', ...modelParts] = String(value || '').split('::');
  const model = modelParts.join('::');
  return provider && model ? { provider, model } : undefined;
};

const toolTemplates = [
  {
    label: '飞书表格',
    name: 'feishu_create_sheet',
    type: 'cli' as const,
    description: '创建飞书多维表或日报表格',
    executorRef: 'feishu.create_sheet',
    riskLevel: 'safe',
    capability: 'automation',
    icon: 'table',
    modelProvider: '',
    model: '',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string', description: '表格标题' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    label: 'HTTP API',
    name: 'http_api_call',
    type: 'cli' as const,
    description: '调用一个已授权的内部 HTTP API',
    executorRef: 'http.request',
    riskLevel: 'review',
    capability: 'api',
    icon: 'api',
    modelProvider: '',
    model: '',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, method: { type: 'string' }, body: { type: 'object' } },
      required: ['url', 'method'],
      additionalProperties: true,
    },
  },
  {
    label: 'Shell CLI',
    name: 'shell_cli_run',
    type: 'cli' as const,
    description: '调用白名单内的本地 CLI 命令',
    executorRef: 'shell.run',
    riskLevel: 'review',
    capability: 'cli',
    icon: 'terminal',
    modelProvider: '',
    model: '',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    label: '图片生成',
    name: 'generate_image',
    type: 'builtin' as const,
    description: '调用统一模型中心的图片模型生成或编辑图片',
    executorRef: 'media.generate_image',
    riskLevel: 'safe',
    capability: 'image',
    icon: 'image',
    modelProvider: 'kie',
    model: 'gpt-image-2',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片生成或编辑要求' },
        task_type: { type: 'string', enum: ['new_image', 'edit_image'] },
        input_image_urls: { type: 'array', items: { type: 'string' } },
        aspect_ratio: { type: 'string' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    label: '视频生成',
    name: 'generate_video',
    type: 'builtin' as const,
    description: '调用统一模型中心的视频模型生成短视频任务',
    executorRef: 'media.generate_video',
    riskLevel: 'safe',
    capability: 'video',
    icon: 'video',
    modelProvider: 'kie',
    model: 'veo3_fast',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频内容描述' },
        image_urls: { type: 'array', items: { type: 'string' } },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        duration: { type: 'number' },
      },
      required: ['prompt'],
      additionalProperties: true,
    },
  },
  {
    label: 'Seedance Fast 视频',
    name: 'generate_seedance_fast_video',
    type: 'builtin' as const,
    description: '调用 KIE Seedance Fast 生成短视频任务',
    executorRef: 'media.generate_video',
    riskLevel: 'safe',
    capability: 'video',
    icon: 'video',
    modelProvider: 'kie',
    model: 'bytedance/seedance-2-fast',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频内容描述' },
        image_urls: { type: 'array', items: { type: 'string' } },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        duration: { type: 'number' },
      },
      required: ['prompt'],
      additionalProperties: true,
    },
  },
];

const getToolVisual = (tool: { type?: string; icon?: string; executorRef?: string; capability?: string }) => {
  const key = `${tool.icon || ''} ${tool.capability || ''} ${tool.executorRef || ''}`.toLowerCase();
  if (key.includes('image')) return { Icon: ImageIcon, label: '图片', tone: 'good' as const };
  if (key.includes('video')) return { Icon: Video, label: '视频', tone: 'warn' as const };
  if (key.includes('feishu')) return { Icon: FilePlus2, label: '飞书', tone: 'good' as const };
  if (key.includes('http') || key.includes('api')) return { Icon: Globe2, label: 'API', tone: 'neutral' as const };
  return { Icon: TerminalSquare, label: tool.type === 'builtin' ? '内置' : 'CLI', tone: 'neutral' as const };
};

const getFirstSessionIdForAgent = (config: SmartFactoryConfig, agentId: string) => (
  config.sessions.find((session) => session.agentId === agentId)?.id || config.sessions[0]?.id || ''
);

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const getTraceList = (log: Record<string, unknown>) => (Array.isArray(log.trace) ? log.trace : []);
const getToolCount = (logs: Array<Record<string, unknown>>) => logs.reduce((sum, log) => (
  sum + getTraceList(log).filter((item) => String((item as Record<string, unknown>).event || '').includes('tool')).length
), 0);
const getKnowledgeCount = (logs: Array<Record<string, unknown>>) => logs.reduce((sum, log) => (
  sum + getTraceList(log).filter((item) => String((item as Record<string, unknown>).event || '').includes('knowledge')).length
), 0);

// agent 状态标签(已发布/草稿+时间),在 SmartFactory 列表和侧边栏两处复用
const agentStatusLabel = (agent: { status?: string; publishedAt?: number | null } | null | undefined): string => {
  if (!agent) return '';
  return agent.status === 'published'
    ? `已发布${agent.publishedAt ? `（${formatTime(agent.publishedAt)}）` : ''}`
    : '草稿';
};

const StatusPill = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' }) => {
  const style = tone === 'good'
    ? { background: 'rgba(34,197,94,.11)', color: '#15803d' }
    : tone === 'warn'
      ? { background: 'rgba(245,158,11,.12)', color: '#b45309' }
      : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' };
  return <span className="inline-flex h-6 items-center rounded-[6px] px-2 text-[11px] font-semibold" style={style}>{children}</span>;
};

type AreaAction = {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  primary?: boolean;
};

const SectionShell = ({
  id,
  title,
  hint,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  icon: React.ElementType;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <section className="rounded-[8px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }} data-section={id}>
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
      <span className="flex min-w-0 items-center gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Icon size={16} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
          <span className="mt-0.5 block truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{hint}</span>
        </span>
      </span>
      <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-tertiary)' }} />
    </button>
    {open && <div className="border-t px-4 py-4" style={{ borderColor: 'var(--border-subtle)' }}>{children}</div>}
  </section>
);

const SmartFactoryPanel: React.FC<Props> = ({ onStatusMessage, onErrorMessage, onLoadingChange }) => {
  const [surface, setSurface] = useState<SurfaceKey>('home');
  const [mainArea, setMainArea] = useState<MainArea>('workspace');
  const [tab, setTab] = useState<StudioTab>('edit');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState<SmartFactoryConfig | null>(null);
  const [result, setResult] = useState<SmartFactoryPreviewResult | null>(null);
  const [activeAgentId, setActiveAgentId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(samplePrompts[0]);
  const [agentDraft, setAgentDraft] = useState(emptyAgentDraft);
  const [toolDraft, setToolDraft] = useState(emptyToolDraft);
  const [toolTestTitle, setToolTestTitle] = useState('日报');
  const [knowledgeBaseName, setKnowledgeBaseName] = useState('商品资料库');
  const [knowledgeBaseDescription, setKnowledgeBaseDescription] = useState('用于训练商品、售后、运营资料。');
  const [activeKnowledgeBaseId, setActiveKnowledgeBaseId] = useState('');
  const [knowledgeTitle, setKnowledgeTitle] = useState('');
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [knowledgeFileName, setKnowledgeFileName] = useState('');
  const [knowledgeChunkStrategy, setKnowledgeChunkStrategy] = useState<KnowledgeChunkStrategy>('general');
  const [knowledgeMaxChunkChars, setKnowledgeMaxChunkChars] = useState('760');
  const [knowledgeQuery, setKnowledgeQuery] = useState('退货');
  const [knowledgeRetrievalTopK, setKnowledgeRetrievalTopK] = useState('3');
  const [knowledgeRetrievalThreshold, setKnowledgeRetrievalThreshold] = useState('1');
  const [knowledgeRetrievalMaxContextChars, setKnowledgeRetrievalMaxContextChars] = useState('2400');
  const [knowledgeEmbeddingModel, setKnowledgeEmbeddingModel] = useState('');
  const [knowledgeRerankModel, setKnowledgeRerankModel] = useState('');
  const [knowledgeResults, setKnowledgeResults] = useState<Array<Record<string, unknown>>>([]);
  const [openSections, setOpenSections] = useState<Record<EditorSection, boolean>>({
    prompt: true,
    variables: false,
    knowledge: true,
    metadata: false,
    tools: true,
    vision: false,
    model: false,
    publish: false,
  });

  const applyConfig = (nextConfig: SmartFactoryConfig) => {
    const firstAgent = nextConfig.agents.find((agent) => agent.status === 'published') || nextConfig.agents[0];
    const fallbackAgentId = firstAgent?.id || '';
    setConfig(nextConfig);
    setActiveAgentId((current) => (
      current && nextConfig.agents.some((agent) => agent.id === current) ? current : fallbackAgentId
    ));
    setActiveSessionId((current) => (
      current && nextConfig.sessions.some((session) => session.id === current)
        ? current
        : getFirstSessionIdForAgent(nextConfig, fallbackAgentId)
    ));
    setActiveKnowledgeBaseId((current) => (
      current && nextConfig.knowledgeBases.some((base) => base.id === current)
        ? current
        : nextConfig.knowledgeBases[0]?.id || ''
    ));
  };

  const runAction = async (successMessage: string, action: () => Promise<void>) => {
    setBusy(true);
    onLoadingChange(true);
    onStatusMessage('');
    onErrorMessage('');
    try {
      await action();
      onStatusMessage(successMessage);
    } catch (error: unknown) {
      onErrorMessage(error instanceof Error ? error.message : '智能工厂操作失败。');
    } finally {
      setBusy(false);
      onLoadingChange(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    void fetchSmartFactoryConfig()
      .then((configResponse) => {
        if (disposed) return;
        applyConfig(configResponse.config);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          onErrorMessage(resolveSmartFactoryConfigLoadErrorMessage(error));
        }
      });
    return () => {
      disposed = true;
    };
  }, [onErrorMessage]);

  const activeAgent = useMemo(() => (
    config?.agents.find((agent) => agent.id === activeAgentId) || config?.agents[0] || null
  ), [activeAgentId, config]);

  const activeSession = useMemo(() => (
    config?.sessions.find((session) => session.id === activeSessionId)
      || config?.sessions.find((session) => session.agentId === activeAgent?.id)
      || config?.sessions[0]
      || null
  ), [activeAgent?.id, activeSessionId, config]);

  const modelOptions = config?.models || [];
  const embeddingModelOptions = modelOptions.filter((model) => getModelMode(model.mode) === 'embedding');
  const rerankModelOptions = modelOptions.filter((model) => getModelMode(model.mode) === 'rerank');
  const activeKnowledgeBase = config?.knowledgeBases.find((base) => base.id === activeKnowledgeBaseId) || config?.knowledgeBases[0] || null;
  const runLogs = config?.runLogs || [];
  const sessionMessages = activeSession?.messages || [];
  const hasRealRelayTarget = Boolean((config?.modelProviders || []).some((provider) => provider.baseUrl && provider.hasCredential));
  const hasReadyKnowledge = Boolean((config?.knowledgeBases || []).some((base) => (base.documentCount || 0) > 0));
  const hasAuthorizedTool = Boolean((config?.tools || []).some((tool) => tool.authorized));
  const publishChecks = [
    { label: '模型已选择', done: Boolean(agentDraft.modelProvider && agentDraft.modelName) },
    { label: '提示词完整', done: agentDraft.prompt.trim().length >= 12 },
    { label: '知识库已绑定', done: agentDraft.knowledgeBaseIds.length > 0 && hasReadyKnowledge },
    { label: '工具已授权', done: agentDraft.toolNames.length > 0 && hasAuthorizedTool },
  ];
  const canPublish = publishChecks.every((item) => item.done);

  useEffect(() => {
    if (!activeAgent) return;
    setAgentDraft({
      name: activeAgent.name || '',
      description: activeAgent.description || '',
      prompt: activeAgent.prompt || emptyAgentDraft.prompt,
      modelProvider: String(activeAgent.model?.provider || modelOptions[0]?.provider || ''),
      modelName: String(activeAgent.model?.model || modelOptions[0]?.name || ''),
      knowledgeBaseIds: activeAgent.knowledgeBaseIds || [],
      toolNames: activeAgent.toolNames || [],
      variables: activeAgent.variables || [],
      metadataFilters: activeAgent.metadataFilters || [],
      vision: activeAgent.vision || emptyAgentDraft.vision,
    });
  }, [activeAgent?.id, config?.models.length]);

  useEffect(() => {
    if (!activeKnowledgeBase) return;
    const retrievalPolicy = activeKnowledgeBase.retrievalPolicy || {};
    setKnowledgeRetrievalTopK(String(retrievalPolicy.topK || 3));
    setKnowledgeRetrievalThreshold(String(retrievalPolicy.similarityThreshold ?? 1));
    setKnowledgeRetrievalMaxContextChars(String(retrievalPolicy.maxContextChars || 2400));
    setKnowledgeEmbeddingModel(toModelOptionValue(
      activeKnowledgeBase.embeddingModel?.provider || embeddingModelOptions[0]?.provider || '',
      activeKnowledgeBase.embeddingModel?.model || embeddingModelOptions[0]?.name || '',
    ));
    setKnowledgeRerankModel(toModelOptionValue(
      activeKnowledgeBase.rerankModel?.provider || rerankModelOptions[0]?.provider || '',
      activeKnowledgeBase.rerankModel?.model || rerankModelOptions[0]?.name || '',
    ));
  }, [activeKnowledgeBase?.id, embeddingModelOptions.length, rerankModelOptions.length]);

  const filteredAgents = (config?.agents || []).filter((agent) => {
    const text = [agent.name, agent.description, agent.status, String(agent.model?.model || '')].join(' ').toLowerCase();
    const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase());
    const hasKnowledge = Boolean(agent.knowledgeBaseIds?.length);
    const hasTools = Boolean(agent.toolNames?.length);
    const matchesFilter = filter === 'all'
      || filter === 'chat'
      || (filter === 'workflow' && hasKnowledge && hasTools)
      || (filter === 'knowledge' && hasKnowledge)
      || (filter === 'tool' && hasTools);
    return matchesQuery && matchesFilter;
  });

  const handleOpenAgent = (agentId: string, nextTab: StudioTab = 'edit') => {
    setActiveAgentId(agentId);
    if (config) setActiveSessionId(getFirstSessionIdForAgent(config, agentId));
    setTab(nextTab);
    setSurface('studio');
  };

  const handleNewAgent = async () => {
    await runAction('智能体草稿已创建。', async () => {
      const response = await createSmartFactoryAgent({
        name: agentDraft.name || '新智能体',
        description: agentDraft.description,
        prompt: agentDraft.prompt,
        model: { provider: agentDraft.modelProvider || modelOptions[0]?.provider, model: agentDraft.modelName || modelOptions[0]?.name },
        knowledgeBaseIds: agentDraft.knowledgeBaseIds,
        toolNames: agentDraft.toolNames,
        variables: agentDraft.variables,
        metadataFilters: agentDraft.metadataFilters,
        vision: agentDraft.vision,
      });
      applyConfig(response.config);
      setSurface('studio');
      setTab('edit');
    });
  };

  const handleSaveAgent = async () => {
    if (!activeAgent) return;
    await runAction('智能体配置已保存。', async () => {
      const response = await updateSmartFactoryAgent(activeAgent.id, {
        name: agentDraft.name,
        description: agentDraft.description,
        prompt: agentDraft.prompt,
        model: { provider: agentDraft.modelProvider, model: agentDraft.modelName },
        knowledgeBaseIds: agentDraft.knowledgeBaseIds,
        toolNames: agentDraft.toolNames,
        variables: agentDraft.variables,
        metadataFilters: agentDraft.metadataFilters,
        vision: agentDraft.vision,
      });
      applyConfig(response.config);
    });
  };

  const handlePublish = async () => {
    if (!activeAgent) return;
    let agentCenterSync: SmartFactoryAgentCenterSync | undefined;
    let succeeded = false;
    await runAction('', async () => {
      await handleSaveAgent();
      const response = await publishSmartFactoryAgent(activeAgent.id);
      agentCenterSync = response.agentCenterSync;
      applyConfig(response.config);
      succeeded = true;
    });
    // runAction sets onErrorMessage on throw; only handle sync-level feedback here
    if (!succeeded) return;
    if (agentCenterSync) {
      if ('syncError' in agentCenterSync) {
        onErrorMessage(`发布完成但同步智能体中心失败：${agentCenterSync.syncError}`);
        return;
      }
      if (agentCenterSync.synced && 'validationFailed' in agentCenterSync && agentCenterSync.validationFailed) {
        const msg = agentCenterSync.errorMessage ? `——${agentCenterSync.errorMessage}` : '';
        onErrorMessage(`发布未上线：验证失败${msg}（老版本仍在线）。`);
        return;
      }
    }
    // Only show success message when no error was set
    const publishSuccessMessage = (agentCenterSync?.synced && 'published' in agentCenterSync && agentCenterSync.published)
      ? '已发布并上线到智能体中心，商家侧立即可用。'
      : '智能体已发布，可以在调试预览中正式运行。';
    onStatusMessage(publishSuccessMessage);
  };

  const handleDeleteAgent = async () => {
    if (!activeAgent) return;
    if (!window.confirm(`确认删除智能体「${activeAgent.name}」？它的调试会话会一并删除，且不可恢复。将同时在智能体中心下线该智能体（聊天历史保留）。`)) return;
    let unlinkError: string | undefined;
    await runAction('智能体已删除。', async () => {
      const response = await deleteSmartFactoryAgent(activeAgent.id);
      if (response.agentCenterUnlink && 'error' in response.agentCenterUnlink) {
        unlinkError = response.agentCenterUnlink.error;
      }
      applyConfig(response.config);
      setSurface('home');
    });
    if (unlinkError) {
      onErrorMessage(`已删除，但智能体中心下线失败：${unlinkError}`);
    }
  };

  const handleToggleAgentEnabled = async () => {
    if (!activeAgent) return;
    const nextEnabled = activeAgent.enabled === false;
    await runAction(nextEnabled ? '智能体已启用。' : '智能体已停用。', async () => {
      const response = await updateSmartFactoryAgent(activeAgent.id, { enabled: nextEnabled });
      applyConfig(response.config);
    });
  };

  const handleSend = async () => {
    const nextMessage = message.trim();
    if (!nextMessage) {
      onErrorMessage('请输入对话内容。');
      return;
    }
    if (!activeAgent || !activeSession) {
      onErrorMessage('请先创建并发布一个智能体。');
      return;
    }
    await runAction('调试预览运行完成。', async () => {
      const response = await sendSmartFactoryChat({ agentId: activeAgent.id, sessionId: activeSession.id, message: nextMessage });
      applyConfig(response.config);
      setResult(response.result);
      setMessage('');
    });
  };

  const handleCreateKnowledgeBase = async () => {
    await runAction('知识库已创建。', async () => {
      const response = await createSmartFactoryKnowledgeBase({ name: knowledgeBaseName, description: knowledgeBaseDescription });
      applyConfig(response.config);
    });
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setKnowledgeFileName(file.name);
    setKnowledgeTitle(file.name.replace(/\.[^.]+$/, ''));
    setKnowledgeContent(content);
  };

  const handleAddKnowledge = async () => {
    if (!activeKnowledgeBaseId || !knowledgeTitle.trim()) {
      onErrorMessage('请选择知识库，并填写知识标题。');
      return;
    }
    await runAction('知识文档已上传并训练。', async () => {
      const response = await addSmartFactoryKnowledgeDocument({
        knowledgeBaseId: activeKnowledgeBaseId,
        document: {
          title: knowledgeTitle,
          content: knowledgeContent,
          fileName: knowledgeFileName,
          sourceType: knowledgeFileName ? 'file' : 'text',
          chunkStrategy: knowledgeChunkStrategy,
          maxChunkChars: Number(knowledgeMaxChunkChars) || undefined,
        },
      });
      applyConfig(response.config);
      setKnowledgeTitle('');
      setKnowledgeContent('');
      setKnowledgeFileName('');
    });
  };

  const handleRetrainDocument = async (documentId: string, content: string) => {
    await runAction('知识文档已重训。', async () => {
      const response = await retrainSmartFactoryKnowledgeDocument(documentId, {
        content,
        chunkStrategy: knowledgeChunkStrategy,
        maxChunkChars: Number(knowledgeMaxChunkChars) || undefined,
      });
      applyConfig(response.config);
    });
  };

  const handleDeleteDocument = async (documentId: string) => {
    await runAction('知识文档已删除。', async () => {
      const response = await deleteSmartFactoryKnowledgeDocument(documentId);
      applyConfig(response.config);
    });
  };

  const handleDeleteKnowledgeBase = async (knowledgeBaseId: string) => {
    const target = config?.knowledgeBases.find((item) => item.id === knowledgeBaseId);
    if (!window.confirm(`确认删除知识库「${target?.name || knowledgeBaseId}」？文档、分段和智能体绑定都会被移除。`)) return;
    await runAction('知识库已删除。', async () => {
      const response = await deleteSmartFactoryKnowledgeBase(knowledgeBaseId);
      applyConfig(response.config);
    });
  };

  const handleSearchKnowledge = async () => {
    await runAction('知识库检索测试完成。', async () => {
      const response = await searchSmartFactoryKnowledge({
        query: knowledgeQuery,
        knowledgeBaseIds: activeKnowledgeBaseId ? [activeKnowledgeBaseId] : [],
        retrievalPolicy: {
          topK: Number(knowledgeRetrievalTopK) || 3,
          similarityThreshold: Number(knowledgeRetrievalThreshold) || 0,
          maxContextChars: Number(knowledgeRetrievalMaxContextChars) || 2400,
        },
        ...(parseModelOptionValue(knowledgeEmbeddingModel) ? { embeddingModel: parseModelOptionValue(knowledgeEmbeddingModel) } : {}),
        ...(parseModelOptionValue(knowledgeRerankModel) ? { rerankModel: parseModelOptionValue(knowledgeRerankModel) } : {}),
      });
      setKnowledgeResults(response.search.results);
    });
  };

  const handleSaveKnowledgeBaseSettings = async () => {
    if (!activeKnowledgeBaseId) {
      onErrorMessage('请选择知识库。');
      return;
    }
    await runAction('知识库设置已保存。', async () => {
      const response = await updateSmartFactoryKnowledgeBase(activeKnowledgeBaseId, {
        name: activeKnowledgeBase?.name,
        description: activeKnowledgeBase?.description,
        embeddingModel: parseModelOptionValue(knowledgeEmbeddingModel),
        rerankModel: parseModelOptionValue(knowledgeRerankModel),
        retrievalPolicy: {
          topK: Number(knowledgeRetrievalTopK) || 3,
          similarityThreshold: Number(knowledgeRetrievalThreshold) || 0,
          maxContextChars: Number(knowledgeRetrievalMaxContextChars) || 2400,
        },
      });
      applyConfig(response.config);
    });
  };

  const handleSaveTool = async () => {
    await runAction('CLI 工具配置已保存。', async () => {
      const response = await saveSmartFactoryTool(toolDraft);
      applyConfig(response.config);
    });
  };

  const handleUseToolTemplate = (template: typeof toolTemplates[number]) => {
    setToolDraft({
      name: template.name,
      type: template.type,
      description: template.description,
      executorRef: template.executorRef,
      riskLevel: template.riskLevel,
      capability: template.capability,
      icon: template.icon,
      modelProvider: template.modelProvider,
      model: template.model,
      inputSchemaText: JSON.stringify(template.inputSchema, null, 2),
    });
  };

  const handleTestTool = async () => {
    await runAction('工具测试完成。', async () => {
      const payload = toolDraft.executorRef.startsWith('media.')
        ? { prompt: toolTestTitle || '生成一张简洁的商品展示图' }
        : { title: toolTestTitle };
      const response = await testSmartFactoryTool(toolDraft.name, payload);
      if (!response.ok) throw new Error(response.observation || '工具测试失败。');
    });
  };

  const handleDeleteTool = async (toolName: string) => {
    if (!window.confirm(`确认删除工具 ${toolName}？已绑定智能体会自动解除该工具。`)) return;
    await runAction('工具已删除。', async () => {
      const response = await deleteSmartFactoryTool(toolName);
      applyConfig(response.config);
    });
  };

  const toggleKnowledge = (id: string) => {
    setAgentDraft((prev) => ({
      ...prev,
      knowledgeBaseIds: prev.knowledgeBaseIds.includes(id)
        ? prev.knowledgeBaseIds.filter((item) => item !== id)
        : [...prev.knowledgeBaseIds, id],
    }));
  };

  const toggleTool = (name: string) => {
    setAgentDraft((prev) => ({
      ...prev,
      toolNames: prev.toolNames.includes(name)
        ? prev.toolNames.filter((item) => item !== name)
        : [...prev.toolNames, name],
    }));
  };

  const updateVariable = (index: number, patch: Partial<AgentVariable>) => {
    setAgentDraft((prev) => ({
      ...prev,
      variables: prev.variables.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const updateMetadataFilter = (index: number, patch: Partial<MetadataFilter>) => {
    setAgentDraft((prev) => ({
      ...prev,
      metadataFilters: prev.metadataFilters.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };

  const openMainArea = (nextArea: MainArea) => {
    setMainArea(nextArea);
    setSurface('home');
  };

  const renderMainAreaNav = () => (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto" aria-label="智能工厂主导航">
      {mainAreas.map((item) => {
        const Icon = item.icon;
        const active = mainArea === item.id;
        return (
          <button key={item.id} type="button" onClick={() => openMainArea(item.id)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold" style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}>
            <Icon size={15} /> {item.label}
          </button>
        );
      })}
    </div>
  );

  const renderAreaFrame = ({
    title,
    description,
    icon: Icon,
    actions = [],
    content,
  }: {
    title: string;
    description: string;
    icon: React.ElementType;
    actions?: AreaAction[];
    content: React.ReactNode;
  }) => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 rounded-[8px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="border-b px-4 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
          {renderMainAreaNav()}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <div className="mt-2 flex min-w-0 items-center gap-2">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Icon size={16} />
              </span>
              <h2 className="truncate text-[18px] font-semibold tracking-[0]" style={{ color: 'var(--text-primary)' }}>{title}</h2>
              <span className="hidden text-[12px] md:inline" style={{ color: 'var(--text-tertiary)' }}>{description}</span>
            </div>
          </div>
          {!!actions.length && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions.map((action) => {
                const ActionIcon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: action.primary ? 'var(--accent)' : 'var(--border-subtle)',
                      background: action.primary ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: action.primary ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    <ActionIcon size={15} /> {action.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 min-h-0 flex-1 overflow-auto px-1 pb-5">
        {content}
      </div>
    </div>
  );

  const renderWorkspaceContent = () => (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {filters.map((item) => {
            const Icon = item.icon;
            const active = filter === item.id;
            return (
              <button key={item.id} type="button" onClick={() => setFilter(item.id)} className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: active ? 'var(--accent)' : 'var(--border-subtle)', background: active ? 'var(--accent-soft)' : 'var(--bg-surface)', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}>
                <Icon size={14} /> {item.label}
              </button>
            );
          })}
        </div>
        <div className="flex h-9 min-w-[280px] items-center gap-2 rounded-[8px] border px-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <Search size={15} color="var(--text-tertiary)" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-full flex-1 bg-transparent text-[12px] outline-none" placeholder="搜索应用" style={{ color: 'var(--text-primary)' }} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <WorkspaceShellCard className="p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>创建应用</p>
          <div className="mt-4 space-y-2">
            {[
              { label: '创建空白应用', icon: FilePlus2, action: handleNewAgent },
              { label: '从模板创建', icon: Sparkles, action: () => setFilter('workflow') },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.label} type="button" onClick={item.action} className="flex w-full items-center justify-between rounded-[8px] border px-3 py-3 text-left text-[13px] font-semibold" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                  <span className="inline-flex items-center gap-2"><Icon size={16} />{item.label}</span>
                  <ChevronRight size={15} color="var(--text-tertiary)" />
                </button>
              );
            })}
          </div>
          <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>当前真实链路</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill tone={hasRealRelayTarget ? 'good' : 'warn'}>模型中转 {hasRealRelayTarget ? '已配置' : '待配置 Base URL'}</StatusPill>
              <StatusPill tone={hasReadyKnowledge ? 'good' : 'warn'}>知识库 {hasReadyKnowledge ? '可检索' : '待训练'}</StatusPill>
              <StatusPill tone={hasAuthorizedTool ? 'good' : 'warn'}>CLI 工具 {hasAuthorizedTool ? '可调用' : '待授权'}</StatusPill>
            </div>
          </div>
        </WorkspaceShellCard>

        <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredAgents.map((agent) => (
            <button key={agent.id} type="button" onClick={() => handleOpenAgent(agent.id)} className="min-h-[172px] rounded-[8px] border p-4 text-left transition hover:-translate-y-0.5" style={{ borderColor: agent.id === activeAgent?.id ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)', boxShadow: '0 14px 34px rgba(15,23,42,.06)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Bot size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>AGENT · {agentStatusLabel(agent)}</p>
                  </div>
                </div>
                <ChevronRight size={16} color="var(--text-tertiary)" />
              </div>
              <p className="mt-4 line-clamp-2 min-h-[40px] text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{agent.description || '进入应用后补充用途、模型、知识库和工具。'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill>{String(agent.model?.model || '未设模型')}</StatusPill>
                <StatusPill>{agent.knowledgeBaseIds?.length || 0} 知识库</StatusPill>
                <StatusPill>{agent.toolNames?.length || 0} 工具</StatusPill>
              </div>
            </button>
          ))}
          {!filteredAgents.length && (
            <div className="rounded-[8px] border px-5 py-10 text-center md:col-span-2 xl:col-span-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
              没有匹配应用，调整筛选或创建一个新应用。
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderAppSidebar = () => (
    <WorkspaceShellCard className="flex min-h-0 flex-col overflow-hidden p-0" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <div className="border-b p-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <button type="button" onClick={() => setSurface('home')} className="mb-4 inline-flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
          <ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} /> 返回应用列表
        </button>
        <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Bot size={20} /></span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{activeAgent?.name || '智能体工作室'}</p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{agentStatusLabel(activeAgent)} · AGENT</p>
            </div>
          </div>
          <p className="mt-3 line-clamp-2 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{activeAgent?.description || '配置智能体能力。'}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleAgentEnabled}
              className="rounded-[6px] border px-2.5 py-1.5 text-[11px] font-medium transition hover:opacity-80"
              style={{ borderColor: 'var(--border-subtle)', color: activeAgent?.enabled === false ? 'var(--accent)' : 'var(--text-secondary)', background: 'transparent' }}
            >
              {activeAgent?.enabled === false ? '启用' : '停用'}
            </button>
            <button
              type="button"
              onClick={handleDeleteAgent}
              className="rounded-[6px] border px-2.5 py-1.5 text-[11px] font-medium transition hover:opacity-80"
              style={{ borderColor: 'rgba(220,38,38,.35)', color: 'rgb(220,38,38)', background: 'transparent' }}
            >
              删除
            </button>
            {activeAgent?.enabled === false ? (
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>已停用</span>
            ) : null}
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-auto p-3">
        {studioTabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className="mb-1 flex w-full items-center gap-3 rounded-[8px] px-3 py-3 text-left" style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}>
              <Icon size={17} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{item.label}</span>
                <span className="mt-0.5 block truncate text-[11px]" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>{item.description}</span>
              </span>
            </button>
          );
        })}
      </nav>
    </WorkspaceShellCard>
  );

  const renderPromptEditor = () => (
    <div className="rounded-[9px] p-0.5" style={{ background: 'linear-gradient(90deg, rgba(37,99,235,.95), rgba(14,165,233,.85))' }}>
      <div className="flex min-h-[320px] flex-col rounded-[8px]" style={{ background: 'var(--bg-input)' }}>
        <div className="flex h-9 items-center justify-between border-b px-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <button type="button" className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            <Sparkles size={14} /> 插入变量
          </button>
          <span className="rounded-[4px] border px-1.5 py-0.5 text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>{agentDraft.prompt.length}</span>
        </div>
        <textarea
          value={agentDraft.prompt}
          onChange={(event) => setAgentDraft((prev) => ({ ...prev, prompt: event.target.value }))}
          className="min-h-[280px] flex-1 resize-none bg-transparent px-4 py-3 text-[13px] leading-6 outline-none"
          placeholder="在这里写你的提示词，输入 / 插入变量，输入 { 插入上下文。"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>
    </div>
  );

  const renderEditTab = () => (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-h-0 overflow-auto pr-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>编辑</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>按能力分块折叠配置智能体。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setOpenSections((prev) => ({ ...prev, model: true }))} className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              <Settings2 size={15} /> Agent 设置
            </button>
            <select value={`${agentDraft.modelProvider}::${agentDraft.modelName}`} onChange={(event) => {
              const [provider, model] = event.target.value.split('::');
              setAgentDraft((prev) => ({ ...prev, modelProvider: provider, modelName: model }));
            }} className="h-9 rounded-[8px] border px-3 text-[12px] font-semibold outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              {modelOptions.map((model) => <option key={`${model.provider}:${model.name}`} value={`${model.provider}::${model.name}`}>{model.name}</option>)}
            </select>
            <button type="button" onClick={handlePublish} disabled={!canPublish || busy} className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
              <Rocket size={15} /> 发布
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {editorSections.map((section) => (
            <SectionShell key={section.id} id={section.id} title={section.label} hint={section.hint} icon={section.icon} open={openSections[section.id]} onToggle={() => setOpenSections((prev) => ({ ...prev, [section.id]: !prev[section.id] }))}>
              {section.id === 'prompt' && (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input value={agentDraft.name} onChange={(event) => setAgentDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[13px] outline-none" placeholder="智能体名称" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    <input value={agentDraft.description} onChange={(event) => setAgentDraft((prev) => ({ ...prev, description: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[13px] outline-none" placeholder="用途描述" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                  </div>
                  {renderPromptEditor()}
                </div>
              )}

              {section.id === 'variables' && (
                <div className="space-y-3">
                  {agentDraft.variables.map((variable, index) => (
                    <div key={`${variable.key}-${index}`} className="grid gap-2 rounded-[8px] border p-3 md:grid-cols-[1fr_1fr_120px_80px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                      <input value={variable.key} onChange={(event) => updateVariable(index, { key: event.target.value })} className="h-9 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="key" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <input value={variable.label || ''} onChange={(event) => updateVariable(index, { label: event.target.value })} className="h-9 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="显示名" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <select value={variable.type || 'text'} onChange={(event) => updateVariable(index, { type: event.target.value })} className="h-9 rounded-[8px] border px-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                        <option value="text">text</option>
                        <option value="number">number</option>
                        <option value="select">select</option>
                      </select>
                      <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={variable.required === true} onChange={(event) => updateVariable(index, { required: event.target.checked })} /> 必填
                      </label>
                    </div>
                  ))}
                  <button type="button" onClick={() => setAgentDraft((prev) => ({ ...prev, variables: [...prev.variables, { key: `var_${prev.variables.length + 1}`, label: '新变量', type: 'text', required: false, defaultValue: '' }] }))} className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <Plus size={14} /> 添加变量
                  </button>
                </div>
              )}

              {section.id === 'knowledge' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                    <div>
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>绑定已有知识库</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>知识库创建、文档上传、训练和召回测试已移到独立知识库页面。</p>
                    </div>
                    <button type="button" onClick={() => openMainArea('knowledge')} className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
                      <Database size={15} /> 管理知识库
                    </button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(config?.knowledgeBases || []).map((base) => (
                      <label key={base.id} className="flex items-center justify-between rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: agentDraft.knowledgeBaseIds.includes(base.id) ? 'var(--accent-soft)' : 'var(--bg-elevated)' }}>
                        <span>
                          <span className="block text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{base.name}</span>
                          <span className="mt-1 block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{base.documentCount || 0} 文档 · {base.chunkCount || 0} chunks</span>
                        </span>
                        <input type="checkbox" checked={agentDraft.knowledgeBaseIds.includes(base.id)} onChange={() => toggleKnowledge(base.id)} />
                      </label>
                    ))}
                    {!(config?.knowledgeBases || []).length && (
                      <div className="rounded-[8px] border px-4 py-8 text-center text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                        暂无可绑定知识库，请先进入知识库页面创建。
                      </div>
                    )}
                  </div>
                </div>
              )}

              {section.id === 'metadata' && (
                <div className="space-y-3">
                  {agentDraft.metadataFilters.map((filterItem, index) => (
                    <div key={`${filterItem.key}-${index}`} className="grid gap-2 md:grid-cols-[1fr_140px_1fr]" >
                      <input value={filterItem.key} onChange={(event) => updateMetadataFilter(index, { key: event.target.value })} className="h-9 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="字段" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <select value={filterItem.operator || 'contains'} onChange={(event) => updateMetadataFilter(index, { operator: event.target.value })} className="h-9 rounded-[8px] border px-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                        <option value="contains">contains</option>
                        <option value="equals">equals</option>
                      </select>
                      <input value={filterItem.value || ''} onChange={(event) => updateMetadataFilter(index, { value: event.target.value })} className="h-9 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="值" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    </div>
                  ))}
                  <button type="button" onClick={() => setAgentDraft((prev) => ({ ...prev, metadataFilters: [...prev.metadataFilters, { key: 'source', operator: 'contains', value: '' }] }))} className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <Plus size={14} /> 添加过滤条件
                  </button>
                </div>
              )}

              {section.id === 'tools' && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-2">
                    {(config?.tools || []).map((tool) => {
                      const visual = getToolVisual(tool);
                      const Icon = visual.Icon;
                      return (
                        <label key={tool.name} className="flex items-center justify-between rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: agentDraft.toolNames.includes(tool.name) ? 'var(--accent-soft)' : 'var(--bg-elevated)' }}>
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--bg-surface)', color: 'var(--accent)' }}>
                              <Icon size={16} />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{tool.name}</span>
                              <span className="mt-1 block truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{visual.label} · {tool.executorRef} · {tool.model ? `${tool.modelProvider || 'model'} / ${tool.model}` : (tool.authorized ? '已授权' : '未授权')}</span>
                            </span>
                          </span>
                          <input type="checkbox" checked={agentDraft.toolNames.includes(tool.name)} onChange={() => toggleTool(tool.name)} />
                        </label>
                      );
                    })}
                  </div>
                  <div className="space-y-3">
                    <input value={toolDraft.name} onChange={(event) => setToolDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="工具名" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    <select value={toolDraft.type} onChange={(event) => setToolDraft((prev) => ({ ...prev, type: event.target.value === 'builtin' ? 'builtin' : 'cli' }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                      <option value="cli">CLI / 外部插件</option>
                      <option value="builtin">内置媒体工具</option>
                    </select>
                    <input value={toolDraft.executorRef} onChange={(event) => setToolDraft((prev) => ({ ...prev, executorRef: event.target.value }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="executorRef" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={toolDraft.capability} onChange={(event) => setToolDraft((prev) => ({ ...prev, capability: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="能力：image / video / cli" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <input value={toolDraft.icon} onChange={(event) => setToolDraft((prev) => ({ ...prev, icon: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="图标：image / video" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <input value={toolDraft.modelProvider} onChange={(event) => setToolDraft((prev) => ({ ...prev, modelProvider: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="模型渠道：kie" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <input value={toolDraft.model} onChange={(event) => setToolDraft((prev) => ({ ...prev, model: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="模型名：gpt-image-2 / veo3_fast" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    </div>
                    <textarea value={toolDraft.inputSchemaText} onChange={(event) => setToolDraft((prev) => ({ ...prev, inputSchemaText: event.target.value }))} className="min-h-[126px] w-full resize-none rounded-[8px] border px-3 py-2 text-[11px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                    <button type="button" onClick={handleSaveTool} className="h-9 w-full rounded-[8px] px-3 text-[12px] font-semibold text-white" style={{ background: 'var(--accent)' }}>保存工具</button>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input value={toolTestTitle} onChange={(event) => setToolTestTitle(event.target.value)} className="h-9 rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                      <button type="button" onClick={handleTestTool} className="h-9 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>测试</button>
                    </div>
                  </div>
                </div>
              )}

              {section.id === 'vision' && (
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex h-10 items-center gap-2 rounded-[8px] border px-3 text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={agentDraft.vision.enabled === true} onChange={(event) => setAgentDraft((prev) => ({ ...prev, vision: { ...prev.vision, enabled: event.target.checked } }))} /> 启用视觉
                  </label>
                  <input value={(agentDraft.vision.transferMethods || ['local_file']).join(',')} onChange={(event) => setAgentDraft((prev) => ({ ...prev, vision: { ...prev.vision, transferMethods: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                  <input type="number" min={1} max={50} value={agentDraft.vision.imageFileSizeLimit || 10} onChange={(event) => setAgentDraft((prev) => ({ ...prev, vision: { ...prev.vision, imageFileSizeLimit: Number(event.target.value) } }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
                </div>
              )}

              {section.id === 'model' && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <label className="block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    模型供应商
                    <select
                      value={agentDraft.modelProvider}
                      onChange={(event) => {
                        const provider = event.target.value;
                        const firstModel = modelOptions.find((model) => model.provider === provider);
                        setAgentDraft((prev) => ({
                          ...prev,
                          modelProvider: provider,
                          modelName: firstModel?.name || '',
                        }));
                      }}
                      className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    >
                      <option value="">请选择供应商</option>
                      {Array.from(new Set(modelOptions.map((model) => model.provider))).map((provider) => (
                        <option key={provider} value={provider}>{provider}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    对话模型
                    <select
                      value={agentDraft.modelName}
                      onChange={(event) => setAgentDraft((prev) => ({ ...prev, modelName: event.target.value }))}
                      className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                    >
                      <option value="">请选择模型</option>
                      {modelOptions
                        .filter((model) => !agentDraft.modelProvider || model.provider === agentDraft.modelProvider)
                        .map((model) => <option key={`${model.provider}:${model.name}`} value={model.name}>{model.name}</option>)}
                    </select>
                  </label>
                  <div className="rounded-[8px] border p-3 text-[12px] leading-5 lg:col-span-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                    来源：设置中心 / 统一模型中心。模型中心统一管理供应商、Base URL、密钥引用和能力目录；智能工厂这里只做绑定和运行选择。这里仅为当前智能体选择对话模型。
                  </div>
                </div>
              )}

              {section.id === 'publish' && (
                <div className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    {publishChecks.map((item) => (
                      <span key={item.label} className="inline-flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border-subtle)', background: item.done ? 'rgba(34,197,94,.08)' : 'var(--bg-elevated)', color: item.done ? '#15803d' : 'var(--text-tertiary)' }}>
                        <CheckCircle2 size={14} /> {item.done ? '完成' : '待补'} · {item.label}
                      </span>
                    ))}
                  </div>
                  <button type="button" onClick={handlePublish} disabled={!canPublish || busy} className="h-10 rounded-[8px] px-4 text-[12px] font-semibold text-white disabled:opacity-55" style={{ background: 'var(--accent)' }}>发布智能体</button>
                </div>
              )}
            </SectionShell>
          ))}
        </div>
      </div>

      {renderDebugPreview()}
    </div>
  );

  const renderDebugPreview = () => (
    <WorkspaceShellCard className="flex min-h-0 flex-col overflow-hidden p-0" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <div>
          <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>调试与预览</p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>真实调用智能工厂运行时，检查智能体回复效果。</p>
        </div>
        <button type="button" onClick={() => setResult(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }} title="重置预览">
          <RefreshCcw size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {sessionMessages.length ? sessionMessages.map((item, index) => (
          <div key={item.id || `${item.role}-${index}`} className={`mb-4 flex ${item.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
            <div className="max-w-[82%] rounded-[8px] px-4 py-3 text-[13px] leading-6" style={{ background: item.role === 'assistant' ? 'var(--bg-elevated)' : 'var(--accent)', color: item.role === 'assistant' ? 'var(--text-primary)' : '#fff' }}>
              <p className="whitespace-pre-wrap break-words">{item.content}</p>
            </div>
          </div>
        )) : (
          <div className="flex h-full min-h-[220px] items-center justify-center text-center text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            选择下方示例或输入内容，验证知识库引用和工具调用。
          </div>
        )}
      </div>
      <div className="shrink-0 border-t p-4" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="mb-2 flex flex-wrap gap-2">
          {samplePrompts.map((item) => (
            <button key={item} type="button" onClick={() => setMessage(item)} className="rounded-[8px] border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              {item}
            </button>
          ))}
        </div>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-[86px] w-full resize-none rounded-[8px] border px-3 py-2 text-[13px] outline-none" placeholder="和 Bot 聊天" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>会带入已保存配置、知识库和工具。</p>
          <button type="button" disabled={busy} onClick={handleSend} className="inline-flex h-9 items-center gap-2 rounded-[8px] px-4 text-[12px] font-semibold text-white disabled:opacity-55" style={{ background: 'var(--accent)' }}>
            {busy ? <Activity size={15} /> : <Send size={15} />} 发送
          </button>
        </div>
        {result && (
          <div className="mt-4 grid gap-3">
            <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>引用来源</p>
              <pre className="mt-2 max-h-[130px] overflow-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>{formatJson(result.citations || [])}</pre>
            </div>
            <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>工具结果 / Trace</p>
              <pre className="mt-2 max-h-[150px] overflow-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>{formatJson({ tools: result.toolResults, trace: result.trace })}</pre>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShellCard>
  );

  const renderApiTab = () => {
    const payload = { agentId: activeAgent?.id || '', sessionId: activeSession?.id || '', message: '退货规则是什么' };
    return (
      <WorkspaceShellCard className="h-full overflow-auto p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>访问 API</p>
        <p className="mt-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>当前版本暴露内部智能工厂 API，后续公网发布需补鉴权、限流和外部 token。</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Endpoint</p>
            <code className="mt-3 block rounded-[8px] px-3 py-2 text-[12px]" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>POST /api/smart-factory/chat</code>
          </div>
          <div className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>Payload</p>
            <pre className="mt-3 max-h-[260px] overflow-auto rounded-[8px] px-3 py-2 text-[12px]" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>{formatJson(payload)}</pre>
          </div>
        </div>
      </WorkspaceShellCard>
    );
  };

  const renderLogsTab = () => (
    <WorkspaceShellCard className="h-full overflow-auto p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>日志与标注</p>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>展示当前智能体 runtime runLogs，标注入口用于后续人工纠错闭环。</p>
      <div className="mt-5 grid gap-3">
        {runLogs.length ? runLogs.map((log, index) => (
          <div key={String(log.id || index)} className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{String(log.id || `run-${index + 1}`)}</p>
              <button type="button" className="inline-flex h-8 items-center gap-2 rounded-[8px] border px-3 text-[11px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <KeyRound size={13} /> 标注
              </button>
            </div>
            <pre className="mt-3 max-h-[220px] overflow-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>{formatJson(log)}</pre>
          </div>
        )) : (
          <div className="rounded-[8px] border px-5 py-12 text-center text-[13px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>暂无运行日志，先在调试预览中发送一条消息。</div>
        )}
      </div>
    </WorkspaceShellCard>
  );

  const renderMonitorTab = () => {
    const cards = [
      { label: '运行次数', value: runLogs.length },
      { label: '知识引用', value: getKnowledgeCount(runLogs) },
      { label: '工具调用', value: getToolCount(runLogs) },
      { label: '错误数', value: runLogs.filter((log) => String(log.status || '').includes('error')).length },
    ];
    return (
      <WorkspaceShellCard className="h-full overflow-auto p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>监测</p>
        <p className="mt-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>从真实 runLogs 聚合当前智能体运行指标。</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div key={card.label} className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{card.label}</p>
              <p className="mt-3 text-[28px] font-semibold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
            </div>
          ))}
        </div>
      </WorkspaceShellCard>
    );
  };

  const renderKnowledgeAreaContent = () => (
    <SmartFactoryKnowledgeManager
      config={config}
      activeKnowledgeBaseId={activeKnowledgeBaseId}
      knowledgeBaseName={knowledgeBaseName}
      knowledgeBaseDescription={knowledgeBaseDescription}
      knowledgeTitle={knowledgeTitle}
      knowledgeContent={knowledgeContent}
      knowledgeFileName={knowledgeFileName}
      knowledgeChunkStrategy={knowledgeChunkStrategy}
      knowledgeMaxChunkChars={knowledgeMaxChunkChars}
      knowledgeQuery={knowledgeQuery}
      knowledgeRetrievalTopK={knowledgeRetrievalTopK}
      knowledgeRetrievalThreshold={knowledgeRetrievalThreshold}
      knowledgeRetrievalMaxContextChars={knowledgeRetrievalMaxContextChars}
      knowledgeEmbeddingModel={knowledgeEmbeddingModel}
      knowledgeRerankModel={knowledgeRerankModel}
      embeddingModelOptions={embeddingModelOptions}
      rerankModelOptions={rerankModelOptions}
      knowledgeResults={knowledgeResults}
      busy={busy}
      onSelectKnowledgeBase={setActiveKnowledgeBaseId}
      onKnowledgeBaseNameChange={setKnowledgeBaseName}
      onKnowledgeBaseDescriptionChange={setKnowledgeBaseDescription}
      onKnowledgeTitleChange={setKnowledgeTitle}
      onKnowledgeContentChange={setKnowledgeContent}
      onKnowledgeChunkStrategyChange={setKnowledgeChunkStrategy}
      onKnowledgeMaxChunkCharsChange={setKnowledgeMaxChunkChars}
      onKnowledgeQueryChange={setKnowledgeQuery}
      onKnowledgeRetrievalTopKChange={setKnowledgeRetrievalTopK}
      onKnowledgeRetrievalThresholdChange={setKnowledgeRetrievalThreshold}
      onKnowledgeRetrievalMaxContextCharsChange={setKnowledgeRetrievalMaxContextChars}
      onKnowledgeEmbeddingModelChange={setKnowledgeEmbeddingModel}
      onKnowledgeRerankModelChange={setKnowledgeRerankModel}
      onCreateKnowledgeBase={handleCreateKnowledgeBase}
      onFileUpload={(file) => void handleFileUpload(file)}
      onAddKnowledge={handleAddKnowledge}
      onSaveKnowledgeBaseSettings={handleSaveKnowledgeBaseSettings}
      onDeleteKnowledgeBase={handleDeleteKnowledgeBase}
      onRetrainDocument={(documentId, content) => void handleRetrainDocument(documentId, content)}
      onDeleteDocument={(documentId) => void handleDeleteDocument(documentId)}
      onSearchKnowledge={handleSearchKnowledge}
    />
  );

  const renderToolsContent = () => (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <WorkspaceShellCard className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>工具模板</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>先从常用模板开始，再按真实 CLI 或 API 参数微调。</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {toolTemplates.map((template) => {
                const visual = getToolVisual(template);
                const Icon = visual.Icon;
                return (
                  <button key={template.name} type="button" onClick={() => handleUseToolTemplate(template)} className="rounded-[8px] border p-3 text-left" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      <Icon size={16} />
                    </span>
                    <p className="mt-3 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{template.label}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>{template.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusPill tone={template.riskLevel === 'safe' ? 'good' : 'warn'}>{template.riskLevel}</StatusPill>
                      <StatusPill>{visual.label}</StatusPill>
                    </div>
                  </button>
                );
              })}
            </div>
          </WorkspaceShellCard>
          <div className="grid content-start gap-3 md:grid-cols-2">
            {(config?.tools || []).map((tool) => {
              const visual = getToolVisual(tool);
              const Icon = visual.Icon;
              return (
                <WorkspaceShellCard key={tool.name} className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      <Icon size={19} />
                    </span>
                    <StatusPill tone={tool.authorized ? 'good' : 'warn'}>{tool.authorized ? '已授权' : '未授权'}</StatusPill>
                  </div>
                  <p className="mt-4 truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{tool.name}</p>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{tool.description || '暂无描述'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill>{visual.label}</StatusPill>
                    <StatusPill>{tool.type || 'cli'}</StatusPill>
                    {tool.model ? <StatusPill>{tool.modelProvider || 'model'} / {tool.model}</StatusPill> : null}
                  </div>
                  <p className="mt-3 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{tool.executorRef}</p>
                  <div className="mt-4 flex gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                    <button type="button" onClick={() => {
                      setToolDraft({
                        name: tool.name,
                        type: tool.type === 'builtin' ? 'builtin' : 'cli',
                        description: tool.description || '',
                        executorRef: tool.executorRef || '',
                        riskLevel: tool.riskLevel || 'safe',
                        capability: tool.capability || '',
                        icon: tool.icon || '',
                        modelProvider: tool.modelProvider || '',
                        model: tool.model || '',
                        inputSchemaText: JSON.stringify(tool.inputSchema || {}, null, 2),
                      });
                    }} className="h-8 rounded-[8px] px-3 text-[11px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>配置工具</button>
                    <button type="button" onClick={() => void handleDeleteTool(tool.name)} className="h-8 rounded-[8px] px-3 text-[11px] font-semibold" style={{ background: 'rgba(239,68,68,.09)', color: '#b91c1c' }}>删除工具</button>
                  </div>
                </WorkspaceShellCard>
              );
            })}
            {!(config?.tools || []).length && (
              <div className="rounded-[8px] border px-5 py-10 text-center text-[13px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                暂无工具。请先从工具模板创建。
              </div>
            )}
          </div>
        </div>
        <WorkspaceShellCard className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>注册工具</p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>CLI 工具执行后台白名单 executor，飞书表格需配置 SMART_FACTORY_CLI_FEISHU_CREATE_SHEET_COMMAND；内置图片/视频工具走现有生成 API 和模型渠道。</p>
          <div className="mt-4 space-y-3">
            <input value={toolDraft.name} onChange={(event) => setToolDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="工具名" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            <select value={toolDraft.type} onChange={(event) => setToolDraft((prev) => ({ ...prev, type: event.target.value === 'builtin' ? 'builtin' : 'cli' }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
              <option value="cli">CLI / 外部插件</option>
              <option value="builtin">内置媒体工具</option>
            </select>
            <input value={toolDraft.executorRef} onChange={(event) => setToolDraft((prev) => ({ ...prev, executorRef: event.target.value }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="executorRef" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            <input value={toolDraft.description} onChange={(event) => setToolDraft((prev) => ({ ...prev, description: event.target.value }))} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="工具说明" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            <div className="grid grid-cols-2 gap-2">
              <input value={toolDraft.capability} onChange={(event) => setToolDraft((prev) => ({ ...prev, capability: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="能力：image / video / cli" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input value={toolDraft.icon} onChange={(event) => setToolDraft((prev) => ({ ...prev, icon: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="图标：image / video" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input value={toolDraft.modelProvider} onChange={(event) => setToolDraft((prev) => ({ ...prev, modelProvider: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="模型渠道：kie" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
              <input value={toolDraft.model} onChange={(event) => setToolDraft((prev) => ({ ...prev, model: event.target.value }))} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="模型名：gpt-image-2 / veo3_fast" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            </div>
            <label className="block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              参数 Schema
              <textarea value={toolDraft.inputSchemaText} onChange={(event) => setToolDraft((prev) => ({ ...prev, inputSchemaText: event.target.value }))} className="mt-1 min-h-[180px] w-full resize-none rounded-[8px] border px-3 py-2 text-[11px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            </label>
            <input value={toolTestTitle} onChange={(event) => setToolTestTitle(event.target.value)} className="h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="测试输入 title" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={handleSaveTool} className="h-9 rounded-[8px] px-3 text-[12px] font-semibold text-white" style={{ background: 'var(--accent)' }}>保存工具</button>
              <button type="button" onClick={handleTestTool} className="h-9 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>测试工具</button>
            </div>
          </div>
        </WorkspaceShellCard>
      </div>
    </div>
  );

  if (surface === 'home') {
    const areaConfig = {
      workspace: {
        title: '工作室',
        description: '管理可发布的智能体应用，进入应用后再编辑配置和发布。',
        icon: Sparkles,
        actions: [
          { label: '创建应用', icon: PackagePlus, onClick: handleNewAgent, primary: true },
        ],
        content: renderWorkspaceContent(),
      },
      knowledge: {
        title: '知识库',
        description: '独立管理知识库、文档训练、召回测试和检索策略。',
        icon: Database,
        content: renderKnowledgeAreaContent(),
      },
      tools: {
        title: '工具',
        description: '独立管理 CLI 工具、插件定义和授权测试。',
        icon: Wrench,
        content: renderToolsContent(),
      },
    }[mainArea];

    return renderAreaFrame(areaConfig);
  }

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      {renderAppSidebar()}
      <div className="min-h-0 overflow-hidden">
        {tab === 'edit' && renderEditTab()}
        {tab === 'api' && renderApiTab()}
        {tab === 'logs' && renderLogsTab()}
        {tab === 'monitor' && renderMonitorTab()}
      </div>
    </div>
  );
};

export default SmartFactoryPanel;
