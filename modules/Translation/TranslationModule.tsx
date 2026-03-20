
import React, { useState } from 'react';
import { GlobalApiConfig, ModuleConfig, AppModule, TranslationSubMode, TranslationPersistentState, FileItem } from '../../types';
import SettingsSidebar from '../../components/SettingsSidebar';
import FileProcessor from '../../components/FileProcessor';

interface Props {
  apiConfig: GlobalApiConfig;
  moduleConfig: ModuleConfig;
  onModuleConfigChange: (config: ModuleConfig) => void;
  persistentState: TranslationPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<TranslationPersistentState>>;
}

const TranslationModule: React.FC<Props> = ({ apiConfig, moduleConfig, onModuleConfigChange, persistentState, onStateChange }) => {
  const [subMode, setSubMode] = useState<TranslationSubMode>(TranslationSubMode.MAIN);

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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="bg-white border-b border-slate-100 px-8 py-2 flex items-center gap-8 shrink-0 z-10">
        <button 
          onClick={() => setSubMode(TranslationSubMode.MAIN)}
          className={`flex items-center gap-2 py-2 border-b-2 transition-all ${subMode === TranslationSubMode.MAIN ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fas fa-image text-sm"></i>
          <span className="text-sm font-black">主图出海</span>
        </button>
        <button 
          onClick={() => setSubMode(TranslationSubMode.DETAIL)}
          className={`flex items-center gap-2 py-2 border-b-2 transition-all ${subMode === TranslationSubMode.DETAIL ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fas fa-list text-sm"></i>
          <span className="text-sm font-black">详情出海</span>
        </button>
        <button 
          onClick={() => setSubMode(TranslationSubMode.REMOVE_TEXT)}
          className={`flex items-center gap-2 py-2 border-b-2 transition-all ${subMode === TranslationSubMode.REMOVE_TEXT ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fas fa-eraser text-sm"></i>
          <span className="text-sm font-black">去除文案</span>
        </button>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <SettingsSidebar 
          activeModule={AppModule.TRANSLATION}
          subMode={subMode}
          config={moduleConfig} 
          onChange={onModuleConfigChange} 
          disabled={currentData.isProcessing} 
        />
        <FileProcessor 
          activeModule={AppModule.TRANSLATION}
          subMode={subMode}
          apiConfig={apiConfig}
          config={moduleConfig} 
          files={currentData.files}
          onFilesChange={handleFilesChange}
          isProcessing={currentData.isProcessing}
          onProcessingChange={handleProcessingChange} 
        />
      </div>
    </div>
  );
};

export default TranslationModule;
