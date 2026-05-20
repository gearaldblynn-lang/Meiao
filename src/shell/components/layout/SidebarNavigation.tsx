import React from 'react';
import type { AppModule } from '../../types';
import { AppModuleObj } from '../../types';
import {
  Bot, Sparkles, Globe, Users, Wand2, PlayCircle, BookOpen,
  Settings, UserCircle, Hexagon, Sun, Moon
} from 'lucide-react';

interface NavDef { module: AppModule; icon: React.ReactNode; label: string; }

const MAIN: NavDef[] = [
  { module: AppModuleObj.AGENT_CENTER, icon: <Bot size={20} strokeWidth={1.5} />, label: '智能体' },
  { module: AppModuleObj.ONE_CLICK, icon: <Sparkles size={20} strokeWidth={1.5} />, label: '一键主详' },
  { module: AppModuleObj.TRANSLATION, icon: <Globe size={20} strokeWidth={1.5} />, label: '翻译' },
  { module: AppModuleObj.BUYER_SHOW, icon: <Users size={20} strokeWidth={1.5} />, label: '买家秀' },
  { module: AppModuleObj.RETOUCH, icon: <Wand2 size={20} strokeWidth={1.5} />, label: '精修' },
  { module: AppModuleObj.VIDEO, icon: <PlayCircle size={20} strokeWidth={1.5} />, label: '视频' },
  { module: AppModuleObj.XHS_COVER, icon: <BookOpen size={20} strokeWidth={1.5} />, label: '小红书' },
];

const BOTTOM: NavDef[] = [
  { module: AppModuleObj.SETTINGS, icon: <Settings size={20} strokeWidth={1.5} />, label: '设置' },
  { module: AppModuleObj.ACCOUNT, icon: <UserCircle size={20} strokeWidth={1.5} />, label: '账户' },
];

interface Props {
  activeModule: AppModule | 'landing';
  onModuleChange: (m: AppModule | 'landing') => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const SidebarNavigation: React.FC<Props> = ({ activeModule, onModuleChange, theme, onToggleTheme }) => {
  const isLight = theme === 'light';
  const renderItem = (item: NavDef) => {
    const isActive = activeModule === item.module;
    return (
      <button
        key={item.module}
        onClick={() => onModuleChange(item.module)}
        className="group relative flex items-center justify-center w-[44px] h-[44px] rounded-2xl transition-all"
        style={{
          background: isActive ? 'var(--accent-soft)' : 'transparent',
          color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
        }}
        title={item.label}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full" style={{ background: 'var(--accent)' }} />
        )}
        {item.icon}
        <div
          className="absolute left-full ml-2.5 px-3 py-2 rounded-2xl text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-elevated)' }}
        >
          {item.label}
        </div>
      </button>
    );
  };

  return (
    <aside
      className="h-full flex flex-col items-center shrink-0 py-3 gap-1"
      style={{ width: 'var(--sidebar-width)', background: 'var(--bg-base)' }}
    >
      {/* Logo */}
      <button onClick={() => onModuleChange('landing')} className="mb-1.5 relative group" title="首页">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-2xl transition-all"
          style={{
            background: activeModule === 'landing' ? 'var(--accent)' : (isLight ? 'transparent' : 'var(--bg-elevated)'),
            color: activeModule === 'landing' ? '#ffffff' : (isLight ? 'var(--text-secondary)' : 'var(--text-tertiary)'),
          }}
        >
          <Hexagon size={18} strokeWidth={2} />
        </div>
        {activeModule === 'landing' && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full" style={{ background: 'var(--accent)' }} />
        )}
      </button>

      <nav className="flex flex-col gap-1 flex-1 mt-2">{MAIN.map(renderItem)}</nav>

      <div className="flex flex-col gap-1 mt-2">
        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="flex items-center justify-center w-[44px] h-[44px] rounded-2xl transition-all"
          style={{ color: 'var(--text-tertiary)' }}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        {BOTTOM.map(renderItem)}
      </div>
    </aside>
  );
};

export default SidebarNavigation;
