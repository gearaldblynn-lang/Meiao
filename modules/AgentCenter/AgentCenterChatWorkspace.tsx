import React, { useMemo, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, ModuleInterfaceId, SystemPublicConfig } from '../../types';
import AgentAvatar from './AgentAvatar';
import ChatConversationPane from './ChatConversationPane';
import { ComposerAttachment } from './ChatComposer';
import { resolveActiveAgentId } from './agentCenterUtils.mjs';

interface Props {
  currentUser?: AuthUser | null;
  chatAgents: AgentSummary[];
  recentAgents: AgentSummary[];
  sessions: AgentChatSession[];
  workspacePage: 'plaza' | 'chat';
  selectedAgentId: string;
  selectedSessionId: string;
  messages: AgentChatMessage[];
  messageDraft: string;
  chatModels: SystemPublicConfig['agentModels']['chat'];
  selectedModel: string;
  reasoningLevel: string | null;
  webSearchEnabled: boolean;
  attachments: ComposerAttachment[];
  imageModeEnabled: boolean;
  sessionsCollapsed: boolean;
  onToggleSessionsCollapsed: () => void;
  onPreviewAgent: (agentId: string) => void;
  onEnterAgent: (agentId: string) => void;
  onBackToPlaza: () => void;
  onCreateSession: (agentId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onDeleteAgentHistory: (agentId: string) => void;
  onMessageDraftChange: (value: string) => void;
  onSelectedModelChange: (value: string) => void;
  onReasoningLevelChange: (value: string | null) => void;
  onWebSearchToggle: () => void;
  onAddAttachments: (next: ComposerAttachment[]) => void;
  onRemoveAttachment: (id: string) => void;
  onImageModeToggle: () => void;
  onSendMessage: () => void;
  onInterruptSend?: () => void;
  sendingMessage?: boolean;
  onHandoff?: (target: ModuleInterfaceId, payload: Record<string, unknown>) => void;
  onBatchSend?: (batches: ComposerAttachment[][], meta: { totalFiles: number; skippedCount: number; skippedReasons: string[] }) => Promise<void>;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

const glassPanelClassName =
  'rounded-[30px] border border-white/70 bg-white/72 shadow-[0_25px_55px_rgba(15,23,42,0.12)] backdrop-blur-xl';

const formatModelLabel = (modelId?: string | null) => {
  if (!modelId) return '-';
  return modelId
    .replace(/^nano-banana-/i, 'Nano Banana ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const AgentCenterChatWorkspace: React.FC<Props> = ({
  currentUser = null,
  chatAgents,
  recentAgents,
  sessions,
  workspacePage,
  selectedAgentId,
  selectedSessionId,
  messages,
  messageDraft,
  chatModels,
  selectedModel,
  reasoningLevel,
  webSearchEnabled,
  attachments,
  imageModeEnabled,
  sessionsCollapsed,
  onToggleSessionsCollapsed,
  onPreviewAgent,
  onEnterAgent,
  onBackToPlaza,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onDeleteAgentHistory,
  onMessageDraftChange,
  onSelectedModelChange,
  onReasoningLevelChange,
  onWebSearchToggle,
  onAddAttachments,
  onRemoveAttachment,
  onImageModeToggle,
  onSendMessage,
  onInterruptSend,
  sendingMessage = false,
  onHandoff,
  onBatchSend,
}) => {
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [recentDeleteMode, setRecentDeleteMode] = useState(false);
  const [agentDetailOpen, setAgentDetailOpen] = useState(true);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );
  const selectedAgent = useMemo(
    () => {
      const activeAgentId = resolveActiveAgentId({
        workspacePage,
        selectedAgentId,
        selectedSession,
      });
      return chatAgents.find((agent) => agent.id === activeAgentId) || chatAgents[0] || null;
    },
    [chatAgents, selectedAgentId, selectedSession, workspacePage]
  );
  const selectedAgentSessions = useMemo(() => {
    if (!selectedAgent) return [];
    return sessions
      .filter((session) => session.agentId === selectedAgent.id)
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }, [selectedAgent, sessions]);
  const recentAgentIds = new Set(recentAgents.map((agent) => agent.id));
  const departmentOptions = useMemo(() => {
    const options = Array.from(new Set(chatAgents.map((agent) => agent.department?.trim() || '通用').filter(Boolean)));
    return ['all', ...options];
  }, [chatAgents]);
  const filteredAgents = useMemo(() => {
    if (departmentFilter === 'all') return chatAgents;
    return chatAgents.filter((agent) => (agent.department?.trim() || '通用') === departmentFilter);
  }, [chatAgents, departmentFilter]);
  const selectedAgentSummary = selectedAgent?.description || '未填写介绍';
  const imageGenerationEnabled = Boolean(selectedAgent?.imageGenerationEnabled && selectedAgent?.imageModel);
  const imageMaxInputCount = Number(selectedAgent?.imageMaxInputCount || 1);

  const openDeleteAgentHistoryConfirm = (agent: AgentSummary) => {
    setConfirmState({
      title: '删除使用记录',
      message: `确认删除你与“${agent.name}”相关的全部会话、消息和使用记录吗？此操作不可恢复。`,
      confirmLabel: '确认删除',
      onConfirm: () => {
        setConfirmState(null);
        onDeleteAgentHistory(agent.id);
      },
    });
  };

  const openDeleteSessionConfirm = (session: AgentChatSession) => {
    setConfirmState({
      title: '删除会话',
      message: `确认删除会话“${session.title}”吗？删除后该会话消息不可恢复。`,
      confirmLabel: '确认删除',
      onConfirm: () => {
        setConfirmState(null);
        onDeleteSession(session.id);
      },
    });
  };

  const renderConfirmDialog = () => {
    if (!confirmState) return null;
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/24 px-6">
        <div className="w-full max-w-md rounded-[30px] border border-white/70 bg-white/88 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-black text-slate-900">{confirmState.title}</h3>
              <p className="mt-3 text-sm font-medium leading-7 text-slate-600">{confirmState.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmState(null)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 text-slate-400 transition hover:text-slate-700"
              aria-label="关闭确认弹窗"
            >
              <i className="fas fa-xmark text-sm" />
            </button>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmState(null)}
              className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-2.5 text-sm font-black text-slate-600"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmState.onConfirm}
              className="rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-black text-white"
            >
              {confirmState.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (workspacePage === 'plaza') {
    return (
      <>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className={`${glassPanelClassName} px-5 py-5`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-black text-slate-900">智能体广场</p>
                <span className="rounded-full bg-white/88 px-2.5 py-1 text-[11px] font-black text-slate-500">{chatAgents.length}</span>
              </div>
              <select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
                className="rounded-full border border-slate-200/90 bg-white/90 px-3 py-2 text-[12px] font-semibold text-slate-600 outline-none"
              >
                <option value="all">全部部门</option>
                {departmentOptions.filter((item) => item !== 'all').map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 rounded-[22px] border border-slate-200/80 bg-white/74 p-3">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                {filteredAgents.map((agent) => {
                  const active = agent.id === selectedAgent?.id;
                  const used = recentAgentIds.has(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        onPreviewAgent(agent.id);
                        setAgentDetailOpen(true);
                      }}
                      className={`group flex flex-col items-center gap-1 rounded-[14px] border px-2 py-2 text-center transition ${
                        active
                          ? 'border-cyan-300/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(236,254,255,0.88))] shadow-[0_10px_22px_rgba(14,165,233,0.12)]'
                          : 'border-slate-200/80 bg-white/82 hover:border-slate-300/90 hover:bg-white/92'
                      }`}
                    >
                      <div className="relative">
                        <AgentAvatar
                          name={agent.name}
                          iconUrl={agent.iconUrl || undefined}
                          avatarPreset={agent.avatarPreset || undefined}
                          className="h-10 w-10 rounded-[13px] text-sm"
                        />
                        {used ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" /> : null}
                      </div>
                      <div className="w-full">
                        <p className="truncate text-[10px] font-semibold text-slate-800">{agent.name}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredAgents.length === 0 ? (
                <div className="py-8 text-center text-sm font-medium text-slate-500">当前部门下暂无智能体</div>
              ) : null}
            </div>

            <div className="mt-4 rounded-[22px] border border-slate-200/80 bg-white/74 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-black text-slate-700">最近使用</p>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 text-[10px] text-slate-400"
                    title="收起时显示最近使用过的智能体图标，展开后可以直接删除你和该智能体相关的历史记录。"
                    aria-label="最近使用说明"
                  >
                    <i className="fas fa-question text-[9px]" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setRecentDeleteMode((value) => !value)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-[12px] transition ${
                    recentDeleteMode
                      ? 'border-rose-200 bg-rose-50 text-rose-500'
                      : 'border-slate-200/90 bg-white/90 text-slate-500'
                  }`}
                  title={recentDeleteMode ? '退出删除模式' : '进入删除模式'}
                  aria-label={recentDeleteMode ? '退出删除模式' : '进入删除模式'}
                >
                  <i className="fas fa-trash-can" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2.5">
                {recentAgents.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-slate-200/80 bg-slate-50/70 px-4 py-4 text-sm font-medium text-slate-500">
                    还没有使用记录
                  </div>
                ) : (
                  recentAgents.map((agent) => (
                    <div key={agent.id} className="relative">
                      <button
                        type="button"
                        onClick={() => onPreviewAgent(agent.id)}
                        className="flex w-[52px] flex-col items-center gap-1 rounded-[14px] border border-slate-200/80 bg-white/86 px-1.5 py-2 transition hover:border-slate-300"
                        title={agent.name}
                      >
                        <AgentAvatar
                          name={agent.name}
                          iconUrl={agent.iconUrl || undefined}
                          avatarPreset={agent.avatarPreset || undefined}
                          className="h-7 w-7 rounded-[10px] text-[11px]"
                        />
                        <span className="w-full truncate text-[10px] font-medium text-slate-500">{agent.name}</span>
                      </button>
                      {recentDeleteMode ? (
                        <button
                          type="button"
                          onClick={() => openDeleteAgentHistoryConfirm(agent)}
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white"
                          aria-label={`删除 ${agent.name} 的使用记录`}
                        >
                          <i className="fas fa-xmark" />
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <aside className={`${glassPanelClassName} px-4 py-4`}>
            <p className="text-[12px] font-black text-slate-700">智能体信息</p>
            {selectedAgent && agentDetailOpen ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-3">
                  <AgentAvatar
                    name={selectedAgent.name}
                    iconUrl={selectedAgent.iconUrl || undefined}
                    avatarPreset={selectedAgent.avatarPreset || undefined}
                    className="h-12 w-12 rounded-[16px] text-base"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-black text-slate-900">{selectedAgent.name}</p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                      {selectedAgent.department || '通用'} · {selectedAgent.ownerDisplayName || '未显示制作人'}
                    </p>
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-200/80 bg-white/80 p-3">
                  <p className="text-[13px] font-medium leading-6 text-slate-600">{selectedAgentSummary}</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-slate-200/80 bg-white/80 p-3">
                    <p className="text-[11px] font-black text-slate-400">制作人</p>
                    <p className="mt-1.5 text-[12px] font-semibold text-slate-900">
                      {selectedAgent.ownerDisplayName || '未显示'}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200/80 bg-white/80 p-3">
                    <p className="text-[11px] font-black text-slate-400">部门</p>
                    <p className="mt-1.5 text-[12px] font-semibold text-slate-900">{selectedAgent.department || '通用'}</p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200/80 bg-white/80 p-3">
                    <p className="text-[11px] font-black text-slate-400">模型</p>
                    <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold text-slate-900">
                      {formatModelLabel(selectedAgent.defaultChatModel || selectedAgent.defaultModel || '-')}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200/80 bg-white/80 p-3">
                    <p className="text-[11px] font-black text-slate-400">生图</p>
                    <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold text-slate-900">
                      {imageGenerationEnabled ? formatModelLabel(selectedAgent.imageModel || '-') : '未启用'}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-slate-200/80 bg-white/80 p-3">
                    <p className="text-[11px] font-black text-slate-400">会话</p>
                    <p className="mt-1.5 text-[12px] font-semibold text-slate-900">{selectedAgentSessions.length} 个</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onEnterAgent(selectedAgent.id)}
                  className="w-full rounded-[18px] bg-slate-900 px-4 py-2.5 text-[13px] font-black text-white"
                >
                  {recentAgentIds.has(selectedAgent.id) ? '进入会话' : '开始对话'}
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-[22px] border border-dashed border-slate-200/80 bg-slate-50/70 px-4 py-8 text-center text-sm font-medium text-slate-500">
                选择左侧智能体后查看信息
              </div>
            )}
          </aside>
        </div>
        {renderConfirmDialog()}
      </>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <section className={`${glassPanelClassName} px-5 py-4`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={onBackToPlaza}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200/85 bg-white/90 px-3.5 text-[12px] font-black text-slate-700"
              >
                <i className="fas fa-arrow-left text-xs" />
                返回智能体广场
              </button>
              {selectedAgent ? (
                <>
                  <AgentAvatar
                    name={selectedAgent.name}
                    iconUrl={selectedAgent.iconUrl || undefined}
                    avatarPreset={selectedAgent.avatarPreset || undefined}
                    className="h-11 w-11 rounded-[16px] text-sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-black tracking-[-0.02em] text-slate-950">{selectedAgent.name}</p>
                    <p className="truncate text-[12px] font-medium text-slate-500">{selectedAgentSummary}</p>
                  </div>
                </>
              ) : null}
            </div>
            {selectedAgent && selectedAgentSessions.length > 0 ? (
              <button
                type="button"
                onClick={onToggleSessionsCollapsed}
                className="flex h-9 w-9 items-center justify-center rounded-[16px] border border-slate-200/80 bg-white/86 text-slate-500"
                title={sessionsCollapsed ? '展开会话列表' : '收起会话列表'}
                aria-label={sessionsCollapsed ? '展开会话列表' : '收起会话列表'}
              >
                <i className={`fas ${sessionsCollapsed ? 'fa-angles-right' : 'fa-angles-left'} text-sm`} />
              </button>
            ) : null}
          </div>
        </section>

        {!selectedAgent ? (
          <section className={`${glassPanelClassName} flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center text-sm font-medium text-slate-500`}>
            当前没有可用智能体。
          </section>
        ) : selectedAgentSessions.length === 0 ? (
          <section className={`${glassPanelClassName} min-h-0 flex-1 px-6 py-7`}>
            <div className="mx-auto max-w-2xl rounded-[24px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(236,254,255,0.82))] p-5 shadow-[0_18px_40px_rgba(14,165,233,0.1)]">
              <div className="flex items-start gap-4">
                <AgentAvatar
                  name={selectedAgent.name}
                  iconUrl={selectedAgent.iconUrl || undefined}
                  avatarPreset={selectedAgent.avatarPreset || undefined}
                  className="h-14 w-14 rounded-[18px] text-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">首次使用</p>
                  <h3 className="mt-2 text-[22px] font-black tracking-[-0.03em] text-slate-950">{selectedAgent.name}</h3>
                  <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600">{selectedAgentSummary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200/80 bg-white/88 px-3 py-1 text-[10px] font-black text-slate-500">
                      模型 {selectedAgent.defaultChatModel || selectedAgent.defaultModel || '-'}
                    </span>
                    <span className="rounded-full border border-slate-200/80 bg-white/88 px-3 py-1 text-[10px] font-black text-slate-500">
                      {currentUser?.displayName || currentUser?.username || '内部成员'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCreateSession(selectedAgent.id)}
                    className="mt-5 rounded-[18px] bg-slate-900 px-4 py-2.5 text-[13px] font-black text-white"
                  >
                    开始对话
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className={`min-h-0 flex-1 overflow-hidden grid gap-4 ${sessionsCollapsed ? 'xl:grid-cols-[78px_minmax(0,1fr)]' : 'xl:grid-cols-[280px_minmax(0,1fr)]'}`}>
            <aside className={`${glassPanelClassName} min-h-0 overflow-hidden ${sessionsCollapsed ? 'px-3 py-4' : 'p-4'}`}>
              {sessionsCollapsed ? (
                <div className="flex h-full min-h-0 flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={onToggleSessionsCollapsed}
                    className="flex h-9 w-9 items-center justify-center rounded-[15px] border border-slate-200/80 bg-white/80 text-slate-500"
                    title="展开会话列表"
                    aria-label="展开会话列表"
                  >
                    <i className="fas fa-angles-right text-sm" />
                  </button>
                  <AgentAvatar
                    name={selectedAgent.name}
                    iconUrl={selectedAgent.iconUrl || undefined}
                    avatarPreset={selectedAgent.avatarPreset || undefined}
                    className="h-10 w-10 rounded-[15px] text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => onCreateSession(selectedAgent.id)}
                    className="flex h-9 w-9 items-center justify-center rounded-[15px] border border-slate-200/80 bg-white/80 text-slate-500"
                    title="新建会话"
                    aria-label="新建会话"
                  >
                    <i className="fas fa-pen-to-square text-sm" />
                  </button>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">会话</p>
                      <h4 className="mt-1.5 text-[16px] font-black text-slate-900">{selectedAgent.name}</h4>
                      <p className="mt-1 text-[12px] font-medium text-slate-500">{selectedAgentSessions.length} 个会话</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onCreateSession(selectedAgent.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-[15px] border border-slate-200/80 bg-white/80 text-slate-500"
                        title="新建会话"
                        aria-label="新建会话"
                      >
                        <i className="fas fa-pen-to-square text-sm" />
                      </button>
                      <button
                        type="button"
                        onClick={onToggleSessionsCollapsed}
                        className="flex h-9 w-9 items-center justify-center rounded-[15px] border border-slate-200/80 bg-white/80 text-slate-500"
                        title="收起会话列表"
                        aria-label="收起会话列表"
                      >
                        <i className="fas fa-angles-left text-sm" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {selectedAgentSessions.map((session) => {
                      const active = session.id === selectedSessionId;
                      return (
                        <div
                          key={session.id}
                          className={`rounded-[18px] border p-2.5 transition ${
                            active
                              ? 'border-cyan-300/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(236,254,255,0.92))] shadow-[0_10px_24px_rgba(14,165,233,0.14)]'
                              : 'border-slate-200/80 bg-white/76 hover:border-slate-300/90'
                          }`}
                        >
                          <button type="button" onClick={() => onSelectSession(session.id)} className="w-full text-left">
                            <p className="truncate text-[13px] font-black text-slate-900">{session.title}</p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                            </p>
                          </button>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                              {session.selectedModel || '默认模型'}
                            </span>
                            <button
                              type="button"
                              onClick={() => openDeleteSessionConfirm(session)}
                              className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-200/80 bg-rose-50/85 text-rose-500 transition hover:bg-rose-100"
                              title="删除会话"
                              aria-label="删除会话"
                            >
                              <i className="fas fa-trash text-xs" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </aside>

            <div className="min-w-0 min-h-0">
              <ChatConversationPane
                messages={messages}
                messageDraft={messageDraft}
                onMessageDraftChange={onMessageDraftChange}
                onSendMessage={onSendMessage}
                sending={sendingMessage}
                selectedSession={selectedSession}
                selectedAgent={selectedAgent}
                currentUser={currentUser}
                chatModels={chatModels}
                selectedModel={selectedModel}
                onModelChange={onSelectedModelChange}
                reasoningLevel={reasoningLevel}
                onReasoningLevelChange={onReasoningLevelChange}
                webSearchEnabled={webSearchEnabled}
                onWebSearchToggle={onWebSearchToggle}
                attachments={attachments}
                onAddAttachments={onAddAttachments}
                onRemoveAttachment={onRemoveAttachment}
                imageModeEnabled={imageModeEnabled}
                imageModeAvailable={imageGenerationEnabled}
                imageMaxInputCount={imageMaxInputCount}
                onImageModeToggle={onImageModeToggle}
                onInterruptSend={onInterruptSend}
                onHandoff={onHandoff}
                onBatchSend={onBatchSend}
              />
            </div>
          </div>
        )}
      </div>
      {renderConfirmDialog()}
    </>
  );
};

export default AgentCenterChatWorkspace;
