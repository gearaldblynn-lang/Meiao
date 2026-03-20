
import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  addToast: (message: string, type?: ToastType) => void;
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
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto min-w-[320px] max-w-md p-4 rounded-2xl shadow-2xl border flex items-start gap-4 animate-in slide-in-from-right-10 fade-in duration-300 bg-white ${
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
              <h4 className={`text-[10px] font-black uppercase tracking-widest mb-1 ${
                 toast.type === 'error' ? 'text-rose-500' :
                 toast.type === 'success' ? 'text-emerald-500' :
                 toast.type === 'warning' ? 'text-amber-500' :
                 'text-slate-400'
              }`}>
                {toast.type === 'error' ? 'System Error' : toast.type === 'success' ? 'Operation Success' : toast.type === 'warning' ? 'Attention' : 'Notification'}
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
