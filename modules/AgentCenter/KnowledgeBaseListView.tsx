import React from 'react';
import { KnowledgeBaseSummary } from '../../types';
import { WorkspaceShellCard } from '../../components/ui/workspacePrimitives';

interface Props {
  knowledgeBases: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId: string;
  search: string;
  departmentFilter: string;
  onSearchChange: (value: string) => void;
  onDepartmentFilterChange: (value: string) => void;
  onSelectKnowledgeBase: (knowledgeBaseId: string) => void;
  onOpenCreate: () => void;
  onOpenDetail: (knowledgeBaseId: string) => void;
}

const metricCardClassName =
  'inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 shadow-[0_8px_18px_rgba(148,163,184,0.08)]';

const panelClassName =
  'rounded-[20px] border border-white/75 bg-white/84 shadow-[0_18px_40px_rgba(148,163,184,0.1)] backdrop-blur-xl';

const KnowledgeBaseListView: React.FC<Props> = ({
  knowledgeBases,
  selectedKnowledgeBaseId,
  search,
  departmentFilter,
  onSearchChange,
  onDepartmentFilterChange,
  onSelectKnowledgeBase,
  onOpenCreate,
  onOpenDetail,
}) => {
  const departments = Array.from(new Set(knowledgeBases.map((item) => item.department).filter(Boolean)));
  const selectedKnowledgeBase = knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId) || knowledgeBases[0] || null;
  const totalDocuments = knowledgeBases.reduce((sum, item) => sum + Number(item.documentCount || 0), 0);
  const totalBindings = knowledgeBases.reduce((sum, item) => sum + Number(item.boundAgentCount || 0), 0);

  return (
    <div className="space-y-3 pb-6">
      <WorkspaceShellCard className="overflow-hidden border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.8))] px-4 py-3.5 shadow-[0_20px_50px_rgba(148,163,184,0.12)] backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="mr-auto min-w-0">
            <h3 className="text-[18px] font-black tracking-[-0.04em] text-slate-950">管理中的知识库</h3>
            <p className="mt-0.5 text-[11px] font-medium text-slate-400">先维护知识，再回到智能体里按需绑定。</p>
          </div>
          <div className={metricCardClassName}>
            <span className="text-[11px] font-medium text-slate-400">知识库</span>
            <p className="text-[14px] font-black tracking-[-0.03em] text-slate-950">{knowledgeBases.length}</p>
          </div>
          <div className={metricCardClassName}>
            <span className="text-[11px] font-medium text-slate-400">文档</span>
            <p className="text-[14px] font-black tracking-[-0.03em] text-slate-950">{totalDocuments}</p>
          </div>
          <div className={metricCardClassName}>
            <span className="text-[11px] font-medium text-slate-400">绑定中</span>
            <p className="text-[14px] font-black tracking-[-0.03em] text-slate-950">{totalBindings}</p>
          </div>
          <button
            type="button"
            onClick={onOpenCreate}
            className="rounded-full bg-slate-900 px-4 py-2 text-[12px] font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.14)]"
          >
            新建知识库
          </button>
        </div>
      </WorkspaceShellCard>

      <WorkspaceShellCard className="border border-white/70 bg-white/82 px-4 py-4 shadow-[0_20px_48px_rgba(148,163,184,0.1)] backdrop-blur-2xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索知识库名称或说明"
            className="min-w-[220px] flex-1 rounded-full border border-white/80 bg-white/90 px-4 py-2 text-[13px] font-medium text-slate-700 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.86)]"
          />
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
          <div className="text-[11px] font-medium text-slate-400">{knowledgeBases.length} 个结果</div>
        </div>

        {selectedKnowledgeBase ? (
          <div className={`${panelClassName} mt-3 flex flex-wrap items-center gap-2.5 px-3 py-2.5`}>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black tracking-[0.08em] text-slate-500">
              已选知识库
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-slate-900 text-sm text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)]">
                <i className="fas fa-book-open" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[13px] font-black text-slate-900">{selectedKnowledgeBase.name}</p>
                  {selectedKnowledgeBase.department ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                      {selectedKnowledgeBase.department}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
                  文档 {selectedKnowledgeBase.documentCount} 个 · 绑定 {selectedKnowledgeBase.boundAgentCount} 次
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenDetail(selectedKnowledgeBase.id)}
              className="shrink-0 rounded-full bg-slate-900 px-3.5 py-2 text-[11px] font-black text-white"
            >
              进入编辑
            </button>
          </div>
        ) : null}

        <div className="mt-3 rounded-[22px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.74))]">
          <div className="flex items-center justify-between border-b border-slate-100/90 px-4 py-2.5">
            <p className="text-[12px] font-black text-slate-700">知识库列表</p>
          </div>

          <div className="overflow-y-auto px-4 py-4">
            {knowledgeBases.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/60 px-4 py-12 text-center text-sm font-medium text-slate-500">
                当前没有符合条件的知识库。
              </div>
            ) : (
              <div className="grid auto-rows-max gap-3 md:grid-cols-2 xl:grid-cols-3">
                {knowledgeBases.map((item) => {
                  const active = item.id === selectedKnowledgeBase?.id;
                  return (
                  <div
                    key={item.id}
                    className={`flex min-h-[156px] w-full flex-col items-start gap-2.5 rounded-[20px] border px-3.5 py-3.5 text-left transition ${
                      active
                        ? 'border-cyan-200 bg-[linear-gradient(135deg,rgba(236,254,255,0.92),rgba(255,255,255,0.84))] shadow-[0_16px_36px_rgba(14,165,233,0.12)]'
                        : 'border-white/80 bg-white/84 hover:border-slate-200 hover:bg-white/92'
                    }`}
                  >
                    <button type="button" onClick={() => onSelectKnowledgeBase(item.id)} className="flex w-full items-start gap-3 text-left">
                      <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-slate-900 text-sm text-white shadow-[0_10px_22px_rgba(15,23,42,0.14)]">
                        <i className="fas fa-book-open" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-black text-slate-900">{item.name}</p>
                          {item.department ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                              {item.department}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-5 text-slate-500">{item.description || '暂无说明'}</p>
                      </div>
                    </button>

                    <div className="flex w-full flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black tracking-[0.08em] text-slate-500">
                        文档 {item.documentCount}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black tracking-[0.08em] text-slate-500">
                        绑定 {item.boundAgentCount}
                      </span>
                    </div>

                    <div className="mt-auto flex w-full items-center justify-end border-t border-slate-100/90 pt-2.5">
                      <button
                        type="button"
                        onClick={() => onOpenDetail(item.id)}
                        className="rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-black text-slate-700"
                      >
                        进入编辑
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      </WorkspaceShellCard>
    </div>
  );
};

export default KnowledgeBaseListView;
