
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  timestamp: number;
  module?: string;
  status?: string;
  persistInCenter?: boolean;
  read?: boolean;
}

interface ToastContextType {
  addToast: (
    message: string,
    type?: ToastType,
    options?: Partial<Pick<ToastItem, 'title' | 'module' | 'status' | 'persistInCenter'>>
  ) => void;
  notifications: ToastItem[];
  unreadCount: number;
  isCenterOpen: boolean;
  openCenter: () => void;
  closeCenter: () => void;
  toggleCenter: () => void;
  clearNotifications: () => void;
  removeNotification: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<ToastItem[]>([]);
  const [isCenterOpen, setIsCenterOpen] = useState(false);

  const addToast = useCallback((
    message: string,
    type: ToastType = 'info',
    options?: Partial<Pick<ToastItem, 'title' | 'module' | 'status' | 'persistInCenter'>>
  ) => {
    const id = Math.random().toString(36).substr(2, 9);
    const toast: ToastItem = {
      id,
      type,
      title: options?.title || (
        type === 'error' ? '运行异常' :
        type === 'success' ? '操作完成' :
        type === 'warning' ? '注意' :
        '系统通知'
      ),
      message,
      timestamp: Date.now(),
      module: options?.module,
      status: options?.status,
      persistInCenter: options?.persistInCenter ?? true,
      read: false,
    };

    setToasts((prev) => [...prev, toast]);
    if (toast.persistInCenter) {
      setNotifications((prev) => [toast, ...prev].slice(0, 40));
    }
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const openCenter = useCallback(() => {
    setIsCenterOpen(true);
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
  }, []);

  const closeCenter = useCallback(() => {
    setIsCenterOpen(false);
  }, []);

  const toggleCenter = useCallback(() => {
    setIsCenterOpen((prev) => {
      const next = !prev;
      if (next) {
        setNotifications((items) => items.map((item) => ({ ...item, read: true })));
      }
      return next;
    });
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications]
  );

  return (
    <ToastContext.Provider
      value={{
        addToast,
        notifications,
        unreadCount,
        isCenterOpen,
        openCenter,
        closeCenter,
        toggleCenter,
        clearNotifications,
        removeNotification,
      }}
    >
      {children}
      {isCenterOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭通知中心"
            onClick={closeCenter}
            className="fixed inset-0 z-[9997] bg-slate-950/12 backdrop-blur-[1px]"
          />
          <div className="fixed right-6 top-24 z-[9998] w-[360px] rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-sm font-black text-slate-900">通知中心</p>
                <p className="mt-1 text-[11px] text-slate-400">运行进度、异常和清理结果都会留在这里。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearNotifications}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-black text-slate-500 transition-colors hover:bg-slate-200"
                >
                  清空通知
                </button>
                <button
                  type="button"
                  onClick={closeCenter}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
                >
                  <i className="fas fa-times text-xs"></i>
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
              {notifications.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
                  <p className="text-sm font-black text-slate-600">还没有通知</p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-400">开始生成、报错、清理数据之后，这里会自动留下记录。</p>
                </div>
              ) : notifications.map((toast) => (
                <div
                  key={toast.id}
                  className={`rounded-2xl border px-4 py-4 ${
                    toast.type === 'error' ? 'border-rose-100 bg-rose-50/70' :
                    toast.type === 'success' ? 'border-emerald-100 bg-emerald-50/70' :
                    toast.type === 'warning' ? 'border-amber-100 bg-amber-50/70' :
                    'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
                      toast.type === 'error' ? 'bg-rose-100 text-rose-500' :
                      toast.type === 'success' ? 'bg-emerald-100 text-emerald-500' :
                      toast.type === 'warning' ? 'bg-amber-100 text-amber-500' :
                      'bg-indigo-100 text-indigo-500'
                    }`}>
                      <i className={`fas ${
                        toast.type === 'error' ? 'fa-circle-exclamation' :
                        toast.type === 'success' ? 'fa-circle-check' :
                        toast.type === 'warning' ? 'fa-triangle-exclamation' :
                        'fa-circle-info'
                      }`}></i>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-black text-slate-900">{toast.title}</p>
                        <button
                          type="button"
                          onClick={() => removeNotification(toast.id)}
                          className="text-slate-300 transition-colors hover:text-slate-500"
                        >
                          <i className="fas fa-times text-xs"></i>
                        </button>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-slate-600">{toast.message}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                        <span>{new Date(toast.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                        {toast.module ? <span>{toast.module}</span> : null}
                        {toast.status ? <span>{toast.status}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <div className="fixed right-6 top-24 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto min-w-[320px] max-w-md rounded-2xl border bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.16)] flex items-start gap-4 animate-in slide-in-from-right-10 fade-in duration-300 ${
              toast.type === 'error' ? 'border-rose-100 ring-1 ring-rose-50' :
              toast.type === 'success' ? 'border-emerald-100 ring-1 ring-emerald-50' :
              toast.type === 'warning' ? 'border-amber-100 ring-1 ring-amber-50' :
              'border-slate-100 ring-1 ring-slate-50'
            }`}
          >
            <div className={`mt-0.5 text-xl bg-opacity-10 rounded-full p-1 ${
               toast.type === 'error' ? 'text-rose-500' :
               toast.type === 'success' ? 'text-emerald-500' :
               toast.type === 'warning' ? 'text-amber-500' :
               'text-indigo-500'
            }`}>
              <i className={`fas ${
                toast.type === 'error' ? 'fa-times-circle' :
                toast.type === 'success' ? 'fa-check-circle' :
                toast.type === 'warning' ? 'fa-exclamation-triangle' :
                'fa-info-circle'
              }`}></i>
            </div>
            <div className="flex-1 py-0.5">
              <h4 className={`mb-1 text-[10px] font-black uppercase tracking-widest ${
                 toast.type === 'error' ? 'text-rose-500' :
                 toast.type === 'success' ? 'text-emerald-500' :
                 toast.type === 'warning' ? 'text-amber-500' :
                 'text-slate-400'
              }`}>
                {toast.title}
              </h4>
              <p className="text-xs font-bold text-slate-700 leading-relaxed whitespace-pre-wrap">{toast.message}</p>
            </div>
            <button onClick={() => removeToast(toast.id)} className="text-slate-300 hover:text-slate-500 transition-colors mt-1"><i className="fas fa-times"></i></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
