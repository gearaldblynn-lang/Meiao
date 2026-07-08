import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Braces,
  Database,
  FileText,
  Import,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import type { SmartFactoryConfig } from '../../services/internalApi';

type KnowledgeBase = SmartFactoryConfig['knowledgeBases'][number];
type KnowledgeDocument = NonNullable<KnowledgeBase['documents']>[number];

type KnowledgeDetailTab = 'documents' | 'hitTesting' | 'settings' | 'api';
type KnowledgeChunkStrategy = 'general' | 'rule' | 'sop' | 'faq' | 'case';

export interface SmartFactoryKnowledgeManagerProps {
  config: SmartFactoryConfig | null;
  activeKnowledgeBaseId: string;
  knowledgeBaseName: string;
  knowledgeBaseDescription: string;
  knowledgeTitle: string;
  knowledgeContent: string;
  knowledgeFileName: string;
  knowledgeChunkStrategy: KnowledgeChunkStrategy;
  knowledgeMaxChunkChars: string;
  knowledgeQuery: string;
  knowledgeRetrievalTopK: string;
  knowledgeRetrievalThreshold: string;
  knowledgeRetrievalMaxContextChars: string;
  knowledgeEmbeddingModel: string;
  knowledgeRerankModel: string;
  embeddingModelOptions: Array<{ provider: string; name: string; mode?: string; features?: string[] }>;
  rerankModelOptions: Array<{ provider: string; name: string; mode?: string; features?: string[] }>;
  knowledgeResults: Array<Record<string, unknown>>;
  busy: boolean;
  onSelectKnowledgeBase: (id: string) => void;
  onKnowledgeBaseNameChange: (value: string) => void;
  onKnowledgeBaseDescriptionChange: (value: string) => void;
  onKnowledgeTitleChange: (value: string) => void;
  onKnowledgeContentChange: (value: string) => void;
  onKnowledgeChunkStrategyChange: (value: KnowledgeChunkStrategy) => void;
  onKnowledgeMaxChunkCharsChange: (value: string) => void;
  onKnowledgeQueryChange: (value: string) => void;
  onKnowledgeRetrievalTopKChange: (value: string) => void;
  onKnowledgeRetrievalThresholdChange: (value: string) => void;
  onKnowledgeRetrievalMaxContextCharsChange: (value: string) => void;
  onKnowledgeEmbeddingModelChange: (value: string) => void;
  onKnowledgeRerankModelChange: (value: string) => void;
  onCreateKnowledgeBase: () => void;
  onFileUpload: (file: File | undefined) => void;
  onAddKnowledge: () => void;
  onSaveKnowledgeBaseSettings: () => void;
  onDeleteKnowledgeBase: (knowledgeBaseId: string) => void;
  onRetrainDocument: (documentId: string, content: string) => void;
  onDeleteDocument: (documentId: string) => void;
  onSearchKnowledge: () => void;
}

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);
const toModelOptionValue = (provider = '', model = '') => (provider && model ? `${provider}::${model}` : '');

const chunkStrategies: Array<{ id: KnowledgeChunkStrategy; label: string; description: string }> = [
  { id: 'general', label: '通用型', description: '普通说明文档' },
  { id: 'rule', label: '规则型', description: '规则条款独立成片' },
  { id: 'sop', label: 'SOP型', description: '流程步骤按顺序保留' },
  { id: 'faq', label: 'FAQ型', description: '问答一组优先成片' },
  { id: 'case', label: '案例型', description: '案例保留更多上下文' },
];

const tabs: Array<{ id: KnowledgeDetailTab; label: string; icon: React.ElementType; description: string }> = [
  { id: 'documents', label: '文档', icon: FileText, description: '文件、训练状态、分段和重训' },
  { id: 'hitTesting', label: '召回测试', icon: SlidersHorizontal, description: '检索 query、引用片段和 score' },
  { id: 'settings', label: '设置', icon: Settings2, description: '知识库名称、描述和检索策略' },
  { id: 'api', label: 'API', icon: Braces, description: '内部知识库接口和 payload' },
];

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-[8px] border px-5 py-10 text-center text-[13px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
    {children}
  </div>
);

const DocumentCard = ({
  document,
  onRetrain,
  onDelete,
}: {
  document: KnowledgeDocument;
  onRetrain: (documentId: string, content: string) => void;
  onDelete: (documentId: string) => void;
}) => (
  <div className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{document.title}</p>
        <p className="mt-1 text-[11px]" style={{ color: document.status === 'failed' ? '#b91c1c' : 'var(--text-tertiary)' }}>
          {document.status === 'failed' ? '训练失败' : (document.status || 'ready')} · {document.chunkCount || 0} chunks · {document.chunkStrategy || 'general'} · {document.fileName || document.sourceType || 'text'}
        </p>
        {document.error && <p className="mt-1 text-[11px]" style={{ color: '#b91c1c' }}>错误原因：{document.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={() => onRetrain(document.id, document.preview || '')} className="inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 text-[11px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <RefreshCcw size={13} /> 重训
        </button>
        <button type="button" onClick={() => onDelete(document.id)} className="h-8 rounded-[8px] px-2 text-[11px] font-semibold" style={{ background: 'rgba(239,68,68,.09)', color: '#b91c1c' }}>
          删除
        </button>
      </div>
    </div>
    <p className="mt-3 line-clamp-3 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{document.preview || '暂无预览内容'}</p>
  </div>
);

export const SmartFactoryKnowledgeManager: React.FC<SmartFactoryKnowledgeManagerProps> = ({
  config,
  activeKnowledgeBaseId,
  knowledgeBaseName,
  knowledgeBaseDescription,
  knowledgeTitle,
  knowledgeContent,
  knowledgeFileName,
  knowledgeChunkStrategy,
  knowledgeMaxChunkChars,
  knowledgeQuery,
  knowledgeRetrievalTopK,
  knowledgeRetrievalThreshold,
  knowledgeRetrievalMaxContextChars,
  knowledgeEmbeddingModel,
  knowledgeRerankModel,
  embeddingModelOptions,
  rerankModelOptions,
  knowledgeResults,
  busy,
  onSelectKnowledgeBase,
  onKnowledgeBaseNameChange,
  onKnowledgeBaseDescriptionChange,
  onKnowledgeTitleChange,
  onKnowledgeContentChange,
  onKnowledgeChunkStrategyChange,
  onKnowledgeMaxChunkCharsChange,
  onKnowledgeQueryChange,
  onKnowledgeRetrievalTopKChange,
  onKnowledgeRetrievalThresholdChange,
  onKnowledgeRetrievalMaxContextCharsChange,
  onKnowledgeEmbeddingModelChange,
  onKnowledgeRerankModelChange,
  onCreateKnowledgeBase,
  onFileUpload,
  onAddKnowledge,
  onSaveKnowledgeBaseSettings,
  onDeleteKnowledgeBase,
  onRetrainDocument,
  onDeleteDocument,
  onSearchKnowledge,
}) => {
  const [keyword, setKeyword] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<KnowledgeDetailTab>('documents');

  const knowledgeBases = config?.knowledgeBases || [];
  const activeKnowledgeBase = knowledgeBases.find((base) => base.id === activeKnowledgeBaseId) || knowledgeBases[0] || null;
  const filteredKnowledgeBases = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return knowledgeBases;
    return knowledgeBases.filter((base) => [base.name, base.description, base.status]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(value));
  }, [keyword, knowledgeBases]);

  const openDetail = (id: string) => {
    onSelectKnowledgeBase(id);
    setDetailOpen(true);
    setDetailTab('documents');
  };

  const openImportTarget = () => {
    const targetId = activeKnowledgeBase?.id || knowledgeBases[0]?.id;
    if (!targetId) {
      onCreateKnowledgeBase();
      return;
    }
    openDetail(targetId);
  };

  const renderList = () => (
    <div className="flex min-h-0 flex-col gap-4">
      <WorkspaceShellCard className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>知识库列表</p>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>创建知识库后进入详情页上传文件、训练文档和做召回测试。</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={openImportTarget} className="inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              <Import size={15} /> 导入数据源
            </button>
            <button type="button" onClick={onCreateKnowledgeBase} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold text-white disabled:opacity-55" style={{ background: 'var(--accent)' }}>
              <Plus size={15} /> 创建知识库
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid gap-3 md:grid-cols-2">
            <input value={knowledgeBaseName} onChange={(event) => onKnowledgeBaseNameChange(event.target.value)} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="知识库名称" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
            <input value={knowledgeBaseDescription} onChange={(event) => onKnowledgeBaseDescriptionChange(event.target.value)} className="h-10 rounded-[8px] border px-3 text-[12px] outline-none" placeholder="知识库描述" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          </div>
          <div className="flex h-10 items-center gap-2 rounded-[8px] border px-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}>
            <Search size={15} color="var(--text-tertiary)" />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="h-full flex-1 bg-transparent text-[12px] outline-none" placeholder="搜索知识库" style={{ color: 'var(--text-primary)' }} />
          </div>
        </div>
      </WorkspaceShellCard>

      <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredKnowledgeBases.map((base) => (
          <div key={base.id} className="min-h-[176px] rounded-[8px] border p-4 text-left transition hover:-translate-y-0.5" style={{ borderColor: base.id === activeKnowledgeBaseId ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)', boxShadow: '0 14px 34px rgba(15,23,42,.06)' }}>
            <div className="flex items-start justify-between gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Database size={20} />
              </span>
              <span className="rounded-[6px] px-2 py-1 text-[11px]" style={{ background: 'rgba(34,197,94,.1)', color: '#15803d' }}>{base.status || 'ready'}</span>
            </div>
            <p className="mt-4 truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{base.name}</p>
            <p className="mt-2 line-clamp-2 min-h-[38px] text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{base.description || '暂无描述'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-[6px] px-2 py-1 text-[11px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{base.documentCount || 0} 文档</span>
              <span className="rounded-[6px] px-2 py-1 text-[11px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{base.chunkCount || 0} chunks</span>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <button type="button" onClick={() => openDetail(base.id)} className="h-8 rounded-[8px] px-3 text-[11px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>文档管理</button>
              <button type="button" onClick={() => onDeleteKnowledgeBase(base.id)} className="h-8 rounded-[8px] px-3 text-[11px] font-semibold" style={{ background: 'rgba(239,68,68,.09)', color: '#b91c1c' }}>删除知识库</button>
            </div>
          </div>
        ))}
        {!filteredKnowledgeBases.length && <EmptyState>没有匹配的知识库。</EmptyState>}
      </div>
    </div>
  );

  const renderDocuments = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        {(activeKnowledgeBase?.documents || []).map((document) => (
          <DocumentCard key={document.id} document={document} onRetrain={onRetrainDocument} onDelete={onDeleteDocument} />
        ))}
        {!(activeKnowledgeBase?.documents || []).length && <EmptyState>当前知识库还没有文档。</EmptyState>}
      </div>
      <WorkspaceShellCard className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>上传并训练</p>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>文档管理只在知识库详情页进行。</p>
        <label className="mt-4 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] border text-[12px] font-semibold" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <Upload size={15} /> 文件上传
          <input type="file" className="hidden" onChange={(event) => onFileUpload(event.target.files?.[0])} />
        </label>
        {knowledgeFileName && <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>已读取：{knowledgeFileName}</p>}
        <input value={knowledgeTitle} onChange={(event) => onKnowledgeTitleChange(event.target.value)} className="mt-3 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" placeholder="文档标题" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_132px]">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            分段策略
            <select value={knowledgeChunkStrategy} onChange={(event) => onKnowledgeChunkStrategyChange(event.target.value as KnowledgeChunkStrategy)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
              {chunkStrategies.map((strategy) => <option key={strategy.id} value={strategy.id}>{strategy.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            最大分段字符
            <input value={knowledgeMaxChunkChars} onChange={(event) => onKnowledgeMaxChunkCharsChange(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" inputMode="numeric" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          </label>
        </div>
        <textarea value={knowledgeContent} onChange={(event) => onKnowledgeContentChange(event.target.value)} className="mt-3 min-h-[180px] w-full resize-none rounded-[8px] border px-3 py-2 text-[12px] outline-none" placeholder="文档内容或文件读取结果" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        <button type="button" onClick={onAddKnowledge} disabled={busy} className="mt-3 h-10 w-full rounded-[8px] px-3 text-[12px] font-semibold text-white disabled:opacity-55" style={{ background: 'var(--accent)' }}>开始训练</button>
      </WorkspaceShellCard>
    </div>
  );

  const renderHitTesting = () => (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <WorkspaceShellCard className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>召回测试</p>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>输入问题，测试知识库能召回哪些内容。</p>
        <textarea value={knowledgeQuery} onChange={(event) => onKnowledgeQueryChange(event.target.value)} className="mt-4 min-h-[120px] w-full resize-none rounded-[8px] border px-3 py-2 text-[13px] outline-none" placeholder="输入 query" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Top K
            <input value={knowledgeRetrievalTopK} onChange={(event) => onKnowledgeRetrievalTopKChange(event.target.value)} className="mt-1 h-9 w-full rounded-[8px] border px-2 text-[12px] outline-none" inputMode="numeric" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Score 阈值
            <input value={knowledgeRetrievalThreshold} onChange={(event) => onKnowledgeRetrievalThresholdChange(event.target.value)} className="mt-1 h-9 w-full rounded-[8px] border px-2 text-[12px] outline-none" inputMode="decimal" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          </label>
          <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            最大上下文字符
            <input value={knowledgeRetrievalMaxContextChars} onChange={(event) => onKnowledgeRetrievalMaxContextCharsChange(event.target.value)} className="mt-1 h-9 w-full rounded-[8px] border px-2 text-[12px] outline-none" inputMode="numeric" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
          </label>
        </div>
        <button type="button" onClick={onSearchKnowledge} disabled={busy} className="mt-3 h-10 rounded-[8px] px-4 text-[12px] font-semibold text-white disabled:opacity-55" style={{ background: 'var(--accent)' }}>运行召回测试</button>
      </WorkspaceShellCard>
      <WorkspaceShellCard className="p-4" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>召回结果</p>
        <pre className="mt-3 max-h-[440px] overflow-auto rounded-[8px] px-3 py-2 text-[11px]" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>{formatJson(knowledgeResults)}</pre>
      </WorkspaceShellCard>
    </div>
  );

  const renderSettings = () => (
    <WorkspaceShellCard className="p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>知识库设置</p>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>管理知识库训练状态和召回策略，智能体绑定后会沿用这里的检索参数。</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-[8px] border p-4 md:col-span-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>知识库训练模型</p>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>Embedding 用于向量训练，Rerank 用于召回后重排。</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Embedding 模型
              <select value={knowledgeEmbeddingModel} onChange={(event) => onKnowledgeEmbeddingModelChange(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                <option value="">未配置 Embedding</option>
                {embeddingModelOptions.map((model) => (
                  <option key={`${model.provider}:${model.name}`} value={toModelOptionValue(model.provider, model.name)}>{model.provider} / {model.name}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Rerank 模型
              <select value={knowledgeRerankModel} onChange={(event) => onKnowledgeRerankModelChange(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}>
                <option value="">不使用 Rerank</option>
                {rerankModelOptions.map((model) => (
                  <option key={`${model.provider}:${model.name}`} value={toModelOptionValue(model.provider, model.name)}>{model.provider} / {model.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>名称</p>
          <p className="mt-2 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{activeKnowledgeBase?.name || '-'}</p>
        </div>
        <div className="rounded-[8px] border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>文档 / 分段</p>
          <p className="mt-2 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{activeKnowledgeBase?.documentCount || 0} / {activeKnowledgeBase?.chunkCount || 0}</p>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            ready {activeKnowledgeBase?.readyDocumentCount || 0} · failed {activeKnowledgeBase?.failedDocumentCount || 0}
          </p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Top K
          <input value={knowledgeRetrievalTopK} onChange={(event) => onKnowledgeRetrievalTopKChange(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" inputMode="numeric" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        </label>
        <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          Score 阈值
          <input value={knowledgeRetrievalThreshold} onChange={(event) => onKnowledgeRetrievalThresholdChange(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" inputMode="decimal" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        </label>
        <label className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          最大上下文字符
          <input value={knowledgeRetrievalMaxContextChars} onChange={(event) => onKnowledgeRetrievalMaxContextCharsChange(event.target.value)} className="mt-1 h-10 w-full rounded-[8px] border px-3 text-[12px] outline-none" inputMode="numeric" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }} />
        </label>
      </div>
      <button type="button" onClick={onSaveKnowledgeBaseSettings} disabled={busy} className="mt-4 h-10 rounded-[8px] px-4 text-[12px] font-semibold text-white disabled:opacity-55" style={{ background: 'var(--accent)' }}>保存设置</button>
      <div className="mt-6 rounded-[8px] border p-4" style={{ borderColor: 'rgba(239,68,68,.24)', background: 'rgba(239,68,68,.06)' }}>
        <p className="text-[13px] font-semibold" style={{ color: '#b91c1c' }}>确认删除知识库</p>
        <p className="mt-1 text-[12px]" style={{ color: '#b91c1c' }}>删除知识库会移除文档、分段和智能体绑定关系。</p>
        <button type="button" onClick={() => activeKnowledgeBase && onDeleteKnowledgeBase(activeKnowledgeBase.id)} disabled={busy} className="mt-3 h-9 rounded-[8px] px-3 text-[12px] font-semibold disabled:opacity-55" style={{ background: 'rgba(239,68,68,.12)', color: '#b91c1c' }}>删除知识库</button>
      </div>
    </WorkspaceShellCard>
  );

  const renderApi = () => (
    <WorkspaceShellCard className="p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>知识库 API</p>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>当前使用 Smart Factory 内部 API，公网 API 需要后续加 token、限流和访问权限。</p>
      <pre className="mt-5 overflow-auto rounded-[8px] px-3 py-3 text-[12px]" style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}>{formatJson({
        updateKnowledgeBase: 'PATCH /api/smart-factory/knowledge-bases/{knowledgeBaseId}',
        createDocument: 'POST /api/smart-factory/knowledge-documents',
        search: 'POST /api/smart-factory/knowledge-search',
        knowledgeBaseId: activeKnowledgeBase?.id || '',
        retrievalPolicy: activeKnowledgeBase?.retrievalPolicy || {},
        embeddingModel: activeKnowledgeBase?.embeddingModel || null,
        rerankModel: activeKnowledgeBase?.rerankModel || null,
      })}</pre>
    </WorkspaceShellCard>
  );

  const renderDetail = () => {
    if (!activeKnowledgeBase) return <EmptyState>请选择一个知识库。</EmptyState>;
    return (
      <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <WorkspaceShellCard className="flex min-h-0 flex-col overflow-hidden p-0" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
          <div className="border-b p-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <button type="button" onClick={() => setDetailOpen(false)} className="mb-4 inline-flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-[12px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              <ArrowLeft size={15} /> 返回知识库列表
            </button>
            <div className="rounded-[8px] border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Database size={20} /></span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{activeKnowledgeBase.name}</p>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>DATASET · {activeKnowledgeBase.status || 'ready'}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>{activeKnowledgeBase.description || '暂无描述'}</p>
            </div>
          </div>
          <nav className="flex-1 overflow-auto p-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = detailTab === tab.id;
              return (
                <button key={tab.id} type="button" onClick={() => setDetailTab(tab.id)} className="mb-1 flex w-full items-center gap-3 rounded-[8px] px-3 py-3 text-left" style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  <Icon size={17} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{tab.label}</span>
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>{tab.description}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </WorkspaceShellCard>
        <div className="min-h-0 overflow-auto">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[8px] border px-4 py-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
            <div>
              <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{tabs.find((tab) => tab.id === detailTab)?.label}</p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>{tabs.find((tab) => tab.id === detailTab)?.description}</p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-[8px] px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              <Database size={13} /> {activeKnowledgeBase?.name || '知识库'}
            </span>
          </div>
          {detailTab === 'documents' && renderDocuments()}
          {detailTab === 'hitTesting' && renderHitTesting()}
          {detailTab === 'settings' && renderSettings()}
          {detailTab === 'api' && renderApi()}
        </div>
      </div>
    );
  };

  return detailOpen ? renderDetail() : renderList();
};

export default SmartFactoryKnowledgeManager;
