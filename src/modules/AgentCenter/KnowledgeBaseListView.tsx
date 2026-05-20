import React from 'react';
import { KnowledgeBaseSummary } from '../../types';
import { LegacyFaIcon, PopoverSelect, WorkspaceShellCard } from '../../components/ui/workspacePrimitives';

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
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5';

const panelClassName =
  'rounded-[20px]';

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
      <WorkspaceShellCard className="overflow-hidden border-0 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="mr-auto min-w-0">
            <h3 className="text-[18px] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>管理中的知识库</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>先维护知识，再回到智能体里按需绑定。</p>
          </div>
          <div className={metricCardClassName} style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>知识库</span>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{knowledgeBases.length}</p>
          </div>
          <div className={metricCardClassName} style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>文档</span>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{totalDocuments}</p>
          </div>
          <div className={metricCardClassName} style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>绑定中</span>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>{totalBindings}</p>
          </div>
          <button
            type="button"
            onClick={onOpenCreate}
            className="rounded-full px-4 py-2 text-[12px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}
          >
            新建知识库
          </button>
        </div>
      </WorkspaceShellCard>

      <WorkspaceShellCard className="border-0 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索知识库名称或说明"
            className="min-w-[220px] flex-1 rounded-full border-0 px-4 py-2 text-[13px] outline-none"
            style={{ background: 'var(--bg-input)', color: 'var(--text-primary)' }}
          />
          <PopoverSelect
            value={departmentFilter}
            onChange={onDepartmentFilterChange}
            options={[{ value: '', label: '全部部门' }, ...departments.map((department) => ({ value: department, label: department }))]}
            buttonClassName="rounded-full border-0 px-3.5 py-2 text-[12px]"
          />
          <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{knowledgeBases.length} 个结果</div>
        </div>

        {selectedKnowledgeBase ? (
          <div className={`${panelClassName} mt-3 flex flex-wrap items-center gap-2.5 px-3 py-2.5`}>
            <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
              已选知识库
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[14px] text-sm text-white" style={{ background: 'var(--accent)' }}>
                <LegacyFaIcon icon="fa-book-open" className="text-sm" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedKnowledgeBase.name}</p>
                  {selectedKnowledgeBase.department ? (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      {selectedKnowledgeBase.department}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  文档 {selectedKnowledgeBase.documentCount} 个 · 绑定 {selectedKnowledgeBase.boundAgentCount} 次
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenDetail(selectedKnowledgeBase.id)}
              className="shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              进入编辑
            </button>
          </div>
        ) : null}

        <div className="mt-3 rounded-[22px]" style={{ background: 'var(--bg-base)' }}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>知识库列表</p>
          </div>

          <div className="overflow-y-auto px-4 py-4">
            {knowledgeBases.length === 0 ? (
              <div className="rounded-[22px] px-4 py-12 text-center text-sm" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                当前没有符合条件的知识库。
              </div>
            ) : (
              <div className="grid auto-rows-max gap-3 md:grid-cols-2 xl:grid-cols-3">
                {knowledgeBases.map((item) => {
                  const active = item.id === selectedKnowledgeBase?.id;
                  return (
                  <div
                    key={item.id}
                    className="flex min-h-[156px] w-full flex-col items-start gap-2.5 rounded-[20px] px-3.5 py-3.5 text-left transition"
                    style={active
                      ? { background: 'var(--accent-soft)', boxShadow: 'none' }
                      : { background: 'var(--bg-surface)' }}
                  >
                    <button type="button" onClick={() => onSelectKnowledgeBase(item.id)} className="flex w-full items-start gap-3 text-left">
                      <div className="flex h-11 w-11 items-center justify-center rounded-[16px] text-sm text-white" style={{ background: 'var(--accent)' }}>
                        <LegacyFaIcon icon="fa-book-open" className="text-sm" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                          {item.department ? (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                              {item.department}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>{item.description || '暂无说明'}</p>
                      </div>
                    </button>

                    <div className="flex w-full flex-wrap items-center gap-2">
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                        文档 {item.documentCount}
                      </span>
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                        绑定 {item.boundAgentCount}
                      </span>
                    </div>

                    <div className="mt-auto flex w-full items-center justify-end pt-2.5">
                      <button
                        type="button"
                        onClick={() => onOpenDetail(item.id)}
                        className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
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
