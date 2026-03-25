import React, { useEffect, useMemo, useState } from 'react';
import { AppModule, AuthUser } from './types';
import TranslationModule from './modules/Translation/TranslationModule';
import OneClickModule from './modules/OneClick/OneClickModule';
import RetouchModule from './modules/Retouch/RetouchModule';
import BuyerShowModule from './modules/BuyerShow/BuyerShowModule';
import VideoModule from './modules/Video/VideoModule';
import GlobalApiSettings from './modules/Settings/GlobalApiSettings';
import AccountManagement from './modules/Account/AccountManagement';
import SidebarNavigation from './components/layout/SidebarNavigation';
import Header from './components/layout/Header';
import { ToastProvider } from './components/ToastSystem';
import LoginScreen from './components/Internal/LoginScreen';
import {
  buildPersistedAppState,
  loadPersistedAppState,
  normalizeLoadedPersistedAppState,
  PersistedAppState,
  sanitizePersistedAppState,
  savePersistedAppState,
} from './utils/appState';
import {
  clearSessionToken,
  fetchCurrentUser,
  fetchRemoteAppState,
  loginInternalUser,
  logoutInternalUser,
  probeInternalApi,
  saveRemoteAppState,
  storeSessionToken,
} from './services/internalApi';

type AppMode = 'checking' | 'local' | 'internal';
type AuthStatus = 'checking' | 'logged_out' | 'logged_in';

interface WorkspaceProps {
  initialState: Partial<PersistedAppState>;
  persistMode: 'local' | 'remote';
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  onLogout?: () => void;
}

const LoadingScreen: React.FC<{ text: string }> = ({ text }) => (
  <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6">
    <div className="max-w-lg w-full bg-white border border-slate-200 rounded-[32px] shadow-xl p-8 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Meiao</p>
      <h1 className="mt-3 text-2xl font-black text-slate-900">{text}</h1>
      <p className="mt-3 text-sm font-bold text-slate-500 leading-7">我正在检查当前环境，并决定是进入单机模式还是公司内部协作模式。</p>
    </div>
  </div>
);

const AppWorkspace: React.FC<WorkspaceProps> = ({
  initialState,
  persistMode,
  currentUser = null,
  internalMode = false,
  onLogout,
}) => {
  const baseState = useMemo(() => buildPersistedAppState(initialState), [initialState]);

  const [activeModule, setActiveModule] = useState<AppModule>(baseState.activeModule);
  const [apiConfig, setApiConfig] = useState(baseState.apiConfig);
  const [moduleConfig, setModuleConfig] = useState(baseState.moduleConfig);
  const [translationMemory, setTranslationMemory] = useState(baseState.translationMemory);
  const [oneClickMemory, setOneClickMemory] = useState(baseState.oneClickMemory);
  const [retouchMemory, setRetouchMemory] = useState(baseState.retouchMemory);
  const [buyerShowMemory, setBuyerShowMemory] = useState(baseState.buyerShowMemory);
  const [videoMemory, setVideoMemory] = useState(baseState.videoMemory);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const snapshot: PersistedAppState = {
      activeModule,
      apiConfig,
      moduleConfig,
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
    moduleConfig,
    translationMemory,
    oneClickMemory,
    retouchMemory,
    buyerShowMemory,
    videoMemory,
    hydrated,
    persistMode,
  ]);

  return (
    <ToastProvider>
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans select-none">
        <SidebarNavigation activeModule={activeModule} onModuleChange={setActiveModule} />
        <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
          <Header activeModule={activeModule} currentUser={currentUser} internalMode={internalMode} onLogout={onLogout} />

          <main className="flex-1 relative overflow-hidden h-full">
            <div className={`h-full overflow-hidden ${activeModule === AppModule.SETTINGS ? '' : 'hidden'}`}>
              <GlobalApiSettings
                apiConfig={apiConfig}
                onApiConfigChange={setApiConfig}
                currentUser={currentUser}
                internalMode={internalMode}
              />
            </div>
            <div className={`h-full overflow-hidden ${activeModule === AppModule.TRANSLATION ? '' : 'hidden'}`}>
              <TranslationModule apiConfig={apiConfig} moduleConfig={moduleConfig} onModuleConfigChange={setModuleConfig} persistentState={translationMemory} onStateChange={setTranslationMemory} />
            </div>
            <div className={`h-full overflow-hidden ${activeModule === AppModule.ONE_CLICK ? '' : 'hidden'}`}>
              <OneClickModule apiConfig={apiConfig} persistentState={oneClickMemory} onStateChange={setOneClickMemory} />
            </div>
            <div className={`h-full overflow-hidden ${activeModule === AppModule.RETOUCH ? '' : 'hidden'}`}>
              <RetouchModule apiConfig={apiConfig} persistentState={retouchMemory} onStateChange={setRetouchMemory} />
            </div>
            <div className={`h-full overflow-hidden ${activeModule === AppModule.BUYER_SHOW ? '' : 'hidden'}`}>
              <BuyerShowModule apiConfig={apiConfig} persistentState={buyerShowMemory} onStateChange={setBuyerShowMemory} />
            </div>
            <div className={`h-full overflow-hidden ${activeModule === AppModule.VIDEO ? '' : 'hidden'}`}>
              <VideoModule apiConfig={apiConfig} persistentState={videoMemory} onStateChange={setVideoMemory} />
            </div>
            <div className={`h-full overflow-hidden ${activeModule === AppModule.ACCOUNT ? '' : 'hidden'}`}>
              <AccountManagement currentUser={currentUser} internalMode={internalMode} />
            </div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
};

const App: React.FC = () => {
  const localState = useMemo(() => loadPersistedAppState(), []);
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
        setCurrentUser(me.user);
        setRemoteState(normalizeLoadedPersistedAppState(stateResult.state));
        setAuthStatus('logged_in');
      } catch {
        clearSessionToken();
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
      await logoutInternalUser();
    } catch (error) {
      console.error('Failed to logout', error);
    } finally {
      clearSessionToken();
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
    return <LoginScreen isSubmitting={loginSubmitting} error={loginError} onLogin={handleLogin} />;
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
    />
  );
};

export default App;
