import React from 'react';
import AgentAvatar from './AgentAvatar';
import { AgentSummary } from '../../types';

interface Props {
  chatAgents: AgentSummary[];
  selectedAgentId?: string;
  collapsed?: boolean;
  onSelectAgent: (agentId: string) => void;
  onCreateSession: (agentId: string) => void;
  onToggleCollapsed: () => void;
}

const ChatSessionSidebar: React.FC<Props> = ({
  chatAgents,
  selectedAgentId,
  collapsed = false,
  onSelectAgent,
  onCreateSession,
  onToggleCollapsed,
}) => (
  <aside
    className={`flex h-full flex-col gap-4 rounded-[30px] border border-white/70 bg-white/68 p-4 shadow-[0_25px_55px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all ${
      collapsed ? 'w-[88px]' : 'w-full'
    }`}
  >
    <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-3'}`}>
      {collapsed ? null : (
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">智能体</p>
          <h2 className="mt-1 text-base font-black text-slate-900">工作台</h2>
        </div>
      )}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/72 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
        title={collapsed ? '展开智能体栏' : '收起智能体栏'}
        aria-label={collapsed ? '展开智能体栏' : '收起智能体栏'}
      >
        <i className={`fas ${collapsed ? 'fa-angles-right' : 'fa-angles-left'} text-sm`} />
      </button>
    </div>

    <div className="flex-1 space-y-2 overflow-y-auto pr-1">
      {chatAgents.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200/70 bg-slate-50/80 px-3 py-5 text-center text-xs font-black text-slate-500">
          暂无智能体
        </div>
      ) : (
        chatAgents.map((agent) => {
          const isSelected = agent.id === selectedAgentId;
          return (
            <div
              key={agent.id}
              className={`rounded-[24px] border transition ${
                isSelected
                  ? 'border-cyan-300/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(236,254,255,0.92))] shadow-[0_16px_32px_rgba(14,165,233,0.18)]'
                  : 'border-slate-200/80 bg-white/70 hover:border-slate-300/90'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className={`flex w-full items-center ${collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-3'} text-left`}
                title={collapsed ? agent.name : undefined}
              >
                <AgentAvatar
                  name={agent.name}
                  iconUrl={agent.iconUrl || undefined}
                  avatarPreset={agent.avatarPreset || undefined}
                  className="h-11 w-11 rounded-[18px] text-sm"
                />
                {collapsed ? null : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-900">{agent.name}</p>
                    <p className="truncate text-[11px] text-slate-500">{agent.description || '未填写介绍'}</p>
                  </div>
                )}
              </button>
              {collapsed ? null : (
                <div className="flex items-center justify-between px-3 pb-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.32em] text-slate-400">
                    {agent.status === 'published' ? '已发布' : agent.status === 'archived' ? '已归档' : '草稿'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onCreateSession(agent.id)}
                    className="rounded-full border border-slate-200/90 bg-white/82 px-3 py-1 text-[11px] font-black text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    新建
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  </aside>
);

export default ChatSessionSidebar;
