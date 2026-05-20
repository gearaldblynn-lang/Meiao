import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem { id: string; type: ToastType; message: string; }
interface ToastCtx { addToast: (message: string, type?: ToastType, options?: unknown) => void; }
const Ctx = createContext<ToastCtx>({ addToast: () => {} });
export const useToast = () => useContext(Ctx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const addToast = useCallback((message: string, type: ToastType = 'info', _options?: unknown) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((p) => [...p, { id, type, message }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);
  const remove = (id: string) => setToasts((p) => p.filter((t) => t.id !== id));
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
