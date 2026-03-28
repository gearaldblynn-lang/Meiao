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
  const iconOnly = 'apple-minimal';

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
        className={`group flex w-full flex-col items-center justify-center gap-2 rounded-[22px] px-2 py-3 text-center transition-all ${
          active
            ? 'bg-white/10 text-white shadow-[0_18px_36px_rgba(15,23,42,0.22)]'
            : isReserved
              ? 'text-slate-600'
              : 'text-slate-400 hover:bg-white/6 hover:text-slate-100'
        }`}
      >
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-[18px] transition-all ${
            active
              ? tone === 'system'
                ? 'bg-white text-slate-900'
                : `${meta.accentClass} text-white`
              : tone === 'system'
                ? 'bg-white/8 text-slate-300 group-hover:bg-white/12'
                : 'bg-white/6 text-slate-300 group-hover:bg-white/10'
          }`}
        >
          <i className={`fas ${meta.icon} text-sm`}></i>
        </div>
        <span className="text-[11px] font-bold tracking-tight">{meta.label}</span>
      </button>
    );
  };

  return (
    <div className="z-50 w-[104px] shrink-0 border-r border-slate-200/70 bg-[linear-gradient(180deg,#0a1220_0%,#121c2b_100%)] px-3 py-4">
      <div className="flex h-full flex-col items-center">
        <button
          type="button"
          className="mb-5 flex h-14 w-14 items-center justify-center rounded-[22px] bg-white shadow-[0_16px_34px_rgba(255,255,255,0.16)] transition-transform hover:scale-[1.02]"
          onClick={() => onModuleChange(AppModule.ONE_CLICK)}
        >
          <span className="text-xl font-black italic text-slate-950">M</span>
        </button>

        <div className="flex w-full flex-col gap-1.5">
          {businessItems.map((item) => renderNavButton(item, 'business'))}
        </div>

        <div className="mt-auto flex w-full flex-col gap-1.5 pt-4">
          {systemItems.map((item) => renderNavButton(item, 'system'))}
        </div>
      </div>
    </div>
  );
};

export default SidebarNavigation;
