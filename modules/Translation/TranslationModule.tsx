
import React, { useState } from 'react';
import { GlobalApiConfig, TranslationModuleConfigs, AppModule, TranslationSubMode, TranslationPersistentState, FileItem } from '../../types';
import SettingsSidebar from '../../components/SettingsSidebar';
import FileProcessor from '../../components/FileProcessor';
import { getTranslationConfigForSubMode, updateTranslationConfigForSubMode } from './translationConfigUtils.mjs';

interface Props {
  apiConfig: GlobalApiConfig;
  translationConfigs: TranslationModuleConfigs;
  onTranslationConfigsChange: (configs: TranslationModuleConfigs) => void;
  persistentState: TranslationPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<TranslationPersistentState>>;
}

const TranslationModule: React.FC<Props> = ({ apiConfig, translationConfigs, onTranslationConfigsChange, persistentState, onStateChange }) => {
  const [subMode, setSubMode] = useState<TranslationSubMode>(TranslationSubMode.MAIN);
  const [startSignal, setStartSignal] = useState(0);

  const getMemoryKey = (mode: TranslationSubMode) => {
    switch(mode) {
      case TranslationSubMode.MAIN: return 'main';
      case TranslationSubMode.DETAIL: return 'detail';
      case TranslationSubMode.REMOVE_TEXT: return 'removeText';
      default: return 'main';
    }
  };

  const key = getMemoryKey(subMode);
  const currentData = persistentState[key];
  const currentConfig = getTranslationConfigForSubMode(translationConfigs, subMode);
  const startDisabled =
    currentData.isProcessing ||
    currentData.files.length === 0 ||
    !currentData.files.some((file) => file.status === 'pending' || file.status === 'error' || file.status === 'interrupted');

  const handleFilesChange = (newFilesOrFn: FileItem[] | ((prev: FileItem[]) => FileItem[])) => {
    onStateChange(prev => {
      const currentFiles = prev[key].files;
      const newFiles = typeof newFilesOrFn === 'function' ? newFilesOrFn(currentFiles) : newFilesOrFn;
      return {
        ...prev,
        [key]: { ...prev[key], files: newFiles }
      };
    });
  };

  const handleProcessingChange = (processing: boolean) => {
    onStateChange(prev => ({
      ...prev,
      [key]: { ...prev[key], isProcessing: processing }
    }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden px-6 pb-6 pt-5">
      <div className="flex-1 flex min-h-0 overflow-hidden rounded-[32px] border border-white/70 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <SettingsSidebar 
          activeModule={AppModule.TRANSLATION}
          subMode={subMode}
          config={currentConfig}
          onChange={(nextConfig) => onTranslationConfigsChange(updateTranslationConfigForSubMode(translationConfigs, subMode, nextConfig))}
          disabled={currentData.isProcessing}
          onModeChange={setSubMode}
          onStart={() => setStartSignal((value) => value + 1)}
          startDisabled={startDisabled}
        />
        <FileProcessor 
          activeModule={AppModule.TRANSLATION}
          subMode={subMode}
          apiConfig={apiConfig}
          config={currentConfig}
          files={currentData.files}
          onFilesChange={handleFilesChange}
          isProcessing={currentData.isProcessing}
          onProcessingChange={handleProcessingChange}
          startSignal={startSignal}
        />
      </div>
    </div>
  );
};

export default TranslationModule;
