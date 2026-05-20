import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<Props> = ({
  open, title, message, confirmText = '删除', cancelText = '取消', onConfirm, onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center px-5 py-6"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(10px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[28px]"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b px-6 pb-5 pt-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(239,68,68,0.1)' }}>
            <AlertTriangle size={18} strokeWidth={2.1} style={{ color: 'var(--error)' }} />
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <h3 className="text-[16px] font-semibold leading-6" style={{ color: 'var(--text-primary)' }}>{title}</h3>
            <p className="mt-2 max-w-[30ch] text-[14px] leading-7" style={{ color: 'var(--text-secondary)' }}>{message}</p>
          </div>
          <button
            onClick={onCancel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-5 px-6 pb-6">
          <button
            onClick={onCancel}
            className="min-h-11 min-w-[88px] rounded-2xl px-4 text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="min-h-11 min-w-[88px] rounded-2xl px-5 text-[13px] font-semibold text-white transition-colors"
            style={{ background: 'var(--error)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#DC2626'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--error)'; }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
