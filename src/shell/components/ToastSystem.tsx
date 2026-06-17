import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { APP_RELEASE_VERSION, CURRENT_RELEASE_NOTES, RELEASE_NOTES_STORAGE_KEY } from '../../config/releaseNotes';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem { id: string; type: ToastType; message: string; }
interface ToastOptions { durationMs?: number; }
interface ToastCtx { addToast: (message: string, type?: ToastType, options?: ToastOptions) => void; }
const Ctx = createContext<ToastCtx>({ addToast: () => {} });
export const useToast = () => useContext(Ctx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const addToast = useCallback((message: string, type: ToastType = 'info', options?: ToastOptions) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((p) => [...p, { id, type, message }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), options?.durationMs ?? 3500);
  }, []);
  const remove = (id: string) => setToasts((p) => p.filter((t) => t.id !== id));
  useEffect(() => {
    try {
      if (localStorage.getItem(RELEASE_NOTES_STORAGE_KEY) === APP_RELEASE_VERSION) return;
      const primaryNote = CURRENT_RELEASE_NOTES[0];
      const primaryItem = primaryNote?.items?.[0] || '智能体对话已修复，还原原生 GPT 式智能对话体验。';
      addToast(`${primaryNote?.title || '本次更新'}：${primaryItem}`, 'info', { durationMs: 9000 });
      localStorage.setItem(RELEASE_NOTES_STORAGE_KEY, APP_RELEASE_VERSION);
    } catch {
      addToast('智能体对话已修复，还原原生 GPT 式智能对话，可连续对话、改图和重新生成。', 'info', { durationMs: 9000 });
    }
  }, [addToast]);
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
            <button onClick={() => remove(t.id)} style={{ color: 'var(--text-tertiary)' }}><X size={13} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
};
