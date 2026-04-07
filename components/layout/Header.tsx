import React, { useState } from 'react';
import { AppModule, AuthUser } from '../../types';
import { useToast } from '../ToastSystem';
import HelpGuideModal from '../HelpGuideModal';
import UserAvatar from '../../modules/AgentCenter/UserAvatar';
import { getModuleMeta } from './moduleMeta';

interface Props {
  activeModule: AppModule;
  releaseTag: string;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onLogout?: () => void;
  onNavigateModule?: (module: AppModule, options?: { accountView?: 'profile' | 'manage' }) => void;
  onOpenReleaseNotes?: () => void;
  onBack?: () => void;
}

const Header: React.FC<Props> = ({
  activeModule,
  releaseTag,
  currentUser = null,
  internalMode = false,
  onLogout,
  onNavigateModule,
  onOpenReleaseNotes,
  onBack,
}) => {
  const meta = getModuleMeta(activeModule);
  const { unreadCount, toggleCenter } = useToast();
  const [showHelp, setShowHelp] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const showBack = activeModule === AppModule.ACCOUNT || activeModule === AppModule.SETTINGS;

  const closeUserMenu = () => setUserMenuOpen(false);

  const handleNavigate = (module: AppModule, options?: { accountView?: 'profile' | 'manage' }) => {
    closeUserMenu();
    onNavigateModule?.(module, options);
  };

  return (
    <header className="z-40 shrink-0 border-b border-slate-200/80 bg-white/85 px-8 py-4 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          {showBack && onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              title="返回上一页"
              aria-label="返回上一页"
            >
              <i className="fas fa-arrow-left text-sm" />
            </button>
          ) : null}
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
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenReleaseNotes}
            className="hidden rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-500 transition hover:border-slate-300 hover:text-slate-900 lg:flex"
            title={`查看本次更新 ${releaseTag}`}
          >
            {releaseTag}
          </button>
          <div className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 lg:flex">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"></div>
            <span className="text-[10px] font-medium text-slate-500">{internalMode ? '服务正常' : '单机本地模式'}</span>
          </div>
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

          {internalMode && currentUser ? (
            <div className="relative z-50">
              <button
                type="button"
                onClick={() => setUserMenuOpen((value) => !value)}
                className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-white px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:border-slate-300"
              >
                <UserAvatar
                  name={currentUser.username}
                  avatarUrl={currentUser.avatarUrl}
                  avatarPreset={currentUser.avatarPreset}
                  className="h-9 w-9 text-sm font-black"
                />
                <div className="hidden text-left md:block">
                  <p className="max-w-[140px] truncate text-[13px] font-black text-slate-900">{currentUser.username}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    {currentUser.role === 'admin' ? '管理员' : '个人资料'}
                  </p>
                </div>
                <i className={`fas fa-chevron-down text-[11px] text-slate-400 transition ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {userMenuOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="关闭用户菜单"
                    onClick={closeUserMenu}
                    className="fixed inset-0 z-40 cursor-default bg-transparent"
                  />
                  <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[220px] overflow-hidden rounded-[24px] border border-slate-200 bg-white p-2 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
                    <button
                      type="button"
                      onClick={() => handleNavigate(AppModule.ACCOUNT, { accountView: 'profile' })}
                      className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <i className="fas fa-id-badge w-4 text-slate-400" />
                      <span>个人资料</span>
                    </button>
                    {currentUser.role === 'admin' ? (
                      <button
                        type="button"
                        onClick={() => handleNavigate(AppModule.ACCOUNT, { accountView: 'manage' })}
                        className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        <i className="fas fa-user-shield w-4 text-slate-400" />
                        <span>账号管理</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleNavigate(AppModule.SETTINGS)}
                      className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <i className="fas fa-gear w-4 text-slate-400" />
                      <span>系统设置</span>
                    </button>
                    <div className="my-2 h-px bg-slate-100" />
                    <button
                      type="button"
                      onClick={() => {
                        closeUserMenu();
                        onLogout?.();
                      }}
                      className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-[13px] font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <i className="fas fa-right-from-bracket w-4" />
                      <span>退出登录</span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {showHelp ? <HelpGuideModal onClose={() => setShowHelp(false)} /> : null}
    </header>
  );
};

export default Header;
