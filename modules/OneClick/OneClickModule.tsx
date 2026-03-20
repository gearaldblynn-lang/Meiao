
import React, { useState } from 'react';
import { GlobalApiConfig, OneClickSubMode, OneClickPersistentState } from '../../types';
import MainImageSubModule from './MainImageSubModule';
import DetailPageSubModule from './DetailPageSubModule';
import { useToast } from '../../components/ToastSystem';
import { createDefaultOneClickState } from '../../utils/appState';

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: OneClickPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<OneClickPersistentState>>;
}

const OneClickModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  const [subMode, setSubMode] = useState<OneClickSubMode>(OneClickSubMode.MAIN_IMAGE);
  const [isProcessing, setIsProcessing] = useState(false);
  const { addToast } = useToast();
  const defaultOneClickState = createDefaultOneClickState();

  // 使用函数式更新确保并发安全
  const updateMainImageState = (updates: Partial<OneClickPersistentState['mainImage']> | ((prev: OneClickPersistentState['mainImage']) => OneClickPersistentState['mainImage'])) => {
    onStateChange(prev => {
      const current = prev.mainImage;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      return {
        ...prev,
        mainImage: { ...current, ...finalUpdates }
      };
    });
  };

  const updateDetailPageState = (updates: Partial<OneClickPersistentState['detailPage']> | ((prev: OneClickPersistentState['detailPage']) => OneClickPersistentState['detailPage'])) => {
    onStateChange(prev => {
      const current = prev.detailPage;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      return {
        ...prev,
        detailPage: { ...current, ...finalUpdates }
      };
    });
  };

  const pickSyncValue = <T,>(sourceValue: T, targetValue: T): T => {
    if (typeof sourceValue === 'string') {
      return sourceValue.trim() ? sourceValue : targetValue;
    }

    if (Array.isArray(sourceValue)) {
      return sourceValue.length > 0 ? sourceValue : targetValue;
    }

    if (sourceValue === null || sourceValue === undefined) {
      return targetValue;
    }

    return sourceValue;
  };

  const syncSharedFields = (source: OneClickPersistentState['mainImage'], target: OneClickPersistentState['detailPage']) => ({
    ...target,
    productImages: pickSyncValue(source.productImages, target.productImages),
    uploadedProductUrls: pickSyncValue(source.uploadedProductUrls, target.uploadedProductUrls),
    config: {
      ...target.config,
      description: pickSyncValue(source.config.description, target.config.description),
      planningLogic: pickSyncValue(source.config.planningLogic, target.config.planningLogic),
      platformType: pickSyncValue(source.config.platformType, target.config.platformType),
      platform: pickSyncValue(source.config.platform, target.config.platform),
      language: pickSyncValue(source.config.language, target.config.language),
      quality: pickSyncValue(source.config.quality, target.config.quality),
      model: pickSyncValue(source.config.model, target.config.model),
      styleStrength: pickSyncValue(source.config.styleStrength, target.config.styleStrength),
      resolutionMode: pickSyncValue(source.config.resolutionMode, target.config.resolutionMode),
      maxFileSize: pickSyncValue(source.config.maxFileSize, target.config.maxFileSize),
    }
  });

  const syncSharedFieldsToMain = (source: OneClickPersistentState['detailPage'], target: OneClickPersistentState['mainImage']) => ({
    ...target,
    productImages: pickSyncValue(source.productImages, target.productImages),
    uploadedProductUrls: pickSyncValue(source.uploadedProductUrls, target.uploadedProductUrls),
    config: {
      ...target.config,
      description: pickSyncValue(source.config.description, target.config.description),
      planningLogic: pickSyncValue(source.config.planningLogic, target.config.planningLogic),
      platformType: pickSyncValue(source.config.platformType, target.config.platformType),
      platform: pickSyncValue(source.config.platform, target.config.platform),
      language: pickSyncValue(source.config.language, target.config.language),
      quality: pickSyncValue(source.config.quality, target.config.quality),
      model: pickSyncValue(source.config.model, target.config.model),
      styleStrength: pickSyncValue(source.config.styleStrength, target.config.styleStrength),
      resolutionMode: pickSyncValue(source.config.resolutionMode, target.config.resolutionMode),
      maxFileSize: pickSyncValue(source.config.maxFileSize, target.config.maxFileSize),
    }
  });

  const handleSyncToDetail = () => {
    onStateChange(prev => ({
      ...prev,
      detailPage: syncSharedFields(prev.mainImage, prev.detailPage),
    }));
    addToast('已将主图的公共配置同步到详情', 'success');
  };

  const handleSyncToMain = () => {
    onStateChange(prev => ({
      ...prev,
      mainImage: syncSharedFieldsToMain(prev.detailPage, prev.mainImage),
    }));
    addToast('已将详情的公共配置同步到主图', 'success');
  };

  const handleClearMainConfig = () => {
    onStateChange(prev => ({
      ...prev,
      mainImage: {
        ...defaultOneClickState.mainImage,
        schemes: [],
      }
    }));
    addToast('已清空主图配置信息', 'success');
  };

  const handleClearDetailConfig = () => {
    onStateChange(prev => ({
      ...prev,
      detailPage: {
        ...defaultOneClickState.detailPage,
        schemes: [],
      }
    }));
    addToast('已清空详情配置信息', 'success');
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-slate-50">
      {/* Module Tabs */}
      <div className="bg-white border-b border-slate-100 px-8 py-2 flex items-center gap-8 shrink-0 z-10 shadow-sm">
        <button 
          onClick={() => setSubMode(OneClickSubMode.MAIN_IMAGE)}
          className={`flex items-center gap-2 py-2 border-b-2 transition-all ${subMode === OneClickSubMode.MAIN_IMAGE ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fas fa-magic text-sm"></i>
          <span className="text-sm font-black">一键主图生成</span>
        </button>
        <button 
          onClick={() => setSubMode(OneClickSubMode.DETAIL_PAGE)}
          className={`flex items-center gap-2 py-2 border-b-2 transition-all ${subMode === OneClickSubMode.DETAIL_PAGE ? 'border-rose-600 text-rose-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
        >
          <i className="fas fa-layer-group text-sm"></i>
          <span className="text-sm font-black">一键详情生成</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        <div className={`h-full w-full flex overflow-hidden ${subMode === OneClickSubMode.MAIN_IMAGE ? '' : 'hidden'}`}>
          <MainImageSubModule 
            apiConfig={apiConfig} 
            state={persistentState.mainImage}
            onUpdate={updateMainImageState}
            onSyncConfig={handleSyncToMain}
            onClearConfig={handleClearMainConfig}
            onProcessingChange={setIsProcessing} 
          />
        </div>
        <div className={`h-full w-full flex overflow-hidden ${subMode === OneClickSubMode.DETAIL_PAGE ? '' : 'hidden'}`}>
          <DetailPageSubModule
            apiConfig={apiConfig}
            state={persistentState.detailPage}
            onUpdate={updateDetailPageState}
            onSyncConfig={handleSyncToDetail}
            onClearConfig={handleClearDetailConfig}
            onProcessingChange={setIsProcessing}
          />
        </div>
      </div>
    </div>
  );
};

export default OneClickModule;
