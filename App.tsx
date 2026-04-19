import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { AppModule, AuthUser, ModuleInterfaceId } from './types';
import SidebarNavigation from './components/layout/SidebarNavigation';
import Header from './components/layout/Header';
import { ToastProvider } from './components/ToastSystem';
import LoginScreen from './components/Internal/LoginScreen';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import { APP_RELEASE_VERSION, RELEASE_NOTES_STORAGE_KEY } from './config/releaseNotes';
import {
  buildPersistedAppState,
  loadPersistedAppState,
  normalizeLoadedPersistedAppState,
  PersistedAppState,
  sanitizePersistedAppState,
  savePersistedAppState,
} from './utils/appState';
import {
  clearCurrentUserContext,
  clearSessionToken,
  fetchCurrentUser,
  fetchRemoteAppState,
  fetchSystemConfig,
  loginInternalUser,
  logoutInternalUser,
  probeInternalApi,
  saveRemoteAppState,
  storeActiveModuleContext,
  storeCurrentUserContext,
  storeSessionToken,
} from './services/internalApi';
import { logActionSuccess } from './services/loggingService';
import { getEffectiveConcurrency } from './modules/Account/accountManagementUtils.mjs';
import { getLegacyTranslationModuleConfig } from './modules/Translation/translationConfigUtils.mjs';

const AgentCenterModule = lazy(() => import('./modules/AgentCenter/AgentCenterModule'));
const TranslationModule = lazy(() => import('./modules/Translation/TranslationModule'));
const OneClickModule = lazy(() => import('./modules/OneClick/OneClickModule'));
const RetouchModule = lazy(() => import('./modules/Retouch/RetouchModule'));
const BuyerShowModule = lazy(() => import('./modules/BuyerShow/BuyerShowModule'));
const VideoModule = lazy(() => import('./modules/Video/VideoModule'));
const GlobalApiSettings = lazy(() => import('./modules/Settings/GlobalApiSettings'));
const AccountManagement = lazy(() => import('./modules/Account/AccountManagement'));

type AppMode = 'checking' | 'local' | 'internal';
type AuthStatus = 'checking' | 'logged_out' | 'logged_in';

interface WorkspaceProps {
  initialState: Partial<PersistedAppState>;
  persistMode: 'local' | 'remote';
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onLogout?: () => void;
  onCurrentUserChange?: (user: AuthUser) => void;
}

const isSystemModule = (module: AppModule) =>
  module === AppModule.SETTINGS || module === AppModule.ACCOUNT;

const getSafePrimaryModule = (module: AppModule) =>
  isSystemModule(module) ? AppModule.AGENT_CENTER : module;

const LoadingScreen: React.FC<{ text: string }> = ({ text }) => (
  <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6">
    <div className="max-w-lg w-full bg-white border border-slate-200 rounded-[32px] shadow-xl p-8 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Meiao</p>
      <h1 className="mt-3 text-2xl font-black text-slate-900">{text}</h1>
      <p className="mt-3 text-sm font-bold text-slate-500 leading-7">我正在检查当前环境，并决定是进入单机模式还是公司内部协作模式。</p>
    </div>
  </div>
);

const ModuleLoadingFallback: React.FC = () => (
  <div className="flex h-full items-center justify-center bg-white/60">
    <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 text-center shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Loading</p>
      <p className="mt-2 text-sm font-bold text-slate-600">模块资源加载中</p>
    </div>
  </div>
);

const AppWorkspace: React.FC<WorkspaceProps> = ({
  initialState,
  persistMode,
  currentUser = null,
  internalMode = false,
  onLogout,
  onCurrentUserChange,
}) => {
  const baseState = useMemo(() => buildPersistedAppState(initialState), [initialState]);

  const [activeModule, setActiveModule] = useState<AppModule>(baseState.activeModule);
  const [lastPrimaryModule, setLastPrimaryModule] = useState<AppModule>(getSafePrimaryModule(baseState.activeModule));
  const [systemPageSourceModule, setSystemPageSourceModule] = useState<AppModule>(getSafePrimaryModule(baseState.activeModule));
  const [accountEntryMode, setAccountEntryMode] = useState<'default' | 'profile' | 'manage'>('default');
  const [apiConfig, setApiConfig] = useState(baseState.apiConfig);
  const [translationConfigs, setTranslationConfigs] = useState(baseState.translationConfigs);
  const [translationMemory, setTranslationMemory] = useState(baseState.translationMemory);
  const [oneClickMemory, setOneClickMemory] = useState(baseState.oneClickMemory);
  const [retouchMemory, setRetouchMemory] = useState(baseState.retouchMemory);
  const [buyerShowMemory, setBuyerShowMemory] = useState(baseState.buyerShowMemory);
  const [videoMemory, setVideoMemory] = useState(baseState.videoMemory);
  const [hydrated, setHydrated] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seenVersion = localStorage.getItem(RELEASE_NOTES_STORAGE_KEY);
    if (seenVersion === APP_RELEASE_VERSION) return;
    setShowReleaseNotes(true);
    localStorage.setItem(RELEASE_NOTES_STORAGE_KEY, APP_RELEASE_VERSION);
  }, []);

  const openReleaseNotes = () => {
    setShowReleaseNotes(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(RELEASE_NOTES_STORAGE_KEY, APP_RELEASE_VERSION);
    }
  };

  useEffect(() => {
    if (internalMode) {
      storeActiveModuleContext(activeModule);
    }
  }, [activeModule, internalMode]);

  const handleModuleChange = (module: AppModule, options?: { accountView?: 'profile' | 'manage' }) => {
    if (!isSystemModule(module)) {
      setLastPrimaryModule(module);
      setSystemPageSourceModule(module);
    } else {
      setSystemPageSourceModule(getSafePrimaryModule(activeModule));
    }
    if (module === AppModule.ACCOUNT) {
      setAccountEntryMode(options?.accountView || 'default');
    } else {
      setAccountEntryMode('default');
    }
    setActiveModule(module);
  };

  const handleAgentHandoff = (target: ModuleInterfaceId, payload: Record<string, unknown>) => {
    if (target === 'one_click_main') {
      const toStringArray = (val: unknown): string[] => {
        if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string' && Boolean(v));
        if (typeof val === 'string') { try { const p = JSON.parse(val); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; } }
        return [];
      };
      const toString = (val: unknown): string =>
        typeof val === 'string' && val !== 'null' ? val.trim() : '';
      const productImageUrls = toStringArray(payload.productImageUrls);
      const designReferenceUrls = toStringArray(payload.designReferenceUrls);
      const logoUrl = toString(payload.logoUrl);
      setOneClickMemory((prev) => ({
        ...prev,
        mainImage: {
          ...prev.mainImage,
          ...(productImageUrls.length > 0 ? { uploadedProductUrls: productImageUrls } : {}),
          ...(logoUrl ? { uploadedLogoUrl: logoUrl } : {}),
          ...(designReferenceUrls.length > 0 ? { uploadedDesignReferenceUrls: designReferenceUrls } : {}),
          config: {
            ...prev.mainImage.config,
            ...(payload.description ? { description: String(payload.description) } : {}),
            ...(payload.planningLogic ? { planningLogic: String(payload.planningLogic) } : {}),
          },
        },
      }));
      handleModuleChange(AppModule.ONE_CLICK);
    }
  };

  const handleBackFromSystemPage = () => {
    setActiveModule(getSafePrimaryModule(systemPageSourceModule));
    setLastPrimaryModule(getSafePrimaryModule(systemPageSourceModule));
    setAccountEntryMode('default');
  };

  useEffect(() => {
    if (!internalMode || !currentUser) return;
    let disposed = false;

    const syncServerConcurrency = async () => {
      try {
        const result = await fetchSystemConfig();
        if (disposed) return;
        const effectiveConcurrency = getEffectiveConcurrency(
          result.config.queue.maxConcurrency,
          currentUser.jobConcurrency
        );
        setApiConfig((prev) => ({
          ...prev,
          kieApiKey: '',
          concurrency: effectiveConcurrency,
        }));
      } catch (error) {
        console.error('Failed to sync server concurrency', error);
      }
    };

    void syncServerConcurrency();

    return () => {
      disposed = true;
    };
  }, [internalMode, currentUser?.id, currentUser?.jobConcurrency]);

  useEffect(() => {
    if (!hydrated) return;

    const snapshot: PersistedAppState = {
      activeModule,
      apiConfig,
      moduleConfig: getLegacyTranslationModuleConfig(translationConfigs),
      translationConfigs,
      translationMemory,
      oneClickMemory,
      retouchMemory,
      buyerShowMemory,
      videoMemory,
    };

    if (persistMode === 'local') {
      savePersistedAppState(snapshot);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveRemoteAppState(sanitizePersistedAppState(snapshot)).catch((error) => {
        console.error('Failed to save remote app state', error);
      });
    }, 600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeModule,
    apiConfig,
    translationConfigs,
    translationMemory,
    oneClickMemory,
    retouchMemory,
    buyerShowMemory,
    videoMemory,
    hydrated,
    persistMode,
  ]);

  const activeModuleView = (() => {
    switch (activeModule) {
      case AppModule.AGENT_CENTER:
        return <AgentCenterModule currentUser={currentUser} internalMode={internalMode} onHandoff={handleAgentHandoff} />;
      case AppModule.SETTINGS:
        return (
          <GlobalApiSettings
            apiConfig={apiConfig}
            onApiConfigChange={setApiConfig}
            currentUser={currentUser}
            internalMode={internalMode}
            isActive={activeModule === AppModule.SETTINGS}
          />
        );
      case AppModule.TRANSLATION:
        return <TranslationModule apiConfig={apiConfig} translationConfigs={translationConfigs} onTranslationConfigsChange={setTranslationConfigs} persistentState={translationMemory} onStateChange={setTranslationMemory} />;
      case AppModule.ONE_CLICK:
        return <OneClickModule apiConfig={apiConfig} persistentState={oneClickMemory} onStateChange={setOneClickMemory} />;
      case AppModule.RETOUCH:
        return <RetouchModule apiConfig={apiConfig} persistentState={retouchMemory} onStateChange={setRetouchMemory} />;
      case AppModule.BUYER_SHOW:
        return <BuyerShowModule apiConfig={apiConfig} persistentState={buyerShowMemory} onStateChange={setBuyerShowMemory} />;
      case AppModule.VIDEO:
        return <VideoModule apiConfig={apiConfig} persistentState={videoMemory} onStateChange={setVideoMemory} />;
      case AppModule.ACCOUNT:
        return (
          <AccountManagement
            key={accountEntryMode}
            currentUser={currentUser}
            internalMode={internalMode}
            onCurrentUserChange={onCurrentUserChange}
            entryMode={accountEntryMode}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <ToastProvider appVersion={APP_RELEASE_VERSION} onOpenReleaseNotes={openReleaseNotes}>
      <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#f8fbff_0%,#eef4ff_20%,#f8fafc_52%,#edf2f7_100%)] font-sans text-slate-900">
        <SidebarNavigation
          activeModule={activeModule}
          onModuleChange={handleModuleChange}
          showSystemEntries={!internalMode}
          currentUser={currentUser}
          internalMode={internalMode}
          releaseTag={APP_RELEASE_VERSION}
          serviceStatusLabel={internalMode ? '服务正常' : '单机本地模式'}
          onOpenReleaseNotes={openReleaseNotes}
          onLogout={onLogout}
        />
        <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
          <Header
            activeModule={activeModule}
            onBack={handleBackFromSystemPage}
          />

          <main className="relative flex-1 min-h-0">
            <Suspense fallback={<ModuleLoadingFallback />}>
              <div className="h-full min-h-0">
                {activeModuleView}
              </div>
            </Suspense>
          </main>
        </div>
      </div>
      {showReleaseNotes ? <ReleaseNotesModal onClose={() => setShowReleaseNotes(false)} /> : null}
    </ToastProvider>
  );
};

const App: React.FC = () => {
  const localState = useMemo(() => loadPersistedAppState(), []);
  const isLocalPreviewHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const [appMode, setAppMode] = useState<AppMode>('checking');
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [remoteState, setRemoteState] = useState<Partial<PersistedAppState> | null>(null);
  const [loginError, setLoginError] = useState('');
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  useEffect(() => {
    let disposed = false;

    const init = async () => {
      const internalApiReady = await probeInternalApi();
      if (!internalApiReady) {
        if (!disposed) {
          clearCurrentUserContext();
          setAppMode('local');
          setAuthStatus('logged_out');
        }
        return;
      }

      if (disposed) return;
      setAppMode('internal');

      try {
        const me = await fetchCurrentUser();
        const stateResult = await fetchRemoteAppState();
        if (disposed) return;
        storeCurrentUserContext(me.user);
        setCurrentUser(me.user);
        setRemoteState(normalizeLoadedPersistedAppState(stateResult.state));
        setAuthStatus('logged_in');
      } catch {
        clearSessionToken();
        clearCurrentUserContext();
        if (!disposed) {
          setAuthStatus('logged_out');
        }
      }
    };

    void init();

    return () => {
      disposed = true;
    };
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setLoginSubmitting(true);
    setLoginError('');
    try {
      const loginResult = await loginInternalUser(username, password);
      storeSessionToken(loginResult.token);
      storeCurrentUserContext(loginResult.user);
      const stateResult = await fetchRemoteAppState();
      setCurrentUser(loginResult.user);
      setRemoteState(normalizeLoadedPersistedAppState(stateResult.state));
      setAuthStatus('logged_in');
    } catch (error: any) {
      setLoginError(error.message || '登录失败');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      void logActionSuccess({
        module: 'account',
        action: 'logout_click',
        message: '点击退出登录',
      });
      await logoutInternalUser();
    } catch (error) {
      console.error('Failed to logout', error);
    } finally {
      clearSessionToken();
      clearCurrentUserContext();
      setCurrentUser(null);
      setRemoteState(null);
      setAuthStatus('logged_out');
    }
  };

  if (appMode === 'checking' || authStatus === 'checking') {
    return <LoadingScreen text="正在准备工作台" />;
  }

  if (appMode === 'local') {
    return <AppWorkspace initialState={localState} persistMode="local" />;
  }

  if (authStatus === 'logged_out') {
    return (
      <LoginScreen
        isSubmitting={loginSubmitting}
        error={loginError}
        defaultUsername={isLocalPreviewHost ? '将离' : ''}
        defaultPassword={isLocalPreviewHost ? '411422' : ''}
        onLogin={handleLogin}
      />
    );
  }

  if (!remoteState || !currentUser) {
    return <LoadingScreen text="正在加载你的工作内容" />;
  }

  return (
    <AppWorkspace
      key={currentUser.id}
      initialState={remoteState}
      persistMode="remote"
      currentUser={currentUser}
      internalMode
      onLogout={handleLogout}
      onCurrentUserChange={(user) => {
        storeCurrentUserContext(user);
        setCurrentUser(user);
      }}
    />
  );
};

export default App;
