import React, { useState } from 'react';
import { GlobalApiConfig, OneClickReferencePreset, OneClickSubMode, OneClickPersistentState, OneClickWorkspaceProject, SkuWorkspaceProject } from '../../types';
import FirstImageSubModule from './FirstImageSubModule';
import MainImageSubModule from './MainImageSubModule';
import DetailPageSubModule from './DetailPageSubModule';
import SkuSubModule from './SkuSubModule';
import { useToast } from '../../components/ToastSystem';
import ConfirmDialog from '../../components/ConfirmDialog';
import { createDefaultOneClickState } from '../../utils/appState';
import { logActionSuccess } from '../../services/loggingService';
import { releaseObjectURLs } from '../../utils/urlUtils';
import { applyReferencePresetToState, createReferencePresetFromState, createReferencePresetsFromFirstImageState, deleteReferencePreset, upsertReferencePreset } from './referencePresetUtils.mjs';

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: OneClickPersistentState;
  onStateChange: React.Dispatch<React.SetStateAction<OneClickPersistentState>>;
}

const createProjectId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const hasMainLikeContent = (state: OneClickPersistentState['firstImage'] | OneClickPersistentState['mainImage'] | OneClickPersistentState['detailPage']) =>
  state.schemes.length > 0
  || state.productImages.length > 0
  || state.uploadedProductUrls.length > 0
  || state.designReferences.length > 0
  || state.uploadedDesignReferenceUrls.length > 0
  || Boolean(state.logoImage || state.uploadedLogoUrl || state.config.description.trim());

const hasSkuContent = (state: OneClickPersistentState['sku']) =>
  state.schemes.length > 0
  || state.images.length > 0
  || state.uploadedProductUrls.length > 0
  || state.designReferences.length > 0
  || state.uploadedDesignReferenceUrls.length > 0
  || Boolean(state.config.productInfo.trim());

const cloneReferenceItems = <T extends { id: string; file: File | null; uploadedUrl: string | null }>(items: T[]) =>
  items.map((item) => ({ ...item }));

const cloneMainLikeProject = (
  state: OneClickPersistentState['firstImage'] | OneClickPersistentState['mainImage'] | OneClickPersistentState['detailPage'],
  projectId: string,
  name: string,
  createdAt: number,
  meta?: Partial<OneClickWorkspaceProject>,
): OneClickWorkspaceProject => ({
  id: projectId,
  name,
  createdAt,
  updatedAt: meta?.updatedAt ?? createdAt,
  isDraft: meta?.isDraft,
  productImages: [...state.productImages],
  logoImage: state.logoImage,
  uploadedLogoUrl: state.uploadedLogoUrl,
  styleImage: state.styleImage,
  designReferences: cloneReferenceItems(state.designReferences),
  uploadedDesignReferenceUrls: [...state.uploadedDesignReferenceUrls],
  referenceDimensions: [...state.referenceDimensions],
  referenceAnalysis: { ...state.referenceAnalysis },
  schemes: state.schemes.map((scheme) => ({ ...scheme })),
  config: { ...state.config },
  lastStyleUrl: state.lastStyleUrl,
  uploadedProductUrls: [...state.uploadedProductUrls],
  directions: [...state.directions],
});

const cloneSkuProject = (
  state: OneClickPersistentState['sku'],
  projectId: string,
  name: string,
  createdAt: number,
  meta?: Partial<SkuWorkspaceProject>,
): SkuWorkspaceProject => ({
  id: projectId,
  name,
  createdAt,
  updatedAt: meta?.updatedAt ?? createdAt,
  isDraft: meta?.isDraft,
  images: state.images.map((image) => ({ ...image })),
  designReferences: cloneReferenceItems(state.designReferences),
  uploadedDesignReferenceUrls: [...state.uploadedDesignReferenceUrls],
  referenceDimensions: [...state.referenceDimensions],
  referenceAnalysis: { ...state.referenceAnalysis },
  schemes: state.schemes.map((scheme) => ({ ...scheme })),
  config: {
    ...state.config,
    combinations: state.config.combinations.map((item) => ({ ...item })),
  },
  firstSkuResultUrl: state.firstSkuResultUrl,
  uploadedProductUrls: [...state.uploadedProductUrls],
  lastStyleUrl: state.lastStyleUrl,
});

const applyMainLikeProject = (
  state: OneClickPersistentState['firstImage'] | OneClickPersistentState['mainImage'] | OneClickPersistentState['detailPage'],
  project: OneClickWorkspaceProject,
) => ({
  ...state,
  productImages: [...project.productImages],
  logoImage: project.logoImage,
  uploadedLogoUrl: project.uploadedLogoUrl,
  styleImage: project.styleImage,
  designReferences: cloneReferenceItems(project.designReferences),
  uploadedDesignReferenceUrls: [...project.uploadedDesignReferenceUrls],
  referenceDimensions: [...project.referenceDimensions],
  referenceAnalysis: { ...project.referenceAnalysis },
  schemes: project.schemes.map((scheme) => ({ ...scheme })),
  config: { ...project.config },
  lastStyleUrl: project.lastStyleUrl,
  uploadedProductUrls: [...project.uploadedProductUrls],
  directions: [...project.directions],
  activeProjectId: project.id,
});

const applySkuProject = (state: OneClickPersistentState['sku'], project: SkuWorkspaceProject) => ({
  ...state,
  images: project.images.map((image) => ({ ...image })),
  designReferences: cloneReferenceItems(project.designReferences),
  uploadedDesignReferenceUrls: [...project.uploadedDesignReferenceUrls],
  referenceDimensions: [...project.referenceDimensions],
  referenceAnalysis: { ...project.referenceAnalysis },
  schemes: project.schemes.map((scheme) => ({ ...scheme })),
  config: {
    ...project.config,
    combinations: project.config.combinations.map((item) => ({ ...item })),
  },
  firstSkuResultUrl: project.firstSkuResultUrl,
  uploadedProductUrls: [...project.uploadedProductUrls],
  lastStyleUrl: project.lastStyleUrl,
  activeProjectId: project.id,
});

const OneClickModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  const [subMode, setSubMode] = useState<OneClickSubMode>(OneClickSubMode.FIRST_IMAGE);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmState, setConfirmState] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  }>(null);
  const { addToast } = useToast();
  const defaultOneClickState = createDefaultOneClickState();

  const updateReferencePresets = (updater: (prev: OneClickPersistentState['referencePresets']) => OneClickPersistentState['referencePresets']) => {
    onStateChange(prev => ({
      ...prev,
      referencePresets: updater(prev.referencePresets || defaultOneClickState.referencePresets),
    }));
  };

  const handleCreateReferencePreset = (preset: OneClickReferencePreset) => {
    updateReferencePresets(prev => ({ ...prev, presets: upsertReferencePreset(prev.presets, preset) }));
    addToast('已新增预设', 'success');
  };

  const handleCreateReferencePresetBatch = (presets: OneClickReferencePreset[]) => {
    updateReferencePresets(prev => ({
      ...prev,
      presets: presets.reduce((current, preset) => upsertReferencePreset(current, preset), prev.presets),
    }));
    addToast(`已保存 ${presets.length} 个预设`, 'success');
  };

  const handleUpdateReferencePreset = (preset: OneClickReferencePreset) => {
    updateReferencePresets(prev => ({ ...prev, presets: upsertReferencePreset(prev.presets, preset) }));
    addToast('已更新预设', 'success');
  };

  const handleDeleteReferencePreset = (id: string) => {
    updateReferencePresets(prev => ({ ...prev, presets: deleteReferencePreset(prev.presets, id) }));
    addToast('已删除预设', 'success');
  };

  const applyPresetForSubMode = (targetSubMode: OneClickSubMode, preset: OneClickReferencePreset) => {
    if (targetSubMode === OneClickSubMode.FIRST_IMAGE) {
      updateFirstImageState((prev) => applyReferencePresetToState({ ...preset, subMode: targetSubMode }, prev));
      addToast('已应用首图参考预设', 'success');
      return;
    }
    if (targetSubMode === OneClickSubMode.MAIN_IMAGE) {
      updateMainImageState((prev) => applyReferencePresetToState({ ...preset, subMode: targetSubMode }, prev));
      addToast('已应用主图参考预设', 'success');
      return;
    }
    if (targetSubMode === OneClickSubMode.DETAIL_PAGE) {
      updateDetailPageState((prev) => applyReferencePresetToState({ ...preset, subMode: targetSubMode }, prev));
      addToast('已应用详情参考预设', 'success');
      return;
    }
    updateSkuState((prev) => applyReferencePresetToState({ ...preset, subMode: targetSubMode }, prev));
    addToast('已应用 SKU 参考预设', 'success');
  };

  const saveCurrentPreset = (targetSubMode: OneClickSubMode) => {
    if (targetSubMode === OneClickSubMode.FIRST_IMAGE) {
      const presets = createReferencePresetsFromFirstImageState({
        namePrefix: '首图主图参考预设',
        state: persistentState.firstImage,
      }) as OneClickReferencePreset[];
      if (presets.length === 0) {
        addToast('当前没有可保存的主图参考，请先上传主图参考。', 'warning');
        return;
      }
      handleCreateReferencePresetBatch(presets);
      return;
    }

    const sourceState = targetSubMode === OneClickSubMode.MAIN_IMAGE
        ? persistentState.mainImage
        : targetSubMode === OneClickSubMode.DETAIL_PAGE
          ? persistentState.detailPage
          : persistentState.sku;

    const defaultName = targetSubMode === OneClickSubMode.MAIN_IMAGE
        ? '主图参考预设'
        : targetSubMode === OneClickSubMode.DETAIL_PAGE
          ? '详情参考预设'
          : 'SKU参考预设';

    const preset = createReferencePresetFromState({
      subMode: targetSubMode,
      name: defaultName,
      state: sourceState,
    }) as OneClickReferencePreset;

    if (!preset.referenceImageUrls.length) {
      addToast('当前没有可保存的参考图，请先补充参考图。', 'warning');
      return;
    }

    handleCreateReferencePreset(preset);
  };

  const syncActiveMainLikeProject = (
    state: OneClickPersistentState['firstImage'] | OneClickPersistentState['mainImage'] | OneClickPersistentState['detailPage'],
  ) => {
    if (!state.activeProjectId) return state.projects;
    return state.projects.map((project) => (
      project.id === state.activeProjectId
        ? cloneMainLikeProject(state as any, project.id, project.name, project.createdAt, {
            updatedAt: Date.now(),
            isDraft: state.schemes.length > 0 ? false : project.isDraft,
          })
        : project
    ));
  };

  const syncActiveSkuProject = (state: OneClickPersistentState['sku']) => {
    if (!state.activeProjectId) return state.projects;
    return state.projects.map((project) => (
      project.id === state.activeProjectId
        ? cloneSkuProject(state, project.id, project.name, project.createdAt, {
            updatedAt: Date.now(),
            isDraft: state.schemes.length > 0 ? false : project.isDraft,
          })
        : project
    ));
  };

  // 使用函数式更新确保并发安全
  const updateFirstImageState = (updates: Partial<OneClickPersistentState['firstImage']> | ((prev: OneClickPersistentState['firstImage']) => OneClickPersistentState['firstImage'])) => {
    onStateChange(prev => {
      const current = prev.firstImage;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      const nextState = { ...current, ...finalUpdates };
      return {
        ...prev,
        firstImage: { ...nextState, projects: syncActiveMainLikeProject(nextState) }
      };
    });
  };

  const updateMainImageState = (updates: Partial<OneClickPersistentState['mainImage']> | ((prev: OneClickPersistentState['mainImage']) => OneClickPersistentState['mainImage'])) => {
    onStateChange(prev => {
      const current = prev.mainImage;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      const nextState = { ...current, ...finalUpdates };
      return {
        ...prev,
        mainImage: { ...nextState, projects: syncActiveMainLikeProject(nextState) }
      };
    });
  };

  const updateDetailPageState = (updates: Partial<OneClickPersistentState['detailPage']> | ((prev: OneClickPersistentState['detailPage']) => OneClickPersistentState['detailPage'])) => {
    onStateChange(prev => {
      const current = prev.detailPage;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      const nextState = { ...current, ...finalUpdates };
      return {
        ...prev,
        detailPage: { ...nextState, projects: syncActiveMainLikeProject(nextState) }
      };
    });
  };

  const updateSkuState = (updates: Partial<OneClickPersistentState['sku']> | ((prev: OneClickPersistentState['sku']) => OneClickPersistentState['sku'])) => {
    onStateChange(prev => {
      const current = prev.sku;
      const finalUpdates = typeof updates === 'function' ? updates(current) : updates;
      const nextState = { ...current, ...finalUpdates };
      return {
        ...prev,
        sku: { ...nextState, projects: syncActiveSkuProject(nextState) }
      };
    });
  };

  const buildNextProjectName = (prefix: string, names: string[]) => {
    let index = 1;
    let nextName = `${prefix}项目 ${index}`;
    while (names.includes(nextName)) {
      index += 1;
      nextName = `${prefix}项目 ${index}`;
    }
    return nextName;
  };

  const prepareFreshMainLikeProject = (
    key: 'firstImage' | 'mainImage' | 'detailPage',
    prefix: string,
  ) => {
    onStateChange((prev) => {
      const current = prev[key];
      const names = current.projects.map((item) => item.name);
      const nextProjects = syncActiveMainLikeProject(current);
      if (!current.activeProjectId && hasMainLikeContent(current) && nextProjects.length === 0) {
        nextProjects.push(cloneMainLikeProject(current, createProjectId(prefix), buildNextProjectName(prefix, names), Date.now()));
      }
      const now = Date.now();
      const newProject = cloneMainLikeProject(
        {
          ...current,
          schemes: [],
          directions: [],
        },
        createProjectId(prefix),
        buildNextProjectName(prefix, [...names, ...nextProjects.map((item) => item.name)]),
        now,
        { isDraft: true, updatedAt: now },
      );
      const nextState = {
        ...current,
        ...newProject,
        projects: [...nextProjects, newProject],
        activeProjectId: newProject.id,
      };
      return { ...prev, [key]: nextState };
    });
  };

  const prepareFreshSkuProject = (prefix: string) => {
    onStateChange((prev) => {
      const current = prev.sku;
      const names = current.projects.map((item) => item.name);
      const nextProjects = syncActiveSkuProject(current);
      if (!current.activeProjectId && hasSkuContent(current) && nextProjects.length === 0) {
        nextProjects.push(cloneSkuProject(current, createProjectId(prefix), buildNextProjectName(prefix, names), Date.now()));
      }
      const now = Date.now();
      const newProject = cloneSkuProject(
        {
          ...current,
          schemes: [],
          firstSkuResultUrl: null,
        },
        createProjectId(prefix),
        buildNextProjectName(prefix, [...names, ...nextProjects.map((item) => item.name)]),
        now,
        { isDraft: true, updatedAt: now },
      );
      const nextState = {
        ...current,
        ...newProject,
        projects: [...nextProjects, newProject],
        activeProjectId: newProject.id,
      };
      return { ...prev, sku: nextState };
    });
  };

  const selectMainLikeProject = (key: 'firstImage' | 'mainImage' | 'detailPage', projectId: string) => {
    onStateChange((prev) => {
      const current = prev[key];
      const project = syncActiveMainLikeProject(current).find((item) => item.id === projectId);
      if (!project) return prev;
      return {
        ...prev,
        [key]: {
          ...applyMainLikeProject(current, project),
          projects: syncActiveMainLikeProject(current),
        },
      };
    });
  };

  const selectSkuProject = (projectId: string) => {
    onStateChange((prev) => {
      const current = prev.sku;
      const project = syncActiveSkuProject(current).find((item) => item.id === projectId);
      if (!project) return prev;
      return {
        ...prev,
        sku: {
          ...applySkuProject(current, project),
          projects: syncActiveSkuProject(current),
        },
      };
    });
  };

  const deleteActiveMainLikeProject = (key: 'firstImage' | 'mainImage' | 'detailPage') => {
    deleteMainLikeProject(key, persistentState[key].activeProjectId);
  };

  const deleteMainLikeProject = (key: 'firstImage' | 'mainImage' | 'detailPage', projectId?: string | null) => {
    onStateChange((prev) => {
      const current = prev[key];
      const targetProjectId = projectId || current.activeProjectId;
      if (!targetProjectId) return prev;
      const remaining = syncActiveMainLikeProject(current).filter((item) => item.id !== targetProjectId);
      if (remaining.length === 0) {
        return {
          ...prev,
          [key]: {
            ...defaultOneClickState[key],
            projects: [],
            activeProjectId: null,
          },
        };
      }
      const fallback = remaining[remaining.length - 1];
      const nextProjectState = current.activeProjectId === targetProjectId
        ? {
            ...applyMainLikeProject(current, fallback),
            projects: remaining,
            activeProjectId: fallback.id,
          }
        : {
            ...current,
            projects: remaining,
          };
      return {
        ...prev,
        [key]: nextProjectState,
      };
    });
  };

  const deleteActiveSkuProject = () => {
    deleteSkuProject(persistentState.sku.activeProjectId);
  };

  const deleteSkuProject = (projectId?: string | null) => {
    onStateChange((prev) => {
      const current = prev.sku;
      const targetProjectId = projectId || current.activeProjectId;
      if (!targetProjectId) return prev;
      const remaining = syncActiveSkuProject(current).filter((item) => item.id !== targetProjectId);
      if (remaining.length === 0) {
        return {
          ...prev,
          sku: {
            ...defaultOneClickState.sku,
            projects: [],
            activeProjectId: null,
          },
        };
      }
      const fallback = remaining[remaining.length - 1];
      const nextProjectState = current.activeProjectId === targetProjectId
        ? {
            ...applySkuProject(current, fallback),
            projects: remaining,
            activeProjectId: fallback.id,
          }
        : {
            ...current,
            projects: remaining,
          };
      return {
        ...prev,
        sku: nextProjectState,
      };
    });
  };

  const requestDeleteMainLikeProject = (
    key: 'firstImage' | 'mainImage' | 'detailPage',
    label: string,
    projectId?: string | null,
  ) => {
    const current = persistentState[key];
    const targetProjectId = projectId || current.activeProjectId;
    if (!targetProjectId) return;
    const targetProject = current.projects.find((item) => item.id === targetProjectId);
    const projectName = targetProject?.name || `${label}项目`;
    setConfirmState({
      title: `确认删除${label}项目`,
      message: `确定要删除“${projectName}”吗？该项目下的方案和结果将一并移除，此操作不可撤销。`,
      confirmLabel: '确认删除',
      onConfirm: () => {
        setConfirmState(null);
        deleteMainLikeProject(key, targetProjectId);
        addToast(`已删除${label}项目`, 'success');
      },
    });
  };

  const requestDeleteSkuProject = (projectId?: string | null) => {
    const current = persistentState.sku;
    const targetProjectId = projectId || current.activeProjectId;
    if (!targetProjectId) return;
    const targetProject = current.projects.find((item) => item.id === targetProjectId);
    const projectName = targetProject?.name || 'SKU项目';
    setConfirmState({
      title: '确认删除SKU项目',
      message: `确定要删除“${projectName}”吗？该项目下的方案和结果将一并移除，此操作不可撤销。`,
      confirmLabel: '确认删除',
      onConfirm: () => {
        setConfirmState(null);
        deleteSkuProject(targetProjectId);
        addToast('已删除SKU项目', 'success');
      },
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
    logoImage: pickSyncValue(source.logoImage, target.logoImage),
    uploadedProductUrls: pickSyncValue(source.uploadedProductUrls, target.uploadedProductUrls),
    uploadedLogoUrl: pickSyncValue(source.uploadedLogoUrl, target.uploadedLogoUrl),
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
    logoImage: pickSyncValue(source.logoImage, target.logoImage),
    uploadedProductUrls: pickSyncValue(source.uploadedProductUrls, target.uploadedProductUrls),
    uploadedLogoUrl: pickSyncValue(source.uploadedLogoUrl, target.uploadedLogoUrl),
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

  const handleClearFirstImageConfig = () => {
    setConfirmState({
      title: '确认清空首图',
      message: '确定要清空首图的所有配置和方案吗？此操作不可撤销。',
      confirmLabel: '确认清空首图',
      onConfirm: () => {
        setConfirmState(null);
        releaseObjectURLs([
          ...persistentState.firstImage.productImages,
          persistentState.firstImage.logoImage,
          persistentState.firstImage.styleImage,
          ...persistentState.firstImage.designReferences.map((item) => item.file),
        ]);
        onStateChange(prev => ({
          ...prev,
          firstImage: {
            ...defaultOneClickState.firstImage,
            schemes: [],
          }
        }));
        void logActionSuccess({
          module: 'one_click',
          action: 'clear_first_image_config',
          message: '清空首图配置信息',
          meta: {
            target: 'first_image',
          },
        });
        addToast('已清空首图配置信息', 'success');
      },
    });
  };

  const handleClearMainConfig = () => {
    setConfirmState({
      title: '确认清空主图',
      message: '确定要清空主图的所有配置和方案吗？此操作不可撤销。',
      confirmLabel: '确认清空主图',
      onConfirm: () => {
        setConfirmState(null);
        releaseObjectURLs([
          ...persistentState.mainImage.productImages,
          persistentState.mainImage.logoImage,
          persistentState.mainImage.styleImage,
          ...persistentState.mainImage.designReferences.map((item) => item.file),
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
      },
    });
  };

  const handleClearDetailConfig = () => {
    setConfirmState({
      title: '确认清空详情',
      message: '确定要清空详情的所有配置和方案吗？此操作不可撤销。',
      confirmLabel: '确认清空详情',
      onConfirm: () => {
        setConfirmState(null);
        releaseObjectURLs([
          ...persistentState.detailPage.productImages,
          persistentState.detailPage.logoImage,
          persistentState.detailPage.styleImage,
          ...persistentState.detailPage.designReferences.map((item) => item.file),
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
      },
    });
  };

  const handleClearSkuConfig = () => {
    setConfirmState({
      title: '确认清空 SKU',
      message: '确定要清空 SKU 的所有配置和方案吗？此操作不可撤销。',
      confirmLabel: '确认清空 SKU',
      onConfirm: () => {
        setConfirmState(null);
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
      },
    });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-6 pb-6 pt-5">
      <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[32px] border border-white/70 shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        {subMode === OneClickSubMode.FIRST_IMAGE ? (
          <FirstImageSubModule
            apiConfig={apiConfig}
            state={persistentState.firstImage}
            onUpdate={updateFirstImageState}
            onClearConfig={handleClearFirstImageConfig}
            onPrepareFreshProject={() => prepareFreshMainLikeProject('firstImage', '首图')}
            onSelectProject={(projectId) => selectMainLikeProject('firstImage', projectId)}
            onDeleteActiveProject={() => requestDeleteMainLikeProject('firstImage', '首图')}
            onDeleteProject={(projectId) => requestDeleteMainLikeProject('firstImage', '首图', projectId)}
            onProcessingChange={setIsProcessing}
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
            referencePresets={persistentState.referencePresets || defaultOneClickState.referencePresets}
            onSaveReferencePreset={() => saveCurrentPreset(OneClickSubMode.FIRST_IMAGE)}
            onCreateReferencePreset={handleCreateReferencePreset}
            onUpdateReferencePreset={handleUpdateReferencePreset}
            onApplyReferencePreset={(preset) => applyPresetForSubMode(OneClickSubMode.FIRST_IMAGE, preset)}
            onDeleteReferencePreset={handleDeleteReferencePreset}
          />
        ) : null}
        {subMode === OneClickSubMode.MAIN_IMAGE ? (
          <MainImageSubModule 
            apiConfig={apiConfig} 
            state={persistentState.mainImage}
            onUpdate={updateMainImageState}
            onSyncConfig={handleSyncToMain}
            onClearConfig={handleClearMainConfig}
            onPrepareFreshProject={() => prepareFreshMainLikeProject('mainImage', '主图')}
            onSelectProject={(projectId) => selectMainLikeProject('mainImage', projectId)}
            onDeleteActiveProject={() => requestDeleteMainLikeProject('mainImage', '主图')}
            onDeleteProject={(projectId) => requestDeleteMainLikeProject('mainImage', '主图', projectId)}
            onProcessingChange={setIsProcessing}
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
            referencePresets={persistentState.referencePresets || defaultOneClickState.referencePresets}
            onSaveReferencePreset={() => saveCurrentPreset(OneClickSubMode.MAIN_IMAGE)}
            onCreateReferencePreset={handleCreateReferencePreset}
            onUpdateReferencePreset={handleUpdateReferencePreset}
            onApplyReferencePreset={(preset) => applyPresetForSubMode(OneClickSubMode.MAIN_IMAGE, preset)}
            onDeleteReferencePreset={handleDeleteReferencePreset}
          />
        ) : null}
        {subMode === OneClickSubMode.DETAIL_PAGE ? (
          <DetailPageSubModule
            apiConfig={apiConfig}
            state={persistentState.detailPage}
            onUpdate={updateDetailPageState}
            onSyncConfig={handleSyncToDetail}
            onClearConfig={handleClearDetailConfig}
            onPrepareFreshProject={() => prepareFreshMainLikeProject('detailPage', '详情')}
            onSelectProject={(projectId) => selectMainLikeProject('detailPage', projectId)}
            onDeleteActiveProject={() => requestDeleteMainLikeProject('detailPage', '详情')}
            onDeleteProject={(projectId) => requestDeleteMainLikeProject('detailPage', '详情', projectId)}
            onProcessingChange={setIsProcessing}
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
            referencePresets={persistentState.referencePresets || defaultOneClickState.referencePresets}
            onSaveReferencePreset={() => saveCurrentPreset(OneClickSubMode.DETAIL_PAGE)}
            onCreateReferencePreset={handleCreateReferencePreset}
            onUpdateReferencePreset={handleUpdateReferencePreset}
            onApplyReferencePreset={(preset) => applyPresetForSubMode(OneClickSubMode.DETAIL_PAGE, preset)}
            onDeleteReferencePreset={handleDeleteReferencePreset}
          />
        ) : null}
        {subMode === OneClickSubMode.SKU ? (
          <SkuSubModule
            apiConfig={apiConfig}
            state={persistentState.sku}
            onUpdate={updateSkuState}
            onClearConfig={handleClearSkuConfig}
            onPrepareFreshProject={() => prepareFreshSkuProject('SKU')}
            onSelectProject={selectSkuProject}
            onDeleteActiveProject={() => requestDeleteSkuProject()}
            onDeleteProject={(projectId) => requestDeleteSkuProject(projectId)}
            onProcessingChange={setIsProcessing}
            currentSubMode={subMode}
            onSubModeChange={setSubMode}
            referencePresets={persistentState.referencePresets || defaultOneClickState.referencePresets}
            onSaveReferencePreset={() => saveCurrentPreset(OneClickSubMode.SKU)}
            onCreateReferencePreset={handleCreateReferencePreset}
            onUpdateReferencePreset={handleUpdateReferencePreset}
            onApplyReferencePreset={(preset) => applyPresetForSubMode(OneClickSubMode.SKU, preset)}
            onDeleteReferencePreset={handleDeleteReferencePreset}
          />
        ) : null}
      </div>
      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel || '确认'}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => confirmState?.onConfirm()}
      />
    </div>
  );
};

export default OneClickModule;
