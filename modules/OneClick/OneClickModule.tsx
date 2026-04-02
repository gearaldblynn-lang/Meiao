import React, { useState } from 'react';
import { GlobalApiConfig, OneClickSubMode, OneClickPersistentState } from '../../types';
import MainImageSubModule from './MainImageSubModule';
import DetailPageSubModule from './DetailPageSubModule';
import SkuSubModule from './SkuSubModule';
import { useToast } from '../../components/ToastSystem';
import { createDefaultOneClickState } from '../../utils/appState';
import { logActionSuccess } from '../../services/loggingService';
import { releaseObjectURLs } from '../../utils/urlUtils';

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
    void logActionSuccess({
      module: 'one_click',
      action: 'sync_from_detail',
      message: '同步主图配置信息到详情页',
      meta: {
        source: 'main_image',
        target: 'detail_page',
      },
    });
    addToast('已将主图的公共配置同步到详情', 'success');
  };

  const handleSyncToMain = () => {
    onStateChange(prev => ({
      ...prev,
      mainImage: syncSharedFieldsToMain(prev.detailPage, prev.mainImage),
    }));
    void logActionSuccess({
      module: 'one_click',
      action: 'sync_from_main',
      message: '同步详情配置信息到主图页',
      meta: {
        source: 'detail_page',
        target: 'main_image',
      },
    });
    addToast('已将详情的公共配置同步到主图', 'success');
  };

  const handleClearMainConfig = () => {
    releaseObjectURLs([
      ...persistentState.mainImage.productImages,
      persistentState.mainImage.styleImage,
    ]);
    onStateChange(prev => ({
      ...prev,
      mainImage: {
        ...defaultOneClickState.mainImage,
        schemes: [],
      }
    }));
    void logActionSuccess({
      module: 'one_click',
      action: 'clear_main_config',
      message: '清空主图配置信息',
      meta: {
        target: 'main_image',
      },
    });
    addToast('已清空主图配置信息', 'success');
  };

  const handleClearDetailConfig = () => {
    releaseObjectURLs([
      ...persistentState.detailPage.productImages,
      persistentState.detailPage.styleImage,
    ]);
    onStateChange(prev => ({
      ...prev,
      detailPage: {
        ...defaultOneClickState.detailPage,
        schemes: [],
      }
    }));
    void logActionSuccess({
      module: 'one_click',
      action: 'clear_detail_config',
      message: '清空详情配置信息',
      meta: {
        target: 'detail_page',
      },
    });
    addToast('已清空详情配置信息', 'success');
  };

  const updateSkuState = (updates: Partial<OneClickPersistentState['sku']> | ((prev: OneClickPersistentState['sku']) => OneClickPersistentState['sku'])) => {
    onStateChange(prev => {
      const current = prev.sku;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      return { ...prev, sku: { ...current, ...finalUpdates } };
    });
  };

  const handleClearSkuConfig = () => {
    onStateChange(prev => ({
      ...prev,
      sku: { ...defaultOneClickState.sku, schemes: [] },
    }));
    void logActionSuccess({
      module: 'one_click',
      action: 'clear_sku_config',
      message: '清空SKU配置信息',
      meta: { target: 'sku' },
    });
    addToast('已清空SKU配置信息', 'success');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-6 pb-6 pt-5">
      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[32px] border border-white/70 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <div className={`h-full w-full flex overflow-hidden ${subMode === OneClickSubMode.MAIN_IMAGE ? '' : 'hidden'}`}>
          <MainImageSubModule 
            apiConfig={apiConfig} 
            state={persistentState.mainImage}
            onUpdate={updateMainImageState}
            onSyncConfig={handleSyncToMain}
            onClearConfig={handleClearMainConfig}
            onProcessingChange={setIsProcessing}
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
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
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
          />
        </div>
        <div className={`h-full w-full flex overflow-hidden ${subMode === OneClickSubMode.SKU ? '' : 'hidden'}`}>
          <SkuSubModule
            apiConfig={apiConfig}
            state={persistentState.sku}
            onUpdate={updateSkuState}
            onClearConfig={handleClearSkuConfig}
            onProcessingChange={setIsProcessing}
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
          />
        </div>
      </div>
    </div>
  );
};

export default OneClickModule;
