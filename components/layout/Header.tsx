
import React, { useState } from 'react';
import { AppModule, AuthUser } from '../../types';
import { useToast } from '../ToastSystem';
import { getModuleMeta } from './moduleMeta';
import HelpGuideModal from '../HelpGuideModal';

interface Props {
  activeModule: AppModule;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onLogout?: () => void;
}

const Header: React.FC<Props> = ({ activeModule, currentUser = null, internalMode = false, onLogout }) => {
  const meta = getModuleMeta(activeModule);
  const { unreadCount, toggleCenter } = useToast();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <header className="shrink-0 border-b border-slate-200/80 bg-white/85 px-8 py-4 backdrop-blur-xl z-40">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${meta.accentSoftClass}`}>
              <i className={`fas ${meta.icon} ${meta.accentTextClass}`}></i>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black tracking-tight text-slate-900">
                {meta.title}
                <span className="ml-2 text-slate-400">·</span>
                <span className="ml-2 text-slate-500">{meta.subtitle}</span>
              </h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 lg:flex">
            <span className="text-[10px] font-medium text-slate-400">版本</span>
            <span className="text-xs font-black text-slate-700">v{__APP_VERSION__}</span>
          </div>
          <div className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 lg:flex">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-medium text-slate-500">服务正常</span>
          </div>
          {internalMode ? (
            <div className="hidden items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 lg:flex">
              <div className="h-2 w-2 rounded-full bg-amber-500"></div>
              <span className="text-[11px] font-bold text-amber-800">
                {currentUser?.displayName || currentUser?.username || '内部用户'} · {currentUser?.role === 'admin' ? '管理员' : '员工'}
              </span>
            </div>
          ) : (
            <div className="hidden items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 lg:flex">
              <div className="h-2 w-2 rounded-full bg-slate-500"></div>
              <span className="text-[11px] font-bold text-slate-600">单机本地模式</span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCenter}
            className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-all hover:border-slate-300 hover:text-slate-900"
            title="通知中心"
          >
            <i className="fas fa-bell text-sm"></i>
            {unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(true)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-all hover:border-slate-300 hover:text-slate-900"
            title="使用帮助"
          >
            <i className="fas fa-question-circle text-sm"></i>
          </button>
          {internalMode && onLogout ? (
            <button
              onClick={onLogout}
              className="rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black text-white transition-colors hover:bg-slate-800"
            >
              退出登录
            </button>
          ) : null}
        </div>
      </div>
      {showHelp && <HelpGuideModal onClose={() => setShowHelp(false)} />}
    </header>
  );
};

export default Header;
