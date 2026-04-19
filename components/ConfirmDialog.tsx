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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/24 px-6">
      <div className="w-full max-w-md rounded-[30px] border border-white/70 bg-white/92 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-black text-slate-900">{title}</h3>
            <p className="mt-3 text-sm font-medium leading-7 text-slate-600">{message}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200/80 bg-white/90 text-slate-400 transition hover:text-slate-700"
            aria-label="关闭确认弹窗"
          >
            <i className="fas fa-xmark text-sm" />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-2.5 text-sm font-black text-slate-600"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={tone === 'danger'
              ? 'rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-black text-white'
              : 'rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
