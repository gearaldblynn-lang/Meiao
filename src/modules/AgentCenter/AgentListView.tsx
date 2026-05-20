import React from 'react';
import { AgentSummary } from '../../types';
import { PopoverSelect, WorkspaceShellCard } from '../../components/ui/workspacePrimitives';
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
  'rounded-[20px]';

const metricCardClassName =
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5';

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
      <WorkspaceShellCard className="flex-none overflow-hidden border-0 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="mr-auto min-w-0">
            <h3 className="text-[18px] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>管理中的智能体</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>创建、筛选并继续处理你负责的智能体。</p>
          </div>
          <div className={metricCardClassName} style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>全部</span>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{agents.length}</p>
          </div>
          <div className={metricCardClassName} style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>已发布</span>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{publishedCount}</p>
          </div>
          <div className={metricCardClassName} style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>草稿</span>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{draftCount}</p>
          </div>
          <button
            type="button"
            onClick={onOpenCreate}
            className="rounded-full px-4 py-2 text-[12px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            新建智能体
          </button>
        </div>
      </WorkspaceShellCard>

      <WorkspaceShellCard className="border-0 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索名称、部门或说明"
            className="min-w-[220px] flex-1 rounded-full border-0 px-4 py-2 text-[13px] outline-none"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
          <PopoverSelect
            value={statusFilter}
            onChange={onStatusFilterChange}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'draft', label: '草稿' },
              { value: 'published', label: '已发布' },
              { value: 'archived', label: '已归档' },
            ]}
            buttonClassName="rounded-full border-0 px-3.5 py-2 text-[12px]"
          />
          <PopoverSelect
            value={departmentFilter}
            onChange={onDepartmentFilterChange}
            options={[{ value: '', label: '全部部门' }, ...departments.map((department) => ({ value: department, label: department }))]}
            buttonClassName="rounded-full border-0 px-3.5 py-2 text-[12px]"
          />
          <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{agents.length} 个结果</div>
        </div>

        {selectedAgent ? (
          <div className={`${glassPanelClassName} mt-3 flex flex-wrap items-center gap-2.5 px-3 py-2.5`}>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
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
                  <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</p>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: selectedAgent.status === 'published' ? 'rgba(16,185,129,0.12)' : 'var(--accent-soft)', color: selectedAgent.status === 'published' ? 'var(--success)' : 'var(--accent)' }}>
                    {selectedAgent.status === 'published' ? '已发布' : '待处理'}
                  </span>
                  {selectedAgent.department ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      {selectedAgent.department}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {selectedAgent.currentVersionNo ? `V${selectedAgent.currentVersionNo}` : '未发布'} · {selectedAgent.description || '暂无说明'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenDetail(selectedAgent.id)}
              className="shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              进入编辑
            </button>
          </div>
        ) : null}

        <div className="mt-3 rounded-[22px]" style={{ background: 'var(--bg-base)' }}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>智能体列表</p>
          </div>

          <div className="overflow-y-auto px-4 py-4">
            {agents.length === 0 ? (
              <div className="rounded-[22px] px-4 py-12 text-center text-sm" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
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
                      className={`flex h-full min-h-[156px] w-full flex-col items-start gap-2.5 rounded-[20px] px-3.5 py-3.5 text-left transition ${
                        active
                          ? ''
                          : ''
                      }`}
                      style={active
                        ? { background: 'var(--accent-soft)', boxShadow: 'none' }
                        : { background: 'var(--bg-surface)' }}
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
                            <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: isPublished ? 'rgba(16,185,129,0.12)' : 'var(--accent-soft)', color: isPublished ? 'var(--success)' : 'var(--accent)' }}>
                              {isPublished ? '已发布' : '待处理'}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>{agent.description || '暂无说明'}</p>
                        </div>
                      </button>

                      <div className="flex w-full flex-wrap items-center gap-2">
                        {agent.department ? (
                          <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                            {agent.department}
                          </span>
                        ) : null}
                        <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                          {agent.currentVersionNo ? `V${agent.currentVersionNo}` : '未发布'}
                        </span>
                      </div>

                      <div className="mt-auto flex w-full items-center justify-between gap-3 pt-2.5">
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          {new Date(agent.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                        </p>
                        <button
                          type="button"
                          onClick={() => onOpenDetail(agent.id)}
                          className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
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
