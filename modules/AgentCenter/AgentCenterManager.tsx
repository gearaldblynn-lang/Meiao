import React, { useEffect, useMemo, useState } from 'react';
import { AgentSummary, AgentVersion, KnowledgeBaseSummary, KnowledgeDocumentSummary } from '../../types';
import {
  archiveAgent,
  createAgent,
  createAgentDraft,
  deleteAgentVersion,
  deleteKnowledgeBase,
  createKnowledgeBase,
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  fetchAgentDetail,
  fetchAgentSummaries,
  fetchSystemConfig,
  fetchKnowledgeBaseDetail,
  fetchKnowledgeBases,
  publishAgent,
  rollbackAgent,
  updateAgent,
  updateAgentVersion,
  updateKnowledgeBase,
  updateKnowledgeDocument,
  uploadInternalAssetStream,
  validateAgentVersion,
} from '../../services/internalApi';
import { KNOWLEDGE_CHUNK_STRATEGY_META, normalizeAgentConfig } from './agentCenterUtils.mjs';
import AgentListView from './AgentListView';
import AgentDetailView from './AgentDetailView';
import AgentWizardView from './AgentWizardView';
import KnowledgeBaseListView from './KnowledgeBaseListView';
import KnowledgeBaseEditorView from './KnowledgeBaseEditorView';

type ManagerPage = 'agent_list' | 'agent_detail' | 'agent_wizard' | 'knowledge_list' | 'knowledge_editor';

interface Props {
  onStatusMessage: (value: string) => void;
  onErrorMessage: (value: string) => void;
  onLoadingChange: (value: boolean) => void;
  onAgentCatalogChanged?: () => void;
}

interface DangerConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

const emptyKnowledgeBaseForm = { name: '', description: '', department: '' };
const emptyDocumentForm = {
  title: '',
  rawText: '',
  sourceType: 'manual' as 'manual' | 'upload',
  chunkStrategy: 'general' as 'general' | 'rule' | 'sop' | 'faq' | 'case',
  normalizationEnabled: false,
};
const fallbackChatModels = [
  { id: 'doubao-seed-1-6-flash-250615', label: '豆包 Seed 1.6 Flash' },
  { id: 'doubao-seed-1-6-thinking-250715', label: '豆包 Seed 1.6 Thinking' },
  { id: 'doubao-seed-2-0-lite-260215', label: '豆包 Seed 2.0 Lite' },
];
const fallbackImageModels = [
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
];

const AgentCenterManager: React.FC<Props> = ({ onStatusMessage, onErrorMessage, onLoadingChange, onAgentCatalogChanged }) => {
  const [managerSection, setManagerSection] = useState<'agents' | 'knowledge'>('agents');
  const [page, setPage] = useState<ManagerPage>('agent_list');
  const [knowledgeReturnPage, setKnowledgeReturnPage] = useState<ManagerPage>('knowledge_list');
  const [detailTab, setDetailTab] = useState<'config' | 'knowledge' | 'test' | 'versions'>('config');
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [validationMessage, setValidationMessage] = useState('请用一句话说明这个智能体能做什么。');
  const [validationResult, setValidationResult] = useState<Record<string, unknown> | null>(null);
  const [wizardMode, setWizardMode] = useState<'create' | 'edit'>('create');
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardForm, setWizardForm] = useState({
    name: '',
    description: '',
    department: '',
    iconUrl: '',
    avatarPreset: 'aurora',
    systemPrompt: '',
    selectedKnowledgeBaseIds: [] as string[],
    allowedChatModels: ['doubao-seed-1-6-flash-250615', 'doubao-seed-1-6-thinking-250715'],
    defaultChatModel: 'doubao-seed-1-6-thinking-250715',
    cheapModel: 'doubao-seed-1-6-flash-250615',
    enableImageGeneration: false,
    imageModel: 'nano-banana-2',
    topK: 3,
  });
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const [knowledgeDepartmentFilter, setKnowledgeDepartmentFilter] = useState('');
  const [agentSearch, setAgentSearch] = useState('');
  const [agentStatusFilter, setAgentStatusFilter] = useState<'all' | 'draft' | 'published' | 'archived'>('all');
  const [agentDepartmentFilter, setAgentDepartmentFilter] = useState('');
  const [knowledgeBaseForm, setKnowledgeBaseForm] = useState(emptyKnowledgeBaseForm);
  const [documentForm, setDocumentForm] = useState(emptyDocumentForm);
  const [editingDocumentId, setEditingDocumentId] = useState('');
  const [availableChatModels, setAvailableChatModels] = useState(fallbackChatModels);
  const [availableImageModels, setAvailableImageModels] = useState(fallbackImageModels);
  const [dangerConfirm, setDangerConfirm] = useState<DangerConfirmState | null>(null);

  const selectedAgent = useMemo(() => agents.find((item) => item.id === selectedAgentId) || null, [agents, selectedAgentId]);
  const selectedVersion = useMemo(() => versions.find((item) => item.id === selectedVersionId) || versions[0] || null, [versions, selectedVersionId]);
  const draftVersion = useMemo(() => versions.find((item) => !item.isPublished) || null, [versions]);
  const selectedKnowledgeBase = useMemo(() => knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId) || null, [knowledgeBases, selectedKnowledgeBaseId]);

  const filteredAgents = useMemo(() => agents.filter((item) => {
    const matchesSearch = !agentSearch || `${item.name} ${item.department} ${item.description}`.toLowerCase().includes(agentSearch.toLowerCase());
    const matchesStatus = agentStatusFilter === 'all' || item.status === agentStatusFilter;
    const matchesDepartment = !agentDepartmentFilter || item.department === agentDepartmentFilter;
    return matchesSearch && matchesStatus && matchesDepartment;
  }), [agents, agentSearch, agentStatusFilter, agentDepartmentFilter]);

  const filteredKnowledgeBases = useMemo(() => knowledgeBases.filter((item) => {
    const matchesSearch = !knowledgeSearch || `${item.name} ${item.department} ${item.description}`.toLowerCase().includes(knowledgeSearch.toLowerCase());
    const matchesDepartment = !knowledgeDepartmentFilter || item.department === knowledgeDepartmentFilter;
    return matchesSearch && matchesDepartment;
  }), [knowledgeBases, knowledgeSearch, knowledgeDepartmentFilter]);

  const runAction = async (action: () => Promise<void>) => {
    onLoadingChange(true);
    onErrorMessage('');
    onStatusMessage('');
    try {
      await action();
    } catch (error: any) {
      onErrorMessage(error.message || '操作失败');
    } finally {
      onLoadingChange(false);
    }
  };

  const loadAgents = async (preferredAgentId = selectedAgentId) => {
    const result = await fetchAgentSummaries();
    setAgents(result.agents);
    const nextId = preferredAgentId || result.agents[0]?.id || '';
    setSelectedAgentId(nextId);
    if (nextId) {
      const detail = await fetchAgentDetail(nextId);
      setVersions(detail.versions);
      setSelectedVersionId((current) => current && detail.versions.some((item) => item.id === current) ? current : detail.versions[0]?.id || '');
      setValidationResult(detail.versions[0]?.validationSummary || null);
    } else {
      setVersions([]);
      setSelectedVersionId('');
      setValidationResult(null);
    }
  };

  const loadKnowledgeBases = async (preferredKnowledgeBaseId = selectedKnowledgeBaseId) => {
    const result = await fetchKnowledgeBases();
    setKnowledgeBases(result.knowledgeBases);
    const nextId = preferredKnowledgeBaseId || result.knowledgeBases[0]?.id || '';
    setSelectedKnowledgeBaseId(nextId);
    if (nextId) {
      const detail = await fetchKnowledgeBaseDetail(nextId);
      setDocuments(detail.documents);
    } else {
      setDocuments([]);
    }
  };

  useEffect(() => {
    onLoadingChange(true);
    Promise.all([
      loadAgents(),
      loadKnowledgeBases(),
      fetchSystemConfig().then((result) => {
        setAvailableChatModels(result.config.agentModels?.chat?.length ? result.config.agentModels.chat : fallbackChatModels);
        setAvailableImageModels(result.config.agentModels?.image?.length ? result.config.agentModels.image : fallbackImageModels);
      }),
    ])
      .catch((error: any) => onErrorMessage(error.message || '智能体中心初始化失败'))
      .finally(() => onLoadingChange(false));
  }, []);

  useEffect(() => {
    if (!selectedKnowledgeBase) {
      setKnowledgeBaseForm(emptyKnowledgeBaseForm);
      setEditingDocumentId('');
      setDocumentForm(emptyDocumentForm);
      return;
    }
    setKnowledgeBaseForm({
      name: selectedKnowledgeBase.name,
      description: selectedKnowledgeBase.description,
      department: selectedKnowledgeBase.department,
    });
  }, [selectedKnowledgeBase?.id]);

  const openCreateWizard = () => {
    const defaultAllowedChatModels = availableChatModels.slice(0, Math.min(2, availableChatModels.length)).map((item) => item.id);
    const defaultChatModel = defaultAllowedChatModels.find((id) => id.includes('thinking')) || defaultAllowedChatModels[0] || '';
    const cheapModel = defaultAllowedChatModels.find((id) => id.includes('flash') || id.includes('lite')) || defaultAllowedChatModels[0] || '';
    setWizardMode('create');
    setWizardStep(0);
    setWizardForm({
      name: '',
      description: '',
      department: '',
      iconUrl: '',
      avatarPreset: 'aurora',
      systemPrompt: '',
      selectedKnowledgeBaseIds: [],
      allowedChatModels: defaultAllowedChatModels,
      defaultChatModel,
      cheapModel,
      enableImageGeneration: false,
      imageModel: availableImageModels[0]?.id || 'nano-banana-2',
      topK: 3,
    });
    setPage('agent_wizard');
  };

  const applyEditWizardState = (editableVersion: AgentVersion, initialStep = 0) => {
    if (!selectedAgent) return;
    const config = normalizeAgentConfig(editableVersion);
    setWizardMode('edit');
    setWizardStep(initialStep);
    setWizardForm({
      name: selectedAgent.name,
      description: selectedAgent.description,
      department: selectedAgent.department,
      iconUrl: selectedAgent.iconUrl || '',
      avatarPreset: selectedAgent.avatarPreset || 'aurora',
      systemPrompt: config.systemPrompt,
      selectedKnowledgeBaseIds: editableVersion.knowledgeBaseIds || [],
      allowedChatModels: editableVersion.allowedChatModels?.length
        ? editableVersion.allowedChatModels
        : [editableVersion.defaultChatModel || config.modelPolicy.defaultModel].filter(Boolean),
      defaultChatModel: editableVersion.defaultChatModel || config.modelPolicy.defaultModel,
      cheapModel: config.modelPolicy.cheapModel || editableVersion.defaultChatModel || config.modelPolicy.defaultModel,
      enableImageGeneration: Boolean(config.modelPolicy.imageGenerationEnabled),
      imageModel: config.modelPolicy.multimodalModel || availableImageModels[0]?.id || 'nano-banana-2',
      topK: config.retrievalPolicy.topK,
    });
    setPage('agent_wizard');
  };

  const openEditWizard = () => {
    const editableVersion = draftVersion || selectedVersion;
    if (!selectedAgent || !editableVersion) return;
    applyEditWizardState(editableVersion, 0);
  };

  const openEditWizardAtStep = (targetStep: number) => runAction(async () => {
    if (!selectedAgent) return;
    let editableVersion = draftVersion || selectedVersion;
    if (!editableVersion) return;
    if (!draftVersion) {
      const result = await createAgentDraft(selectedAgent.id);
      onStatusMessage(`已创建草稿版本 V${result.version.versionNo}`);
      await loadAgents(selectedAgent.id);
      setSelectedVersionId(result.version.id);
      const detail = await fetchAgentDetail(selectedAgent.id);
      editableVersion = detail.versions.find((item) => item.id === result.version.id) || detail.versions.find((item) => !item.isPublished) || null;
    } else {
      setSelectedVersionId(editableVersion.id);
    }
    if (!editableVersion) return;
    applyEditWizardState(editableVersion, targetStep);
  });

  const handleWizardSubmit = () => runAction(async () => {
    const allowedChatModels: string[] = Array.from(
      new Set(wizardForm.allowedChatModels.map((item) => String(item || '').trim()).filter(Boolean))
    );
    const defaultChatModel = allowedChatModels.includes(wizardForm.defaultChatModel)
      ? wizardForm.defaultChatModel
      : allowedChatModels[0] || availableChatModels[0]?.id || '';
    const cheapModel = allowedChatModels.includes(wizardForm.cheapModel)
      ? wizardForm.cheapModel
      : allowedChatModels[0] || defaultChatModel;
    const imageModel = wizardForm.imageModel || availableImageModels[0]?.id || 'nano-banana-2';
    if (wizardMode === 'create') {
      const result = await createAgent({
        name: wizardForm.name,
        description: wizardForm.description,
        department: wizardForm.department,
        iconUrl: wizardForm.iconUrl || null,
        avatarPreset: wizardForm.avatarPreset || null,
        systemPrompt: wizardForm.systemPrompt,
        knowledgeBaseIds: wizardForm.selectedKnowledgeBaseIds,
        allowedChatModels,
        defaultChatModel,
        modelPolicy: { cheapModel, defaultModel: defaultChatModel, multimodalModel: imageModel, imageGenerationEnabled: Boolean(wizardForm.enableImageGeneration) },
        retrievalPolicy: { topK: wizardForm.topK },
      });
      onStatusMessage(`已创建智能体：${result.agent.name}`);
      await loadAgents(result.agent.id);
      setPage('agent_detail');
      return;
    }
    if (!selectedAgent || !selectedVersion) return;
    await updateAgent(selectedAgent.id, {
      name: wizardForm.name,
      description: wizardForm.description,
      department: wizardForm.department,
      iconUrl: wizardForm.iconUrl || null,
      avatarPreset: wizardForm.avatarPreset || null,
    });
    await updateAgentVersion(selectedVersion.id, {
      systemPrompt: wizardForm.systemPrompt,
      knowledgeBaseIds: wizardForm.selectedKnowledgeBaseIds,
      allowedChatModels,
      defaultChatModel,
      modelPolicy: { ...selectedVersion.modelPolicy, cheapModel, defaultModel: defaultChatModel, multimodalModel: imageModel, imageGenerationEnabled: Boolean(wizardForm.enableImageGeneration) },
      retrievalPolicy: { ...selectedVersion.retrievalPolicy, topK: wizardForm.topK },
    });
    onStatusMessage('草稿已保存。');
    await loadAgents(selectedAgent.id);
    setPage('agent_detail');
  });

  const handleCreateDraft = () => runAction(async () => {
    if (!selectedAgent) return;
    const result = await createAgentDraft(selectedAgent.id);
    onStatusMessage(`已创建草稿版本 V${result.version.versionNo}`);
    await loadAgents(selectedAgent.id);
    setSelectedVersionId(result.version.id);
    setPage('agent_detail');
  });

  const handlePublish = () => runAction(async () => {
    if (!selectedAgent) return;
    const draftVersion = versions.find((item) => !item.isPublished) || null;
    if (!draftVersion || draftVersion.validationStatus !== 'success') {
      onErrorMessage('请先完成测试验证');
      return;
    }
    await publishAgent(selectedAgent.id, draftVersion.id);
    onStatusMessage(`已发布 ${selectedAgent.name} 的 ${draftVersion.versionName}`);
    await loadAgents(selectedAgent.id);
    onAgentCatalogChanged?.();
  });

  const handleVersionNameChange = (versionId: string, versionName: string) => runAction(async () => {
    const version = versions.find((item) => item.id === versionId);
    if (!version || version.isPublished) return;
    await updateAgentVersion(versionId, { versionName });
    onStatusMessage('版本名称已保存。');
    await loadAgents(selectedAgentId);
    setSelectedVersionId(versionId);
  });

  const handleRollback = (versionId: string) => runAction(async () => {
    if (!selectedAgent) return;
    await rollbackAgent(selectedAgent.id, versionId);
    onStatusMessage('已回滚到历史版本。');
    await loadAgents(selectedAgent.id);
  });

  const handleDeleteAgent = () => runAction(async () => {
    if (!selectedAgent) return;
    await archiveAgent(selectedAgent.id);
    onStatusMessage(`已永久删除 ${selectedAgent.name}`);
    await loadAgents('');
    setPage('agent_list');
  });

  const handleDeleteVersion = (versionId: string) => runAction(async () => {
    const targetVersion = versions.find((item) => item.id === versionId);
    if (!selectedAgent || !targetVersion) return;
    await deleteAgentVersion(versionId);
    onStatusMessage(`已永久删除 V${targetVersion.versionNo}`);
    await loadAgents(selectedAgent.id);
  });

  const openDeleteAgentConfirm = () => {
    if (!selectedAgent) return;
    setDangerConfirm({
      title: '永久删除确认',
      message: `确认删除后将不可恢复。智能体“${selectedAgent.name}”的版本、会话与调用记录都会被一并永久删除。`,
      confirmLabel: '确认删除智能体',
      onConfirm: () => {
        setDangerConfirm(null);
        void handleDeleteAgent();
      },
    });
  };

  const openDeleteVersionConfirm = (versionId: string) => {
    const targetVersion = versions.find((item) => item.id === versionId);
    if (!targetVersion) return;
    setDangerConfirm({
      title: '永久删除确认',
      message: `确认删除后将不可恢复。版本 V${targetVersion.versionNo} 会被永久删除，且无法找回。`,
      confirmLabel: '确认删除版本',
      onConfirm: () => {
        setDangerConfirm(null);
        void handleDeleteVersion(versionId);
      },
    });
  };

  const handleValidate = () => runAction(async () => {
    if (!selectedVersion) return;
    const result = await validateAgentVersion(selectedVersion.id, validationMessage);
    setValidationResult(result.result);
    onStatusMessage('验证完成。');
    await loadAgents(selectedAgentId);
  });

  const handleSaveKnowledgeBase = () => runAction(async () => {
    if (selectedKnowledgeBase) {
      await updateKnowledgeBase(selectedKnowledgeBase.id, knowledgeBaseForm);
      onStatusMessage('知识库已保存。');
      await loadKnowledgeBases(selectedKnowledgeBase.id);
      return;
    }
    const result = await createKnowledgeBase(knowledgeBaseForm);
    onStatusMessage(`已创建知识库：${result.knowledgeBase.name}`);
    await loadKnowledgeBases(result.knowledgeBase.id);
    setPage('knowledge_editor');
  });

  const handleArchiveKnowledgeBase = () => runAction(async () => {
    if (!selectedKnowledgeBase) return;
    await deleteKnowledgeBase(selectedKnowledgeBase.id);
    onStatusMessage(`已永久删除知识库：${selectedKnowledgeBase.name}`);
    await loadKnowledgeBases('');
    setPage('knowledge_list');
  });

  const handleCreateDocument = () => runAction(async () => {
    if (!selectedKnowledgeBase) return;
    if (editingDocumentId) {
      const result = await updateKnowledgeDocument(editingDocumentId, {
        title: documentForm.title,
        rawText: documentForm.rawText,
        sourceType: documentForm.sourceType,
        chunkStrategy: documentForm.chunkStrategy,
        normalizationEnabled: documentForm.normalizationEnabled,
      });
      setEditingDocumentId('');
      setDocumentForm(emptyDocumentForm);
      onStatusMessage(
        result.document.normalizationEnabled && result.document.normalizedStatus === 'failed'
          ? `文档已保存并重新切片，AI 规范整理失败，已回退原文。${result.document.normalizationError ? `原因：${result.document.normalizationError}` : ''}`
          : '文档已保存并重新切片。'
      );
      await loadKnowledgeBases(selectedKnowledgeBase.id);
      return;
    }
    const result = await createKnowledgeDocument({
      knowledgeBaseId: selectedKnowledgeBase.id,
      title: documentForm.title,
      rawText: documentForm.rawText,
      sourceType: documentForm.sourceType,
      chunkStrategy: documentForm.chunkStrategy,
      normalizationEnabled: documentForm.normalizationEnabled,
    });
    setDocumentForm(emptyDocumentForm);
    onStatusMessage(
      result.document.normalizationEnabled && result.document.normalizedStatus === 'failed'
        ? `文档已入库并完成切片，AI 规范整理失败，已回退原文。${result.document.normalizationError ? `原因：${result.document.normalizationError}` : ''}`
        : '文档已入库并完成切片。'
    );
    await loadKnowledgeBases(selectedKnowledgeBase.id);
  });

  const handleEditDocument = (documentId: string) => {
    const target = documents.find((item) => item.id === documentId);
    if (!target) return;
    setEditingDocumentId(documentId);
    setDocumentForm({
      title: target.title,
      rawText: target.rawText,
      sourceType: target.sourceType,
      chunkStrategy: target.chunkStrategy || 'general',
      normalizationEnabled: Boolean(target.normalizationEnabled),
    });
  };

  const handleCancelDocumentEdit = () => {
    setEditingDocumentId('');
    setDocumentForm(emptyDocumentForm);
  };

  const handleDeleteDocument = (documentId: string) => runAction(async () => {
    await deleteKnowledgeDocument(documentId);
    if (editingDocumentId === documentId) {
      setEditingDocumentId('');
      setDocumentForm(emptyDocumentForm);
    }
    onStatusMessage('文档已删除。');
    await loadKnowledgeBases(selectedKnowledgeBaseId);
  });

  const handleUploadTextFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rawText = await file.text();
    setDocumentForm({
      title: file.name,
      rawText,
      sourceType: 'upload',
      chunkStrategy: 'general',
      normalizationEnabled: false,
    });
  };

  const openKnowledgeList = (returnPage: ManagerPage = 'knowledge_list') => {
    setManagerSection('knowledge');
    setKnowledgeReturnPage(returnPage);
    setPage('knowledge_list');
  };

  const openKnowledgeEditor = async (knowledgeBaseId: string, returnPage: ManagerPage = 'knowledge_list') => {
    setManagerSection('knowledge');
    setKnowledgeReturnPage(returnPage);
    setSelectedKnowledgeBaseId(knowledgeBaseId);
    setEditingDocumentId('');
    setDocumentForm(emptyDocumentForm);
    const detail = await fetchKnowledgeBaseDetail(knowledgeBaseId);
    setDocuments(detail.documents);
    setPage('knowledge_editor');
  };

  const openKnowledgeCreate = (returnPage: ManagerPage = 'knowledge_list') => {
    setManagerSection('knowledge');
    setKnowledgeReturnPage(returnPage);
    setSelectedKnowledgeBaseId('');
    setDocuments([]);
    setKnowledgeBaseForm(emptyKnowledgeBaseForm);
    setDocumentForm(emptyDocumentForm);
    setEditingDocumentId('');
    setPage('knowledge_editor');
  };

  const handleKnowledgeBack = () => {
    if (knowledgeReturnPage === 'agent_detail') {
      setManagerSection('agents');
      setPage('agent_detail');
      return;
    }
    setManagerSection('knowledge');
    setPage('knowledge_list');
  };

  const renderSectionTabs = () => (
    <div className="mb-6 flex flex-wrap gap-3">
      <button
        onClick={() => {
          setManagerSection('agents');
          setPage('agent_list');
        }}
        className={`rounded-2xl px-4 py-3 text-sm font-black ${managerSection === 'agents' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
      >
        智能体
      </button>
      <button
        onClick={() => openKnowledgeList('knowledge_list')}
        className={`rounded-2xl px-4 py-3 text-sm font-black ${managerSection === 'knowledge' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
      >
        知识库
      </button>
    </div>
  );

  const renderDangerConfirm = () => (
    dangerConfirm ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-6">
        <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-7 shadow-[0_30px_80px_rgba(15,23,42,0.24)]">
          <div className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-[11px] font-black tracking-[0.12em] text-rose-600">
            永久删除
          </div>
          <h3 className="mt-4 text-[28px] font-black tracking-[-0.03em] text-slate-950">{dangerConfirm.title}</h3>
          <p className="mt-3 text-sm font-medium leading-7 text-slate-700">{dangerConfirm.message}</p>
          <div className="mt-5 rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700">
            确认后会立即执行，且无法撤销。
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDangerConfirm(null)}
              className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700"
            >
              取消
            </button>
            <button
              type="button"
              onClick={dangerConfirm.onConfirm}
              className="rounded-[18px] bg-[linear-gradient(135deg,#fb7185,#e11d48)] px-4 py-3 text-sm font-black text-white shadow-[0_18px_40px_rgba(225,29,72,0.28)]"
            >
              {dangerConfirm.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    ) : null
  );

  const wrapPage = (content: React.ReactNode) => (
    <div className="h-full min-h-0 overflow-y-auto pr-1">
      {content}
    </div>
  );

  if (page === 'agent_wizard') {
    return wrapPage(
      <>
        {renderSectionTabs()}
        <AgentWizardView
          mode={wizardMode}
          currentStep={wizardStep}
          form={wizardForm}
          knowledgeBases={knowledgeBases}
          availableChatModels={availableChatModels}
          availableImageModels={availableImageModels}
          onBack={() => setPage(selectedAgent ? 'agent_detail' : 'agent_list')}
          onPrev={() => setWizardStep((value) => Math.max(0, value - 1))}
          onNext={() => setWizardStep((value) => Math.min(4, value + 1))}
          onSubmit={handleWizardSubmit}
          onStepChange={setWizardStep}
          onChange={(field, value) => {
            if (field === 'iconUrl' && typeof value === 'string' && value && value.startsWith('data:')) {
              const mimeMatch = value.match(/^data:([^;]+);base64,/);
              const extension = mimeMatch?.[1]?.includes('png') ? 'png' : mimeMatch?.[1]?.includes('webp') ? 'webp' : 'jpg';
              const base64Data = value.split(',')[1] || '';
              void runAction(async () => {
                const uploaded = await uploadInternalAssetStream({
                  module: 'agent_center',
                  file: new File([Uint8Array.from(atob(base64Data), (char) => char.charCodeAt(0))], `agent-icon.${extension}`, { type: mimeMatch?.[1] || 'image/png' }),
                  fileName: `agent-icon.${extension}`,
                });
            setWizardForm((prev) => ({ ...prev, iconUrl: uploaded.fileUrl }));
            onStatusMessage('图标上传完成。');
          });
          return;
        }
            setWizardForm((prev) => {
              const next = { ...prev, [field]: value };
              if (field === 'allowedChatModels') {
                const allowedChatModels = Array.from(new Set((value as string[]).filter(Boolean)));
                next.allowedChatModels = allowedChatModels;
                if (!allowedChatModels.includes(next.defaultChatModel)) {
                  next.defaultChatModel = allowedChatModels[0] || '';
                }
                if (!allowedChatModels.includes(next.cheapModel)) {
                  next.cheapModel = allowedChatModels[0] || next.defaultChatModel || '';
                }
              }
              if (field === 'defaultChatModel' && !next.allowedChatModels.includes(String(value || ''))) {
                next.defaultChatModel = next.allowedChatModels[0] || '';
              }
              if (field === 'cheapModel' && !next.allowedChatModels.includes(String(value || ''))) {
                next.cheapModel = next.allowedChatModels[0] || next.defaultChatModel || '';
              }
              return next;
            });
          }}
        />
        {renderDangerConfirm()}
      </>
    );
  }

  if (page === 'agent_detail') {
    return wrapPage(
      <>
        {renderSectionTabs()}
        <AgentDetailView
          agent={selectedAgent}
          versions={versions}
          selectedVersionId={selectedVersionId}
          detailTab={detailTab}
          selectedKnowledgeBaseIds={selectedVersion?.knowledgeBaseIds || []}
          knowledgeBases={knowledgeBases}
          validationMessage={validationMessage}
          validationResult={validationResult}
          onBack={() => setPage('agent_list')}
          onDetailTabChange={setDetailTab}
          onEditDraft={openEditWizard}
          onEditConfig={() => void openEditWizardAtStep(3)}
          onEditKnowledge={() => void openEditWizardAtStep(2)}
          onCreateDraft={handleCreateDraft}
          onPublish={handlePublish}
          onDeleteAgent={openDeleteAgentConfirm}
          onSelectVersion={setSelectedVersionId}
          onRollback={handleRollback}
          onDeleteVersion={openDeleteVersionConfirm}
          onVersionNameChange={handleVersionNameChange}
          onKnowledgeBaseEditor={() => openKnowledgeList('agent_detail')}
          onValidationMessageChange={setValidationMessage}
          onValidate={handleValidate}
        />
        {renderDangerConfirm()}
      </>
    );
  }

  if (page === 'knowledge_editor') {
    return wrapPage(
      <>
        {renderSectionTabs()}
        <KnowledgeBaseEditorView
          knowledgeBase={selectedKnowledgeBase}
          documents={documents}
          form={knowledgeBaseForm}
          documentForm={documentForm}
          editingDocumentId={editingDocumentId}
          onBack={handleKnowledgeBack}
          onFormChange={(field, value) => setKnowledgeBaseForm((prev) => ({ ...prev, [field]: value }))}
          onDocumentFormChange={(field, value) => setDocumentForm((prev) => ({ ...prev, [field]: value }))}
          onUploadTextFile={handleUploadTextFile}
          onSave={handleSaveKnowledgeBase}
          onDeleteKnowledgeBase={handleArchiveKnowledgeBase}
          onCreateDocument={handleCreateDocument}
          onCancelDocumentEdit={handleCancelDocumentEdit}
          onEditDocument={handleEditDocument}
          onDeleteDocument={handleDeleteDocument}
        />
        {renderDangerConfirm()}
      </>
    );
  }

  if (page === 'knowledge_list') {
    return wrapPage(
      <>
        {renderSectionTabs()}
        <KnowledgeBaseListView
          knowledgeBases={filteredKnowledgeBases}
          selectedKnowledgeBaseId={selectedKnowledgeBaseId}
          search={knowledgeSearch}
          departmentFilter={knowledgeDepartmentFilter}
          onSearchChange={setKnowledgeSearch}
          onDepartmentFilterChange={setKnowledgeDepartmentFilter}
          onSelectKnowledgeBase={async (knowledgeBaseId) => {
            setSelectedKnowledgeBaseId(knowledgeBaseId);
            const detail = await fetchKnowledgeBaseDetail(knowledgeBaseId);
            setDocuments(detail.documents);
          }}
          onOpenCreate={() => openKnowledgeCreate('knowledge_list')}
          onOpenDetail={(knowledgeBaseId) => void openKnowledgeEditor(knowledgeBaseId, 'knowledge_list')}
        />
        {renderDangerConfirm()}
      </>
    );
  }

  return wrapPage(
    <>
      {renderSectionTabs()}
      <AgentListView
        agents={filteredAgents}
        selectedAgentId={selectedAgentId}
        search={agentSearch}
        statusFilter={agentStatusFilter}
        departmentFilter={agentDepartmentFilter}
        onSearchChange={setAgentSearch}
        onStatusFilterChange={setAgentStatusFilter}
        onDepartmentFilterChange={setAgentDepartmentFilter}
        onSelectAgent={async (agentId) => {
          setManagerSection('agents');
          setSelectedAgentId(agentId);
          await loadAgents(agentId);
        }}
        onOpenDetail={async (agentId) => {
          setManagerSection('agents');
          setSelectedAgentId(agentId);
          await loadAgents(agentId);
          setPage('agent_detail');
        }}
        onOpenCreate={openCreateWizard}
      />
      {renderDangerConfirm()}
    </>
  );
};

export default AgentCenterManager;
