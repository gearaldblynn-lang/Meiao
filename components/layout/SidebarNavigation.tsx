import React, { useState } from 'react';
import { AppModule, AuthUser } from '../../types';
import { MODULE_META } from './moduleMeta';
import { useToast } from '../ToastSystem';
import HelpGuideModal from '../HelpGuideModal';
import UserAvatar from '../../modules/AgentCenter/UserAvatar';

interface Props {
  activeModule: AppModule;
  onModuleChange: (module: AppModule, options?: { accountView?: 'profile' | 'manage' }) => void;
  showSystemEntries?: boolean;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  releaseTag: string;
  serviceStatusLabel: string;
  onOpenReleaseNotes?: () => void;
  onLogout?: () => void;
}

const SidebarNavigation: React.FC<Props> = ({
  activeModule,
  onModuleChange,
  showSystemEntries = true,
  currentUser = null,
  internalMode = false,
  releaseTag,
  serviceStatusLabel,
  onOpenReleaseNotes,
  onLogout,
}) => {
  const businessItems = [
    AppModule.AGENT_CENTER,
    AppModule.ONE_CLICK,
    AppModule.TRANSLATION,
    AppModule.BUYER_SHOW,
    AppModule.RETOUCH,
    AppModule.PHOTOGRAPHY,
    AppModule.VIDEO,
  ];
  const systemItems = [AppModule.SETTINGS, AppModule.ACCOUNT];
  const { unreadCount, toggleCenter } = useToast();
  const [userHubOpen, setUserHubOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const closeUserHub = () => setUserHubOpen(false);

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
        data-icon-only="true"
        data-iconOnly="true"
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
        <span className="text-[10px] font-bold leading-tight tracking-tight">{meta.label}</span>
      </button>
    );
  };

  return (
    <div className="sidebar-nav z-50 shrink-0 overflow-visible border-r border-slate-200/70 bg-[linear-gradient(180deg,#0a1220_0%,#121c2b_100%)] px-2 py-3">
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
      <div className="flex h-full flex-col items-center overflow-visible">
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

        <div className="mt-auto w-full pt-3">
          {showSystemEntries ? (
            <div className="sys-grid mb-3 w-full">
              {systemItems.map((item) => renderNavButton(item, 'system'))}
            </div>
          ) : null}

          {internalMode && currentUser ? (
            <div className="relative flex w-full justify-center">
              {userHubOpen ? (
                <button
                  type="button"
                  aria-label="关闭用户工作台"
                  onClick={closeUserHub}
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                />
              ) : null}

              {userHubOpen ? (
                <div className="absolute bottom-0 left-[calc(100%+12px)] z-50 w-[248px] overflow-hidden rounded-[26px] border border-white/70 bg-white/95 p-2 text-slate-900 shadow-[0_24px_60px_rgba(2,6,23,0.18)] backdrop-blur-2xl">
                  <div className="rounded-[20px] border border-slate-200/80 bg-white/86 px-3 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">状态</p>
                    <button
                      type="button"
                      onClick={() => {
                        closeUserHub();
                        onOpenReleaseNotes?.();
                      }}
                      className="mt-3 flex w-full items-center justify-between rounded-[16px] border border-slate-200/90 bg-white px-3 py-2.5 text-left transition hover:bg-slate-50"
                      title={`查看本次更新 ${releaseTag}`}
                    >
                      <span className="text-[12px] font-black text-slate-900">{releaseTag}</span>
                      <span className="text-[10px] font-medium text-slate-500">查看本次更新</span>
                    </button>
                    <div className="mt-2 flex items-center gap-2 rounded-[16px] border border-slate-200/90 bg-white px-3 py-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(74,222,128,0.12)]" />
                      <span className="text-[12px] font-medium text-slate-700">{serviceStatusLabel}</span>
                    </div>
                  </div>

                  <div className="mt-2 rounded-[20px] border border-slate-200/80 bg-white/86 px-2 py-2">
                    <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">全局</p>
                    <button
                      type="button"
                      onClick={() => {
                        closeUserHub();
                        toggleCenter();
                      }}
                      className="flex w-full items-center justify-between rounded-[15px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-3">
                        <i className="fas fa-bell w-4 text-slate-400" />
                        <span>通知中心</span>
                      </span>
                      {unreadCount > 0 ? (
                        <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white">
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        closeUserHub();
                        setShowHelp(true);
                      }}
                      className="flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <i className="fas fa-question-circle w-4 text-slate-400" />
                      <span>使用帮助</span>
                    </button>
                  </div>

                  <div className="mt-2 rounded-[20px] border border-slate-200/80 bg-white/86 px-2 py-2">
                    <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">账户</p>
                    <button
                      type="button"
                      onClick={() => {
                        closeUserHub();
                        onModuleChange(AppModule.ACCOUNT, { accountView: 'profile' });
                      }}
                      className="flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <i className="fas fa-id-badge w-4 text-slate-400" />
                      <span>个人资料</span>
                    </button>
                    {currentUser.role === 'admin' ? (
                      <button
                        type="button"
                        onClick={() => {
                          closeUserHub();
                          onModuleChange(AppModule.ACCOUNT, { accountView: 'manage' });
                        }}
                        className="flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-800 transition hover:bg-slate-50"
                      >
                        <i className="fas fa-user-shield w-4 text-slate-400" />
                        <span>账号管理</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        closeUserHub();
                        onModuleChange(AppModule.SETTINGS);
                      }}
                      className="flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left text-[13px] font-semibold text-slate-800 transition hover:bg-slate-50"
                    >
                      <i className="fas fa-gear w-4 text-slate-400" />
                      <span>系统设置</span>
                    </button>
                    <div className="my-2 h-px bg-slate-200/80" />
                    <button
                      type="button"
                      onClick={() => {
                        closeUserHub();
                        onLogout?.();
                      }}
                      className="flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left text-[13px] font-semibold text-rose-500 transition hover:bg-rose-50"
                    >
                      <i className="fas fa-right-from-bracket w-4" />
                      <span>退出登录</span>
                    </button>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setUserHubOpen((value) => !value)}
                className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-white/10 bg-white/8 text-white/92 transition hover:bg-white/12"
              >
                <UserAvatar
                  name={currentUser.username}
                  avatarUrl={currentUser.avatarUrl}
                  avatarPreset={currentUser.avatarPreset}
                  className="h-9 w-9 text-sm font-black"
                />
                <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/14 px-1 text-[9px] font-black text-white/72">
                  <i className={`fas fa-chevron-up transition ${userHubOpen ? '' : 'rotate-180'}`} />
                </span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {showHelp ? <HelpGuideModal onClose={() => setShowHelp(false)} /> : null}
    </div>
  );
};

export default SidebarNavigation;
