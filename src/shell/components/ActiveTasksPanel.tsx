import React from 'react';
import { X, Loader2, CheckCircle2, AlertCircle, Clock, ArrowRight } from 'lucide-react';

export interface Task {
  id: string;
  projectId: string;
  module: string;
  type: 'image' | 'video' | 'plan' | 'batch';
  status: 'pending' | 'generating' | 'completed' | 'error';
  title: string;
  progress?: number;
  createdAt: string;
  total?: number;
  completed?: number;
  prompt?: string;
}

interface Props {
  tasks: Task[];
  onCancel?: (taskId: string) => void;
  onViewTask?: (taskId: string) => void;
  showGenerationProgress?: boolean;
}

const statusConfig: Record<Task['status'], { icon: React.ReactNode; color: string; label: string; bg: string }> = {
  pending:    { icon: <Clock size={12} />,                           color: 'var(--text-tertiary)', label: '排队中', bg: 'var(--bg-elevated)' },
  generating: { icon: <Loader2 size={12} className="animate-spin" />, color: 'var(--accent)',       label: '生成中', bg: 'var(--accent-soft)' },
  completed:  { icon: <CheckCircle2 size={12} />,                    color: 'var(--success)',       label: '已完成', bg: 'rgba(34,197,94,0.08)' },
  error:      { icon: <AlertCircle size={12} />,                     color: 'var(--error)',         label: '失败',   bg: 'rgba(239,68,68,0.06)' },
};

const moduleNames: Record<string, string> = {
  one_click: '一键主详', translation: '出海翻译', retouch: '产品精修',
  buyer_show: '买家秀', video: '短视频', xhs_cover: '小红书', agent_center: '智能体',
};

const ActiveTasksPanel: React.FC<Props> = ({ tasks, onCancel, onViewTask, showGenerationProgress = true }) => {
  const activeTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'generating');
  const recentTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'error').slice(0, 3);

  if (activeTasks.length === 0 && recentTasks.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-primary)' }}>任务队列</span>
        {activeTasks.length > 0 && (
          <span className="flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {activeTasks.length}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {activeTasks.map((task) => {
          const cfg = statusConfig[task.status];
          const displayLabel = task.type === 'plan'
            ? task.status === 'pending'
              ? '等待提交'
              : task.status === 'generating'
                ? '策划中'
                : cfg.label
            : cfg.label;
          return (
            <div
              key={task.id}
              className="flex items-center gap-3 rounded-[18px] px-3 py-2.5"
              style={{ background: 'var(--bg-elevated)' }}
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-xl shrink-0" style={{ background: cfg.bg }}>
                <span style={{ color: cfg.color }}>{cfg.icon}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
                  <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>{moduleNames[task.module] || task.module}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {showGenerationProgress && task.progress !== undefined && (
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)', maxWidth: 120 }}>
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${task.progress}%`, background: 'var(--accent)' }} />
                    </div>
                  )}
                  {task.total !== undefined && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {task.completed || 0}/{task.total}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: cfg.color }}>{displayLabel}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {onViewTask && (
                  <button onClick={() => onViewTask(task.id)} className="flex items-center justify-center w-7 h-7 rounded-xl transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                    <ArrowRight size={12} />
                  </button>
                )}
                {onCancel && (
                  <button onClick={() => onCancel(task.id)} className="flex items-center justify-center w-7 h-7 rounded-xl transition-colors" style={{ color: 'var(--text-tertiary)' }}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {recentTasks.map((task) => {
          const cfg = statusConfig[task.status];
          return (
            <button
              key={task.id}
              onClick={() => onViewTask?.(task.id)}
              className="flex w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span style={{ color: cfg.color }}>{cfg.icon}</span>
              <p className="text-[11px] truncate flex-1">{task.title}</p>
              <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>{cfg.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ActiveTasksPanel;
