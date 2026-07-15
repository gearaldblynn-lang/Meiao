import React from 'react';
import { CheckCircle2, Settings2, X } from 'lucide-react';

type Props = {
  open: boolean;
  fileName?: string;
  onUseDefault: () => void;
  onAdjust: () => void;
};

const SubtitleRegionReminderDialog: React.FC<Props> = ({
  open,
  fileName = '',
  onUseDefault,
  onAdjust,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[410] flex items-center justify-center px-5 py-6"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(10px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="请确认去字幕区域"
      onClick={onUseDefault}
    >
      <div
        className="w-full max-w-[460px] overflow-hidden rounded-[28px] border"
        style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b px-6 pb-5 pt-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <Settings2 size={18} strokeWidth={2.1} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>请确认去字幕区域</h3>
            <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
              系统已默认框选画面底部 30%。提交前建议检查字幕是否完整落在蓝色框内，避免漏删或误删。
            </p>
            {fileName ? <p className="mt-2 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{fileName}</p> : null}
          </div>
          <button type="button" onClick={onUseDefault} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }} aria-label="关闭区域提醒">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-col-reverse gap-2.5 px-6 pb-6 pt-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onUseDefault} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 text-[13px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            <CheckCircle2 size={15} /> 使用默认区域
          </button>
          <button type="button" onClick={onAdjust} className="flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 text-[13px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
            <Settings2 size={15} /> 去调整区域
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubtitleRegionReminderDialog;
