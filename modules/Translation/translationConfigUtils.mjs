const createBaseConfig = () => ({
  targetLanguage: 'English',
  customLanguage: '',
  removeWatermark: true,
  aspectRatio: 'auto',
  quality: '1k',
  model: 'nano-banana-2',
  resolutionMode: 'custom',
  targetWidth: 1200,
  targetHeight: 1200,
  maxFileSize: 2.0,
});

export const createDefaultTranslationConfigs = () => ({
  main: {
    ...createBaseConfig(),
    aspectRatio: '1:1',
    targetWidth: 800,
    targetHeight: 800,
  },
  detail: {
    ...createBaseConfig(),
    aspectRatio: 'auto',
    targetWidth: 750,
    targetHeight: 0,
  },
  removeText: {
    ...createBaseConfig(),
    aspectRatio: 'auto',
    targetWidth: 1200,
    targetHeight: 0,
  },
});

const sanitizeConfig = (config, fallback) => {
  if (!config || typeof config !== 'object') return { ...fallback };
  return {
    ...fallback,
    ...config,
  };
};

export const migrateLegacyTranslationConfigs = (legacyConfig, existingConfigs = null) => {
  const defaults = createDefaultTranslationConfigs();
  const mainSeed = sanitizeConfig(legacyConfig, defaults.main);
  const sharedDetailSeed = {
    ...defaults.detail,
    targetLanguage: mainSeed.targetLanguage,
    customLanguage: mainSeed.customLanguage,
    removeWatermark: mainSeed.removeWatermark,
    quality: mainSeed.quality,
    model: mainSeed.model,
    maxFileSize: mainSeed.maxFileSize,
  };
  const sharedRemoveTextSeed = {
    ...defaults.removeText,
    targetLanguage: mainSeed.targetLanguage,
    customLanguage: mainSeed.customLanguage,
    removeWatermark: mainSeed.removeWatermark,
    quality: mainSeed.quality,
    model: mainSeed.model,
    maxFileSize: mainSeed.maxFileSize,
  };

  return {
    main: sanitizeConfig(existingConfigs?.main || mainSeed, mainSeed),
    detail: sanitizeConfig(existingConfigs?.detail, sharedDetailSeed),
    removeText: sanitizeConfig(existingConfigs?.removeText, sharedRemoveTextSeed),
  };
};

export const getTranslationConfigForSubMode = (configs, subMode) => {
  const safeConfigs = migrateLegacyTranslationConfigs(null, configs);
  if (subMode === 'detail') return safeConfigs.detail;
  if (subMode === 'remove_text') return safeConfigs.removeText;
  return safeConfigs.main;
};

export const getLegacyTranslationModuleConfig = (configs) => {
  return getTranslationConfigForSubMode(configs, 'main');
};

export const updateTranslationConfigForSubMode = (configs, subMode, nextConfig) => {
  const safeConfigs = migrateLegacyTranslationConfigs(null, configs);
  if (subMode === 'detail') {
    return { ...safeConfigs, detail: nextConfig };
  }
  if (subMode === 'remove_text') {
    return { ...safeConfigs, removeText: nextConfig };
  }
  return { ...safeConfigs, main: nextConfig };
};

export const shouldValidateTranslationAspectRatio = (config, subMode) => {
  return subMode === 'main' && config?.resolutionMode === 'custom' && config?.aspectRatio && config.aspectRatio !== 'auto';
};
