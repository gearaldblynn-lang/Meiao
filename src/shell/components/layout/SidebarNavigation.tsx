import React from 'react';
import type { AppModule } from '../../types';
import { AppModuleObj } from '../../types';
import {
  Bot, Sparkles, Globe, Users, Wand2, PlayCircle, BookOpen,
  Settings, UserCircle, Hexagon, Sun, Moon, ChevronLeft, ChevronRight
} from 'lucide-react';

interface NavDef { module: AppModule; icon: React.ReactNode; label: string; }

const MAIN: NavDef[] = [
  { module: AppModuleObj.AGENT_CENTER, icon: <Bot size={20} strokeWidth={1.5} />, label: '智能体' },
  { module: AppModuleObj.ONE_CLICK, icon: <Sparkles size={20} strokeWidth={1.5} />, label: '一键主详' },
  { module: AppModuleObj.TRANSLATION, icon: <Globe size={20} strokeWidth={1.5} />, label: '出海翻译' },
  { module: AppModuleObj.BUYER_SHOW, icon: <Users size={20} strokeWidth={1.5} />, label: '买家秀' },
  { module: AppModuleObj.RETOUCH, icon: <Wand2 size={20} strokeWidth={1.5} />, label: '产品精修' },
  { module: AppModuleObj.VIDEO, icon: <PlayCircle size={20} strokeWidth={1.5} />, label: '视频生成' },
  { module: AppModuleObj.XHS_COVER, icon: <BookOpen size={20} strokeWidth={1.5} />, label: '小红书' },
];

const BOTTOM: NavDef[] = [
  { module: AppModuleObj.SETTINGS, icon: <Settings size={20} strokeWidth={1.5} />, label: '设置中心' },
  { module: AppModuleObj.ACCOUNT, icon: <UserCircle size={20} strokeWidth={1.5} />, label: '账户管理' },
];

interface Props {
  activeModule: AppModule | 'landing';
  onModuleChange: (m: AppModule | 'landing') => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const SidebarNavigation: React.FC<Props> = ({ activeModule, onModuleChange, theme, onToggleTheme, collapsed, onToggleCollapsed }) => {
  const isLight = theme === 'light';
  const renderItem = (item: NavDef) => {
    const isActive = activeModule === item.module;
    return (
      <button
        key={item.module}
        onClick={() => onModuleChange(item.module)}
        className={`group relative flex h-[44px] w-full items-center rounded-2xl transition-all ${collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-3'}`}
        style={{
          background: isActive ? 'var(--accent-soft)' : 'transparent',
          color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
        }}
        title={item.label}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full" style={{ background: 'var(--accent)' }} />
        )}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">{item.icon}</span>
        {!collapsed && <span className="min-w-0 truncate text-[13px] font-semibold">{item.label}</span>}
        {collapsed && (
          <div
            className="absolute left-full ml-2.5 px-3 py-2 rounded-2xl text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', boxShadow: 'var(--shadow-elevated)' }}
          >
            {item.label}
          </div>
        )}
      </button>
    );
  };

  return (
    <aside
      className="relative h-full flex flex-col shrink-0 py-3 gap-1 px-2 transition-[width] duration-200 ease-out after:absolute after:inset-y-0 after:right-0 after:w-px after:pointer-events-none after:bg-[image:var(--sidebar-divider)]"
      style={{
        width: collapsed ? 'var(--sidebar-width)' : 160,
        background: 'var(--bg-base)',
        '--sidebar-divider': isLight
          ? 'linear-gradient(180deg, transparent 0%, rgba(15,23,42,0.08) 18%, rgba(37,99,235,0.10) 50%, rgba(15,23,42,0.07) 82%, transparent 100%)'
          : 'linear-gradient(180deg, transparent 0%, rgba(148,163,184,0.12) 18%, rgba(96,165,250,0.16) 50%, rgba(148,163,184,0.10) 82%, transparent 100%)',
      } as React.CSSProperties}
      data-sidebar-collapsed={collapsed ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="absolute right-[-16px] top-[72px] z-20 flex h-8 w-4 shrink-0 items-center justify-center border border-l-0 transition-colors hover:bg-[var(--bg-elevated)]"
        style={{
          color: 'var(--text-tertiary)',
          background: 'var(--bg-base)',
          borderColor: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(148,163,184,0.12)',
          boxShadow: isLight ? '1px 0 8px rgba(15,23,42,0.025)' : '1px 0 10px rgba(0,0,0,0.10)',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
        }}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight size={13} strokeWidth={2} /> : <ChevronLeft size={13} strokeWidth={2} />}
      </button>

      <div className={`mb-1.5 flex h-9 w-full items-center ${collapsed ? 'justify-center' : 'justify-start'}`}>
        <button
          onClick={() => onModuleChange('landing')}
          className={`relative group flex h-9 min-w-0 items-center rounded-2xl transition-all ${collapsed ? 'w-8 justify-center' : 'flex-1 justify-start gap-3 px-2.5'}`}
          title="首页"
          style={{
            background: activeModule === 'landing' ? 'var(--accent)' : (isLight ? 'transparent' : 'var(--bg-elevated)'),
            color: activeModule === 'landing' ? '#ffffff' : (isLight ? 'var(--text-secondary)' : 'var(--text-tertiary)'),
          }}
        >
          {activeModule === 'landing' && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full" style={{ background: 'var(--accent)' }} />
          )}
          <Hexagon size={18} strokeWidth={2} className="shrink-0" />
          {!collapsed && <span className="truncate text-[13px] font-semibold">首页</span>}
        </button>
      </div>

      <nav className="flex flex-col gap-1 flex-1 mt-2">{MAIN.map(renderItem)}</nav>

      <div className="flex flex-col gap-1 mt-2">
        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className={`flex h-[44px] w-full items-center rounded-2xl transition-all ${collapsed ? 'justify-center px-0' : 'justify-start gap-3 px-3'}`}
          style={{ color: 'var(--text-tertiary)' }}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</span>
          {!collapsed && <span className="min-w-0 truncate text-[13px] font-semibold">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>}
        </button>
        {BOTTOM.map(renderItem)}
      </div>
    </aside>
  );
};

export default SidebarNavigation;
