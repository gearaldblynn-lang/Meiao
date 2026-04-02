import React from 'react';
import { AppModule } from '../../types';
import { MODULE_META } from './moduleMeta';

interface Props {
  activeModule: AppModule;
  onModuleChange: (module: AppModule) => void;
}

const SidebarNavigation: React.FC<Props> = ({ activeModule, onModuleChange }) => {
  const businessItems = [
    AppModule.ONE_CLICK,
    AppModule.TRANSLATION,
    AppModule.BUYER_SHOW,
    AppModule.RETOUCH,
    AppModule.PHOTOGRAPHY,
    AppModule.VIDEO,
  ];
  const systemItems = [AppModule.SETTINGS, AppModule.ACCOUNT];

  const renderNavButton = (item: AppModule, tone: 'business' | 'system') => {
    const meta = MODULE_META[item];
    const active = activeModule === item;
    const isReserved = item === AppModule.PHOTOGRAPHY;

    return (
      <button
        key={item}
        type="button"
        onClick={() => !isReserved && onModuleChange(item)}
        disabled={isReserved}
        title={meta.label}
        className={`group flex w-full flex-col items-center justify-center gap-1 rounded-[18px] px-1 py-2 text-center transition-all ${
          active
            ? 'bg-white/10 text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)]'
            : isReserved
              ? 'text-slate-600'
              : 'text-slate-400 hover:bg-white/6 hover:text-slate-100'
        }`}
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-[14px] transition-all ${
            active
              ? tone === 'system'
                ? 'bg-white text-slate-900'
                : `${meta.accentClass} text-white`
              : tone === 'system'
                ? 'bg-white/8 text-slate-300 group-hover:bg-white/12'
                : 'bg-white/6 text-slate-300 group-hover:bg-white/10'
          }`}
        >
          <i className={`fas ${meta.icon} text-xs`}></i>
        </div>
        <span className="text-[10px] font-bold tracking-tight leading-tight">{meta.label}</span>
      </button>
    );
  };

  return (
    <div className="sidebar-nav z-50 shrink-0 border-r border-slate-200/70 bg-[linear-gradient(180deg,#0a1220_0%,#121c2b_100%)] px-2 py-3 overflow-y-auto">
      <style>{`
        .sidebar-nav { width: 104px; }
        .sidebar-nav .nav-grid { display: flex; flex-direction: column; gap: 4px; }
        .sidebar-nav .sys-grid { display: flex; flex-direction: column; gap: 4px; }
        @media (max-height: 760px) {
          .sidebar-nav { width: 180px; }
          .sidebar-nav .nav-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
          .sidebar-nav .sys-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
        }
      `}</style>
      <div className="flex h-full flex-col items-center">
        <button
          type="button"
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-[18px] bg-white shadow-[0_16px_34px_rgba(255,255,255,0.16)] transition-transform hover:scale-[1.02]"
          onClick={() => onModuleChange(AppModule.ONE_CLICK)}
        >
          <span className="text-lg font-black italic text-slate-950">M</span>
        </button>

        <div className="nav-grid w-full">
          {businessItems.map((item) => renderNavButton(item, 'business'))}
        </div>

        <div className="sys-grid mt-auto w-full pt-3">
          {systemItems.map((item) => renderNavButton(item, 'system'))}
        </div>
      </div>
    </div>
  );
};

export default SidebarNavigation;
