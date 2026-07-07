import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, Copy, Check } from 'lucide-react';
import { copyTextToClipboard } from '../../utils/clipboard.mjs';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem { id: string; type: ToastType; message: string; }
interface ToastOptions { durationMs?: number; }
interface ToastCtx { addToast: (message: string, type?: ToastType, options?: ToastOptions) => void; }
const Ctx = createContext<ToastCtx>({ addToast: () => {} });
export const useToast = () => useContext(Ctx);

// 同屏上限:批量任务连环失败时不许把整屏糊满,超限丢最旧的
const MAX_VISIBLE_TOASTS = 4;

const ErrorCopyButton: React.FC<{ message: string }> = ({ message }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="复制错误信息"
      onClick={() => {
        void Promise.resolve(copyTextToClipboard(message)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      style={{ color: copied ? 'var(--success)' : 'var(--text-tertiary)' }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const addToast = useCallback((message: string, type: ToastType = 'info', options?: ToastOptions) => {
    const durationMs = options?.durationMs ?? 3500;
    setToasts((p) => {
      // 同文案同类型去重:刷新计时器而不是再堆一条
      const existing = p.find((t) => t.message === message && t.type === type);
      if (existing) {
        clearTimeout(timersRef.current[existing.id]);
        timersRef.current[existing.id] = setTimeout(() => {
          setToasts((q) => q.filter((t) => t.id !== existing.id));
          delete timersRef.current[existing.id];
        }, durationMs);
        return p;
      }
      const id = Math.random().toString(36).slice(2, 9);
      timersRef.current[id] = setTimeout(() => {
        setToasts((q) => q.filter((t) => t.id !== id));
        delete timersRef.current[id];
      }, durationMs);
      const next = [...p, { id, type, message }];
      return next.length > MAX_VISIBLE_TOASTS ? next.slice(next.length - MAX_VISIBLE_TOASTS) : next;
    });
  }, []);
  const remove = (id: string) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts((p) => p.filter((t) => t.id !== id));
  };
  const icons = {
    success: <CheckCircle size={15} style={{ color: 'var(--success)' }} />,
    error: <AlertCircle size={15} style={{ color: 'var(--error)' }} />,
    warning: <AlertTriangle size={15} style={{ color: 'var(--warning)' }} />,
    info: <Info size={15} style={{ color: 'var(--accent)' }} />,
  };
  return (
    <Ctx.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border min-w-[240px] max-w-sm" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)', animation: 'fade-in-up 0.2s ease', boxShadow: 'var(--shadow-elevated)' }}>
            {icons[t.type]}
            <p className="text-[12px] font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{t.message}</p>
            {t.type === 'error' && <ErrorCopyButton message={t.message} />}
            <button onClick={() => remove(t.id)} style={{ color: 'var(--text-tertiary)' }}><X size={13} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
};
