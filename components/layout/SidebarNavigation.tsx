
import React from 'react';
import { AppModule } from '../../types';

interface Props {
  activeModule: AppModule;
  onModuleChange: (module: AppModule) => void;
}

const SidebarNavigation: React.FC<Props> = ({ activeModule, onModuleChange }) => {
  const menuItems = [
    { id: AppModule.ONE_CLICK, icon: 'fa-magic', label: '一键主详', color: 'bg-rose-600' },
    { id: AppModule.TRANSLATION, icon: 'fa-globe', label: '出海翻译', color: 'bg-indigo-600' },
    { id: AppModule.BUYER_SHOW, icon: 'fa-users', label: '买家秀', color: 'bg-amber-500' },
    { id: AppModule.RETOUCH, icon: 'fa-wand-magic-sparkles', label: '产品精修', color: 'bg-emerald-500' },
    { id: AppModule.PHOTOGRAPHY, icon: 'fa-camera-retro', label: '摄影图', color: 'bg-cyan-500' },
    { id: AppModule.VIDEO, icon: 'fa-play-circle', label: '短视频', color: 'bg-purple-500' },
  ];

  return (
    <div className="w-20 bg-slate-900 flex flex-col items-center py-6 shrink-0 z-50">
      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-10 shadow-lg shadow-white/10 cursor-pointer hover:scale-105 transition-transform" onClick={() => onModuleChange(AppModule.ONE_CLICK)}>
        <span className="text-slate-900 font-black text-xl italic">M</span>
      </div>
      
      <div className="flex flex-col gap-4">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onModuleChange(item.id)}
            className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all group relative ${
              activeModule === item.id 
                ? `${item.color} text-white shadow-xl` 
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
            }`}
          >
            <i className={`fas ${item.icon} text-lg`}></i>
            <span className="text-[9px] font-bold">{item.label}</span>
            {activeModule === item.id && (
              <div className="absolute left-[-10px] w-1.5 h-6 bg-white rounded-r-full"></div>
            )}
          </button>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-4">
        <button 
          onClick={() => onModuleChange(AppModule.SETTINGS)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            activeModule === AppModule.SETTINGS ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-600 hover:bg-white/5'
          }`}
        >
          <i className="fas fa-cog"></i>
        </button>
        <button
          onClick={() => onModuleChange(AppModule.ACCOUNT)}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
            activeModule === AppModule.ACCOUNT ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-600 hover:bg-white/5'
          }`}
        >
          <i className="fas fa-user-circle"></i>
        </button>
      </div>
    </div>
  );
};

export default SidebarNavigation;
