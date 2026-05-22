import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, CheckSquare2, ChevronDown, SlidersHorizontal, Square, Trash2, X } from 'lucide-react';
import ActiveTasksPanel from './ActiveTasksPanel';
import ConfirmDialog from './ConfirmDialog';
import ProjectCard from './ProjectCard';
import SubFeatureTabs from './SubFeatureTabs';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { buildTaskFallbackProjects } from '../../adapters/shellScopeFilters';
import type { Project, SubFeatureOption, Task } from '../../ShellMigratedApp';
import type { VideoStoryboardProject } from '../../types';

interface Props {
  projects: Project[];
  tasks: Task[];
  title: string;
  description: string;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptySubtitle: string;
  onDeleteResult: (projectId: string, resultId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDeletePlan?: (projectId: string, planId: string) => void;
  onRegenerateResult?: (projectId: string, resultId: string, instruction?: string) => void;
  onConfirmStoryboardImaging?: (projectId: string) => void;
  onFissionResult?: (projectId: string, resultId: string, mode: 'scene' | 'palette' | 'custom', instruction: string) => void;
  onEditResult?: (projectId: string, resultId: string, instruction: string, files: File[]) => void;
  onRecoverResult?: (projectId: string, resultId: string) => void;
  onConfirmPlan?: (projectId: string, plan: any) => void;
  onUpdatePlans?: (projectId: string, plans: any[]) => void;
  onRegeneratePlans?: (projectId: string) => void;
  onCancelTask?: (taskId: string) => void;
  onImportStoryboardToGeneration?: (project: VideoStoryboardProject, boardId?: string, boardIndex?: number) => void;
  subFeatures?: SubFeatureOption[];
  activeSubFeature?: string;
  onSubFeatureChange?: (id: string) => void;
  beforeProjects?: React.ReactNode;
  pendingActionKeys?: Record<string, boolean>;
  showGenerationProgress?: boolean;
}

const ProjectListView: React.FC<Props> = ({
  projects, tasks, title, description, emptyIcon, emptyTitle, emptySubtitle,
  onDeleteResult, onDeleteProject, onDeletePlan, onRegenerateResult, onFissionResult, onEditResult, onRecoverResult, onCancelTask,
  onConfirmPlan, onUpdatePlans, onRegeneratePlans, onConfirmStoryboardImaging, onImportStoryboardToGeneration,
  subFeatures, activeSubFeature, onSubFeatureChange,
  beforeProjects,
  pendingActionKeys,
  showGenerationProgress = true,
}) => {
  const INITIAL_PROJECT_RENDER_LIMIT = 8;
  const PROJECT_RENDER_BATCH_SIZE = 8;
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Project['status']>('all');
  const [visibleProjectCount, setVisibleProjectCount] = useState(INITIAL_PROJECT_RENDER_LIMIT);
  const [batchSelectMode, setBatchSelectMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);

  const dateFilterOptions: Array<{ value: typeof dateFilter; label: string }> = [
    { value: 'all', label: '全部日期' },
    { value: 'today', label: '今天' },
    { value: '7d', label: '近 7 天' },
    { value: '30d', label: '近 30 天' },
  ];

  const statusFilterOptions: Array<{ value: typeof statusFilter; label: string }> = [
    { value: 'all', label: '全部状态' },
    { value: 'generating', label: '生成中' },
    { value: 'completed', label: '已完成' },
    { value: 'error', label: '失败' },
  ];
  const taskFallbackProjects = useMemo(
    () => buildTaskFallbackProjects(projects, tasks) as Project[],
    [projects, tasks],
  );
  const displayProjects = useMemo(
    () => [...taskFallbackProjects, ...projects],
    [taskFallbackProjects, projects],
  );

  const parseProjectDate = (project: Project) => {
    const raw = project.completedAt || project.createdAt;
    const match = /^(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return null;
    const date = new Date();
    date.setMonth(Number(match[1]) - 1, Number(match[2]));
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const filteredProjects = useMemo(() => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    return displayProjects.filter((project) => {
      if (statusFilter !== 'all' && project.status !== statusFilter) return false;
      if (dateFilter === 'all') return true;
      const date = parseProjectDate(project);
      if (!date) return true;
      const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
      if (dateFilter === 'today') return diffDays === 0;
      if (dateFilter === '7d') return diffDays <= 7;
      if (dateFilter === '30d') return diffDays <= 30;
      return true;
    });
  }, [displayProjects, dateFilter, statusFilter]);

  const orderedProjects = useMemo(() => filteredProjects, [filteredProjects]);
  const visibleProjects = useMemo(() => orderedProjects.slice(0, visibleProjectCount), [orderedProjects, visibleProjectCount]);
  const selectableProjectIds = useMemo(() => orderedProjects.map((project) => project.id), [orderedProjects]);
  const allFilteredProjectsSelected = selectableProjectIds.length > 0 && selectableProjectIds.every((id) => selectedProjectIds.has(id));
  const selectedDateLabel = dateFilterOptions.find((option) => option.value === dateFilter)?.label ?? '全部日期';
  const selectedStatusLabel = statusFilterOptions.find((option) => option.value === statusFilter)?.label ?? '全部状态';
  const toolbarButtonStyle = {
    borderColor: 'var(--border-subtle)',
    background: 'var(--bg-base)',
    color: 'var(--text-secondary)',
  } as const;

  useEffect(() => {
    setVisibleProjectCount(INITIAL_PROJECT_RENDER_LIMIT);
  }, [dateFilter, statusFilter, displayProjects.length]);

  useEffect(() => {
    setSelectedProjectIds((current) => {
      if (current.size === 0) return current;
      const selectable = new Set(selectableProjectIds);
      const next = new Set([...current].filter((projectId) => selectable.has(projectId)));
      return next.size === current.size ? current : next;
    });
  }, [selectableProjectIds]);

  useEffect(() => {
    if (visibleProjectCount >= orderedProjects.length) return;
    type RenderHandle = number | ReturnType<typeof globalThis.setTimeout>;
    const win = window as Window & typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const schedule = (callback: () => void) => {
      if (win.requestIdleCallback) {
        return win.requestIdleCallback(callback, { timeout: 500 });
      }
      return globalThis.setTimeout(callback, 24);
    };
    const cancel = (handle: RenderHandle) => {
      if (typeof handle === 'number' && win.cancelIdleCallback) {
        win.cancelIdleCallback(handle);
        return;
      }
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    };
    const handle = schedule(() => {
      setVisibleProjectCount((current) =>
        Math.min(current + PROJECT_RENDER_BATCH_SIZE, orderedProjects.length)
      );
    });
    return () => cancel(handle);
  }, [visibleProjectCount, orderedProjects.length]);

  const toggleBatchSelectMode = () => {
    setBatchSelectMode((current) => {
      const next = !current;
      if (!next) {
        setSelectedProjectIds(new Set());
        setBatchDeleteConfirmOpen(false);
      }
      return next;
    });
  };

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const toggleSelectAllFilteredProjects = () => {
    setSelectedProjectIds((current) => {
      if (allFilteredProjectsSelected) return new Set();
      const next = new Set(current);
      selectableProjectIds.forEach((projectId) => next.add(projectId));
      return next;
    });
  };

  const handleConfirmBatchDelete = () => {
    selectedProjectIds.forEach((projectId) => onDeleteProject(projectId));
    setSelectedProjectIds(new Set());
    setBatchSelectMode(false);
    setBatchDeleteConfirmOpen(false);
  };

  return (
    <div className="workspace-shell">
      <div className="workspace-content workspace-content-tight">
        <div className="mb-3">
          <div className="flex flex-col gap-2.5 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{title}</h2>
              </div>

              <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
              <button
                type="button"
                onClick={toggleBatchSelectMode}
                disabled={orderedProjects.length === 0}
                className="inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
                style={batchSelectMode
                  ? { borderColor: 'color-mix(in srgb, var(--accent) 26%, var(--border-subtle))', background: 'var(--accent-soft)', color: 'var(--accent)' }
                  : toolbarButtonStyle}
              >
                {batchSelectMode ? <X size={13} /> : <CheckSquare2 size={13} />}
                <span>{batchSelectMode ? '取消批量' : '批量选择'}</span>
              </button>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-medium transition-all"
                    style={dateFilter === 'all'
                      ? toolbarButtonStyle
                      : { borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--border-subtle))', background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <CalendarRange size={13} />
                    <span>{selectedDateLabel}</span>
                    <ChevronDown size={12} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[180px] rounded-[18px] border p-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
                  <div className="space-y-1">
                    {dateFilterOptions.map((option) => {
                      const active = option.value === dateFilter;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDateFilter(option.value)}
                          className="flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-[12px] transition-all"
                          style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
                        >
                          <span>{option.label}</span>
                          {active ? <span className="text-[10px]">当前</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[11px] font-medium transition-all"
                    style={statusFilter === 'all'
                      ? toolbarButtonStyle
                      : { borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--border-subtle))', background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <SlidersHorizontal size={13} />
                    <span>{selectedStatusLabel}</span>
                    <ChevronDown size={12} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[180px] rounded-[18px] border p-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
                  <div className="space-y-1">
                    {statusFilterOptions.map((option) => {
                      const active = option.value === statusFilter;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setStatusFilter(option.value)}
                          className="flex w-full items-center justify-between rounded-[12px] px-3 py-2 text-[12px] transition-all"
                          style={{ background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
                        >
                          <span>{option.label}</span>
                          {active ? <span className="text-[10px]">当前</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              </div>
            </div>

            <div className="flex min-w-0 items-center justify-center">
              <SubFeatureTabs items={subFeatures} activeId={activeSubFeature} onChange={onSubFeatureChange} />
            </div>
          </div>

          {beforeProjects}

          {batchSelectMode ? (
            <div
              className="mt-3 flex flex-col gap-2 rounded-[18px] border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
            >
              <div className="min-w-0 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                已选 <span style={{ color: 'var(--accent)' }}>{selectedProjectIds.size}</span> 个
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAllFilteredProjects}
                  disabled={selectableProjectIds.length === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  style={toolbarButtonStyle}
                >
                  {allFilteredProjectsSelected ? <Square size={13} /> : <CheckSquare2 size={13} />}
                  <span>{allFilteredProjectsSelected ? '清空选择' : '全选当前筛选结果'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBatchDeleteConfirmOpen(true)}
                  disabled={selectedProjectIds.size === 0}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: 'var(--error)' }}
                >
                  <Trash2 size={13} />
                  <span>批量删除</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

      {/* Active tasks */}
      {tasks.length > 0 && (
        <div className="mb-6">
          <ActiveTasksPanel tasks={tasks} onCancel={onCancelTask} showGenerationProgress={showGenerationProgress} />
        </div>
      )}

      {orderedProjects.length > 0 ? (
        <section className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleProjects.map((project) => {
              const selected = selectedProjectIds.has(project.id);
              return (
                <div key={project.id} className="relative">
                  <ProjectCard
                    compact
                    project={project}
                    onDeleteResult={(rid) => onDeleteResult(project.id, rid)}
                    onDeleteProject={onDeleteProject}
                    onDeletePlan={onDeletePlan}
                    onRegenerate={(rid, instruction) => onRegenerateResult?.(project.id, rid, instruction)}
                    onConfirmStoryboardImaging={onConfirmStoryboardImaging}
                    onFission={(rid, mode, instruction) => onFissionResult?.(project.id, rid, mode, instruction)}
                    onEdit={(rid, instruction, files) => onEditResult?.(project.id, rid, instruction, files)}
                    onRecover={(rid) => onRecoverResult?.(project.id, rid)}
                    onConfirmPlan={onConfirmPlan}
                    onUpdatePlans={onUpdatePlans}
                    onRegeneratePlans={onRegeneratePlans}
                    onCancelTask={onCancelTask}
                    onImportStoryboardToGeneration={onImportStoryboardToGeneration}
                    pendingActionKeys={pendingActionKeys}
                    showGenerationProgress={showGenerationProgress}
                  />
                  {batchSelectMode ? (
                    <button
                      type="button"
                      aria-label={`${selected ? '取消选择' : '选择'}${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleProjectSelection(project.id);
                      }}
                      className="absolute inset-0 z-20 rounded-[24px] text-left transition-all"
                      style={{
                        background: selected ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                        boxShadow: selected
                          ? 'inset 0 0 0 2px var(--accent)'
                          : 'inset 0 0 0 1px color-mix(in srgb, var(--border-subtle) 70%, transparent)',
                      }}
                    >
                      <span
                        className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border"
                        style={{
                          borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                          background: selected ? 'var(--accent)' : 'var(--bg-base)',
                          color: selected ? '#fff' : 'var(--text-tertiary)',
                          boxShadow: 'var(--shadow-soft)',
                        }}
                      >
                        {selected ? <CheckSquare2 size={16} /> : <Square size={16} />}
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Empty state */}
      {filteredProjects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-28 text-center">
          <div className="mb-4 flex h-[68px] w-[68px] items-center justify-center">
            <div style={{ color: 'var(--accent)' }}>{emptyIcon}</div>
          </div>
          <p className="text-[15px] font-medium" style={{ color: 'var(--text-secondary)' }}>{displayProjects.length === 0 ? emptyTitle : '没有匹配的项目'}</p>
          <p className="mt-1.5 text-[13px] max-w-sm" style={{ color: 'var(--text-tertiary)' }}>{displayProjects.length === 0 ? emptySubtitle : '调整日期、状态或搜索条件后再查看。'}</p>
        </div>
      )}
      <ConfirmDialog
        open={batchDeleteConfirmOpen}
        title="批量删除项目"
        message={`确定要删除已选的 ${selectedProjectIds.size} 个项目吗？这些项目下的所有图片都会被移除，此操作不可撤销。`}
        confirmText="批量删除"
        onConfirm={handleConfirmBatchDelete}
        onCancel={() => setBatchDeleteConfirmOpen(false)}
      />
      </div>
    </div>
  );
};

export default ProjectListView;
