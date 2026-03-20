
import React, { useState, useEffect } from 'react';
import { AppModule } from './types';
import TranslationModule from './modules/Translation/TranslationModule';
import OneClickModule from './modules/OneClick/OneClickModule';
import RetouchModule from './modules/Retouch/RetouchModule';
import BuyerShowModule from './modules/BuyerShow/BuyerShowModule';
import VideoModule from './modules/Video/VideoModule';
import GlobalApiSettings from './modules/Settings/GlobalApiSettings';
import SidebarNavigation from './components/layout/SidebarNavigation';
import Header from './components/layout/Header';
import { ToastProvider } from './components/ToastSystem';
import {
  createDefaultApiConfig,
  createDefaultBuyerShowState,
  createDefaultModuleConfig,
  createDefaultOneClickState,
  createDefaultRetouchState,
  createDefaultTranslationState,
  createDefaultVideoState,
  loadPersistedAppState,
  savePersistedAppState,
} from './utils/appState';

const App: React.FC = () => {
  const savedState = loadPersistedAppState();

  const [activeModule, setActiveModule] = useState<AppModule>(savedState?.activeModule || AppModule.ONE_CLICK);

  const [apiConfig, setApiConfig] = useState(savedState?.apiConfig || createDefaultApiConfig());
  const [moduleConfig, setModuleConfig] = useState(savedState?.moduleConfig || createDefaultModuleConfig());
  const [translationMemory, setTranslationMemory] = useState(savedState?.translationMemory || createDefaultTranslationState());
  const [oneClickMemory, setOneClickMemory] = useState(savedState?.oneClickMemory || createDefaultOneClickState());
  const [retouchMemory, setRetouchMemory] = useState(savedState?.retouchMemory || createDefaultRetouchState());
  const [buyerShowMemory, setBuyerShowMemory] = useState(savedState?.buyerShowMemory || createDefaultBuyerShowState());
  const [videoMemory, setVideoMemory] = useState(savedState?.videoMemory || createDefaultVideoState());

  useEffect(() => {
    savePersistedAppState({
      activeModule,
      apiConfig,
      moduleConfig,
      translationMemory,
      oneClickMemory,
      retouchMemory,
      buyerShowMemory,
      videoMemory
    });
  }, [activeModule, apiConfig, moduleConfig, translationMemory, oneClickMemory, retouchMemory, buyerShowMemory, videoMemory]);

  return (
    <ToastProvider>
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans select-none">
        <SidebarNavigation activeModule={activeModule} onModuleChange={setActiveModule} />
        <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
          <Header activeModule={activeModule} />
          
          <main className="flex-1 relative overflow-hidden h-full">
            <div className={`h-full overflow-hidden ${activeModule === AppModule.SETTINGS ? '' : 'hidden'}`}>
              <GlobalApiSettings apiConfig={apiConfig} onApiConfigChange={setApiConfig} />
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
          </main>
        </div>
      </div>
    </ToastProvider>
  );
};

export default App;
