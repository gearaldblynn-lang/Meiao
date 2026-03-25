
import React from 'react';
import { AppModule, AuthUser } from '../../types';

interface Props {
  activeModule: AppModule;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onLogout?: () => void;
}

const Header: React.FC<Props> = ({ activeModule, currentUser = null, internalMode = false, onLogout }) => {
  const titles: Record<string, string> = {
    [AppModule.ONE_CLICK]: '一键主详 · 全链路视觉生成',
    [AppModule.TRANSLATION]: '出海翻译 · 多语言视觉本地化',
    [AppModule.BUYER_SHOW]: '买家秀 · 真人质感模拟',
    [AppModule.RETOUCH]: '产品精修 · 商业级画质提升',
    [AppModule.PHOTOGRAPHY]: '产品摄影图 · AI场景构筑',
    [AppModule.VIDEO]: '短视频分镜 · 脚本到画面工作流',
    [AppModule.SETTINGS]: '系统设置 · API 管理',
    [AppModule.ACCOUNT]: '账号管理 · 内部用户工作台',
  };

  return (
    <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-8 shrink-0 z-40">
      <div className="flex items-center gap-3">
        <div className="w-2 h-6 bg-indigo-600 rounded-full"></div>
        <h1 className="text-base font-black text-slate-800">{titles[activeModule] || '梅奥AI'}</h1>
      </div>
      <div className="flex items-center gap-6">
        {internalMode ? (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-100">
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
            <span className="text-[11px] font-bold text-amber-700 tracking-tight">
              {currentUser?.displayName || currentUser?.username || '内部用户'} · {currentUser?.role === 'admin' ? '管理员' : '员工'}
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-100">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight">引擎状态: Kie.ai Nano Pro OK</span>
        </div>
        {internalMode && onLogout ? (
          <button
            onClick={onLogout}
            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-black text-slate-700 transition-colors"
          >
            退出登录
          </button>
        ) : null}
        <div className="flex items-center gap-3 text-slate-400">
          <button className="hover:text-indigo-600" title="使用帮助"><i className="fas fa-question-circle"></i></button>
          <button className="hover:text-indigo-600" title="通知中心"><i className="fas fa-bell"></i></button>
        </div>
      </div>
    </header>
  );
};

export default Header;
