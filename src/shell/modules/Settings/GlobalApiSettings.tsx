import React, { useEffect, useMemo, useState } from 'react';
import AuthenticatedAssetImage from '../../../components/AuthenticatedAssetImage';
import { AlertCircle, Bell, CheckCircle2, KeyRound, Link2, LogIn, LogOut, Moon, RefreshCcw, Server, Shield, Trash2 } from 'lucide-react';
import { createDefaultWorkspacePreferences, loadPersistedAppState, savePersistedAppState, buildPersistedAppState } from '../../../utils/appState';
import {
  broadcastSystemAnalysisModel,
  checkDreaminaLogin,
  deleteSystemModelProvider,
  fetchDreaminaStatus,
  fetchSystemModelProviders,
  fetchSystemConfig,
  logoutDreamina,
  saveSystemModelProvider,
  startDreaminaLogin,
  testSystemModelProvider,
  updateCurrentUserAnalysisModel,
  updateSystemConfig,
} from '../../../services/internalApi';
import { PopoverSelect } from '../../../components/ui/workspacePrimitives';
import type { AuthUser, SystemPublicConfig, WorkspacePreferences } from '../../../types';
import type {
  DreaminaLoginStart,
  DreaminaStatus,
  SystemModelProvider,
  SystemModelProviderPreset,
  SystemModelProviderRegistry,
} from '../../../services/internalApi';

type ModelProviderFormState = {
  provider: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  credentialRef: string;
  modelsText: string;
  defaultModel: string;
  fallbackModel: string;
};

type SettingsSection = 'models' | 'services' | 'access' | 'notifications' | 'preferences';

type UnifiedModelAsset = {
  key: string;
  id: string;
  label: string;
  mode: string;
  provider: string;
  providerLabel: string;
  channel: string;
  configured: boolean;
  usages: string[];
  features: string[];
  runtimeTraits: string[];
  source: string;
};

type RuntimeModelLike = Partial<{
  id: string;
  label: string;
  provider: string;
  supportsToolUse: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsWebSearch: boolean;
  supportsReasoningLevel: boolean;
  supportsMultiImageInput: boolean;
  supportsImageEdit: boolean;
  supportsTransparentBackground: boolean;
  supportsAsyncTask: boolean;
  supportsStreaming: boolean;
  supportsCacheHit: boolean;
  supportsReferenceImage: boolean;
  supportsReferenceVideo: boolean;
  supportsAudioInput: boolean;
}>;

const emptyModelProviderForm: ModelProviderFormState = {
  provider: '',
  displayName: '',
  baseUrl: '',
  apiKey: '',
  credentialRef: '',
  modelsText: '',
  defaultModel: '',
  fallbackModel: '',
};

const formatProviderModelsText = (models: Array<{ id: string; mode?: string }> = []) => (
  models.map((model) => `${model.mode || 'chat'}:${model.id}`).join('\n')
);

const modelModeLabels: Record<string, string> = {
  chat: '对话',
  embedding: 'Embedding',
  rerank: 'Rerank',
  image: '图片',
  video: '视频',
};

const modelModeOrder = ['chat', 'image', 'video', 'embedding', 'rerank'];

const getProviderLogoText = (provider?: string, displayName?: string) => {
  const normalized = String(provider || displayName || '').toLowerCase();
  if (normalized.includes('openai')) return 'AI';
  if (normalized.includes('anthropic') || normalized.includes('claude')) return 'A';
  if (normalized.includes('google') || normalized.includes('gemini')) return 'G';
  if (normalized.includes('deepseek')) return 'D';
  if (normalized.includes('moonshot') || normalized.includes('kimi')) return 'M';
  if (normalized.includes('openrouter')) return 'OR';
  if (normalized.includes('kie')) return 'K';
  return (displayName || provider || 'M').slice(0, 2).toUpperCase();
};

const providerLabels: Record<string, string> = {
  kie: 'KIE 托管',
  apiports: 'APIports',
  openai_compatible: '中转/聚合',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  openrouter: 'OpenRouter',
};

const providerLogoStyles: Record<string, { bg: string; color: string; border?: string }> = {
  openai: { bg: '#ffffff', color: '#0f172a', border: 'rgba(15,23,42,0.12)' },
  anthropic: { bg: '#f4eadf', color: '#171717', border: 'rgba(23,23,23,0.10)' },
  google: { bg: '#ffffff', color: '#2563eb', border: 'rgba(15,23,42,0.12)' },
  gemini: { bg: '#ffffff', color: '#2563eb', border: 'rgba(15,23,42,0.12)' },
  deepseek: { bg: '#ffffff', color: '#1d4ed8', border: 'rgba(29,78,216,0.16)' },
  moonshot: { bg: '#ffffff', color: '#111827', border: 'rgba(15,23,42,0.12)' },
  openrouter: { bg: '#ffffff', color: '#4338ca', border: 'rgba(67,56,202,0.14)' },
  kie: { bg: '#ffffff', color: '#0891b2', border: 'rgba(8,145,178,0.16)' },
  apiports: { bg: '#ffffff', color: '#b45309', border: 'rgba(180,83,9,0.16)' },
  openai_compatible: { bg: '#ffffff', color: '#2563eb', border: 'rgba(37,99,235,0.16)' },
};

const getProviderLogoKey = (provider?: string, modelId?: string, displayName?: string) => {
  const source = `${provider || ''} ${modelId || ''} ${displayName || ''}`.toLowerCase();
  if (source.includes('claude') || source.includes('anthropic')) return 'anthropic';
  if (source.includes('gemini') || source.includes('nano-banana')) return 'gemini';
  if (source.includes('google')) return 'google';
  if (source.includes('deepseek')) return 'deepseek';
  if (source.includes('kimi') || source.includes('moonshot')) return 'moonshot';
  if (source.includes('openrouter')) return 'openrouter';
  if (source.includes('openai') || source.includes('gpt') || source.includes('text-embedding')) return 'openai';
  if (source.includes('compatible') || source.includes('relay') || source.includes('oneapi')) return 'openai_compatible';
  if (source.includes('apiports')) return 'apiports';
  if (source.includes('kie')) return 'kie';
  return provider || 'openai_compatible';
};

const providerLogoSources: Record<string, string> = {
  openai: '/model-logos/openai.svg',
  anthropic: '/model-logos/anthropic.svg',
  google: '/model-logos/google.svg',
  gemini: '/model-logos/gemini.svg',
  deepseek: '/model-logos/deepseek.svg',
  moonshot: '/model-logos/moonshot-k.svg',
  openrouter: '/model-logos/openrouter.svg',
  kie: '/model-logos/kie.ico',
  apiports: '/model-logos/apiports.svg',
};

const ProviderLogo: React.FC<{
  provider?: string;
  modelId?: string;
  displayName?: string;
  size?: 'sm' | 'md';
}> = ({ provider, modelId, displayName, size = 'md' }) => {
  const logoKey = getProviderLogoKey(provider, modelId, displayName);
  const style = providerLogoStyles[logoKey] || { bg: 'var(--bg-elevated)', color: 'var(--accent)' };
  const boxClass = size === 'sm' ? 'h-7 w-7 rounded-lg text-[9px]' : 'h-8 w-8 rounded-xl text-[10px]';
  const label = getProviderLogoText(logoKey, displayName || provider);
  const src = providerLogoSources[logoKey];

  if (src) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center overflow-hidden ${boxClass}`}
        style={{ background: style.bg, border: `1px solid ${style.border || 'transparent'}` }}
        aria-label={displayName || provider || label}
      >
        <AuthenticatedAssetImage src={src} alt="" className="h-[72%] w-[72%] object-contain" />
      </span>
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center font-black ${boxClass}`}
      style={{ background: style.bg, color: style.color, border: style.border ? `1px solid ${style.border}` : undefined }}
      aria-label={displayName || provider || label}
    >
      {label}
    </span>
  );
};

const toModelProviderForm = (
  provider?: Partial<SystemModelProvider & SystemModelProviderPreset> | null,
): ModelProviderFormState => ({
  provider: provider?.provider || '',
  displayName: provider?.displayName || '',
  baseUrl: provider?.baseUrl || '',
  apiKey: '',
  credentialRef: provider?.credentialRef || '',
  modelsText: formatProviderModelsText(provider?.models || []),
  defaultModel: provider?.defaultModel || provider?.models?.find((model) => (model.mode || 'chat') === 'chat')?.id || provider?.models?.[0]?.id || '',
  fallbackModel: provider?.fallbackModel || '',
});

const getModelIdsByMode = (modelsText: string, mode: string) => (
  modelsText
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [maybeMode, ...rest] = line.split(':');
      if (rest.length) return { mode: maybeMode.trim(), id: rest.join(':').trim() };
      return { mode: 'chat', id: line };
    })
    .filter((entry) => entry.mode === mode)
    .map((entry) => entry.id)
);

const featureLabels: Record<string, string> = {
  'tool-call': '工具调用',
  vision: '视觉',
  'structured-output': '结构化输出',
  reasoning: '推理',
  'long-context': '长上下文',
  embedding: 'Embedding',
  rerank: 'Rerank',
  'image-generation': '图片生成',
  'video-generation': '视频生成',
  moderation: '内容安全',
  speech2text: '语音识别',
  tts: '语音合成',
  'file-input': '文件',
  'web-search': '联网',
  'tool-use': '工具调用',
  'multi-image': '多图',
  'image-edit': '图片编辑',
  transparent: '透明背景',
  'reference-image': '参考图',
  'reference-video': '参考视频',
  'audio-input': '音频',
};

const getFeatureLabel = (feature: string) => featureLabels[feature] || feature;

const getModelOwnerLabel = (provider?: string, modelId?: string, displayName?: string) => {
  const logoKey = getProviderLogoKey(provider, modelId, displayName);
  if (logoKey === 'openai_compatible') return displayName || providerLabels.openai_compatible;
  return providerLabels[logoKey] || displayName || providerLabels[provider || ''] || provider || '未知厂商';
};

const formatModelAssetLabel = (modelId: string) => (
  modelId
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
);

const getRuntimeModelFeatures = (model: RuntimeModelLike) => {
  const features = new Set<string>();
  if (model.supportsToolUse) features.add('tool-use');
  if (model.supportsImageInput) features.add('vision');
  if (model.supportsFileInput) features.add('file-input');
  if (model.supportsWebSearch) features.add('web-search');
  if (model.supportsReasoningLevel) features.add('reasoning');
  if (model.supportsMultiImageInput) features.add('multi-image');
  if (model.supportsImageEdit) features.add('image-edit');
  if (model.supportsTransparentBackground) features.add('transparent');
  if (model.supportsReferenceImage) features.add('reference-image');
  if (model.supportsReferenceVideo) features.add('reference-video');
  if (model.supportsAudioInput) features.add('audio-input');
  return Array.from(features);
};

const buildModelRuntimeTraits = (
  mode: string,
  model: RuntimeModelLike = {},
  channel = '',
) => {
  if (mode === 'image' || mode === 'video') {
    return [
      model.supportsAsyncTask === false ? '同步返回' : '异步任务',
      '轮询结果',
      model.supportsStreaming ? '流式输出' : '流式不适用',
      model.supportsCacheHit ? '缓存命中' : '缓存不适用',
    ];
  }
  if (mode === 'embedding' || mode === 'rerank') {
    return ['RAG 调用', '批量请求', '流式不适用', model.supportsCacheHit ? '缓存命中' : '缓存不适用'];
  }
  if (mode === 'chat') {
    if (model.supportsStreaming === false || channel.includes('KIE')) {
      return [
        '非流式',
        '工具路由',
        model.supportsCacheHit ? '缓存命中' : '缓存不可见',
      ];
    }
    if (channel.includes('中转') || channel.includes('聚合')) {
      return ['流式对话', '工具调用', model.supportsCacheHit === false ? '缓存不可见' : '缓存命中视渠道'];
    }
    return ['流式对话', model.supportsCacheHit === false ? '缓存不可见' : '缓存命中视渠道'];
  }
  return ['按渠道能力'];
};

const mergeModelAsset = (assets: Map<string, UnifiedModelAsset>, next: Omit<UnifiedModelAsset, 'key'>) => {
  const key = `${next.mode}:${next.provider}:${next.id}`;
  const existing = assets.get(key);
  if (!existing) {
    assets.set(key, { ...next, key });
    return;
  }
  assets.set(key, {
    ...existing,
    configured: existing.configured || next.configured,
    usages: Array.from(new Set([...existing.usages, ...next.usages])),
    features: Array.from(new Set([...existing.features, ...next.features])),
    runtimeTraits: Array.from(new Set([...existing.runtimeTraits, ...next.runtimeTraits])),
    source: Array.from(new Set([existing.source, next.source].filter(Boolean))).join(' / '),
  });
};

const getProviderConfigured = (
  provider: string,
  systemConfig: SystemPublicConfig | null,
  modelProviderRows: SystemModelProvider[],
) => {
  const normalized = provider.toLowerCase();
  if (normalized === 'kie') return Boolean(systemConfig?.providers.kie.configured);
  if (normalized === 'apiports') return Boolean(systemConfig?.providers.apiports?.configured);
  if (normalized === 'openai_compatible') return Boolean(systemConfig?.systemSettings.openaiCompatible.configured);
  const row = modelProviderRows.find((item) => item.provider === provider);
  return Boolean(row?.hasCredential);
};

const buildUnifiedModelAssets = (
  systemConfig: SystemPublicConfig | null,
  modelProviderRows: SystemModelProvider[],
) => {
  const assets = new Map<string, UnifiedModelAsset>();

  (systemConfig?.agentModels.chat || []).forEach((model) => {
    const channel = model.provider === 'kie' ? 'KIE 托管' : '中转/聚合';
    mergeModelAsset(assets, {
      id: model.id,
      label: model.label || formatModelAssetLabel(model.id),
      mode: 'chat',
      provider: model.provider,
      providerLabel: getModelOwnerLabel(model.provider, model.id),
      channel,
      configured: getProviderConfigured(model.provider, systemConfig, modelProviderRows),
      usages: ['智能体对话', '策划分析'],
      features: getRuntimeModelFeatures(model),
      runtimeTraits: buildModelRuntimeTraits('chat', model, channel),
      source: model.provider === 'kie' ? 'KIE 运行目录' : '中转配置目录',
    });
  });

  (systemConfig?.videoAnalysisModels || []).forEach((model) => {
    mergeModelAsset(assets, {
      id: model.id,
      label: model.label || formatModelAssetLabel(model.id),
      mode: 'chat',
      provider: model.provider,
      providerLabel: getModelOwnerLabel(model.provider, model.id),
      channel: 'KIE 托管',
      configured: getProviderConfigured(model.provider, systemConfig, modelProviderRows),
      usages: ['视频分析'],
      features: getRuntimeModelFeatures(model),
      runtimeTraits: buildModelRuntimeTraits('chat', model, 'KIE 托管'),
      source: '视频分析目录',
    });
  });

  (systemConfig?.agentModels.image || []).forEach((model) => {
    const channel = model.provider === 'apiports' ? 'APIports 托管' : 'KIE 托管';
    mergeModelAsset(assets, {
      id: model.id,
      label: model.label || formatModelAssetLabel(model.id),
      mode: 'image',
      provider: model.provider,
      providerLabel: getModelOwnerLabel(model.provider, model.id),
      channel,
      configured: getProviderConfigured(model.provider, systemConfig, modelProviderRows),
      usages: ['图片生成', '图片编辑'],
      features: ['image-generation', ...getRuntimeModelFeatures(model)],
      runtimeTraits: buildModelRuntimeTraits('image', { ...model, supportsAsyncTask: true, supportsStreaming: false, supportsCacheHit: false }, channel),
      source: model.provider === 'apiports' ? 'APIports 图像目录' : 'KIE 图像目录',
    });
  });

  (systemConfig?.agentModels.video || []).forEach((model) => {
    mergeModelAsset(assets, {
      id: model.id,
      label: model.label || formatModelAssetLabel(model.id),
      mode: 'video',
      provider: model.provider,
      providerLabel: getModelOwnerLabel(model.provider, model.id),
      channel: 'KIE 托管',
      configured: getProviderConfigured(model.provider, systemConfig, modelProviderRows),
      usages: ['视频生成', '视频工作流'],
      features: ['video-generation', ...getRuntimeModelFeatures(model)],
      runtimeTraits: buildModelRuntimeTraits('video', model, 'KIE 托管'),
      source: 'KIE 视频目录',
    });
  });

  modelProviderRows.forEach((provider) => {
    provider.models.forEach((model) => {
      const mode = model.mode || 'chat';
      const channel = getProviderChannelKind(provider);
      const runtimeModel = {
        ...model,
        supportsStreaming: mode === 'chat' ? !provider.provider.toLowerCase().includes('kie') : false,
        supportsCacheHit: mode === 'chat' && !provider.provider.toLowerCase().includes('kie'),
        supportsAsyncTask: mode === 'image' || mode === 'video',
      };
      mergeModelAsset(assets, {
        id: model.id,
        label: formatModelAssetLabel(model.id),
        mode,
        provider: provider.provider,
        providerLabel: getModelOwnerLabel(provider.provider, model.id, provider.displayName),
        channel,
        configured: Boolean(provider.hasCredential),
        usages: [getModeUsageLabel(mode)],
        features: model.features || [],
        runtimeTraits: buildModelRuntimeTraits(mode, runtimeModel, channel),
        source: '模型渠道目录',
      });
    });
  });

  return Array.from(assets.values()).sort((a, b) => {
    const modeDiff = modelModeOrder.indexOf(a.mode) - modelModeOrder.indexOf(b.mode);
    if (modeDiff) return modeDiff;
    const providerDiff = a.providerLabel.localeCompare(b.providerLabel);
    if (providerDiff) return providerDiff;
    return a.label.localeCompare(b.label);
  });
};

const getProviderChannelKind = (provider: Pick<SystemModelProvider, 'provider' | 'baseUrl' | 'customBaseUrlRequired'>) => {
  const source = `${provider.provider || ''} ${provider.baseUrl || ''}`.toLowerCase();
  if (provider.customBaseUrlRequired || source.includes('compatible') || source.includes('relay') || source.includes('openrouter') || source.includes('oneapi')) return '中转/聚合';
  if (source.includes('kie')) return '专用能力';
  return '官方渠道';
};

const countModelModes = (models: SystemModelProvider['models']) => (
  models.reduce<Record<string, number>>((acc, model) => {
    const mode = model.mode || 'chat';
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {})
);

const dedupeModelProviders = (providers: SystemModelProvider[] = []) => {
  const byProvider = new Map<string, SystemModelProvider>();
  providers.forEach((provider) => {
    const existing = byProvider.get(provider.provider);
    if (!existing) {
      byProvider.set(provider.provider, provider);
      return;
    }
    const modelsByKey = new Map<string, SystemModelProvider['models'][number]>();
    [...existing.models, ...provider.models].forEach((model) => {
      modelsByKey.set(`${model.mode || 'chat'}:${model.id}`, model);
    });
    const models = Array.from(modelsByKey.values());
    byProvider.set(provider.provider, {
      ...existing,
      ...provider,
      displayName: provider.displayName || existing.displayName,
      baseUrl: provider.baseUrl || existing.baseUrl,
      hasCredential: Boolean(existing.hasCredential || provider.hasCredential),
      defaultModel: provider.defaultModel || existing.defaultModel,
      fallbackModel: provider.fallbackModel || existing.fallbackModel,
      models,
      capabilityCounts: countModelModes(models),
    });
  });
  const byVisibleConfig = new Map<string, SystemModelProvider>();
  Array.from(byProvider.values()).forEach((provider) => {
    const modelsKey = provider.models
      .map((model) => `${model.mode || 'chat'}:${model.id}`)
      .sort()
      .join(',');
    const visibleKey = [
      provider.displayName || provider.provider,
      provider.baseUrl || '',
      provider.defaultModel || '',
      modelsKey,
    ].join('|').toLowerCase();
    const existing = byVisibleConfig.get(visibleKey);
    if (!existing) {
      byVisibleConfig.set(visibleKey, provider);
      return;
    }
    byVisibleConfig.set(visibleKey, {
      ...existing,
      hasCredential: Boolean(existing.hasCredential || provider.hasCredential),
      fallbackModel: existing.fallbackModel || provider.fallbackModel,
    });
  });
  return Array.from(byVisibleConfig.values());
};

const getModeUsageLabel = (mode: string) => {
  if (mode === 'chat') return '智能体对话';
  if (mode === 'embedding' || mode === 'rerank') return '知识库 RAG';
  if (mode === 'image') return '图片工作流';
  if (mode === 'video') return '视频工作流';
  return '备用能力';
};

const Toggle: React.FC<{ label: string; desc: string; checked: boolean; onChange: (next: boolean) => void }> = ({ label, desc, checked, onChange }) => (
  <div className="flex items-center justify-between py-3">
    <div>
      <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
    </div>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-elevated)' }}
    >
      <div className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform" style={{ left: checked ? 22 : 2 }} />
    </button>
  </div>
);

const GlobalApiSettings: React.FC<{
  currentUser?: AuthUser | null;
  onCurrentUserChange?: (user: AuthUser) => void;
}> = ({ currentUser = null, onCurrentUserChange }) => {
  const persisted = useMemo(() => buildPersistedAppState(loadPersistedAppState()), []);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(
    persisted.apiConfig.workspacePreferences || createDefaultWorkspacePreferences(),
  );
  const [systemConfig, setSystemConfig] = useState<SystemPublicConfig | null>(null);
  const [loadingSystemConfig, setLoadingSystemConfig] = useState(false);
  const [systemConfigError, setSystemConfigError] = useState('');
  const [analysisModel, setAnalysisModel] = useState('');
  const [userAnalysisModel, setUserAnalysisModel] = useState('');
  const [videoAnalysisModel, setVideoAnalysisModel] = useState('');
  const [openaiCompatibleApiKey, setOpenaiCompatibleApiKey] = useState('');
  const [openaiCompatibleBaseUrl, setOpenaiCompatibleBaseUrl] = useState('');
  const [openaiCompatibleModels, setOpenaiCompatibleModels] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementContent, setAnnouncementContent] = useState('');
  const [savingAnalysisModel, setSavingAnalysisModel] = useState(false);
  const [savingUserAnalysisModel, setSavingUserAnalysisModel] = useState(false);
  const [savingOpenaiCompatible, setSavingOpenaiCompatible] = useState(false);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [broadcastingAnalysisModel, setBroadcastingAnalysisModel] = useState(false);
  const [analysisModelMessage, setAnalysisModelMessage] = useState('');
  const [openaiCompatibleMessage, setOpenaiCompatibleMessage] = useState('');
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [dreaminaStatus, setDreaminaStatus] = useState<DreaminaStatus | null>(null);
  const [dreaminaLogin, setDreaminaLogin] = useState<DreaminaLoginStart | null>(null);
  const [dreaminaLoading, setDreaminaLoading] = useState(false);
  const [dreaminaMessage, setDreaminaMessage] = useState('');
  const [modelProviderRegistry, setModelProviderRegistry] = useState<SystemModelProviderRegistry | null>(null);
  const [modelProviderPresets, setModelProviderPresets] = useState<SystemModelProviderPreset[]>([]);
  const [selectedModelProviderId, setSelectedModelProviderId] = useState('openai_compatible');
  const [modelProviderForm, setModelProviderForm] = useState<ModelProviderFormState>(emptyModelProviderForm);
  const [loadingModelProviders, setLoadingModelProviders] = useState(false);
  const [savingModelProvider, setSavingModelProvider] = useState(false);
  const [testingModelProvider, setTestingModelProvider] = useState(false);
  const [modelProviderMessage, setModelProviderMessage] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>('models');
  const [selectedModelMode, setSelectedModelMode] = useState('chat');
  const [modelProviderEditing, setModelProviderEditing] = useState(false);
  const canManageSystemSettings = currentUser?.role === 'admin';
  const applySystemConfig = (config: SystemPublicConfig) => {
    setSystemConfig(config);
    setAnalysisModel(config.systemSettings.analysisModel || '');
    setUserAnalysisModel(config.systemSettings.userAnalysisModel || '');
    setVideoAnalysisModel(config.systemSettings.videoAnalysisModel || '');
    setOpenaiCompatibleBaseUrl(config.systemSettings.openaiCompatible?.baseUrl || '');
    setOpenaiCompatibleModels(config.systemSettings.openaiCompatible?.models || '');
    setOpenaiCompatibleApiKey('');
    setAnnouncementTitle(config.systemSettings.announcement?.title || '');
    setAnnouncementContent(config.systemSettings.announcement?.content || '');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('meiao:system-config-updated', { detail: { config } }));
    }
  };

  useEffect(() => {
    let disposed = false;
    setLoadingSystemConfig(true);
    setSystemConfigError('');
    void fetchSystemConfig()
      .then((result) => {
        if (disposed) return;
        applySystemConfig(result.config);
      })
      .catch((error) => {
        if (disposed) return;
        setSystemConfigError(error instanceof Error ? error.message : '系统配置读取失败');
      })
      .finally(() => {
        if (!disposed) setLoadingSystemConfig(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('meiao:workspace-preferences-updated', { detail: preferences }));
  }, [preferences]);

  useEffect(() => {
    if (!canManageSystemSettings) return;
    let disposed = false;

    const loadDreaminaStatus = async () => {
      setDreaminaLoading(true);
      try {
        const result = await fetchDreaminaStatus();
        if (disposed) return;
        setDreaminaStatus(result.status);
        setDreaminaMessage(result.status.message || '');
      } catch (error) {
        if (disposed) return;
        setDreaminaMessage(error instanceof Error ? error.message : '即梦状态读取失败');
      } finally {
        if (!disposed) setDreaminaLoading(false);
      }
    };

    void loadDreaminaStatus();

    return () => {
      disposed = true;
    };
  }, [canManageSystemSettings]);

  useEffect(() => {
    if (!canManageSystemSettings || !dreaminaLogin?.deviceCode || dreaminaStatus?.authenticated) return undefined;
    let active = true;
    let inFlight = false;

    const refreshDreaminaStatus = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = await checkDreaminaLogin({ deviceCode: dreaminaLogin.deviceCode, poll: 5 });
        if (!active) return;
        setDreaminaStatus(result.status);
        if (result.login.authenticated || result.status.authenticated) {
          setDreaminaLogin(null);
          setDreaminaMessage('即梦登录已完成。');
        } else {
          setDreaminaMessage('正在等待网页登录完成，页面会自动检测状态。');
        }
      } catch (error) {
        if (!active) return;
        setDreaminaMessage(error instanceof Error ? error.message : '即梦状态刷新失败');
      } finally {
        inFlight = false;
      }
    };

    void refreshDreaminaStatus();
    const timer = window.setInterval(() => {
      void refreshDreaminaStatus();
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canManageSystemSettings, dreaminaLogin?.deviceCode, dreaminaStatus?.authenticated]);

  useEffect(() => {
    let disposed = false;
    setLoadingModelProviders(true);
    setModelProviderMessage('');
    void fetchSystemModelProviders()
      .then((result) => {
        if (disposed) return;
        const providers = result.registry.providers || [];
        const firstProvider = providers.find((provider) => provider.provider === selectedModelProviderId) || providers[0] || result.presets[0] || null;
        setModelProviderRegistry(result.registry);
        setModelProviderPresets(result.presets || []);
        setSelectedModelProviderId(firstProvider?.provider || '');
        setModelProviderForm(toModelProviderForm(firstProvider));
      })
      .catch((error) => {
        if (disposed) return;
        setModelProviderMessage(error instanceof Error ? error.message : '模型供应商读取失败');
      })
      .finally(() => {
        if (!disposed) setLoadingModelProviders(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const modelProviderRows = dedupeModelProviders(modelProviderRegistry?.providers || []);
  const unifiedModelAssets = buildUnifiedModelAssets(systemConfig, modelProviderRows);
  const allModelProvidersForManagement = modelProviderRows;
  const selectedModelProvider = modelProviderRows.find((provider) => provider.provider === selectedModelProviderId);
  const configuredModelProviderCount = modelProviderRows.filter((provider) => provider.baseUrl && provider.hasCredential).length;
  const chatModelIdsInDraft = getModelIdsByMode(modelProviderForm.modelsText, 'chat');
  const settingsCategories = [
    { id: 'models' as const, label: '模型中心', desc: '全部模型资产、渠道和全局模型策略' },
    { id: 'services' as const, label: '服务接入', desc: 'KIE 托管、即梦视频和外部服务状态' },
    { id: 'access' as const, label: '账号与权限', desc: '管理员配置与员工可见边界' },
    { id: 'notifications' as const, label: '通知公告', desc: '首次打开弹窗和站内通知' },
    { id: 'preferences' as const, label: '系统偏好', desc: '个人工作台行为与系统状态' },
  ];
  const selectedModeProviders = modelProviderRows.filter((provider) => (
    provider.models.some((model) => (model.mode || 'chat') === selectedModelMode)
      || Boolean(provider.capabilityCounts?.[selectedModelMode])
  ));
  const selectedModeModelCount = selectedModeProviders.reduce((total, provider) => (
    total + provider.models.filter((model) => (model.mode || 'chat') === selectedModelMode).length
  ), 0);
  const selectedModeAssets = unifiedModelAssets.filter((asset) => asset.mode === selectedModelMode);
  const totalModelCount = unifiedModelAssets.length;
  const modelModeStats = modelModeOrder.map((mode) => {
    const assets = unifiedModelAssets.filter((asset) => asset.mode === mode);
    const count = assets.length;
    const configured = assets.some((asset) => asset.configured);
    return {
      mode,
      count,
      label: modelModeLabels[mode] || mode,
      status: configured ? '可调用' : count ? '待密钥' : '未接入',
    };
  });
  const callableModelModeCount = modelModeStats.filter((item) => item.status === '可调用').length;
  const pendingModelModeCount = modelModeStats.filter((item) => item.status !== '可调用').length;
  const selectedProviderModels = selectedModelProvider?.models || [];
  const selectedProviderModeModels = selectedProviderModels.filter((model) => (model.mode || 'chat') === selectedModelMode);
  const selectedProviderFeatureText = Array.from(new Set(
    (selectedProviderModeModels.length ? selectedProviderModeModels : selectedProviderModels)
      .flatMap((model) => model.features || []),
  )).slice(0, 5).map(getFeatureLabel);

  const handleSelectModelProvider = (providerId: string) => {
    const provider = modelProviderRows.find((item) => item.provider === providerId)
      || modelProviderPresets.find((item) => item.provider === providerId)
      || null;
    setSelectedModelProviderId(provider?.provider || providerId);
    setModelProviderForm(toModelProviderForm(provider));
    setModelProviderMessage('');
    setModelProviderEditing(false);
  };

  const handleUseModelProviderPreset = (preset: SystemModelProviderPreset) => {
    setSelectedModelProviderId(preset.provider);
    setModelProviderForm(toModelProviderForm(preset));
    setModelProviderMessage('已载入供应商模板，保存后生效。');
    setModelProviderEditing(true);
  };

  const handleReloadModelProviders = async () => {
    setLoadingModelProviders(true);
    setModelProviderMessage('');
    try {
      const result = await fetchSystemModelProviders();
      const providers = result.registry.providers || [];
      const nextProvider = providers.find((provider) => provider.provider === selectedModelProviderId) || providers[0] || result.presets[0] || null;
      setModelProviderRegistry(result.registry);
      setModelProviderPresets(result.presets || []);
      setSelectedModelProviderId(nextProvider?.provider || '');
      setModelProviderForm(toModelProviderForm(nextProvider));
      setModelProviderEditing(false);
      setModelProviderMessage('模型列表已同步。');
    } catch (error) {
      setModelProviderMessage(error instanceof Error ? error.message : '模型供应商读取失败');
    } finally {
      setLoadingModelProviders(false);
    }
  };

  const handleSaveModelProvider = async () => {
    if (!canManageSystemSettings) {
      setModelProviderMessage('当前账号没有模型供应商管理权限。');
      return;
    }
    if (!modelProviderForm.provider.trim()) {
      setModelProviderMessage('请填写 Provider ID。');
      return;
    }
    setSavingModelProvider(true);
    setModelProviderMessage('');
    try {
      const result = await saveSystemModelProvider({
        provider: modelProviderForm.provider,
        displayName: modelProviderForm.displayName,
        baseUrl: modelProviderForm.baseUrl,
        apiKey: modelProviderForm.apiKey,
        credentialRef: modelProviderForm.credentialRef,
        modelsText: modelProviderForm.modelsText,
        defaultModel: modelProviderForm.defaultModel,
        fallbackModel: modelProviderForm.fallbackModel,
      });
      const savedProvider = result.registry.providers.find((provider) => provider.provider === modelProviderForm.provider) || result.registry.providers[0] || null;
      setModelProviderRegistry(result.registry);
      setSelectedModelProviderId(savedProvider?.provider || modelProviderForm.provider);
      setModelProviderForm(toModelProviderForm(savedProvider));
      setModelProviderEditing(false);
      setModelProviderMessage('模型供应商已保存，智能体配置会读取这份统一配置。');
    } catch (error) {
      setModelProviderMessage(error instanceof Error ? error.message : '保存模型供应商失败');
    } finally {
      setSavingModelProvider(false);
    }
  };

  const handleTestModelProvider = async () => {
    if (!canManageSystemSettings) {
      setModelProviderMessage('当前账号没有模型供应商测试权限。');
      return;
    }
    if (!modelProviderForm.provider.trim()) {
      setModelProviderMessage('请先选择或填写模型供应商。');
      return;
    }
    setTestingModelProvider(true);
    setModelProviderMessage('');
    try {
      const result = await testSystemModelProvider({
        provider: modelProviderForm.provider,
        displayName: modelProviderForm.displayName,
        baseUrl: modelProviderForm.baseUrl,
        apiKey: modelProviderForm.apiKey,
        credentialRef: modelProviderForm.credentialRef,
        modelsText: modelProviderForm.modelsText,
        defaultModel: modelProviderForm.defaultModel,
        fallbackModel: modelProviderForm.fallbackModel,
      });
      setModelProviderMessage(result.message || (result.ok ? '连接测试通过。' : '连接测试未通过。'));
    } catch (error) {
      setModelProviderMessage(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setTestingModelProvider(false);
    }
  };

  const handleDeleteModelProvider = async () => {
    if (!canManageSystemSettings) {
      setModelProviderMessage('当前账号没有模型供应商管理权限。');
      return;
    }
    if (!modelProviderForm.provider.trim()) {
      setModelProviderMessage('请先选择要删除的供应商。');
      return;
    }
    if (!window.confirm(`确认删除模型供应商 ${modelProviderForm.provider}？已绑定智能体会改用剩余可用模型。`)) return;
    setSavingModelProvider(true);
    setModelProviderMessage('');
    try {
      const result = await deleteSystemModelProvider(modelProviderForm.provider);
      const nextProvider = result.registry.providers[0] || modelProviderPresets[0] || null;
      setModelProviderRegistry(result.registry);
      setSelectedModelProviderId(nextProvider?.provider || '');
      setModelProviderForm(toModelProviderForm(nextProvider));
      setModelProviderEditing(false);
      setModelProviderMessage('模型供应商已删除。');
    } catch (error) {
      setModelProviderMessage(error instanceof Error ? error.message : '删除模型供应商失败');
    } finally {
      setSavingModelProvider(false);
    }
  };

  const preferenceRows = useMemo(() => ([
    { key: 'compressImagesBeforeUpload', label: '上传前压缩图片', desc: '在上传前自动压缩大体积图片' },
    { key: 'playSoundAfterGeneration', label: '生成完成后播放提示音', desc: '任务完成时播放声音提醒' },
    { key: 'showGenerationProgress', label: '显示生成进度条', desc: '在卡片上显示实时生成进度' },
  ] as const), []);

  const chatModelOptions = useMemo(() => [
    { value: '', label: '自动选择默认分析模型' },
    ...(systemConfig?.agentModels.chat || []).map((model) => ({
      value: model.id,
      label: model.label,
    })),
  ], [systemConfig?.agentModels.chat]);

  const videoAnalysisModelOptions = useMemo(() => [
    { value: '', label: '默认 Gemini 3 Flash（High）' },
    ...(systemConfig?.videoAnalysisModels || []).map((model) => ({
      value: model.id,
      label: model.label,
    })),
  ], [systemConfig?.videoAnalysisModels]);

  const handleSave = () => {
    const nextState = {
      ...persisted,
      apiConfig: {
        ...persisted.apiConfig,
        workspacePreferences: preferences,
      },
    };
    savePersistedAppState(nextState);
    window.dispatchEvent(new CustomEvent('meiao:workspace-preferences-updated', { detail: preferences }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveAnalysisModel = async () => {
    if (!canManageSystemSettings) {
      setAnalysisModelMessage('当前账号没有全局设置权限。');
      return;
    }
    setSavingAnalysisModel(true);
    setAnalysisModelMessage('');
    try {
      const result = await updateSystemConfig({ analysisModel, videoAnalysisModel });
      applySystemConfig(result.config);
      setAnalysisModelMessage('已保存全局模型设置。');
    } catch (error) {
      setAnalysisModelMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingAnalysisModel(false);
    }
  };

  const handleSaveOpenaiCompatible = async () => {
    if (!canManageSystemSettings) {
      setOpenaiCompatibleMessage('当前账号没有全局设置权限。');
      return;
    }
    setSavingOpenaiCompatible(true);
    setOpenaiCompatibleMessage('');
    try {
      const result = await updateSystemConfig({
        analysisModel,
        videoAnalysisModel,
        openaiCompatible: {
          apiKey: openaiCompatibleApiKey,
          baseUrl: openaiCompatibleBaseUrl,
          models: openaiCompatibleModels,
        },
      });
      applySystemConfig(result.config);
      setOpenaiCompatibleMessage('已保存 OpenAI Compatible 中转站配置。');
    } catch (error) {
      setOpenaiCompatibleMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingOpenaiCompatible(false);
    }
  };

  const handleSaveAnnouncement = async () => {
    if (!canManageSystemSettings) {
      setAnnouncementMessage('当前账号没有公告编辑权限。');
      return;
    }
    const title = announcementTitle.trim();
    const content = announcementContent.trim();
    if (!title || !content) {
      setAnnouncementMessage('请填写公告标题和内容。');
      return;
    }
    setSavingAnnouncement(true);
    setAnnouncementMessage('');
    try {
      const result = await updateSystemConfig({
        analysisModel,
        videoAnalysisModel,
        announcement: { title, content, enabled: true },
      });
      applySystemConfig(result.config);
      setAnnouncementMessage('公告已保存，用户首次打开网页会看到弹窗。');
    } catch (error) {
      setAnnouncementMessage(error instanceof Error ? error.message : '保存公告失败');
    } finally {
      setSavingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async () => {
    if (!canManageSystemSettings) {
      setAnnouncementMessage('当前账号没有公告编辑权限。');
      return;
    }
    setSavingAnnouncement(true);
    setAnnouncementMessage('');
    try {
      const result = await updateSystemConfig({
        analysisModel,
        videoAnalysisModel,
        announcement: { enabled: false },
      });
      applySystemConfig(result.config);
      setAnnouncementMessage('公告已删除。');
    } catch (error) {
      setAnnouncementMessage(error instanceof Error ? error.message : '删除公告失败');
    } finally {
      setSavingAnnouncement(false);
    }
  };

  const handleSaveUserAnalysisModel = async () => {
    setSavingUserAnalysisModel(true);
    setAnalysisModelMessage('');
    try {
      const result = await updateCurrentUserAnalysisModel(userAnalysisModel);
      onCurrentUserChange?.(result.user);
      const configResult = await fetchSystemConfig();
      applySystemConfig(configResult.config);
      setAnalysisModelMessage('已保存我的策划分析模型。');
    } catch (error) {
      setAnalysisModelMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingUserAnalysisModel(false);
    }
  };

  const handleBroadcastAnalysisModel = async () => {
    if (!canManageSystemSettings) {
      setAnalysisModelMessage('当前账号没有全局设置权限。');
      return;
    }
    setBroadcastingAnalysisModel(true);
    setAnalysisModelMessage('');
    try {
      const result = await broadcastSystemAnalysisModel();
      applySystemConfig(result.config);
      setAnalysisModelMessage('已将全局策划分析模型覆盖到所有账号。');
    } catch (error) {
      setAnalysisModelMessage(error instanceof Error ? error.message : '覆盖失败');
    } finally {
      setBroadcastingAnalysisModel(false);
    }
  };

  const handleStartDreaminaLogin = async () => {
    setDreaminaLoading(true);
    setDreaminaMessage('');
    setDreaminaLogin(null);
    try {
      const result = await startDreaminaLogin();
      setDreaminaLogin(result.login);
      setDreaminaStatus((prev) => prev ? {
        ...prev,
        authenticated: false,
        creditText: '',
        message: '正在等待网页登录完成，页面会自动检测状态。',
      } : prev);
      setDreaminaMessage('请完成即梦 OAuth 授权，页面会自动检测状态。');
    } catch (error) {
      setDreaminaMessage(error instanceof Error ? error.message : '启动登录失败');
    } finally {
      setDreaminaLoading(false);
    }
  };

  const handleCheckDreaminaLogin = async () => {
    if (!dreaminaLogin?.deviceCode) {
      setDreaminaMessage('请先开始即梦登录。');
      return;
    }
    setDreaminaLoading(true);
    setDreaminaMessage('');
    try {
      const result = await checkDreaminaLogin({ deviceCode: dreaminaLogin.deviceCode, poll: 30 });
      setDreaminaStatus(result.status);
      if (result.login.authenticated || result.status.authenticated) {
        setDreaminaLogin(null);
      }
      setDreaminaMessage(result.login.authenticated ? '即梦登录已完成。' : '授权尚未完成，请稍后再试。');
    } catch (error) {
      setDreaminaMessage(error instanceof Error ? error.message : '确认登录失败');
    } finally {
      setDreaminaLoading(false);
    }
  };

  const handleLogoutDreamina = async () => {
    setDreaminaLoading(true);
    setDreaminaMessage('');
    try {
      const result = await logoutDreamina();
      setDreaminaStatus(result.status);
      setDreaminaLogin(null);
      setDreaminaMessage('即梦登录已退出。');
    } catch (error) {
      setDreaminaMessage(error instanceof Error ? error.message : '退出失败');
    } finally {
      setDreaminaLoading(false);
    }
  };

  return (
    <div className="workspace-shell">
      <div className="workspace-content workspace-content-form workspace-content-wide">
        <div className="mb-6">
          <h2 className="text-[18px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>系统设置</h2>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>按类型管理工作台能力、模型渠道、服务接入和权限边界。</p>
        </div>

        <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border p-1.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {settingsCategories.map((item) => {
            const active = activeSettingsSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSettingsSection(item.id)}
                className="h-10 rounded-xl px-4 text-left text-[12px] font-black transition"
                style={{
                  background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                  color: active ? 'var(--accent)' : 'var(--text-primary)',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {systemConfigError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
            {systemConfigError}
          </div>
        ) : null}

        <div className="space-y-4">
          {activeSettingsSection === 'services' ? (
          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <Server size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>内部服务托管</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>KIE 密钥由服务端统一接管，前端不再录入真实 Key</p>
              </div>
            </div>
            <div className="rounded-2xl border border-dashed px-4 py-3 text-[12px] leading-6" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
              真实模型调用和密钥管理都走内部后端，工作区偏好在偏好设置里保存。
            </div>
          </div>
          ) : null}

          {activeSettingsSection === 'models' ? (
          <div className="flex flex-col gap-4">
            <div className="order-2 rounded-2xl border p-4 surface" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                    <KeyRound size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-black" style={{ color: 'var(--text-primary)' }}>统一模型中心</h3>
                    <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                      模型中心统一管理厂商、渠道、Base URL、密钥引用、能力矩阵和默认模型；本地模型暂不接入，智能体配置只消费这里的配置。
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2" aria-label="模型中心操作栏">
                  <button
                    type="button"
                    onClick={() => void handleReloadModelProviders()}
                    disabled={loadingModelProviders}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                  >
                    <RefreshCcw size={14} />
                    同步模型列表
                  </button>
                  {canManageSystemSettings ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleTestModelProvider()}
                        disabled={testingModelProvider || !modelProviderForm.provider}
                        className="h-9 rounded-xl border px-3 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                      >
                        {testingModelProvider ? '检查中...' : '健康检查'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedModelProviderId('');
                          setModelProviderForm(emptyModelProviderForm);
                          setModelProviderMessage('');
                          setModelProviderEditing(true);
                        }}
                        className="h-9 rounded-xl px-3 text-[12px] font-black text-white"
                        style={{ background: 'var(--accent)' }}
                      >
                        新增渠道
                      </button>
                    </>
                  ) : (
                    <span className="rounded-full px-3 py-1.5 text-[11px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>只读视图</span>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-black" style={{ color: 'var(--text-tertiary)' }}>已配置渠道</p>
                  <p className="mt-1 text-[18px] font-black" style={{ color: 'var(--text-primary)' }}>{configuredModelProviderCount}</p>
                </div>
                <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-black" style={{ color: 'var(--text-tertiary)' }}>模型资产</p>
                  <p className="mt-1 text-[18px] font-black" style={{ color: 'var(--text-primary)' }}>{totalModelCount}</p>
                </div>
                <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-black" style={{ color: 'var(--text-tertiary)' }}>可调用类型</p>
                  <p className="mt-1 text-[18px] font-black" style={{ color: 'var(--text-primary)' }}>{callableModelModeCount}</p>
                </div>
                <div className="rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-black" style={{ color: 'var(--text-tertiary)' }}>待配置类型</p>
                  <p className="mt-1 text-[18px] font-black" style={{ color: 'var(--text-primary)' }}>{pendingModelModeCount}</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>模型状态概览</p>
            </div>

            <div className="order-1 rounded-2xl border p-4 surface" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                    <Shield size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-black" style={{ color: 'var(--text-primary)' }}>模型全局管理</h3>
                    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      这里管理系统默认使用的模型；员工账号只能选择自己的策划分析模型，不能改全局策略。
                    </p>
                  </div>
                </div>
                <span className="rounded-full px-3 py-1.5 text-[11px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                  生效模型：{systemConfig?.systemSettings.effectiveAnalysisModel || '自动'}
                </span>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>我的策划模型</p>
                      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>用于个人策划、知识整理、智能体测试</p>
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>个人</span>
                  </div>
                  <PopoverSelect
                    value={userAnalysisModel}
                    onChange={setUserAnalysisModel}
                    disabled={loadingSystemConfig || savingUserAnalysisModel}
                    className="min-w-0"
                    buttonClassName="h-10 rounded-xl px-3 text-[12px]"
                    options={chatModelOptions}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveUserAnalysisModel()}
                    disabled={loadingSystemConfig || savingUserAnalysisModel}
                    className="mt-2 h-9 w-full rounded-xl px-3 text-[12px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: 'var(--accent)' }}
                  >
                    {savingUserAnalysisModel ? '保存中...' : '保存我的模型'}
                  </button>
                </div>

                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>全局策划模型</p>
                      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>智能体默认对话、训练和调试模型</p>
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>管理员</span>
                  </div>
                  <PopoverSelect
                    value={analysisModel}
                    onChange={setAnalysisModel}
                    disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel || broadcastingAnalysisModel}
                    className="min-w-0"
                    buttonClassName="h-10 rounded-xl px-3 text-[12px]"
                    options={chatModelOptions}
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveAnalysisModel()}
                      disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel || broadcastingAnalysisModel}
                      className="h-9 rounded-xl px-3 text-[12px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ background: 'var(--accent)' }}
                    >
                      {savingAnalysisModel ? '保存中...' : '保存全局'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBroadcastAnalysisModel()}
                      disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel || broadcastingAnalysisModel}
                      className="h-9 rounded-xl border px-3 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                    >
                      {broadcastingAnalysisModel ? '覆盖中...' : '覆盖账号'}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>视频分析模型</p>
                      <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>爆款视频拆解、上传视频分析专用</p>
                    </div>
                    <span className="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }}>High</span>
                  </div>
                  <PopoverSelect
                    value={videoAnalysisModel}
                    onChange={setVideoAnalysisModel}
                    disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel}
                    className="min-w-0"
                    buttonClassName="h-10 rounded-xl px-3 text-[12px]"
                    options={videoAnalysisModelOptions}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveAnalysisModel()}
                    disabled={!canManageSystemSettings || loadingSystemConfig || savingAnalysisModel}
                    className="mt-2 h-9 w-full rounded-xl border px-3 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                  >
                    保存视频模型
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                <span>{canManageSystemSettings ? '管理员可修改全局模型和广播到所有账号。' : '当前账号不能修改全局模型，只能保存个人策划模型。'}</span>
                {analysisModelMessage ? <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>{analysisModelMessage}</span> : null}
              </div>
            </div>

            <div className="order-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-3">
                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                    <div>
                      <p className="text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>模型资产目录</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {modelModeLabels[selectedModelMode] || selectedModelMode}：统一展示 KIE、APIports、中转渠道和厂商模板里的真实模型资产。
                      </p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      {selectedModeAssets.length} 个模型
                    </span>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2 rounded-xl border p-1.5" aria-label="模型类型筛选栏" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                    {modelModeStats.map((item) => {
                      const active = selectedModelMode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => setSelectedModelMode(item.mode)}
                          className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-[11px] font-black transition"
                          style={{
                            background: active ? 'var(--accent-soft)' : 'transparent',
                            color: active ? 'var(--accent)' : 'var(--text-secondary)',
                          }}
                        >
                          <span>{item.label}</span>
                          <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: active ? 'rgba(37,99,235,0.12)' : 'var(--bg-elevated)' }}>{item.count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="grid grid-cols-[minmax(150px,1.2fr)_74px_84px_minmax(92px,0.8fr)_minmax(120px,1fr)_58px] gap-2 px-3 py-2 text-[10px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      <span>模型 / 厂商</span>
                      <span>渠道</span>
                      <span>使用场景</span>
                      <span>能力</span>
                      <span>运行特性</span>
                      <span>状态</span>
                    </div>
                    {selectedModeAssets.slice(0, 10).map((asset) => (
                      <div
                        key={asset.key}
                        className="grid grid-cols-[minmax(150px,1.2fr)_74px_84px_minmax(92px,0.8fr)_minmax(120px,1fr)_58px] items-center gap-2 border-t px-3 py-3 text-[12px]"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <ProviderLogo provider={asset.provider} modelId={asset.id} displayName={asset.providerLabel} />
                          <span className="min-w-0">
                            <span className="block truncate font-black" style={{ color: 'var(--text-primary)' }}>{asset.label}</span>
                            <span className="block truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{asset.providerLabel} · {asset.id}</span>
                          </span>
                        </span>
                        <span className="truncate text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{asset.channel}</span>
                        <span className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{asset.usages.join(' / ')}</span>
                        <span className="text-[11px] leading-4" style={{ color: 'var(--text-tertiary)' }}>
                          {asset.features.length ? asset.features.slice(0, 4).map(getFeatureLabel).join(' / ') : '基础调用'}
                        </span>
                        <span className="text-[11px] leading-4" style={{ color: 'var(--text-tertiary)' }}>
                          {asset.runtimeTraits.length ? asset.runtimeTraits.slice(0, 4).join(' / ') : '按渠道能力'}
                        </span>
                        <span
                          className="rounded-full px-2 py-1 text-center text-[10px] font-black"
                          style={{
                            background: asset.configured ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                            color: asset.configured ? 'var(--success)' : 'rgb(180,83,9)',
                          }}
                        >
                          {asset.configured ? '可调用' : '待配置'}
                        </span>
                      </div>
                    ))}
                    {!selectedModeAssets.length ? (
                      <div className="border-t px-4 py-10 text-center text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                        当前模型类型暂无资产。请检查服务端模型目录或新增模型渠道。
                      </div>
                    ) : null}
                  </div>
                  {selectedModeAssets.length > 10 ? (
                    <p className="mt-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>已显示前 10 个模型，按模型类型切换可减少列表密度。</p>
                  ) : null}
                </div>

                <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                    <div>
                      <p className="text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>模型渠道矩阵</p>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {modelModeLabels[selectedModelMode] || selectedModelMode}：{selectedModeProviders.length} 个厂商渠道，{selectedModeModelCount} 个模型。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-black" style={{ color: 'var(--text-tertiary)' }}>
                      <span className="rounded-full px-2 py-1" style={{ background: 'var(--bg-elevated)' }}>全部</span>
                      <span className="rounded-full px-2 py-1" style={{ background: 'var(--bg-elevated)' }}>已配置 {configuredModelProviderCount}</span>
                      <span className="rounded-full px-2 py-1" style={{ background: 'var(--bg-elevated)' }}>缺 Key {Math.max(modelProviderRows.length - configuredModelProviderCount, 0)}</span>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="grid grid-cols-[minmax(150px,1.2fr)_74px_minmax(110px,1fr)_minmax(110px,1fr)_58px_70px] gap-2 px-3 py-2 text-[10px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      <span>厂家 / 渠道</span>
                      <span>类型</span>
                      <span>默认模型</span>
                      <span>能力</span>
                      <span>状态</span>
                      <span>使用方</span>
                    </div>
                    {selectedModeProviders.map((provider) => {
                      const modeModels = provider.models.filter((model) => (model.mode || 'chat') === selectedModelMode);
                      const features = Array.from(new Set(modeModels.flatMap((model) => model.features || []))).slice(0, 3).map(getFeatureLabel);
                      return (
                        <button
                          key={provider.provider}
                          type="button"
                          onClick={() => handleSelectModelProvider(provider.provider)}
                          className="grid w-full grid-cols-[minmax(150px,1.2fr)_74px_minmax(110px,1fr)_minmax(110px,1fr)_58px_70px] items-center gap-2 border-t px-3 py-3 text-left text-[12px] transition"
                          style={{
                            borderColor: 'var(--border-subtle)',
                            background: provider.provider === selectedModelProviderId ? 'var(--accent-soft)' : 'var(--bg-surface)',
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <ProviderLogo provider={provider.provider} displayName={provider.displayName} />
                            <span className="min-w-0">
                              <span className="block truncate font-black" style={{ color: 'var(--text-primary)' }}>{provider.displayName || provider.provider}</span>
                              <span className="block truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{provider.baseUrl || provider.provider}</span>
                            </span>
                          </span>
                          <span className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>{getProviderChannelKind(provider)}</span>
                          <span className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{provider.defaultModel || modeModels[0]?.id || '-'}</span>
                          <span className="truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{features.length ? features.join(' / ') : '基础调用'}</span>
                          <span
                            className="rounded-full px-2 py-1 text-center text-[10px] font-black"
                            style={{
                              background: provider.hasCredential ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                              color: provider.hasCredential ? 'var(--success)' : 'rgb(180,83,9)',
                            }}
                          >
                            {provider.hasCredential ? '可用' : '缺 Key'}
                          </span>
                          <span className="truncate text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>{getModeUsageLabel(selectedModelMode)}</span>
                        </button>
                      );
                    })}
                    {!selectedModeProviders.length ? (
                      <div className="border-t px-4 py-10 text-center text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                        当前模型类型暂无渠道。管理员可以从模板新增，或接入自定义中转渠道。
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>全部渠道管理</p>
                        <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>不受左侧模型类型过滤影响，管理员可以直接选择任意中转或厂商渠道编辑。</p>
                      </div>
                      <span className="rounded-full px-2 py-1 text-[10px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                        {allModelProvidersForManagement.length} 个渠道
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {allModelProvidersForManagement.map((provider) => (
                        <button
                          key={`all:${provider.provider}`}
                          type="button"
                          onClick={() => handleSelectModelProvider(provider.provider)}
                          className="inline-flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left"
                          style={{
                            borderColor: provider.provider === selectedModelProviderId ? 'var(--accent)' : 'var(--border-subtle)',
                            background: provider.provider === selectedModelProviderId ? 'var(--accent-soft)' : 'var(--bg-surface)',
                          }}
                        >
                          <ProviderLogo provider={provider.provider} displayName={provider.displayName} size="sm" />
                          <span className="min-w-0">
                            <span className="block max-w-[150px] truncate text-[11px] font-black" style={{ color: 'var(--text-primary)' }}>{provider.displayName || provider.provider}</span>
                            <span className="block max-w-[150px] truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{getProviderChannelKind(provider)} · {provider.models.length} 模型</span>
                          </span>
                        </button>
                      ))}
                      {!allModelProvidersForManagement.length ? (
                        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>暂无外部模型渠道，管理员可以用“新增渠道”或模板接入。</span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {canManageSystemSettings ? (
                  <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    <div className="mb-3 flex items-center justify-between gap-3 px-1">
                      <div>
                        <p className="text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>安装模型供应商</p>
                        <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>这里不是插件安装，而是载入常用供应商的结构模板。</p>
                      </div>
                      <span className="text-[11px] font-bold" style={{ color: 'var(--text-tertiary)' }}>{modelProviderPresets.length} 个模板</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {modelProviderPresets.map((preset) => (
                        <button
                          key={preset.provider}
                          type="button"
                          onClick={() => handleUseModelProviderPreset(preset)}
                          className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
                        >
                          <ProviderLogo provider={preset.provider} displayName={preset.displayName} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>{preset.displayName}</span>
                            <span className="block truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{preset.customBaseUrlRequired ? '中转/自定义 Base URL' : '官方 Base URL'}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border p-4 2xl:col-span-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>渠道详情</p>
                    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {modelProviderEditing ? '编辑 provider、Base URL、密钥引用和模型目录。' : canManageSystemSettings ? '基础配置默认只读，进入编辑后再修改。' : '只读视图：当前账号只能查看模型中心，模型供应商由管理员统一配置。'}
                    </p>
                  </div>
                  {!modelProviderEditing ? (
                    canManageSystemSettings ? (
                      <button
                        type="button"
                        onClick={() => setModelProviderEditing(true)}
                        disabled={!modelProviderForm.provider}
                        className="h-8 rounded-xl px-3 text-[11px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        编辑渠道
                      </button>
                    ) : (
                      <span className="rounded-full px-3 py-1.5 text-[11px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>只读视图</span>
                    )
                  ) : null}
                </div>

                {!modelProviderEditing ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                      <div className="flex items-center gap-3">
                        <ProviderLogo provider={selectedModelProvider?.provider} displayName={selectedModelProvider?.displayName} />
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-black" style={{ color: 'var(--text-primary)' }}>{selectedModelProvider?.displayName || modelProviderForm.displayName || '未选择渠道'}</p>
                          <p className="truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{selectedModelProvider?.provider || modelProviderForm.provider || '请选择左侧渠道'}</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                      <p className="mb-2 text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>基础配置</p>
                      <div className="space-y-2 text-[11px]">
                        <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-tertiary)' }}>渠道类型</span><span className="font-bold" style={{ color: 'var(--text-secondary)' }}>{selectedModelProvider ? getProviderChannelKind(selectedModelProvider) : '-'}</span></div>
                        <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-tertiary)' }}>Base URL</span><span className="max-w-[190px] truncate text-right font-bold" style={{ color: 'var(--text-secondary)' }}>{selectedModelProvider?.baseUrl || '待配置'}</span></div>
                        <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-tertiary)' }}>Key 状态</span><span className="font-bold" style={{ color: selectedModelProvider?.hasCredential ? 'var(--success)' : 'rgb(180,83,9)' }}>{selectedModelProvider?.hasCredential ? '已配置' : '缺失'}</span></div>
                        <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-tertiary)' }}>默认模型</span><span className="max-w-[190px] truncate text-right font-bold" style={{ color: 'var(--text-secondary)' }}>{selectedModelProvider?.defaultModel || '-'}</span></div>
                        <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-tertiary)' }}>备用模型</span><span className="max-w-[190px] truncate text-right font-bold" style={{ color: 'var(--text-secondary)' }}>{selectedModelProvider?.fallbackModel || '-'}</span></div>
                      </div>
                    </div>
                    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                      <p className="mb-2 text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>能力矩阵</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedProviderFeatureText.length ? selectedProviderFeatureText : ['基础调用']).map((feature) => (
                          <span key={feature} className="rounded-full px-2 py-1 text-[10px] font-black" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>{feature}</span>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(selectedProviderModeModels.length ? selectedProviderModeModels : selectedProviderModels).slice(0, 8).map((model) => (
                          <span key={`${model.mode || 'chat'}:${model.id}`} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{model.id}</span>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                      <p className="mb-2 text-[12px] font-black" style={{ color: 'var(--text-primary)' }}>影响范围</p>
                      <div className="space-y-2 text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                        <p>使用方：{getModeUsageLabel(selectedModelMode)}</p>
                        <p>智能体配置：模型中心统一管理，这里变更后配置页只做绑定和运行选择。</p>
                        <p>知识库：Embedding 与 Rerank 会被 RAG 检索训练调用。</p>
                      </div>
                    </div>
                    {modelProviderMessage ? (
                      <div className="rounded-xl border px-3 py-2 text-[12px] leading-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
                        {modelProviderMessage}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Provider ID</span>
                      <input
                        value={modelProviderForm.provider}
                        onChange={(event) => setModelProviderForm((prev) => ({ ...prev, provider: event.target.value }))}
                        disabled={!canManageSystemSettings}
                        placeholder="custom_relay"
                        className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>显示名称</span>
                      <input
                        value={modelProviderForm.displayName}
                        onChange={(event) => setModelProviderForm((prev) => ({ ...prev, displayName: event.target.value }))}
                        disabled={!canManageSystemSettings}
                        placeholder="自定义中转供应商"
                        className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>Base URL</span>
                      <input
                        value={modelProviderForm.baseUrl}
                        onChange={(event) => setModelProviderForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                        disabled={!canManageSystemSettings}
                        placeholder="https://relay.example.com/v1"
                        className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>API Key</span>
                        <input
                          value={modelProviderForm.apiKey}
                          onChange={(event) => setModelProviderForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                          disabled={!canManageSystemSettings}
                          type="password"
                          autoComplete="new-password"
                          placeholder={selectedModelProvider?.hasCredential ? '留空保留现有密钥' : 'sk-...'}
                          className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>密钥引用</span>
                        <input
                          value={modelProviderForm.credentialRef}
                          onChange={(event) => setModelProviderForm((prev) => ({ ...prev, credentialRef: event.target.value }))}
                          disabled={!canManageSystemSettings}
                          placeholder="env:OPENAI_API_KEY"
                          className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        <span>模型目录与能力矩阵</span>
                        <span className="font-medium" style={{ color: 'var(--text-tertiary)' }}>chat / embedding / rerank / image / video</span>
                      </span>
                      <textarea
                        value={modelProviderForm.modelsText}
                        onChange={(event) => setModelProviderForm((prev) => ({ ...prev, modelsText: event.target.value }))}
                        disabled={!canManageSystemSettings}
                        placeholder={'chat:gpt-5.5\nembedding:text-embedding-3-large\nrerank:bge-reranker\nimage:gpt-image-2\nvideo:veo-3'}
                        className="min-h-[130px] w-full resize-y rounded-xl border px-3 py-2 text-[12px] leading-5 outline-none disabled:opacity-60"
                        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>默认模型</span>
                        <select
                          value={modelProviderForm.defaultModel}
                          onChange={(event) => setModelProviderForm((prev) => ({ ...prev, defaultModel: event.target.value }))}
                          disabled={!canManageSystemSettings}
                          className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                        >
                          <option value="">未选择</option>
                          {chatModelIdsInDraft.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>备用模型</span>
                        <select
                          value={modelProviderForm.fallbackModel}
                          onChange={(event) => setModelProviderForm((prev) => ({ ...prev, fallbackModel: event.target.value }))}
                          disabled={!canManageSystemSettings}
                          className="h-10 w-full rounded-xl border px-3 text-[12px] outline-none disabled:opacity-60"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
                        >
                          <option value="">不启用</option>
                          {chatModelIdsInDraft.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
                        </select>
                      </label>
                    </div>
                    {canManageSystemSettings ? (
                      <div className="grid gap-2 sm:grid-cols-4">
                        <button
                          type="button"
                          onClick={() => void handleSaveModelProvider()}
                          disabled={loadingModelProviders || savingModelProvider}
                          className="rounded-xl bg-slate-900 px-3 py-3 text-[12px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingModelProvider ? '保存中...' : '保存供应商'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTestModelProvider()}
                          disabled={testingModelProvider || !modelProviderForm.provider}
                          className="rounded-xl border px-3 py-3 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                        >
                          {testingModelProvider ? '测试中...' : '连接测试'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModelProviderEditing(false);
                            handleSelectModelProvider(selectedModelProvider?.provider || selectedModelProviderId);
                          }}
                          className="rounded-xl border px-3 py-3 text-[12px] font-black"
                          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteModelProvider()}
                          disabled={savingModelProvider || !selectedModelProvider}
                          className="rounded-xl border px-3 py-3 text-[12px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
                        >
                          删除
                        </button>
                      </div>
                    ) : null}
                    {modelProviderMessage ? (
                      <div className="rounded-xl border px-3 py-2 text-[12px] leading-5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
                        {modelProviderMessage}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : null}

          {activeSettingsSection === 'notifications' ? (
          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                  <Bell size={16} style={{ color: 'var(--accent)' }} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>公告管理</h3>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>网页首次打开时居中弹出，可选择今日不再提醒</p>
                </div>
              </div>
              <span
                className="rounded-full border px-3 py-1.5 text-[11px] font-medium"
                style={{
                  borderColor: systemConfig?.systemSettings.announcement?.enabled ? 'rgba(34,197,94,0.28)' : 'var(--border-subtle)',
                  background: systemConfig?.systemSettings.announcement?.enabled ? 'rgba(34,197,94,0.08)' : 'var(--bg-elevated)',
                  color: systemConfig?.systemSettings.announcement?.enabled ? 'var(--success)' : 'var(--text-tertiary)',
                }}
              >
                {systemConfig?.systemSettings.announcement?.enabled ? '展示中' : '暂无公告'}
              </span>
            </div>

            {canManageSystemSettings ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>公告标题</span>
                  <input
                    value={announcementTitle}
                    onChange={(event) => setAnnouncementTitle(event.target.value)}
                    placeholder="例如：6 月 18 功能调整"
                    maxLength={120}
                    className="h-11 w-full rounded-2xl border px-3 text-[13px] outline-none"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>公告内容</span>
                  <textarea
                    value={announcementContent}
                    onChange={(event) => setAnnouncementContent(event.target.value)}
                    placeholder="填写需要所有用户看到的公告内容"
                    maxLength={4000}
                    className="min-h-[120px] w-full resize-y rounded-2xl border px-3 py-3 text-[13px] leading-6 outline-none"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSaveAnnouncement()}
                    disabled={loadingSystemConfig || savingAnnouncement}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingAnnouncement ? '保存中...' : '保存公告'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAnnouncement()}
                    disabled={loadingSystemConfig || savingAnnouncement || !systemConfig?.systemSettings.announcement?.enabled}
                    className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
                  >
                    <Trash2 size={14} />
                    删除公告
                  </button>
                  {announcementMessage ? <span className="text-[12px] font-medium text-slate-600">{announcementMessage}</span> : null}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed px-4 py-3 text-[12px] leading-6" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {systemConfig?.systemSettings.announcement?.enabled ? systemConfig.systemSettings.announcement.title : '当前暂无公告'}
                </p>
                <p className="mt-2 whitespace-pre-wrap">
                  {systemConfig?.systemSettings.announcement?.enabled ? systemConfig.systemSettings.announcement.content : '当前账号没有公告编辑权限。'}
                </p>
              </div>
            )}
          </div>
          ) : null}

          {activeSettingsSection === 'services' && canManageSystemSettings ? (
            <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                    <KeyRound size={16} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>即梦视频服务</h3>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>仅管理员可配置，登录态保存在服务器侧 Dreamina CLI</p>
                  </div>
                </div>
                <span
                  className="rounded-full border px-3 py-1.5 text-[11px] font-medium"
                  style={{
                    borderColor: dreaminaStatus?.authenticated ? 'rgba(34,197,94,0.28)' : 'rgba(245,158,11,0.28)',
                    background: dreaminaStatus?.authenticated ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                    color: dreaminaStatus?.authenticated ? 'var(--success)' : 'rgb(180,83,9)',
                  }}
                >
                  {dreaminaStatus?.authenticated ? '已登录' : dreaminaStatus?.installed === false ? '未安装' : '未登录'}
                </span>
              </div>

              <div className="rounded-2xl border border-dashed px-4 py-3 text-[12px] leading-6" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                {dreaminaStatus?.installed === false
                  ? '未检测到 Dreamina CLI，请先在服务器安装 dreamina 命令，或配置 MEIAO_DREAMINA_CLI_PATH。'
                  : (dreaminaStatus?.message || '点击开始登录后，系统会返回即梦 OAuth 设备码授权信息。')}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>CLI 路径</p>
                  <p className="mt-1 break-all text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{dreaminaStatus?.cliPath || 'dreamina'}</p>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'var(--bg-base)' }}>
                  <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>余额状态</p>
                  <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{dreaminaStatus?.creditText || '登录后可读取'}</p>
                  {dreaminaStatus?.userId || dreaminaStatus?.vipLevel ? (
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {dreaminaStatus?.userId ? `账号 ID ${dreaminaStatus.userId}` : '账号信息已同步'}
                      {dreaminaStatus?.vipLevel ? ` · 等级 ${dreaminaStatus.vipLevel}` : ''}
                    </p>
                  ) : null}
                </div>
              </div>

              {dreaminaLogin ? (
                <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>登录授权信息</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>授权链接</p>
                      <a href={dreaminaLogin.verificationUri} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 break-all text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        <Link2 size={13} />
                        {dreaminaLogin.verificationUri || '未返回'}
                      </a>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>用户码</p>
                      <p className="mt-1 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{dreaminaLogin.userCode || '未返回'}</p>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>设备码</p>
                      <p className="mt-1 break-all text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>{dreaminaLogin.deviceCode || '未返回'}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleStartDreaminaLogin()}
                  disabled={dreaminaLoading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LogIn size={14} />
                  {dreaminaStatus?.authenticated ? '重新登录' : '开始登录'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCheckDreaminaLogin()}
                  disabled={dreaminaLoading || !dreaminaLogin?.deviceCode}
                  className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  <RefreshCcw size={14} />
                  确认登录
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogoutDreamina()}
                  disabled={dreaminaLoading || !dreaminaStatus?.authenticated}
                  className="inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-[13px] font-black disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ borderColor: 'rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
                >
                  <LogOut size={14} />
                  退出登录
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {dreaminaStatus?.authenticated ? <CheckCircle2 size={14} style={{ color: 'var(--success)' }} /> : <AlertCircle size={14} style={{ color: 'rgb(245,158,11)' }} />}
                <span>{dreaminaLoading ? '处理中...' : dreaminaMessage || (dreaminaStatus?.authenticated ? '即梦已可用于视频生成。' : '即梦尚未登录。')}</span>
              </div>
            </div>
          ) : null}

          {activeSettingsSection === 'preferences' ? (
          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'rgba(34,197,94,0.1)' }}>
                <Server size={16} style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>系统状态</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>当前服务运行状态</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: '服务状态', value: loadingSystemConfig ? '读取中' : systemConfigError ? '异常' : '正常', color: systemConfigError ? 'var(--error)' : 'var(--success)', icon: <Shield size={14} /> },
                { label: '队列中', value: loadingSystemConfig ? '...' : String(systemConfig?.queue.queuedCount ?? '0'), color: 'var(--text-primary)', icon: <Server size={14} /> },
              ].map((item) => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--bg-base)' }}>
                  <div className="mb-1.5 flex items-center justify-center gap-1" style={{ color: item.color }}>
                    {item.icon}
                    <span className="text-[11px] font-medium">{item.value}</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{item.label}</p>
                </div>
              ))}
            </div>
          </div>
          ) : null}

          {activeSettingsSection === 'preferences' ? (
          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <Moon size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>偏好设置</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>自定义工作台行为</p>
              </div>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {preferenceRows.map((item) => (
                <Toggle
                  key={item.key}
                  label={item.label}
                  desc={item.desc}
                  checked={preferences[item.key]}
                  onChange={(next) => setPreferences((prev) => ({ ...prev, [item.key]: next }))}
                />
              ))}
            </div>
          </div>
          ) : null}

          {activeSettingsSection === 'access' ? (
          <div className="rounded-2xl border p-5 surface" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                <Shield size={16} style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>账号与权限</h3>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>管理员与员工账号看到的设置入口不同，员工不能操作全局配置。</p>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-2xl border p-4 text-[12px] leading-6" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
                <p className="font-black" style={{ color: 'var(--text-primary)' }}>{canManageSystemSettings ? '管理员视图' : '员工视图'}</p>
                <p className="mt-2">管理员可以配置模型供应商、服务登录、全局运行模型和公告。员工只允许保存个人策划模型与个人偏好，模型中心为只读消费。</p>
              </div>
            </div>
          </div>
          ) : null}

          {activeSettingsSection === 'preferences' ? (
          <div className="flex justify-end">
            <button onClick={handleSave} className="btn-primary" style={{ background: saved ? 'var(--success)' : undefined }}>
              {saved ? '已保存' : '保存设置'}
            </button>
          </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default GlobalApiSettings;
