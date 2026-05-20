import React from 'react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'danger',
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/24 px-5 py-6 backdrop-blur-[10px]">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[28px] border border-white/70 bg-white/96 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-start gap-4 border-b border-slate-200/70 px-6 pb-5 pt-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <i className="fas fa-triangle-exclamation text-base" />
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <h3 className="text-[16px] font-semibold leading-6 text-slate-900">{title}</h3>
            <p className="mt-2 max-w-[30ch] text-[14px] leading-7 text-slate-600">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭确认弹窗"
          >
            <i className="fas fa-xmark text-sm" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-5 px-6 pb-6">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 min-w-[88px] rounded-2xl border border-slate-200/80 bg-white/90 px-4 text-[13px] font-medium text-slate-600"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={tone === 'danger'
              ? 'min-h-11 min-w-[88px] rounded-2xl bg-rose-500 px-5 text-[13px] font-semibold text-white'
              : 'min-h-11 min-w-[88px] rounded-2xl bg-slate-900 px-5 text-[13px] font-semibold text-white'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
