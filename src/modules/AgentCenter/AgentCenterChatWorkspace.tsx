import React, { useMemo, useState } from 'react';
import { AgentChatMessage, AgentChatSession, AgentSummary, AuthUser, ModuleInterfaceId, SystemPublicConfig } from '../../types';
import AgentAvatar from './AgentAvatar';
import ChatConversationPane from './ChatConversationPane';
import { ComposerAttachment } from './ChatComposer';
import { resolveActiveAgentId } from './agentCenterUtils.mjs';
import { LegacyFaIcon, PopoverSelect } from '../../components/ui/workspacePrimitives';

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
  'rounded-[20px] shadow-none';

const formatModelLabel = (modelId?: string | null) => {
  if (!modelId) return '-';
  return modelId
    .replace(/^nano-banana-/i, 'Nano Banana ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const formatRunStatusLabel = (status?: string | null) => {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  if (status === 'running') return '运行中';
  if (status === 'queued') return '排队中';
  return '待开始';
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
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
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
  const latestAssistantRun = useMemo(() => {
    return [...messages].reverse().find((message) => (
      message.role === 'assistant' && Boolean(message.metadata?.clientRequestId || message.metadata?.runId)
    )) || null;
  }, [messages]);
  const contextTrace = latestAssistantRun?.metadata?.contextTrace || null;
  const currentSessionImageCount = useMemo(() => messages.reduce((count, message) => (
    count + (Array.isArray(message.attachments)
      ? message.attachments.filter((attachment) => attachment.kind === 'image' && attachment.url).length
      : 0)
  ), 0), [messages]);
  const pendingMessageCount = useMemo(() => messages.filter((message) => Boolean(message.metadata?.pending)).length, [messages]);
  const currentRunStatus = sendingMessage || pendingMessageCount > 0
    ? 'running'
    : String(latestAssistantRun?.metadata?.status || selectedSession?.lastRunStatus || '');

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
      <div className="fixed inset-0 z-40 flex items-center justify-center px-6" style={{ background: 'var(--overlay-bg)' }}>
        <div className="w-full max-w-md rounded-[24px] p-5" style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-elevated)' }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{confirmState.title}</h3>
              <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>{confirmState.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmState(null)}
              className="flex h-8 w-8 items-center justify-center rounded-full transition"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
              aria-label="关闭确认弹窗"
            >
              <LegacyFaIcon icon="fa-xmark" className="text-sm" />
            </button>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmState(null)}
              className="rounded-full px-4 py-2 text-[12px] font-semibold"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmState.onConfirm}
              className="rounded-full px-4 py-2 text-[12px] font-semibold text-white"
              style={{ background: 'var(--error)' }}
            >
              {confirmState.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderContextPanel = () => {
    if (!contextPanelOpen) return null;
    return (
      <aside
        className="fixed right-6 top-[96px] z-40 flex max-h-[calc(100vh-120px)] w-[340px] min-h-0 flex-col overflow-hidden rounded-[22px] border p-3.5 shadow-[0_18px_46px_rgba(15,23,42,0.16)]"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-tertiary)' }}>运行视图</p>
              <h4 className="mt-1.5 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>任务状态</h4>
            </div>
            <button
              type="button"
              onClick={() => setContextPanelOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full transition"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              aria-label="关闭运行视图"
              title="关闭运行视图"
            >
              <LegacyFaIcon icon="fa-xmark" className="text-[13px]" />
            </button>
          </div>

          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>当前任务</span>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                  {formatRunStatusLabel(currentRunStatus)}
                </span>
              </div>
              <p className="mt-2 break-all text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
                {latestAssistantRun?.metadata?.runId ? String(latestAssistantRun.metadata.runId) : '发送后生成运行 ID'}
              </p>
            </div>

            <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>历史复用</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>历史消息</p>
                  <p className="mt-1 text-[16px] font-black" style={{ color: 'var(--text-primary)' }}>{Number(contextTrace?.historyMessageCount || 0)}</p>
                </div>
                <div className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>知识命中</p>
                  <p className="mt-1 text-[16px] font-black" style={{ color: 'var(--text-primary)' }}>{Number(contextTrace?.knowledgeChunkCount || 0)}</p>
                </div>
                <div className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>附件引用</p>
                  <p className="mt-1 text-[16px] font-black" style={{ color: 'var(--text-primary)' }}>{Array.isArray(contextTrace?.attachmentRefs) ? contextTrace.attachmentRefs.length : 0}</p>
                </div>
                <div className="rounded-[12px] px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>摘要</p>
                  <p className="mt-1 text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>{contextTrace?.summaryUsed ? '已启用' : '未启用'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>会话资产</p>
              <div className="mt-3 space-y-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center justify-between">
                  <span>消息</span>
                  <span className="font-black" style={{ color: 'var(--text-primary)' }}>{messages.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>图片</span>
                  <span className="font-black" style={{ color: 'var(--text-primary)' }}>{currentSessionImageCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>模式</span>
                  <span className="font-black" style={{ color: 'var(--text-primary)' }}>{imageModeEnabled ? '生图' : '对话'}</span>
                </div>
              </div>
            </div>
          </div>
      </aside>
    );
  };

  if (workspacePage === 'plaza') {
    return (
      <>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_292px]">
          <section className={`${glassPanelClassName} px-4 py-4`} style={{ background: 'var(--bg-surface)' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>智能体广场</p>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>{chatAgents.length}</span>
              </div>
              <PopoverSelect
                value={departmentFilter}
                onChange={setDepartmentFilter}
                options={departmentOptions.map((item) => ({ value: item, label: item === 'all' ? '全部部门' : item }))}
                buttonClassName="rounded-full px-3 py-2 text-[12px] font-semibold"
              />
            </div>

            <div className="mt-3 rounded-[18px] p-2.5" style={{ background: 'var(--bg-base)' }}>
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
                      className="group flex flex-col items-center gap-1 rounded-[14px] px-2 py-2 text-center transition"
                      style={active
                        ? { background: 'color-mix(in srgb, var(--accent-soft) 52%, var(--bg-surface))' }
                        : { background: 'var(--bg-surface)' }}
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
                        <p className="truncate text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredAgents.length === 0 ? (
                <div className="py-8 text-center text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>当前部门下暂无智能体</div>
              ) : null}
            </div>

            <div className="mt-3 rounded-[18px] p-3" style={{ background: 'var(--bg-base)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>最近使用</p>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}
                    title="收起时显示最近使用过的智能体图标，展开后可以直接删除你和该智能体相关的历史记录。"
                    aria-label="最近使用说明"
                  >
                    <LegacyFaIcon icon="fa-question" className="text-[9px]" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setRecentDeleteMode((value) => !value)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] transition"
                  style={recentDeleteMode
                    ? { borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }
                    : { borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  title={recentDeleteMode ? '退出删除模式' : '进入删除模式'}
                  aria-label={recentDeleteMode ? '退出删除模式' : '进入删除模式'}
                >
                  <LegacyFaIcon icon="fa-trash-can" className="text-[12px]" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2.5">
                {recentAgents.length === 0 ? (
                  <div className="rounded-[20px] border px-4 py-4 text-sm font-medium" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                    还没有使用记录
                  </div>
                ) : (
                  recentAgents.map((agent) => (
                    <div key={agent.id} className="relative">
                      <button
                        type="button"
                        onClick={() => onPreviewAgent(agent.id)}
                        className="flex w-[52px] flex-col items-center gap-1 rounded-[14px] border px-1.5 py-2 transition"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                        title={agent.name}
                      >
                        <AgentAvatar
                          name={agent.name}
                          iconUrl={agent.iconUrl || undefined}
                          avatarPreset={agent.avatarPreset || undefined}
                          className="h-7 w-7 rounded-[10px] text-[11px]"
                        />
                        <span className="w-full truncate text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>{agent.name}</span>
                      </button>
                      {recentDeleteMode ? (
                        <button
                          type="button"
                          onClick={() => openDeleteAgentHistoryConfirm(agent)}
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white"
                          aria-label={`删除 ${agent.name} 的使用记录`}
                        >
                          <LegacyFaIcon icon="fa-xmark" className="text-[10px]" />
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <aside className={`${glassPanelClassName} px-4 py-4`} style={{ background: 'var(--bg-surface)' }}>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>智能体信息</p>
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
                    <p className="truncate text-[16px] font-black" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</p>
                    <p className="mt-0.5 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {selectedAgent.department || '通用'} · {selectedAgent.ownerDisplayName || '未显示制作人'}
                    </p>
                  </div>
                </div>

                <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
                  <p className="text-[13px] font-medium leading-6" style={{ color: 'var(--text-secondary)' }}>{selectedAgentSummary}</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>制作人</p>
                    <p className="mt-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {selectedAgent.ownerDisplayName || '未显示'}
                    </p>
                  </div>
                  <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>部门</p>
                    <p className="mt-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedAgent.department || '通用'}</p>
                  </div>
                  <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>模型</p>
                    <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatModelLabel(selectedAgent.defaultChatModel || selectedAgent.defaultModel || '-')}
                    </p>
                  </div>
                  <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>生图</p>
                    <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {imageGenerationEnabled ? formatModelLabel(selectedAgent.imageModel || '-') : '未启用'}
                    </p>
                  </div>
                  <div className="rounded-[16px] p-3" style={{ background: 'var(--bg-base)' }}>
                    <p className="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>会话</p>
                    <p className="mt-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedAgentSessions.length} 个</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onEnterAgent(selectedAgent.id)}
                  className="w-full rounded-full px-4 py-2.5 text-[13px] font-semibold transition"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                >
                  {recentAgentIds.has(selectedAgent.id) ? '进入会话' : '开始对话'}
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-[22px] border px-4 py-8 text-center text-sm font-medium" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-tertiary)' }}>
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
        <section className={`${glassPanelClassName} px-4 py-3.5`} style={{ background: 'var(--bg-surface)' }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={onBackToPlaza}
                className="inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[12px] font-black"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
              >
                <LegacyFaIcon icon="fa-arrow-left" className="text-xs" />
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
                    <p className="truncate text-[16px] font-semibold tracking-[-0.02em]" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</p>
                    <p className="truncate text-[12px]" style={{ color: 'var(--text-secondary)' }}>{selectedAgentSummary}</p>
                  </div>
                </>
              ) : null}
            </div>
            {selectedAgent && selectedAgentSessions.length > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setContextPanelOpen(true)}
                  className="inline-flex h-9 items-center gap-2 rounded-[16px] px-3 text-[12px] font-semibold"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  title="打开运行视图"
                  aria-label="打开运行视图"
                >
                  <LegacyFaIcon icon="fa-chart-line" className="text-[12px]" />
                  <span>运行视图</span>
                </button>
                <button
                  type="button"
                  onClick={onToggleSessionsCollapsed}
                  className="flex h-9 w-9 items-center justify-center rounded-[16px]"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                  title={sessionsCollapsed ? '展开会话列表' : '收起会话列表'}
                  aria-label={sessionsCollapsed ? '展开会话列表' : '收起会话列表'}
                >
                  <LegacyFaIcon icon={sessionsCollapsed ? 'fa-angles-right' : 'fa-angles-left'} className="text-sm" />
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {!selectedAgent ? (
          <section className={`${glassPanelClassName} flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center text-sm font-medium`} style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
            当前没有可用智能体。
          </section>
        ) : selectedAgentSessions.length === 0 ? (
          <section className={`${glassPanelClassName} min-h-0 flex-1 px-5 py-6`} style={{ background: 'var(--bg-surface)' }}>
            <div className="mx-auto max-w-2xl rounded-[20px] p-5" style={{ background: 'var(--bg-base)' }}>
              <div className="flex items-start gap-4">
                <AgentAvatar
                  name={selectedAgent.name}
                  iconUrl={selectedAgent.iconUrl || undefined}
                  avatarPreset={selectedAgent.avatarPreset || undefined}
                  className="h-14 w-14 rounded-[18px] text-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-tertiary)' }}>首次使用</p>
                  <h3 className="mt-2 text-[22px] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</h3>
                  <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>{selectedAgentSummary}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full px-3 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      模型 {selectedAgent.defaultChatModel || selectedAgent.defaultModel || '-'}
                    </span>
                    <span className="rounded-full px-3 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      {currentUser?.displayName || currentUser?.username || '内部成员'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCreateSession(selectedAgent.id)}
                    className="mt-5 rounded-full px-4 py-2.5 text-[13px] font-semibold transition"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                  >
                    开始对话
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className={`min-h-0 flex-1 overflow-hidden grid gap-3 ${sessionsCollapsed ? 'xl:grid-cols-[72px_minmax(0,1fr)]' : 'xl:grid-cols-[260px_minmax(0,1fr)]'}`}>
            <aside className={`${glassPanelClassName} min-h-0 overflow-hidden ${sessionsCollapsed ? 'px-3 py-4' : 'p-3.5'}`} style={{ background: 'var(--bg-surface)' }}>
              {sessionsCollapsed ? (
                <div className="flex h-full min-h-0 flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={onToggleSessionsCollapsed}
                    className="flex h-9 w-9 items-center justify-center rounded-[15px]"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    title="展开会话列表"
                    aria-label="展开会话列表"
                  >
                    <LegacyFaIcon icon="fa-angles-right" className="text-sm" />
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
                    className="flex h-9 w-9 items-center justify-center rounded-[15px]"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                    title="新建会话"
                    aria-label="新建会话"
                  >
                    <LegacyFaIcon icon="fa-pen-to-square" className="text-sm" />
                  </button>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-tertiary)' }}>会话</p>
                      <h4 className="mt-1.5 text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</h4>
                      <p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{selectedAgentSessions.length} 个会话</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onCreateSession(selectedAgent.id)}
                        className="flex h-9 w-9 items-center justify-center rounded-[15px]"
                        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                        title="新建会话"
                        aria-label="新建会话"
                      >
                        <LegacyFaIcon icon="fa-pen-to-square" className="text-sm" />
                      </button>
                      <button
                        type="button"
                        onClick={onToggleSessionsCollapsed}
                        className="flex h-9 w-9 items-center justify-center rounded-[15px]"
                        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                        title="收起会话列表"
                        aria-label="收起会话列表"
                      >
                        <LegacyFaIcon icon="fa-angles-left" className="text-sm" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {selectedAgentSessions.map((session) => {
                      const active = session.id === selectedSessionId;
                      const lastMessagePreview = session.lastMessagePreview?.trim() || '暂无消息';
                      const messageCount = Number(session.messageCount || 0);
                      const imageCount = Number(session.imageCount || 0);
                      return (
                        <div
                          key={session.id}
                          className="rounded-[16px] p-2.5 transition"
                          style={active
                            ? { background: 'color-mix(in srgb, var(--accent-soft) 48%, var(--bg-surface))' }
                            : { background: 'var(--bg-base)' }}
                        >
                          <button type="button" onClick={() => onSelectSession(session.id)} className="w-full text-left">
                            <p className="truncate text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>{session.title}</p>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>{lastMessagePreview}</p>
                            <p className="mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                              {new Date(session.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                            </p>
                          </button>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex min-w-0 flex-wrap gap-1.5">
                              <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                                {messageCount} 消息
                              </span>
                              {imageCount > 0 ? (
                                <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                                  {imageCount} 图
                                </span>
                              ) : null}
                              {session.lastRunStatus ? (
                                <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                                  {formatRunStatusLabel(session.lastRunStatus)}
                                </span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => openDeleteSessionConfirm(session)}
                              className="flex h-7 w-7 items-center justify-center rounded-full border transition"
                              style={{ borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}
                              title="删除会话"
                              aria-label="删除会话"
                            >
                              <LegacyFaIcon icon="fa-trash" className="text-xs" />
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

            {renderContextPanel()}
          </div>
        )}
      </div>
      {renderConfirmDialog()}
    </>
  );
};

export default AgentCenterChatWorkspace;
