import React from 'react';
import { AgentSummary } from '../../types';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
import AgentAvatar from './AgentAvatar';

interface Props {
  agents: AgentSummary[];
  selectedAgentId: string;
  search: string;
  statusFilter: 'all' | 'draft' | 'published' | 'archived';
  departmentFilter: string;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: 'all' | 'draft' | 'published' | 'archived') => void;
  onDepartmentFilterChange: (value: string) => void;
  onSelectAgent: (agentId: string) => void;
  onOpenDetail: (agentId: string) => void;
  onOpenCreate: () => void;
}

const glassPanelClassName =
  'rounded-[20px] border border-white/80 bg-white/86 shadow-[0_14px_32px_rgba(148,163,184,0.09)] backdrop-blur-xl';

const metricCardClassName =
  'inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 shadow-[0_8px_18px_rgba(148,163,184,0.07)]';

const AgentListView: React.FC<Props> = ({
  agents,
  selectedAgentId,
  search,
  statusFilter,
  departmentFilter,
  onSearchChange,
  onStatusFilterChange,
  onDepartmentFilterChange,
  onSelectAgent,
  onOpenDetail,
  onOpenCreate,
}) => {
  const departments = Array.from(new Set(agents.map((item) => item.department).filter(Boolean)));
  const selectedAgent = agents.find((item) => item.id === selectedAgentId) || agents[0] || null;
  const publishedCount = agents.filter((item) => item.status === 'published').length;
  const draftCount = agents.filter((item) => item.status === 'draft').length;

  return (
    <div className="space-y-3 pb-6">
      <WorkspaceShellCard className="flex-none overflow-hidden border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.8))] px-4 py-3.5 shadow-[0_20px_50px_rgba(148,163,184,0.12)] backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="mr-auto min-w-0">
            <h3 className="text-[18px] font-black tracking-[-0.04em] text-slate-950">管理中的智能体</h3>
            <p className="mt-0.5 text-[11px] font-medium text-slate-400">创建、筛选并继续处理你负责的智能体。</p>
          </div>
          <div className={metricCardClassName}>
            <span className="text-[11px] font-medium text-slate-400">全部</span>
            <p className="text-[14px] font-black tracking-[-0.03em] text-slate-950">{agents.length}</p>
          </div>
          <div className={metricCardClassName}>
            <span className="text-[11px] font-medium text-slate-400">已发布</span>
            <p className="text-[14px] font-black tracking-[-0.03em] text-slate-950">{publishedCount}</p>
          </div>
          <div className={metricCardClassName}>
            <span className="text-[11px] font-medium text-slate-400">草稿</span>
            <p className="text-[14px] font-black tracking-[-0.03em] text-slate-950">{draftCount}</p>
          </div>
          <button
            type="button"
            onClick={onOpenCreate}
            className="rounded-full bg-slate-900 px-4 py-2 text-[12px] font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.14)]"
          >
            新建智能体
          </button>
        </div>
      </WorkspaceShellCard>

      <WorkspaceShellCard className="border border-white/70 bg-white/82 px-4 py-4 shadow-[0_20px_48px_rgba(148,163,184,0.1)] backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索名称、部门或说明"
            className="min-w-[220px] flex-1 rounded-full border border-white/80 bg-white/90 px-4 py-2 text-[13px] font-medium text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]"
          />
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as Props['statusFilter'])}
            className="rounded-full border border-white/80 bg-white/90 px-3.5 py-2 text-[12px] font-medium text-slate-700 outline-none"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
          <select
            value={departmentFilter}
            onChange={(event) => onDepartmentFilterChange(event.target.value)}
            className="rounded-full border border-white/80 bg-white/90 px-3.5 py-2 text-[12px] font-medium text-slate-700 outline-none"
          >
            <option value="">全部部门</option>
            {departments.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
          <div className="text-[11px] font-medium text-slate-400">{agents.length} 个结果</div>
        </div>

        {selectedAgent ? (
          <div className={`${glassPanelClassName} mt-3 flex flex-wrap items-center gap-2.5 px-3 py-2.5`}>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black tracking-[0.08em] text-slate-500">
              已选智能体
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <AgentAvatar
                name={selectedAgent.name}
                iconUrl={selectedAgent.iconUrl}
                avatarPreset={selectedAgent.avatarPreset}
                className="h-9 w-9 rounded-[13px] text-sm shadow-[0_8px_20px_rgba(148,163,184,0.16)]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[13px] font-black text-slate-900">{selectedAgent.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${selectedAgent.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {selectedAgent.status === 'published' ? '已发布' : '待处理'}
                  </span>
                  {selectedAgent.department ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                      {selectedAgent.department}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                  {selectedAgent.currentVersionNo ? `V${selectedAgent.currentVersionNo}` : '未发布'} · {selectedAgent.description || '暂无说明'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenDetail(selectedAgent.id)}
              className="shrink-0 rounded-full bg-slate-900 px-3.5 py-2 text-[11px] font-black text-white"
            >
              进入编辑
            </button>
          </div>
        ) : null}

        <div className="mt-3 rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.74))]">
          <div className="flex items-center justify-between border-b border-slate-100/90 px-4 py-2.5">
            <p className="text-[12px] font-black text-slate-700">智能体列表</p>
          </div>

          <div className="overflow-y-auto px-4 py-4">
            {agents.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/60 px-4 py-12 text-center text-sm font-medium text-slate-500">
                当前没有符合条件的智能体。
              </div>
            ) : (
              <div className="grid auto-rows-max gap-3 md:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => {
                  const active = agent.id === (selectedAgent?.id || '');
                  const isPublished = agent.status === 'published';
                  return (
                    <div
                      key={agent.id}
                      className={`flex h-full min-h-[156px] w-full flex-col items-start gap-2.5 rounded-[20px] border px-3.5 py-3.5 text-left transition ${
                        active
                          ? 'border-cyan-200 bg-[linear-gradient(135deg,rgba(236,254,255,0.92),rgba(255,255,255,0.84))] shadow-[0_16px_36px_rgba(14,165,233,0.12)]'
                          : 'border-white/80 bg-white/82 hover:border-slate-200 hover:bg-white/92'
                      }`}
                    >
                      <button type="button" onClick={() => onSelectAgent(agent.id)} className="flex w-full items-start gap-3 text-left">
                        <AgentAvatar
                          name={agent.name}
                          iconUrl={agent.iconUrl}
                          avatarPreset={agent.avatarPreset}
                          className="h-11 w-11 rounded-[16px] text-sm shadow-[0_8px_20px_rgba(148,163,184,0.16)]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13px] font-black text-slate-900">{agent.name}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isPublished ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                              {isPublished ? '已发布' : '待处理'}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-5 text-slate-500">{agent.description || '暂无说明'}</p>
                        </div>
                      </button>

                      <div className="flex w-full flex-wrap items-center gap-2">
                        {agent.department ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black tracking-[0.08em] text-slate-500">
                            {agent.department}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black tracking-[0.08em] text-slate-500">
                          {agent.currentVersionNo ? `V${agent.currentVersionNo}` : '未发布'}
                        </span>
                      </div>

                      <div className="mt-auto flex w-full items-center justify-between gap-3 border-t border-slate-100/90 pt-2.5">
                        <p className="text-[10px] font-medium text-slate-400">
                          {new Date(agent.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                        </p>
                        <button
                          type="button"
                          onClick={() => onOpenDetail(agent.id)}
                          className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-black text-slate-700"
                        >
                          继续处理
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </WorkspaceShellCard>
    </div>
  );
};

export default AgentListView;
