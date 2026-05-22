import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { AppModule, SystemPublicConfig } from '../../types';
import { AppModuleObj } from '../../types';
import type { OneClickReferencePreset } from '../../../types';
import {
  Send, ImagePlus, X, ChevronDown, Check, SlidersHorizontal,
  Wand2, Globe, Users, Sparkles, Play, Layers, Palette, Type,
  BoxSelect, Monitor, Folder, Search, Clapperboard, Plus, Loader2,
} from 'lucide-react';
import UploadTypeSelector, { type MaterialType } from '../UploadTypeSelector';
import MaterialPreviewBar from '../MaterialPreviewBar';
import type { Material } from '../../../ShellMigratedApp';
import { XHS_COVER_STYLES, XHS_STYLE_CATEGORIES } from '../../../modules/XhsCover/xhsCoverStyles';
import { deriveLinkedTranslationSize } from '../../../modules/Translation/translationProcessingUtils.mjs';
import {
  getRetouchCustomSizeRatioWarning,
  getRetouchSupportedAspectRatiosForModel,
  getSafeRetouchAspectRatioForModel,
} from '../../../modules/Retouch/retouchSizingUtils.mjs';
import PresetLibrary, { type Preset } from '../PresetLibrary';
import { estimateImageBilling, getImageModelCreditCost } from '../../../utils/imageBilling.mjs';
import { isImeComposing } from '../../../utils/ime';

/* ── Module-specific toolbar params ── */
interface ParamItem {
  key: string;
  label: string;
  title: string;
  icon?: React.ReactNode;
  options: Array<string | { value: string; label: string }>;
  defaultValue: string;
  allowCustom?: boolean;
  recommendedValue?: string;
  recommendedLabel?: string;
  secondaryRecommendedValue?: string;
  secondaryRecommendedLabel?: string;
}

interface ExtendedParamItem {
  key: string;
  label: string;
  type: 'select' | 'textarea' | 'number' | 'checkbox';
  options?: Array<SelectOption>;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  allowCustom?: boolean;
}

type SelectOption = string | { value: string; label: string };

const DEFAULT_DIAGNOSIS_MODEL_OPTIONS = [
  { value: 'gpt-5-4-openai-resp', label: 'GPT-5.4' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'gemini-3.1-pro-openai', label: 'Gemini 3.1 Pro' },
  { value: 'gemini-3-flash-openai', label: 'Gemini 3 Flash' },
];

const STORYBOARD_NARRATIVE_PRESETS_STORAGE_KEY = 'meiao:customStoryboardNarrativePresets';
const STORYBOARD_ADD_PRESET_ID = '__add_storyboard_narrative_preset__';

interface StoryboardNarrativePreset {
  id: string;
  name: string;
  content: string;
  scriptPreset: 'custom' | 'ecommerce' | 'viral';
}

const BUILTIN_STORYBOARD_NARRATIVE_PRESETS: StoryboardNarrativePreset[] = [
  {
    id: 'custom',
    name: '自定义逻辑',
    scriptPreset: 'custom',
    content: '',
  },
  {
    id: 'ecommerce',
    name: '高转化电商逻辑',
    scriptPreset: 'ecommerce',
    content: '高转化电商短视频逻辑：吸引注意、建立信任、放大卖点、制造使用欲望，最后用清晰的行动引导收尾。',
  },
  {
    id: 'viral',
    name: '爆款短视频带货逻辑',
    scriptPreset: 'viral',
    content: '爆款短视频带货逻辑：开头强钩子，快速展示核心价值，用强对比、评论入口或使用结果推动停留和转化。',
  },
];

const loadCustomStoryboardNarrativePresets = (): StoryboardNarrativePreset[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORYBOARD_NARRATIVE_PRESETS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: typeof item?.id === 'string' ? item.id : '',
        name: typeof item?.name === 'string' ? item.name : '',
        content: typeof item?.content === 'string' ? item.content : '',
        scriptPreset: 'custom' as const,
      }))
      .filter((item) => item.id && item.name && item.content);
  } catch {
    return [];
  }
};

const saveCustomStoryboardNarrativePresets = (items: StoryboardNarrativePreset[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORYBOARD_NARRATIVE_PRESETS_STORAGE_KEY, JSON.stringify(items));
};

const toSelectOption = (option: SelectOption) => (
  typeof option === 'string' ? { value: option, label: option } : option
);

const QUICK_PARAMS: Record<string, ParamItem[]> = {
  [AppModuleObj.RETOUCH]: [
    { key: 'mode',    label: '原图精修', title: '修复模式', icon: <Wand2 size={12} />,   options: ['原图精修', '白底精修', '背景替换', '智能增强'], defaultValue: '原图精修' },
    { key: 'model',   label: 'GPT Image 2', title: 'AI 模型', icon: <Monitor size={12} />, options: ['GPT Image 2', 'Nano Banana 2'], defaultValue: 'GPT Image 2', recommendedValue: 'GPT Image 2' },
    { key: 'quality', label: '1K',       title: '出图分辨率', icon: <Sparkles size={12} />, options: ['1K', '2K', '4K'], defaultValue: '1K', recommendedValue: '1K' },
  ],
  [AppModuleObj.BUYER_SHOW]: [
    { key: 'target',  label: '含模特',   title: '模特设置', icon: <Users size={12} />,    options: ['含模特', '仅静物'], defaultValue: '含模特' },
    { key: 'count',   label: '4张',      title: '生成数量', icon: <BoxSelect size={12} />, options: ['1', '2', '4'], defaultValue: '4', allowCustom: true },
    { key: 'market',  label: '中国',     title: '目标市场', icon: <Globe size={12} />,    options: ['中国', '美国', '日本', '欧洲', '东南亚'], defaultValue: '中国', allowCustom: true },
  ],
  [AppModuleObj.VIDEO]: [
    { key: 'duration',label: '10秒', title: '视频时长', icon: <Play size={12} />,    options: ['5秒', '10秒', '15秒', '30秒', '60秒'], defaultValue: '10秒' },
    { key: 'model',   label: 'Seed', title: 'AI 模型', icon: <Monitor size={12} />, options: ['Seedance', 'Veo 2', 'Runway'], defaultValue: 'Seedance' },
    { key: 'ratio',   label: '9:16', title: '出图比例', icon: <BoxSelect size={12} />, options: ['9:16', '16:9', '1:1'], defaultValue: '9:16' },
  ],
  [AppModuleObj.XHS_COVER]: [
    { key: 'font', label: '圆体', title: '字体选择', icon: <Type size={12} />, options: ['圆体', '宋体', '手写体', '综艺体', '可爱体', '书法体'], defaultValue: '圆体', allowCustom: true },
    { key: 'ratio', label: '3:4', title: '出图比例', icon: <BoxSelect size={12} />, options: ['3:4', '1:1', '9:16'], defaultValue: '3:4' },
  ],
  [AppModuleObj.AGENT_CENTER]: [
    { key: 'agent', label: '精修', title: '智能体', icon: <Sparkles size={12} />, options: ['精修助手', '翻译专家', '买家秀', '主图设计'], defaultValue: '精修助手' },
  ],
};

const RETOUCH_RATIO_LABELS: Record<string, string> = {
  auto: 'AI 自适应尺寸',
};

const getRetouchQuickParams = (currentParams: Record<string, string>): ParamItem[] => {
  const supportedRatios = getRetouchSupportedAspectRatiosForModel(currentParams.model || 'GPT Image 2');
  return [
    QUICK_PARAMS[AppModuleObj.RETOUCH][0],
    {
      key: 'ratio',
      label: RETOUCH_RATIO_LABELS[supportedRatios[0]] || supportedRatios[0] || 'AI 自适应尺寸',
      title: '出图比例',
      icon: <BoxSelect size={12} />,
      options: supportedRatios.map((ratio) => ({ value: ratio, label: RETOUCH_RATIO_LABELS[ratio] || ratio })),
      defaultValue: 'auto',
      recommendedValue: '1:1',
      recommendedLabel: '推荐',
      secondaryRecommendedValue: '3:4',
      secondaryRecommendedLabel: '推荐',
    },
    ...QUICK_PARAMS[AppModuleObj.RETOUCH].slice(1),
  ];
};

const getDiagnosisModelOptions = (systemConfig?: SystemPublicConfig | null): Array<{ value: string; label: string }> => {
  const available = systemConfig?.agentModels?.chat || [];
  if (available.length > 0) return available.map((item) => ({ value: item.id, label: item.label }));
  return DEFAULT_DIAGNOSIS_MODEL_OPTIONS;
};

const EXTENDED_PARAMS: Record<string, Array<{
  section: string;
  params: ExtendedParamItem[];
}>> = {
  [AppModuleObj.TRANSLATION]: [
    { section: '尺寸', params: [
      { key: 'width',   label: '宽度(px)',      type: 'number', defaultValue: '800' },
      { key: 'height',  label: '高度(px)',      type: 'number', defaultValue: '1200' },
      { key: 'maxSize', label: '体积限制(MB)',  type: 'number', defaultValue: '2.0' },
    ]},
  ],
  [AppModuleObj.BUYER_SHOW]: [
    { section: '批量', params: [
      { key: 'setCount', label: '生成套数', type: 'select', options: ['1套', '2套', '3套', '4套'], defaultValue: '1套' },
    ]},
  ],
  [AppModuleObj.RETOUCH]: [
    { section: '尺寸', params: [
      { key: 'sizeMode', label: '输出尺寸', type: 'select', options: ['AI 自适应尺寸', '自定义'], defaultValue: 'AI 自适应尺寸' },
      { key: 'width',    label: '宽度(px)', type: 'number', defaultValue: '800' },
      { key: 'height',   label: '高度(px)', type: 'number', defaultValue: '800' },
    ]},
  ],
  [AppModuleObj.XHS_COVER]: [
    { section: '元素', params: [
      { key: 'stickers', label: '装饰贴纸', type: 'select', options: ['不添加', '少量点缀', '标签贴纸', '手绘元素', '强调箭头'], defaultValue: '不添加', allowCustom: true },
      { key: 'extraRequirements', label: '额外要求', type: 'textarea', placeholder: '例如：留白更多、标题更醒目、不要人物...', rows: 3 },
    ]},
  ],
};

const VIDEO_QUICK_PARAMS: Record<string, ParamItem[]> = {
  generation: [
    {
      key: 'dreaminaMode',
      label: '全能参考',
      title: '生成模式',
      icon: <Clapperboard size={12} />,
      options: [
        { value: 'multimodal2video', label: '全能参考' },
        { value: 'frames2video', label: '首尾帧' },
        { value: 'multiframe2video', label: '智能多帧' },
      ],
      defaultValue: 'multimodal2video',
    },
  ],
  storyboard: [
    { key: 'videoMode', label: '原创生成', title: '生成模式', icon: <Clapperboard size={12} />, options: ['原创生成', '爆款复刻'], defaultValue: '原创生成' },
    { key: 'duration', label: '15秒', title: '时长', icon: <Play size={12} />, options: ['5秒', '10秒', '15秒', '30秒'], defaultValue: '15秒' },
    { key: 'shotCount', label: '9格', title: '分镜镜头数', icon: <Layers size={12} />, options: [
      { value: '1', label: '1格' },
      { value: '3', label: '3格' },
      { value: '4', label: '4格' },
      { value: '6', label: '6格' },
      { value: '8', label: '8格' },
      { value: '9', label: '9格' },
      { value: '12', label: '12格' },
    ], defaultValue: '9' },
    { key: 'countryLanguage', label: '中国/中文', title: '目标国家/语言', icon: <Globe size={12} />, options: [
      '中国/中文',
      '美国/英文',
      '日本/日文',
      '韩国/韩文',
      '法国/法文',
      '德国/德文',
      '俄罗斯/俄文',
      '西班牙/西班牙文',
      '葡萄牙/葡萄牙文',
      '墨西哥/西班牙文',
      '泰国/泰文',
      '越南/越南文',
      '印尼/印尼文',
      '阿拉伯/阿拉伯文',
    ], defaultValue: '中国/中文', allowCustom: true },
    { key: 'ratio', label: '9:16', title: '画幅', icon: <BoxSelect size={12} />, options: ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'], defaultValue: '9:16' },
  ],
  diagnosis: [
    { key: 'platform', label: 'TikTok', title: '平台', icon: <Globe size={12} />, options: ['TikTok', '抖音', '小红书'], defaultValue: 'TikTok' },
  ],
};

const VIDEO_EXTENDED_PARAMS: Record<string, Array<{
  section: string;
  params: ExtendedParamItem[];
}>> = {
  generation: [],
  storyboard: [
    { section: '生成', params: [
      { key: 'actorType', label: '演员类型', type: 'select', options: [
        { value: 'no_real_face', label: '不出现真实人脸' },
        { value: 'real_person', label: '真实人物' },
        { value: '3d_digital_human', label: '3D 数字人' },
        { value: 'cartoon_character', label: '卡通角色' },
      ], defaultValue: 'no_real_face' },
      { key: 'generateWhiteBg', label: '同步生成白底图', type: 'checkbox', defaultValue: 'false' },
    ]},
  ],
  diagnosis: [
    { section: '分析', params: [
      { key: 'analysisItems', label: '参考规则', type: 'textarea', placeholder: '例如：标题、封面、互动、风险信号...', rows: 3 },
    ]},
  ],
};

const getRecommendedStoryboardShotCount = (duration: string) => {
  const seconds = Number.parseInt(String(duration || '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(seconds) || seconds <= 5) return '3';
  if (seconds <= 10) return '6';
  if (seconds <= 15) return '9';
  return '12';
};

const getOneClickBaseParams = (mode: string): ParamItem[] => {
  const ratioOptions = mode === '详情页'
    ? ['auto', '3:4', '1:1', '2:3', '4:3', '16:9', '9:16']
    : ['1:1', '2:3', '3:4', '4:3', '16:9', '9:16', 'auto'];
  return [
    { key: 'mode',    label: '首图', title: '图片类型', icon: <Layers size={12} />,    options: ['首图', '主图', '详情页', 'SKU'], defaultValue: '首图' },
    mode === '详情页'
      ? {
          key: 'ratio',
          label: 'auto',
          title: '出图比例',
          icon: <BoxSelect size={12} />,
          options: ratioOptions,
          defaultValue: 'auto',
          recommendedValue: 'auto',
          recommendedLabel: '推荐',
          secondaryRecommendedValue: '3:4',
          secondaryRecommendedLabel: '推荐',
        }
      : {
          key: 'ratio',
          label: '1:1',
          title: '出图比例',
          icon: <BoxSelect size={12} />,
          options: ratioOptions,
          defaultValue: '1:1',
          recommendedValue: '1:1',
          recommendedLabel: '推荐',
        },
    { key: 'model',   label: 'GPT Image 2', title: 'AI 模型', icon: <Monitor size={12} />,  options: ['GPT Image 2', 'Nano Banana 2'], defaultValue: 'GPT Image 2', recommendedValue: 'GPT Image 2' },
    { key: 'quality', label: '1K', title: '出图分辨率', icon: <Sparkles size={12} />,   options: ['1K', '2K', '4K'], defaultValue: '1K', recommendedValue: '1K' },
  ];
};

const ONE_CLICK_COUNT_DEFAULTS: Record<string, string> = {
  主图: '5',
  详情页: '7',
  SKU: '4',
};

const DREAMINA_DURATION_OPTIONS = Array.from({ length: 12 }, (_, index) => `${index + 4}秒`);
const DREAMINA_MULTIFRAME_DURATION_OPTIONS = ['0.5秒', '1秒', '2秒', '3秒', '4秒', '5秒', '6秒', '7秒', '8秒'];
const SEEDANCE_API_MODEL_VALUE = 'bytedance/seedance-2-fast';
const DREAMINA_CLI_MODEL_VALUE = 'seedance2.0fast_vip';
const SEEDANCE_VIDEO_MODEL_OPTIONS = [
  { value: SEEDANCE_API_MODEL_VALUE, label: 'Seedance 2.0 Fast · API' },
  { value: DREAMINA_CLI_MODEL_VALUE, label: 'Seedance 2.0 Fast VIP · CLI' },
];
const DREAMINA_CLI_MODEL_OPTIONS = [
  { value: 'seedance2.0fast_vip', label: 'Seedance 2.0 Fast VIP' },
];
const SEEDANCE_API_RESOLUTION_OPTIONS = ['480p', '720p'];

const normalizeDreaminaUiMode = (value?: string) => {
  const mode = String(value || '').trim();
  if (mode === 'image2video' || mode === '全能参考' || mode === 'multimodal' || mode === 'ref2video') return 'multimodal2video';
  if (mode === '首尾帧' || mode === 'firstLastFrame' || mode === 'frames') return 'frames2video';
  if (mode === '智能多帧' || mode === '多帧成片' || mode === 'multiframe') return 'multiframe2video';
  if (['frames2video', 'multiframe2video', 'multimodal2video'].includes(mode)) return mode;
  return 'multimodal2video';
};

const getSeedanceVideoModelValue = (mode: string, value?: string) => {
  if (mode === 'multiframe2video') return DREAMINA_CLI_MODEL_VALUE;
  return String(value || '').trim() === DREAMINA_CLI_MODEL_VALUE
    ? DREAMINA_CLI_MODEL_VALUE
    : SEEDANCE_API_MODEL_VALUE;
};

const getSeedanceVideoAccessMode = (mode: string, value?: string) => (
  getSeedanceVideoModelValue(mode, value) === DREAMINA_CLI_MODEL_VALUE ? 'cli' : 'api'
);

const getDreaminaGenerationParams = (currentParams: Record<string, string>): ParamItem[] => {
  const mode = normalizeDreaminaUiMode(currentParams.dreaminaMode);
  const selectedModel = getSeedanceVideoModelValue(mode, currentParams.modelVersion);
  const isApiMode = getSeedanceVideoAccessMode(mode, selectedModel) !== 'cli';
  const base = VIDEO_QUICK_PARAMS.generation;
  const durationParam: ParamItem = {
    key: 'duration',
    label: mode === 'multiframe2video' ? '3秒/段' : '5秒',
    title: mode === 'multiframe2video' ? '单段时长' : '视频时长',
    icon: <Play size={12} />,
    options: mode === 'multiframe2video' ? DREAMINA_MULTIFRAME_DURATION_OPTIONS : DREAMINA_DURATION_OPTIONS,
    defaultValue: mode === 'multiframe2video' ? '3秒' : '5秒',
  };
  const modelParam: ParamItem = {
    key: 'modelVersion',
    label: isApiMode ? 'Seedance 2.0 Fast · API' : 'Seedance 2.0 Fast VIP · CLI',
    title: 'AI 模型',
    icon: <Monitor size={12} />,
    options: mode === 'multiframe2video' ? DREAMINA_CLI_MODEL_OPTIONS : SEEDANCE_VIDEO_MODEL_OPTIONS,
    defaultValue: mode === 'multiframe2video' ? DREAMINA_CLI_MODEL_VALUE : SEEDANCE_API_MODEL_VALUE,
    recommendedValue: mode === 'multiframe2video' ? DREAMINA_CLI_MODEL_VALUE : SEEDANCE_API_MODEL_VALUE,
    recommendedLabel: mode === 'multiframe2video' ? '仅支持' : '默认',
  };
  const resolutionParam: ParamItem = {
    key: 'videoResolution',
    label: '720p',
    title: '视频分辨率',
    icon: <Sparkles size={12} />,
    options: SEEDANCE_API_RESOLUTION_OPTIONS,
    defaultValue: '720p',
    recommendedValue: '720p',
    recommendedLabel: '默认',
  };

  if (mode === 'multiframe2video') return [...base, durationParam, modelParam];

  if (mode === 'multimodal2video') {
    return [
      ...base,
      durationParam,
      modelParam,
      ...(isApiMode ? [resolutionParam] : []),
      { key: 'ratio', label: '9:16', title: '画面比例', icon: <BoxSelect size={12} />, options: ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'], defaultValue: '9:16' },
    ];
  }

  return [...base, durationParam, modelParam, ...(isApiMode ? [resolutionParam] : [])];
};

const getStoryboardQuickParams = (currentParams: Record<string, string>): ParamItem[] => {
  if (isStoryboardViralReplicationMode(currentParams.videoMode)) {
    return VIDEO_QUICK_PARAMS.storyboard.filter((param) => ['videoMode', 'ratio'].includes(param.key));
  }
  return VIDEO_QUICK_PARAMS.storyboard;
};

const getVideoQuickParams = (
  activeSubFeature?: string,
  systemConfig?: SystemPublicConfig | null,
  currentParams: Record<string, string> = {},
): ParamItem[] => {
  if (activeSubFeature === 'diagnosis') {
    const options = getDiagnosisModelOptions(systemConfig);
    const effectiveModel = systemConfig?.systemSettings?.effectiveVideoAnalysisModel || 'gemini-3-flash-openai';
    return [
      ...VIDEO_QUICK_PARAMS.diagnosis,
      {
        key: 'analysisModel',
        label: '视频分析',
        title: '视频分析模型',
        icon: <Monitor size={12} />,
        options,
        defaultValue: effectiveModel,
        recommendedValue: effectiveModel,
        recommendedLabel: '默认',
      },
    ];
  }
  if (!activeSubFeature || activeSubFeature === 'generation') return getDreaminaGenerationParams(currentParams);
  if (activeSubFeature === 'storyboard') return getStoryboardQuickParams(currentParams);
  return VIDEO_QUICK_PARAMS[activeSubFeature || 'generation'] || VIDEO_QUICK_PARAMS.generation;
};

const getTranslationQuickParams = (activeSubFeature?: string): ParamItem[] => {
  const isDetail = activeSubFeature === 'detail';
  const isRemoveText = activeSubFeature === 'remove_text';
  const ratioOptions = isDetail || isRemoveText
    ? ['auto', '1:1', '3:4', '4:3', '9:16', '16:9']
    : ['1:1', '3:4', '4:3', '9:16', '16:9'];
  return [
    { key: 'submode', label: isDetail ? '详情出海' : isRemoveText ? '去文案' : '主图出海', title: '翻译模式', icon: <Globe size={12} />, options: ['主图出海', '详情出海', '去文案'], defaultValue: isDetail ? '详情出海' : isRemoveText ? '去文案' : '主图出海' },
    ...(isRemoveText ? [] : [{
      key: 'lang',
      label: '英语',
      title: '目标语言',
      icon: <Globe size={12} />,
      options: [
        { value: 'English', label: '英语（English）' },
        { value: 'Japanese', label: '日语（Japanese）' },
        { value: 'German', label: '德语（German）' },
        { value: 'French', label: '法语（French）' },
        { value: 'Spanish', label: '西班牙语（Spanish）' },
        { value: 'Korean', label: '韩语（Korean）' },
        { value: 'Russian', label: '俄语（Russian）' },
        { value: 'Vietnamese', label: '越南语（Vietnamese）' },
        { value: 'Thai', label: '泰语（Thai）' },
        { value: 'Italian', label: '意大利语（Italian）' },
      ],
      defaultValue: 'English',
      allowCustom: true,
    } as ParamItem]),
    {
      key: 'ratio',
      label: isDetail || isRemoveText ? 'auto' : '1:1',
      title: '出图比例',
      icon: <BoxSelect size={12} />,
      options: ratioOptions,
      defaultValue: isDetail || isRemoveText ? 'auto' : '1:1',
      recommendedValue: isDetail || isRemoveText ? 'auto' : '1:1',
      recommendedLabel: '推荐',
    },
    { key: 'model',   label: 'GPT Image 2', title: 'AI 模型', icon: <Monitor size={12} />, options: ['GPT Image 2', 'Nano Banana 2'], defaultValue: 'GPT Image 2', recommendedValue: 'GPT Image 2' },
    { key: 'quality', label: '1K',       title: '渲染质量', icon: <Sparkles size={12} />, options: ['1K', '2K', '4K'], defaultValue: '1K', recommendedValue: '1K' },
  ];
};

const getTranslationSizeDefaults = (activeSubFeature?: string) => ({
  width: activeSubFeature === 'detail' ? 750 : activeSubFeature === 'remove_text' ? 1200 : 800,
  height: activeSubFeature === 'detail' || activeSubFeature === 'remove_text' ? 0 : 800,
  ratio: activeSubFeature === 'detail' || activeSubFeature === 'remove_text' ? 'auto' : '1:1',
});

const getQuickParamsForModule = (
  module: AppModule,
  currentParams: Record<string, string>,
  activeSubFeature?: string,
  systemConfig?: SystemPublicConfig | null,
): ParamItem[] => {
  if (module === AppModuleObj.TRANSLATION) return getTranslationQuickParams(activeSubFeature);
  if (module === AppModuleObj.VIDEO) return getVideoQuickParams(activeSubFeature, systemConfig, currentParams);
  if (module === AppModuleObj.RETOUCH) return getRetouchQuickParams(currentParams);
  if (module !== AppModuleObj.ONE_CLICK) return QUICK_PARAMS[module] || [];
  const mode = currentParams.mode || '首图';
  if (mode === '首图') return getOneClickBaseParams(mode);
  if (mode === 'SKU') return getOneClickBaseParams(mode);
  return [
    ...getOneClickBaseParams(mode),
    {
      key: 'count',
      label: `${ONE_CLICK_COUNT_DEFAULTS[mode] || '5'}张`,
      title: mode === '详情页' ? '策划屏数' : '生成数量',
      icon: <BoxSelect size={12} />,
      options: mode === '详情页' ? ['3', '5', '7'] : ['3', '5', '7'],
      defaultValue: ONE_CLICK_COUNT_DEFAULTS[mode] || '5',
      allowCustom: true,
    },
  ];
};

const getMaterialTypesForContext = (module: AppModule, currentParams: Record<string, string>, activeSubFeature?: string): MaterialType[] | undefined => {
  if (module === AppModuleObj.BUYER_SHOW) return ['product', 'atmosphere', 'model'];
  if (module === AppModuleObj.VIDEO) {
    if (activeSubFeature === 'diagnosis') return [];
    if (activeSubFeature === 'storyboard') {
      return isStoryboardViralReplicationMode(currentParams.videoMode) ? ['product', 'referenceVideo'] : ['product', 'scene'];
    }
    const dreaminaMode = normalizeDreaminaUiMode(currentParams.dreaminaMode);
    if (dreaminaMode === 'frames2video') return ['product'];
    if (dreaminaMode === 'multiframe2video') return ['product'];
    return ['product', 'scene', 'referenceVideo', 'audio'];
  }
  if (module !== AppModuleObj.ONE_CLICK) return undefined;
  const mode = currentParams.mode || '首图';
  if (mode === 'SKU') return ['product', 'gift', 'styleRef'];
  return ['product', 'logo', 'styleRef'];
};

const isStoryboardViralReplicationMode = (value?: string) => {
  const mode = String(value || '').trim();
  return mode === '爆款复刻' || mode === '爆款裂变' || mode === 'viral_split';
};

const getUploadAcceptForTarget = (target: string) => {
  if (target === 'referenceVideo') return 'video/*';
  if (target === 'audio') return 'audio/*';
  return 'image/*';
};

const getDreaminaModeGuidance = (params: Record<string, string>) => {
  const mode = normalizeDreaminaUiMode(params.dreaminaMode);
  if (mode === 'multiframe2video') {
    return '智能多帧：上传 2-20 张图片，按上传顺序传给即梦，3 张以上会按相邻帧生成多段转场。';
  }
  if (mode === 'frames2video') {
    return '首尾帧：上传至少 2 张图片，第一张作为首帧，第二张作为尾帧；比例跟随首帧。';
  }
  return '全能参考：可上传单张或多张图片，也可混合参考视频和 2-15 秒音频，用于画面、动作、节奏综合参考。';
};

const parseDreaminaSeconds = (value?: string, fallback = 5) => {
  const parsed = Number.parseFloat(String(value || '').replace('秒/段', '').replace('秒', '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getDreaminaCreditHint = (params: Record<string, string>) => {
  const mode = normalizeDreaminaUiMode(params.dreaminaMode);
  const seconds = parseDreaminaSeconds(params.duration, mode === 'multiframe2video' ? 3 : 5);
  const accessMode = getSeedanceVideoAccessMode(mode, params.modelVersion);
  const resolution = params.videoResolution === '480p' ? '480p' : '720p';
  if (accessMode !== 'cli') {
    return `Seedance 2.0 Fast · ${seconds} 秒 · ${resolution}，提交前显示预计积分，完成后按 KIE 真实扣费记录。`;
  }
  if (mode === 'multiframe2video') {
    return `单段 ${seconds} 秒，Seedance 2.0 Fast VIP，积分以即梦实际扣费为准。`;
  }
  return `Seedance 2.0 Fast VIP · ${seconds} 秒，积分以即梦实际扣费为准。`;
};

const estimateSeedanceFastBilling = ({
  accessMode = 'api',
  duration = '5秒',
  resolution = '720p',
  hasVideoInput = false,
} = {}) => {
  if (accessMode === 'cli') return { billable: false, estimatedCredits: 0 };
  const seconds = parseDreaminaSeconds(duration, 5);
  const perSecond = resolution === '720p'
    ? (hasVideoInput ? 20 * seconds : 33 * seconds)
    : (hasVideoInput ? 9 * seconds : 15.5 * seconds);
  return {
    billable: true,
    estimatedCredits: Math.round(perSecond * 10) / 10,
  };
};

const getDreaminaMaterialLabels = (params: Record<string, string>): Partial<Record<MaterialType, { label: string; desc: string }>> => {
  const mode = normalizeDreaminaUiMode(params.dreaminaMode);
  if (mode === 'multiframe2video') {
    return {
      product: { label: '智能多帧图片', desc: '2-20 张，按上传顺序成片' },
    };
  }
  if (mode === 'frames2video') {
    return {
      product: { label: '首尾帧图片', desc: '第 1 张首帧，第 2 张尾帧' },
    };
  }
  return {
      product: { label: '参考图片', desc: '单图/多图均可' },
      scene: { label: '补充图片', desc: '场景/风格参考' },
      referenceVideo: { label: '参考视频', desc: '动作/镜头参考' },
      audio: { label: '参考音频', desc: '音乐/节奏参考' },
  };
};

const getStoryboardMaterialLabels = (params: Record<string, string>): Partial<Record<MaterialType, { label: string; desc: string }>> => {
  if (isStoryboardViralReplicationMode(params.videoMode)) {
    return {
      product: { label: '产品素材', desc: '建议多角度产品图' },
      referenceVideo: { label: '参考视频', desc: '爆款复刻参考' },
    };
  }
  return {
    product: { label: '产品素材', desc: '建议多角度产品图' },
    scene: { label: '场景参考', desc: '拍摄场景参考' },
  };
};

const getBuyerShowSetCount = (currentParams: Record<string, string>) => {
  const parsed = parseInt(String(currentParams.setCount || '1套'), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 4);
};

const getExtendedSectionsForModule = (module: AppModule, currentParams: Record<string, string>, activeSubFeature?: string) => {
  if (activeSubFeature === 'storyboard' && isStoryboardViralReplicationMode(currentParams.videoMode)) return [];
  if (module === AppModuleObj.VIDEO) return VIDEO_EXTENDED_PARAMS[activeSubFeature || 'generation'] || [];
  if (module === AppModuleObj.TRANSLATION) {
    const isDetail = activeSubFeature === 'detail';
    const isRemoveText = activeSubFeature === 'remove_text';
    return [
      {
        section: '尺寸',
        params: [
          { key: 'resolutionMode', label: '尺寸模式', type: 'select', options: ['自定义', '原图'], defaultValue: '自定义' },
          { key: 'maxSize', label: '体积限制(MB)', type: 'number', defaultValue: '2.0' },
          { key: 'targetWidth', label: '输出宽度(px)', type: 'number', defaultValue: isDetail ? '750' : isRemoveText ? '1200' : '800' },
          { key: 'targetHeight', label: '输出高度(px)', type: 'number', defaultValue: isDetail || isRemoveText ? '0' : '800' },
        ],
      },
    ];
  }
  if (module !== AppModuleObj.ONE_CLICK) return EXTENDED_PARAMS[module] || [];
  const mode = currentParams.mode || '首图';
  return [
    {
      section: '投放',
      params: [
        { key: 'platformType', label: '适配市场', type: 'select' as const, options: ['国内(移动端)', '跨境(全球适配)'], defaultValue: '国内(移动端)' },
        { key: 'platform', label: '投放平台', type: 'select' as const, options: ['淘宝', '天猫', '京东', '拼多多', '亚马逊', 'TikTok Shop', 'Shein', 'Shopee'], defaultValue: '淘宝', allowCustom: true },
        { key: 'lang', label: '目标文案语言', type: 'select' as const, options: [
          { value: '中文', label: '中文（Chinese）' },
          { value: 'English', label: '英语（English）' },
          { value: 'Japanese', label: '日语（Japanese）' },
          { value: 'Korean', label: '韩语（Korean）' },
          { value: 'German', label: '德语（German）' },
          { value: 'French', label: '法语（French）' },
          { value: 'Spanish', label: '西班牙语（Spanish）' },
          { value: 'Thai', label: '泰语（Thai）' },
          { value: 'Vietnamese', label: '越南语（Vietnamese）' },
        ], defaultValue: String(currentParams.platformType || '').includes('跨境') ? 'English' : '中文', allowCustom: true },
      ],
    },
    {
      section: '画面',
      params: [
        ...(mode === '首图' ? [{
          key: 'firstImageColorMode',
          label: '首图配色',
          type: 'select' as const,
          options: ['商品自适应', '参考图基准'],
          defaultValue: '商品自适应',
        }] : []),
        { key: 'resolutionMode', label: '尺寸模式', type: 'select' as const, options: ['AI 自适应尺寸', '固定宽度'], defaultValue: '固定宽度' },
        { key: 'targetWidth', label: '输出宽度(px)', type: 'number' as const, defaultValue: mode === '详情页' ? '750' : '800' },
      ],
    },
  ];
};

const MODULE_PLACEHOLDERS: Record<string, string> = {
  [AppModuleObj.AGENT_CENTER]: '描述你的需求，AI 助手将为你完成创作...',
  [AppModuleObj.ONE_CLICK]: '输入产品名称、卖点描述...',
  [AppModuleObj.TRANSLATION]: '',
  [AppModuleObj.BUYER_SHOW]: '请输入产品名称、核心卖点、目标人群和基础适用场景...',
  [AppModuleObj.RETOUCH]: '上传产品图并描述精修要求...',
  [AppModuleObj.VIDEO]: '输入视频脚本或产品卖点...',
  [AppModuleObj.XHS_COVER]: '主标题：\n副标题：\n内容/卖点：',
};

const getPlaceholderForContext = (module: AppModule, activeSubFeature?: string, currentParams: Record<string, string> = {}) => {
  if (module === AppModuleObj.VIDEO && (!activeSubFeature || activeSubFeature === 'generation')) {
    return '描述视频动作、镜头运动、产品卖点和氛围要求...';
  }
  if (module === AppModuleObj.VIDEO && activeSubFeature === 'storyboard') {
    if (isStoryboardViralReplicationMode(currentParams.videoMode)) {
      return '输入产品的参数信息、真实卖点等；不填写则默认复刻参考视频文案...';
    }
    return '输入分镜生成需求：产品卖点、目标人群、视频节奏、必须出现的画面...';
  }
  if (module === AppModuleObj.VIDEO && activeSubFeature === 'diagnosis') {
    return '视频诊断：粘贴需要诊断的视频/笔记链接，或补充你想重点分析的问题...';
  }
  return MODULE_PLACEHOLDERS[module] || '输入创作描述...';
};

const getGenerateLabelForContext = (module: AppModule, activeSubFeature?: string) => {
  if (isPendingShellSubFeature(module, activeSubFeature)) return '待制作';
  if (module === AppModuleObj.VIDEO && activeSubFeature === 'storyboard') return '生成分镜';
  if (module === AppModuleObj.VIDEO && activeSubFeature === 'diagnosis') return '一键勘探深度分析';
  return '生成';
};

const isPendingShellSubFeature = (module: AppModule, activeSubFeature?: string) =>
  (module === AppModuleObj.BUYER_SHOW && activeSubFeature === 'copy')
  || (module === AppModuleObj.RETOUCH && (activeSubFeature === 'background_replace' || activeSubFeature === 'enhance'));

/* ── Compact Dropdown ── */
const CompactSelect: React.FC<{
  value: string;
  options: Array<SelectOption>;
  onChange: (v: string) => void;
  icon?: React.ReactNode;
  title?: string;
  allowCustom?: boolean;
  recommendedValue?: string;
  recommendedLabel?: string;
  secondaryRecommendedValue?: string;
  secondaryRecommendedLabel?: string;
  getOptionMeta?: (value: string) => string;
}> = ({
  value,
  options,
  onChange,
  icon,
  title,
  allowCustom,
  recommendedValue,
  recommendedLabel = '推荐',
  secondaryRecommendedValue,
  secondaryRecommendedLabel = '常用',
  getOptionMeta,
}) => {
  const [open, setOpen] = useState(false);
  const [customInputs, setCustomInputs] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const commitCustom = () => {
    const next = customValue.trim();
    if (!next) return;
    onChange(title?.includes('数量') || title?.includes('张数') || title?.includes('屏数') ? next.replace(/[^\d]/g, '') || next : next);
    setCustomInputs(false);
    setCustomValue('');
    setOpen(false);
  };

  const isRecommended = Boolean(recommendedValue && value === recommendedValue);
  const isSecondaryRecommended = Boolean(secondaryRecommendedValue && value === secondaryRecommendedValue);
  const selectedOption = options.map(toSelectOption).find((opt) => opt.value === value);
  const displayValue = selectedOption?.label || value;
  const isModelSelect = title?.includes('模型');
  const isResolutionSelect = Boolean(title && (title.includes('分辨率') || title.includes('渲染质量')));
  const displayClassName = isModelSelect ? 'max-w-[142px] truncate' : 'max-w-[92px] truncate';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-[11px] font-medium transition-all"
        style={{
          color: open ? 'var(--accent)' : 'var(--text-secondary)',
          background: open ? 'var(--accent-soft)' : 'var(--bg-elevated)',
        }}
      >
        {icon}
        <span className={displayClassName}>{title?.includes('数量') || title?.includes('张数') || title?.includes('屏数') ? `${String(value).replace(/[^\d]/g, '') || value}张` : displayValue}</span>
        {isRecommended ? (
          <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {recommendedLabel}
          </span>
        ) : isSecondaryRecommended ? (
          <span className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {secondaryRecommendedLabel}
          </span>
        ) : null}
        <ChevronDown size={9} className="transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div
          className={`absolute bottom-full left-0 mb-1.5 rounded-2xl py-2 px-1.5 border z-[200] ${isModelSelect ? 'min-w-[240px]' : 'min-w-[170px]'}`}
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
        >
          {title && (
            <div className="px-3 pb-1.5 mb-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>{title}</span>
            </div>
          )}
          {customInputs ? (
            <div className="px-2 pb-1 pt-1">
              <input
                autoFocus
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if ('Enter' === event.key) commitCustom();
                  if ('Escape' === event.key) setCustomInputs(false);
                }}
                placeholder="请输入自定义"
                className="input-field w-full rounded-2xl px-3 py-2 text-[12px]"
              />
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={commitCustom} className="flex-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>确定</button>
                <button type="button" onClick={() => setCustomInputs(false)} className="rounded-2xl px-3 py-1.5 text-[11px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>返回</button>
              </div>
            </div>
          ) : options.map((optItem) => {
            const opt = toSelectOption(optItem);
            const active = opt.value === value;
            const optionMeta = getOptionMeta?.(opt.value);
            return (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] transition-colors rounded-2xl"
              style={{
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              {active && <Check size={11} />}
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate">{opt.label}</span>
                {isResolutionSelect && optionMeta ? (
                  <span className="mt-0.5 text-[10px] font-medium" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                    {optionMeta}
                  </span>
                ) : null}
              </span>
              {recommendedValue && opt.value === recommendedValue ? (
                <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  {recommendedLabel}
                </span>
              ) : secondaryRecommendedValue && opt.value === secondaryRecommendedValue ? (
                <span className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  {secondaryRecommendedLabel}
                </span>
              ) : null}
            </button>
          );})}
          {allowCustom && !customInputs && (
            <button
              type="button"
              onClick={() => setCustomInputs(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-[12px] transition-colors"
              style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
            >
              <span>+ 自定义</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Main Component ── */
interface Props {
  module: AppModule;
  activeSubFeature?: string;
  promptText: string;
  onPromptChange: (text: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  isSubmitLocked?: boolean;
  currentParams: Record<string, string>;
  onParamChange: (key: string, value: string) => void;
  materials: Record<string, Material[]>;
  oneClickReferencePresets?: OneClickReferencePreset[];
  onUploadMaterial: (type: string, files: FileList | null) => void;
  onApplyPresetMaterials?: (items: Array<{ type: string; url: string; remoteUrl?: string; fileName: string }>) => void;
  onRemoveMaterial: (type: string, id: string) => void;
  systemConfig?: SystemPublicConfig | null;
  generationDisabledReason?: string;
}

const BottomInputBar: React.FC<Props> = ({
  module, activeSubFeature, promptText, onPromptChange, onGenerate, isGenerating: _isGenerating, isSubmitLocked = false,
  currentParams, onParamChange, materials, oneClickReferencePresets, onUploadMaterial, onApplyPresetMaterials, onRemoveMaterial,
  systemConfig, generationDisabledReason = '',
}) => {
  const quickParams = getQuickParamsForModule(module, currentParams, activeSubFeature, systemConfig);
  const extendedSections = getExtendedSectionsForModule(module, currentParams, activeSubFeature);
  const placeholder = getPlaceholderForContext(module, activeSubFeature, currentParams);
  const isSkuPromptMode = module === AppModuleObj.ONE_CLICK && (currentParams.mode || '首图') === 'SKU';
  const skuPromptPlaceholder = '1.填写产品信息后会根据产品信息书写主标题，无产品信息则SKU文案为主标题\n2.尽量填写产品规格，如：净含量：100g（10g*10条）';
  const promptPlaceholder = isSkuPromptMode ? skuPromptPlaceholder : (module === AppModuleObj.TRANSLATION ? '' : placeholder);
  const generateLabel = getGenerateLabelForContext(module, activeSubFeature);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string>('');
  const [typeSelectorOpen, setTypeSelectorOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [oneClickPresetLibraryOpen, setOneClickPresetLibraryOpen] = useState(false);
  const [skuNamingOpen, setSkuNamingOpen] = useState(false);
  const [skuCountOpen, setSkuCountOpen] = useState(false);
  const [xhsPresetOpen, setXhsPresetOpen] = useState(false);
  const [xhsPreviewImage, setXhsPreviewImage] = useState<string | null>(null);
  const [customStoryboardNarrativePresets, setCustomStoryboardNarrativePresets] = useState<StoryboardNarrativePreset[]>(() => loadCustomStoryboardNarrativePresets());
  const [storyboardNarrativeSelectOpen, setStoryboardNarrativeSelectOpen] = useState(false);
  const [storyboardPresetNamingOpen, setStoryboardPresetNamingOpen] = useState(false);
  const [storyboardNarrativeName, setStoryboardNarrativeName] = useState('');
  const isTranslation = module === AppModuleObj.TRANSLATION;
  const isOneClick = module === AppModuleObj.ONE_CLICK;
  const isSkuMode = isOneClick && (currentParams.mode || '首图') === 'SKU';
  const isXhsCover = module === AppModuleObj.XHS_COVER;
  const isBuyerShow = module === AppModuleObj.BUYER_SHOW;
  const isPendingSubFeature = isPendingShellSubFeature(module, activeSubFeature);
  const disabledReason = generationDisabledReason || (isPendingSubFeature ? '该子功能待制作' : '');
  const retouchSizeWarning = module === AppModuleObj.RETOUCH
    ? getRetouchCustomSizeRatioWarning({
      aspectRatio: currentParams.ratio || currentParams.aspectRatio || 'auto',
      sizeMode: currentParams.sizeMode,
      resolutionMode: currentParams.resolutionMode,
      width: currentParams.width || currentParams.targetWidth || '800',
      height: currentParams.height || currentParams.targetHeight || '800',
    })
    : '';
  const isDreaminaVideoGeneration = module === AppModuleObj.VIDEO && (!activeSubFeature || activeSubFeature === 'generation');
  const isStoryboardViralReplicationContext = module === AppModuleObj.VIDEO && activeSubFeature === 'storyboard' && isStoryboardViralReplicationMode(currentParams.videoMode);
  const canGenerateWithoutPrompt = isSkuPromptMode || isTranslation || module === AppModuleObj.RETOUCH || isStoryboardViralReplicationContext;
  const isGenerateDisabled = isSubmitLocked || Boolean(disabledReason) || (!promptText.trim() && !canGenerateWithoutPrompt);
  const isSubmitBusy = isSubmitLocked;
  const submitLabel = isSubmitBusy ? '任务处理中...' : generateLabel;
  const showPromptInput = module !== AppModuleObj.TRANSLATION;
  const contextMaterialTypes = getMaterialTypesForContext(module, currentParams, activeSubFeature);
  const buyerShowSetCount = isBuyerShow ? getBuyerShowSetCount(currentParams) : 1;
  const shouldShowUpload = !(module === AppModuleObj.VIDEO && activeSubFeature === 'diagnosis');
  const billingMaterialCount = module === AppModuleObj.TRANSLATION
    ? (materials.product || []).filter((item) => !item.subFeature || item.subFeature === activeSubFeature).length
    : 0;
  const imageBillingEstimate = estimateImageBilling({
    module,
    subFeature: activeSubFeature || '',
    params: currentParams,
    materialCount: billingMaterialCount,
  });
  const seedanceBillingEstimate = isDreaminaVideoGeneration
    ? estimateSeedanceFastBilling({
        accessMode: getSeedanceVideoAccessMode(normalizeDreaminaUiMode(currentParams.dreaminaMode), currentParams.modelVersion),
        duration: currentParams.duration || '5秒',
        resolution: currentParams.videoResolution || '720p',
        hasVideoInput: (materials.referenceVideo || []).length > 0,
      })
    : { billable: false, estimatedCredits: 0 };
  const billingEstimate = seedanceBillingEstimate.billable ? seedanceBillingEstimate : imageBillingEstimate;

  useEffect(() => {
    setTypeSelectorOpen(false);
    setUploadMenuOpen(false);
    setPopoverOpen(false);
    setOneClickPresetLibraryOpen(false);
    setSkuNamingOpen(false);
    setSkuCountOpen(false);
    setXhsPresetOpen(false);
    setXhsPreviewImage(null);
    setStoryboardNarrativeSelectOpen(false);
    setStoryboardPresetNamingOpen(false);
    setUploadTarget('');
  }, [module, activeSubFeature, currentParams.mode]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [promptText]);

  const getVal = useCallback((key: string, def: string) => currentParams[key] ?? def, [currentParams]);
  const getSelectValue = useCallback((param: ParamItem) => {
    const current = getVal(param.key, param.defaultValue);
    if (param.key !== 'analysisModel') return current;
    const validValues = param.options.map(toSelectOption).map((option) => option.value);
    return validValues.includes(current) ? current : param.defaultValue;
  }, [getVal]);

  const handleTranslationParamChange = useCallback((key: string, value: string) => {
    if (module === AppModuleObj.VIDEO && activeSubFeature === 'storyboard') {
      onParamChange(key, value);
      if (key === 'duration') {
        const recommendedShotCount = getRecommendedStoryboardShotCount(value);
        onParamChange('shotCount', recommendedShotCount);
      }
      return;
    }

    if (module === AppModuleObj.RETOUCH) {
      if (key === 'model') {
        const safeRatio = getSafeRetouchAspectRatioForModel(value, currentParams.ratio || currentParams.aspectRatio || 'auto');
        onParamChange('model', value);
        onParamChange('ratio', safeRatio);
        onParamChange('aspectRatio', safeRatio);
        return;
      }
      if (key === 'ratio' || key === 'aspectRatio') {
        const safeRatio = getSafeRetouchAspectRatioForModel(currentParams.model || 'GPT Image 2', value);
        onParamChange('ratio', safeRatio);
        onParamChange('aspectRatio', safeRatio);
        return;
      }
      onParamChange(key, value);
      return;
    }

    if (module !== AppModuleObj.TRANSLATION) {
      onParamChange(key, value);
      return;
    }

    const defaults = getTranslationSizeDefaults(activeSubFeature);
    const currentRatio = String(currentParams.ratio || currentParams.aspectRatio || defaults.ratio);
    const currentWidth = String(currentParams.targetWidth || currentParams.width || defaults.width);
    const currentHeight = String(currentParams.targetHeight || currentParams.height || defaults.height);

    if (key === 'ratio' || key === 'aspectRatio' || key === 'targetWidth' || key === 'targetHeight') {
      const nextAspectRatio = key === 'ratio' || key === 'aspectRatio' ? value : currentRatio;
      const nextSize = deriveLinkedTranslationSize({
        aspectRatio: nextAspectRatio,
        targetWidth: key === 'targetWidth' ? value : currentWidth,
        targetHeight: key === 'targetHeight' ? value : currentHeight,
        changedKey: key === 'aspectRatio' ? 'ratio' : key,
        fallbackWidth: defaults.width,
        fallbackHeight: defaults.height,
      });

      if (key === 'ratio' || key === 'aspectRatio') {
        onParamChange('ratio', value);
        onParamChange('aspectRatio', value);
      }

      onParamChange('targetWidth', nextSize.targetWidth);
      onParamChange('width', nextSize.targetWidth);
      onParamChange('targetHeight', nextSize.targetHeight);
      onParamChange('height', nextSize.targetHeight);
      return;
    }

    onParamChange(key, value);
  }, [activeSubFeature, currentParams.aspectRatio, currentParams.height, currentParams.ratio, currentParams.targetHeight, currentParams.targetWidth, currentParams.width, module, onParamChange]);

  const handleMaterialTypeSelect = (type: MaterialType) => {
    setUploadTarget(type);
    setTypeSelectorOpen(false);
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const storyboardNarrativePresets = [...BUILTIN_STORYBOARD_NARRATIVE_PRESETS, ...customStoryboardNarrativePresets];

  const applyStoryboardNarrativePreset = (preset: StoryboardNarrativePreset) => {
    onParamChange('scriptPreset', preset.scriptPreset);
    onParamChange('selectedStoryboardNarrativePresetId', preset.id);
    if (preset.content) {
      onParamChange('scriptLogic', preset.content);
    }
    setStoryboardNarrativeSelectOpen(false);
  };

  const selectAddStoryboardNarrativePreset = () => {
    onParamChange('scriptPreset', 'custom');
    onParamChange('selectedStoryboardNarrativePresetId', STORYBOARD_ADD_PRESET_ID);
    setStoryboardNarrativeSelectOpen(false);
  };

  const saveStoryboardNarrativePreset = () => {
    const name = storyboardNarrativeName.trim();
    const content = String(currentParams.scriptLogic || '').trim();
    if (!name || !content) return;
    const nextPreset: StoryboardNarrativePreset = {
      id: `custom_${Date.now()}`,
      name,
      content,
      scriptPreset: 'custom',
    };
    const nextPresets = [nextPreset, ...customStoryboardNarrativePresets].slice(0, 12);
    setCustomStoryboardNarrativePresets(nextPresets);
    saveCustomStoryboardNarrativePresets(nextPresets);
    setStoryboardNarrativeName('');
    setStoryboardPresetNamingOpen(false);
    onParamChange('scriptPreset', 'custom');
    onParamChange('selectedStoryboardNarrativePresetId', nextPreset.id);
    onParamChange('scriptLogic', nextPreset.content);
  };

  const renderStoryboardNarrativeControls = () => {
    if (module !== AppModuleObj.VIDEO || activeSubFeature !== 'storyboard') return null;
    if (isStoryboardViralReplicationMode(currentParams.videoMode)) return null;
    const selectedPresetId = currentParams.selectedStoryboardNarrativePresetId || currentParams.scriptPreset || 'custom';
    const currentLogic = getVal('scriptLogic', '');
    const isAddingPreset = selectedPresetId === STORYBOARD_ADD_PRESET_ID;
    const selectedPreset = storyboardNarrativePresets.find((preset) => preset.id === selectedPresetId) || BUILTIN_STORYBOARD_NARRATIVE_PRESETS[0];
    const selectedLabel = isAddingPreset ? '增加预设' : selectedPreset.name;
    return (
      <div className="relative rounded-2xl p-3" style={{ background: 'var(--bg-surface)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>叙事逻辑</p>
            <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              当前：{selectedLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStoryboardNarrativeSelectOpen((value) => !value)}
            className="flex shrink-0 items-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-medium"
            style={{
              background: storyboardNarrativeSelectOpen ? 'var(--accent-soft)' : 'var(--bg-elevated)',
              color: storyboardNarrativeSelectOpen ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <span>选择逻辑</span>
            <ChevronDown size={10} style={{ transform: storyboardNarrativeSelectOpen ? 'rotate(180deg)' : 'none' }} />
          </button>
        </div>

        {storyboardNarrativeSelectOpen && (
          <>
            <div className="fixed inset-0 z-[210]" onClick={() => setStoryboardNarrativeSelectOpen(false)} />
            <div
              className="absolute right-0 top-full z-[230] mt-2 w-[280px] max-w-[calc(100vw-48px)] rounded-3xl border p-2"
              style={{
                background: 'var(--bg-base)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-elevated)',
                animation: 'scale-in 0.18s ease',
              }}
            >
              <div className="px-3 pb-1.5 pt-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>选择叙事逻辑</span>
              </div>
              <div className="mt-1 grid gap-1">
                {storyboardNarrativePresets.map((preset) => {
                  const active = selectedPresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyStoryboardNarrativePreset(preset)}
                      className="flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-[12px] transition-all"
                      style={{
                        background: active ? 'var(--accent-soft)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {active && <Check size={11} />}
                      <span className="truncate">{preset.name}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={selectAddStoryboardNarrativePreset}
                  className="mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-[12px] transition-all"
                  style={{
                    background: isAddingPreset ? 'var(--accent-soft)' : 'transparent',
                    color: isAddingPreset ? 'var(--accent)' : 'var(--accent)',
                  }}
                >
                  <Plus size={12} />
                  <span>增加预设</span>
                </button>
              </div>
            </div>
          </>
        )}

        <label className="mt-3 mb-1.5 block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>自定义叙事逻辑</label>
        <textarea
          value={currentLogic}
          onChange={(event) => {
            onParamChange('scriptLogic', event.target.value);
            onParamChange('scriptPreset', 'custom');
            if (!isAddingPreset) onParamChange('selectedStoryboardNarrativePresetId', 'custom');
          }}
          placeholder="输入你想要的分镜逻辑、节奏、重点画面..."
          rows={4}
          className="input-field w-full resize-none rounded-2xl text-[12px]"
        />

        {isAddingPreset && (
          <button
            type="button"
            onClick={() => {
              setStoryboardNarrativeName('');
              setStoryboardPresetNamingOpen(true);
            }}
            disabled={!currentLogic.trim()}
            className="mt-2 w-full rounded-2xl px-3 py-2 text-[11px] font-medium text-white transition-all disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            保存预设
          </button>
        )}

        {storyboardPresetNamingOpen && (
          <>
            <div className="fixed inset-0 z-[240]" onClick={() => setStoryboardPresetNamingOpen(false)} />
            <div
              className="fixed left-1/2 top-1/2 z-[260] w-[320px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border p-4"
              style={{
                background: 'var(--bg-base)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-elevated)',
                animation: 'scale-in 0.18s ease',
              }}
            >
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>请给预设命名</p>
              <input
                autoFocus
                value={storyboardNarrativeName}
                onChange={(event) => setStoryboardNarrativeName(event.target.value)}
                placeholder="例如：3秒强钩子带货"
                className="input-field mt-3 h-9 w-full rounded-2xl text-[12px]"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setStoryboardPresetNamingOpen(false)}
                  className="rounded-2xl px-3 py-2 text-[11px] font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={saveStoryboardNarrativePreset}
                  disabled={!storyboardNarrativeName.trim() || !currentLogic.trim()}
                  className="rounded-2xl px-3 py-2 text-[11px] font-medium text-white transition-all disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  保存
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !uploadTarget) return;
    onUploadMaterial(uploadTarget, files);
    e.target.value = '';
    setUploadTarget('');
  };

  const onFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    onUploadMaterial('product', files);
    e.target.value = '';
  };

  const renderBuyerShowSetDirections = () => {
    if (!isBuyerShow || buyerShowSetCount <= 1) return null;
    return (
      <div className="col-span-2 mt-2 grid gap-2">
        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          选择多套后，每套分别填写不同场景、人物状态、拍摄氛围或内容方向。
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Array.from({ length: buyerShowSetCount }).map((_, index) => {
          const key = `buyerShowSetDirection_${index}`;
          return (
            <div key={key} className="rounded-2xl p-3" style={{ background: 'var(--bg-elevated)' }}>
              <label className="mb-1.5 block text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                第 {index + 1} 套场景要求
              </label>
              <textarea
                value={getVal(key, '')}
                onChange={(event) => onParamChange(key, event.target.value)}
                placeholder={`第 ${index + 1} 套要写什么场景、人物状态、拍摄氛围或内容方向...`}
                rows={3}
                className="input-field w-full resize-none rounded-2xl text-[12px]"
              />
            </div>
          );
          })}
        </div>
      </div>
    );
  };

  const getOneClickPresetKind = () => {
    if (!isOneClick) return null;
    const mode = currentParams.mode || '首图';
    if (mode === '首图') return 'hero';
    if (mode === '主图') return 'main';
    if (mode === '详情页') return 'detail';
    if (mode === 'SKU') return 'sku';
    return null;
  };

  const getOneClickUploadLabel = (type: MaterialType) => {
    const mode = currentParams.mode || '首图';
    if (type === 'product') return '素材上传';
    if (type === 'gift') return '赠品上传';
    if (type === 'logo') return 'Logo上传';
    if (type === 'styleRef') return mode === 'SKU' ? '风格参考' : '风格参考';
    return '参考素材';
  };

  const getOneClickUploadDesc = (type: MaterialType) => {
    if (type === 'product') return '产品主体原图';
    if (type === 'gift') return '按顺序编号赠品';
    if (type === 'logo') return '品牌标识素材';
    if (type === 'styleRef') return '版式与视觉参考';
    return '参考素材';
  };

  const getOneClickUploadIcon = (type: MaterialType) => {
    if (type === 'logo') return <Type size={15} />;
    if (type === 'gift') return <Sparkles size={15} />;
    if (type === 'styleRef') return <Palette size={15} />;
    return <ImagePlus size={15} />;
  };

  const onApplyOneClickPresets = (presets: Preset[]) => {
    const nextMaterials = presets
      .filter((preset) => preset.imageUrl)
      .map((preset) => ({
        type: preset.type === 'logo' ? 'logo' : 'styleRef',
        url: preset.imageUrl,
        remoteUrl: preset.imageUrl,
        fileName: preset.name,
      }));
    if (nextMaterials.length > 0) onApplyPresetMaterials?.(nextMaterials);
    setOneClickPresetLibraryOpen(false);
  };

  const skuRowCount = Math.max(1, Math.min(20, Number(currentParams.count || ONE_CLICK_COUNT_DEFAULTS.SKU) || 4));
  const [skuCountDraft, setSkuCountDraft] = useState(String(skuRowCount));
  const setSkuRowCount = (nextCount: number) => {
    const bounded = Math.max(1, Math.min(20, nextCount));
    onParamChange('count', String(bounded));
  };

  useEffect(() => {
    if (skuCountOpen) {
      setSkuCountDraft(String(skuRowCount));
    }
  }, [skuCountOpen, skuRowCount]);

  const commitSkuCountDraft = () => {
    const next = Math.max(1, Math.min(20, Number(skuCountDraft.replace(/[^\d]/g, '')) || 1));
    setSkuRowCount(next);
    setSkuCountOpen(false);
  };

  const renderSkuNamingAction = () => {
    if (!isSkuMode) return null;
    return (
      <div className="relative rounded-2xl p-0.5" style={{ background: 'var(--bg-elevated)' }}>
        <button
          type="button"
          onClick={() => setSkuNamingOpen((value) => !value)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-2xl text-[11px] font-medium transition-all"
          style={{
            color: skuNamingOpen ? 'var(--accent)' : 'var(--text-secondary)',
            background: skuNamingOpen ? 'var(--accent-soft)' : 'transparent',
          }}
        >
          <Type size={12} />
          <span>SKU 命名</span>
        </button>

        {skuNamingOpen && (
          <>
            <div className="fixed inset-0 z-[180]" onClick={() => setSkuNamingOpen(false)} />
            <div
              className="absolute bottom-full left-0 mb-2 w-[408px] max-w-[calc(100vw-48px)] rounded-3xl border p-4 z-[200] overflow-hidden"
              style={{
                background: 'var(--bg-base)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-elevated)',
                animation: 'scale-in 0.18s ease',
              }}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>SKU 命名</p>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>产品名称和卖点沿用主输入框，生成几张就填写几个 SKU 命名。</p>
                </div>
                <button onClick={() => setSkuNamingOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-2xl" style={{ color: 'var(--text-tertiary)' }}>
                  <X size={14} />
                </button>
              </div>

              <div className="mb-3 rounded-2xl border px-3 py-2" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>生成张数</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>同步 {skuRowCount} 个 SKU 命名项</p>
                  </div>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setSkuCountOpen((value) => !value)}
                      className="flex items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium"
                      style={{ background: skuCountOpen ? 'var(--accent-soft)' : 'var(--bg-elevated)', color: skuCountOpen ? 'var(--accent)' : 'var(--text-secondary)' }}
                    >
                      <BoxSelect size={12} />
                      <span>{skuRowCount}张</span>
                      <ChevronDown size={10} />
                    </button>
                    {skuCountOpen && (
                      <div
                        className="absolute right-0 top-full z-[220] mt-2 w-[258px] max-w-[calc(100vw-48px)] rounded-3xl border p-3.5 overflow-hidden"
                        style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
                      >
                        <div className="grid grid-cols-3 gap-2">
                          {['2', '4', '6'].map((value) => {
                            const active = String(skuRowCount) === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => { setSkuRowCount(Number(value)); setSkuCountOpen(false); }}
                                className="rounded-2xl px-2 py-2 text-[11px] font-medium"
                                style={{ background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
                              >
                                {value}张
                              </button>
                            );
                          })}
                        </div>
                        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={skuCountDraft}
                            onChange={(event) => setSkuCountDraft(event.target.value.replace(/[^\d]/g, ''))}
                            onKeyDown={(event) => {
                              if (isImeComposing(event)) return;
                              if ('Enter' === event.key) commitSkuCountDraft();
                              if ('Escape' === event.key) setSkuCountOpen(false);
                            }}
                            onBlur={commitSkuCountDraft}
                            className="input-field h-9 min-w-0 rounded-2xl text-[12px]"
                            placeholder="自定义"
                          />
                          <button
                            type="button"
                            onClick={() => setSkuCountOpen(false)}
                            className="shrink-0 rounded-2xl px-3 py-2 text-[11px] font-medium whitespace-nowrap"
                            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            确定
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="max-h-[250px] space-y-2 overflow-y-auto pr-1">
                {Array.from({ length: skuRowCount }).map((_, index) => (
                  <div key={`sku-${index}`} className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{index + 1}</span>
                    <input
                      value={getVal(`skuCopyText_${index}`, '')}
                      onChange={(event) => onParamChange(`skuCopyText_${index}`, event.target.value)}
                      placeholder={'SKU文案："主体X1+赠品一X1+赠品二X5"'}
                      className="input-field h-9 min-w-0 flex-1 rounded-2xl text-[12px]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const selectedXhsStyleId = (currentParams.selectedStyleIds || '')
    .split(',')
    .map((item) => item.trim())
    .find(Boolean) || '';
  const selectedXhsStyle = XHS_COVER_STYLES.find((style) => style.id === selectedXhsStyleId) || null;

  const selectXhsStyle = (id: string) => {
    onParamChange('selectedStyleIds', id);
    const selectedStyle = XHS_COVER_STYLES.find((style) => style.id === id);
    if (selectedStyle) {
      onParamChange('styleCategory', selectedStyle.category);
    }
    setXhsPresetOpen(false);
  };

  const renderXhsPresetLibraryPopover = () => {
    if (!isXhsCover) return null;
    return (
      <>
        {xhsPresetOpen && (
          <>
            <div className="fixed inset-0 z-[180]" onClick={() => setXhsPresetOpen(false)} />
            <div
              className="absolute bottom-full left-0 z-[200] mb-2 w-[560px] max-w-[calc(100vw-48px)] rounded-3xl border p-4"
              style={{
                background: 'var(--bg-base)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-elevated)',
                animation: 'scale-in 0.18s ease',
              }}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>小红书预设库</p>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>沿用旧版 5 类 18 个封面风格，可点图放大参考效果。</p>
                </div>
                <button type="button" onClick={() => setXhsPresetOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-2xl" style={{ color: 'var(--text-tertiary)' }}>
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-[430px] space-y-4 overflow-y-auto pr-1">
                {XHS_STYLE_CATEGORIES.map((category) => (
                  <div key={category.label}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-3.5 w-1 rounded-full" style={{ background: 'var(--accent)' }} />
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{category.label}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{category.ids.length}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                      {category.ids.map((id) => {
                        const style = XHS_COVER_STYLES.find((item) => item.id === id);
                        if (!style) return null;
                        const selected = selectedXhsStyleId === style.id;
                        return (
                          <button
                            key={style.id}
                            type="button"
                            onClick={() => selectXhsStyle(style.id)}
                            className="group overflow-hidden rounded-2xl text-left transition-all"
                            style={{
                              background: selected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                              boxShadow: selected ? '0 0 0 1px var(--accent)' : 'none',
                            }}
                          >
                            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl">
                              <img src={style.previewImage} alt={style.name} loading="lazy" className="h-full w-full object-cover" />
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); setXhsPreviewImage(style.previewImage); }}
                                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
                                style={{ background: 'rgba(0,0,0,0.42)', color: '#fff' }}
                                title="放大预览"
                              >
                                <Search size={12} />
                              </button>
                              {selected && (
                                <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}>
                                  <Check size={11} />
                                </span>
                              )}
                            </div>
                            <div className="px-2 py-1.5">
                              <p className="truncate text-center text-[10px] font-medium" style={{ color: selected ? 'var(--accent)' : 'var(--text-secondary)' }}>{style.name}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        {xhsPreviewImage && (
          <div
            className="fixed inset-0 z-[260] flex items-center justify-center p-6"
            style={{ background: 'rgba(0,0,0,0.76)', backdropFilter: 'blur(10px)' }}
            onClick={() => setXhsPreviewImage(null)}
          >
            <img src={xhsPreviewImage} alt="小红书预设放大预览" className="max-h-[86vh] max-w-full rounded-3xl object-contain" onClick={(event) => event.stopPropagation()} />
          </div>
        )}
      </>
    );
  };

  const displayMaterials = {
    ...materials,
    ...(isXhsCover && selectedXhsStyle ? {
      xhsPreset: [{
        id: selectedXhsStyle.id,
        type: 'xhsPreset',
        url: selectedXhsStyle.previewImage,
        fileName: selectedXhsStyle.name,
      } as Material],
    } : {}),
  };

  const handlePreviewRemove = (type: string, id: string) => {
    if (type === 'xhsPreset') {
      onParamChange('selectedStyleIds', '');
      return;
    }
    onRemoveMaterial(type, id);
  };

  return (
    <div className="shrink-0" style={{ background: 'var(--bg-base)' }}>
      <div className="px-6 pt-4 pb-5">
        {/* Material previews — grouped by type */}
        <MaterialPreviewBar materials={displayMaterials} onRemoveMaterial={handlePreviewRemove} />
        {isDreaminaVideoGeneration && (
          <div className="mx-auto mb-3 flex max-w-[896px] flex-col gap-1 rounded-2xl border px-4 py-2.5 text-[12px] leading-relaxed" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>
            <span>{getDreaminaModeGuidance(currentParams)}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{getDreaminaCreditHint(currentParams)}</span>
          </div>
        )}

        {/* Input container — much larger */}
        <div
          className="mx-auto w-full max-w-[896px] rounded-3xl border transition-all"
          style={{
            borderColor: showPromptInput && promptText ? 'var(--accent)' : 'var(--border-subtle)',
            background: 'var(--bg-surface)',
            boxShadow: showPromptInput && promptText ? '0 0 0 3px var(--accent-soft)' : 'none',
          }}
        >
          {showPromptInput && (
            <div className="px-5 pt-5 pb-3">
              <textarea
                ref={textareaRef}
                value={promptText}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder={promptPlaceholder}
                rows={3}
                className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-[var(--text-tertiary)]"
                style={{ color: 'var(--text-primary)', minHeight: 64 }}
                onKeyDown={(e) => {
                  if ('Enter' !== e.key || e.shiftKey || isImeComposing(e)) return;
                  e.preventDefault();
                  if (!isGenerateDisabled) onGenerate();
                }}
              />
            </div>
          )}

          {/* Toolbar */}
          <div className={`flex items-center justify-between px-3 ${showPromptInput ? 'pb-3' : 'py-5'}`}>
            {/* Left toolbar */}
            <div className="flex items-center gap-1 flex-wrap">
              {/* Upload */}
              <div className="relative" style={{ display: shouldShowUpload ? undefined : 'none' }}>
                {isTranslation ? (
                  <>
                    <button
                      onClick={() => setUploadMenuOpen((v) => !v)}
                      className="flex items-center justify-center w-9 h-9 rounded-2xl transition-colors"
                      style={{ color: Object.values(materials).some(list => list.length > 0) ? 'var(--accent)' : 'var(--text-tertiary)' }}
                      title="上传"
                    >
                      <ImagePlus size={17} />
                    </button>
                    <input ref={fileInputRef} type="file" accept={getUploadAcceptForTarget(uploadTarget)} multiple className="hidden" onChange={onFileSelect} />
                    <input ref={folderInputRef} type="file" {...{ webkitdirectory: "true", directory: "true" }} multiple className="hidden" onChange={onFolderSelect} />
                    {uploadMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-[180]" onClick={() => setUploadMenuOpen(false)} />
                        <div
                          className="absolute bottom-full left-0 mb-2 rounded-2xl border p-2 z-[200] min-w-[180px]"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)', animation: 'scale-in 0.15s ease' }}
                        >
                          <button
                            onClick={() => { setUploadTarget('product'); setUploadMenuOpen(false); setTimeout(() => fileInputRef.current?.click(), 50); }}
                            className="flex items-center gap-2.5 w-full p-2.5 rounded-2xl text-left text-[12px] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          >
                            <ImagePlus size={14} /> 单图/多图上传
                          </button>
                          <button
                            onClick={() => { setUploadMenuOpen(false); setTimeout(() => folderInputRef.current?.click(), 50); }}
                            className="flex items-center gap-2.5 w-full p-2.5 rounded-2xl text-left text-[12px] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          >
                            <Folder size={14} /> 文件夹上传
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : isOneClick ? (
                  <>
                    <button
                      onClick={() => setUploadMenuOpen((v) => !v)}
                      className="flex items-center justify-center w-9 h-9 rounded-2xl transition-colors"
                      style={{ color: Object.values(materials).some(list => list.length > 0) ? 'var(--accent)' : 'var(--text-tertiary)' }}
                      title="上传与预设"
                    >
                      <ImagePlus size={17} />
                    </button>
                    <input ref={fileInputRef} type="file" accept={getUploadAcceptForTarget(uploadTarget)} multiple className="hidden" onChange={onFileSelect} />
                    {uploadMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-[180]" onClick={() => setUploadMenuOpen(false)} />
                        <div
                          className="absolute bottom-full left-0 mb-2 rounded-2xl border p-2 z-[200] w-[260px]"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)', animation: 'scale-in 0.15s ease' }}
                        >
                          <div className="grid grid-cols-2 gap-1.5">
                            {(contextMaterialTypes || []).map((type) => (
                              <button
                                key={type}
                                onClick={() => { setUploadTarget(type); setUploadMenuOpen(false); setTimeout(() => fileInputRef.current?.click(), 50); }}
                                className="flex min-h-[62px] flex-col items-start justify-center gap-1 rounded-2xl p-3 text-left transition-colors"
                                style={{ color: 'var(--text-secondary)' }}
                                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                              >
                                <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                                  {getOneClickUploadIcon(type)}
                                  {getOneClickUploadLabel(type)}
                                </span>
                                <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{getOneClickUploadDesc(type)}</span>
                              </button>
                            ))}
                            <button
                              onClick={() => { setUploadMenuOpen(false); setOneClickPresetLibraryOpen(true); }}
                              className="flex min-h-[62px] flex-col items-start justify-center gap-1 rounded-2xl p-3 text-left transition-colors"
                              style={{ color: 'var(--text-secondary)' }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                            >
                              <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                                <Palette size={15} />
                                预设库
                              </span>
                              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>按当前子功能筛选</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : isXhsCover ? (
                  <>
                    <button
                      onClick={() => setUploadMenuOpen((v) => !v)}
                      className="flex items-center justify-center w-9 h-9 rounded-2xl transition-colors"
                      style={{ color: Object.values(displayMaterials).some(list => list.length > 0) ? 'var(--accent)' : 'var(--text-tertiary)' }}
                      title="上传与预设"
                    >
                      <ImagePlus size={17} />
                    </button>
                    <input ref={fileInputRef} type="file" accept={getUploadAcceptForTarget(uploadTarget)} multiple className="hidden" onChange={onFileSelect} />
                    {uploadMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-[180]" onClick={() => setUploadMenuOpen(false)} />
                        <div
                          className="absolute bottom-full left-0 mb-2 rounded-2xl border p-2 z-[200] min-w-[190px]"
                          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)', animation: 'scale-in 0.15s ease' }}
                        >
                          <button
                            onClick={() => { setUploadTarget('product'); setUploadMenuOpen(false); setTimeout(() => fileInputRef.current?.click(), 50); }}
                            className="flex items-center gap-2.5 w-full p-2.5 rounded-2xl text-left text-[12px] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          >
                            <ImagePlus size={14} /> 素材上传
                          </button>
                          <button
                            onClick={() => { setUploadTarget('styleRef'); setUploadMenuOpen(false); setTimeout(() => fileInputRef.current?.click(), 50); }}
                            className="flex items-center gap-2.5 w-full p-2.5 rounded-2xl text-left text-[12px] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          >
                            <Palette size={14} /> 封面参考
                          </button>
                          <button
                            onClick={() => { setUploadMenuOpen(false); setXhsPresetOpen(true); }}
                            className="flex items-center gap-2.5 w-full p-2.5 rounded-2xl text-left text-[12px] transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          >
                            <Palette size={14} /> 封面预设库
                          </button>
                        </div>
                      </>
                    )}
                    {renderXhsPresetLibraryPopover()}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setTypeSelectorOpen((v) => !v)}
                      className="flex items-center justify-center w-9 h-9 rounded-2xl transition-colors"
                      style={{ color: Object.values(materials).some(list => list.length > 0) ? 'var(--accent)' : 'var(--text-tertiary)' }}
                      title="上传素材"
                    >
                      <ImagePlus size={17} />
                    </button>
                    <input ref={fileInputRef} type="file" accept={getUploadAcceptForTarget(uploadTarget)} multiple className="hidden" onChange={onFileSelect} />
                    <UploadTypeSelector
                      module={module}
                      open={typeSelectorOpen}
                      onClose={() => setTypeSelectorOpen(false)}
                      onSelect={handleMaterialTypeSelect}
                      materialTypes={contextMaterialTypes}
                      materialLabels={
                        activeSubFeature === 'storyboard'
                          ? getStoryboardMaterialLabels(currentParams)
                          : isDreaminaVideoGeneration
                            ? getDreaminaMaterialLabels(currentParams)
                            : undefined
                      }
                    />
                  </>
                )}
              </div>

              {isOneClick && (
                <PresetLibrary
                  open={oneClickPresetLibraryOpen}
                  onClose={() => setOneClickPresetLibraryOpen(false)}
                  onApply={onApplyOneClickPresets}
                  lockedKind={getOneClickPresetKind()}
                  oneClickPresets={oneClickReferencePresets}
                />
              )}

              {/* Quick params */}
                  {quickParams.map((p) => (
                <React.Fragment key={p.key}>
                  <CompactSelect
                    value={getSelectValue(p)}
                    options={p.options}
                    onChange={(v) => handleTranslationParamChange(p.key, v)}
                    icon={p.icon}
                    title={p.title}
                    allowCustom={p.allowCustom}
                    recommendedValue={p.recommendedValue || (p.key === 'model' ? 'GPT Image 2' : p.key === 'quality' ? '1K' : undefined)}
                    recommendedLabel={p.recommendedLabel || '推荐'}
                    secondaryRecommendedValue={p.secondaryRecommendedValue}
                    secondaryRecommendedLabel={p.secondaryRecommendedLabel}
                    getOptionMeta={p.key === 'quality'
                      ? (resolution) => `${getImageModelCreditCost(currentParams.model || 'GPT Image 2', resolution)} 积分/张`
                      : undefined}
                  />
                  {p.key === 'mode' && renderSkuNamingAction()}
                </React.Fragment>
              ))}

              {/* More popover */}
              {extendedSections.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setPopoverOpen((v) => !v)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-2xl text-[11px] font-medium transition-all"
                    style={{ color: popoverOpen ? 'var(--accent)' : 'var(--text-tertiary)', background: popoverOpen ? 'var(--accent-soft)' : 'transparent' }}
                  >
                    <SlidersHorizontal size={12} />
                    <span>更多</span>
                  </button>

                  {popoverOpen && (
                    <>
                      <div className="fixed inset-0 z-[180]" onClick={() => setPopoverOpen(false)} />
                      <div
                        className="absolute bottom-full left-0 mb-2 rounded-3xl border p-4 z-[200] min-w-[320px] max-w-[400px]"
                        style={{
                          background: 'var(--bg-base)',
                          borderColor: 'var(--border-subtle)',
                          boxShadow: 'var(--shadow-elevated)',
                          animation: 'scale-in 0.18s ease',
                        }}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>高级参数</span>
                          <button onClick={() => setPopoverOpen(false)} className="w-8 h-8 rounded-2xl flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
                            <X size={14} />
                          </button>
                        </div>
                        <div className="space-y-3">
                          {renderStoryboardNarrativeControls()}
                          {extendedSections.map((section) => (
                            <div
                              key={section.section}
                              className="rounded-2xl p-3"
                              style={{ background: 'var(--bg-surface)' }}
                            >
                              <p className="text-[12px] font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>{section.section}</p>
                              <div className="grid grid-cols-2 gap-2.5">
                                {section.params.map((p) => {
                                  const val = getVal(p.key, p.defaultValue || '');
                                  if (
                                    module === AppModuleObj.TRANSLATION &&
                                    (activeSubFeature === 'detail' || activeSubFeature === 'remove_text') &&
                                    p.key === 'targetHeight'
                                  ) {
                                    return null;
                                  }
                                  if (p.type === 'select') return (
                                    <div key={p.key}>
                                      <label className="block text-[10px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>{p.label}</label>
                                      <CompactSelect value={val} options={p.options || []} onChange={(v) => handleTranslationParamChange(p.key, v)} allowCustom={p.allowCustom} />
                                    </div>
                                  );
                                  if (p.type === 'number') return (
                                    <div key={p.key}>
                                      <label className="block text-[10px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>{p.label}</label>
                                      <input type="number" value={val} onChange={(e) => handleTranslationParamChange(p.key, e.target.value)} className="input-field w-full text-[12px] py-1.5 rounded-2xl" />
                                    </div>
                                  );
                                  if (p.type === 'checkbox') {
                                    const checked = val === 'true' || val === '1' || val === '是';
                                    return (
                                      <label
                                        key={p.key}
                                        className="col-span-2 flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2"
                                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(event) => onParamChange(p.key, event.target.checked ? 'true' : 'false')}
                                          className="h-4 w-4 accent-[var(--accent)]"
                                        />
                                        <span className="text-[12px] font-medium">{p.label}</span>
                                      </label>
                                    );
                                  }
                                  if (p.type === 'textarea') return (
                                    <div key={p.key} className="col-span-2">
                                      <label className="block text-[10px] mb-1.5" style={{ color: 'var(--text-tertiary)' }}>{p.label}</label>
                                      <textarea value={val} onChange={(e) => onParamChange(p.key, e.target.value)} placeholder={p.placeholder} rows={p.rows || 2} className="input-field w-full text-[12px] resize-none rounded-2xl" />
                                    </div>
                                  );
                                  return null;
                                })}
                                {section.section === '批量' && renderBuyerShowSetDirections()}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

            </div>

            {/* Generate button — rounded-3xl, larger */}
            <div className="flex shrink-0 flex-col items-center gap-1">
              {disabledReason && (
                <p className="whitespace-nowrap text-center text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                  {disabledReason}
                </p>
              )}
              {retouchSizeWarning && (
                <p className="max-w-[220px] text-center text-[10px] font-semibold leading-4" style={{ color: 'var(--warning, #d97706)' }}>
                  {retouchSizeWarning}
                </p>
              )}
              {billingEstimate.billable && billingEstimate.estimatedCredits > 0 && (
                <p className="whitespace-nowrap text-center text-[10px] font-semibold tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                  预计消耗 {billingEstimate.estimatedCredits} 积分
                </p>
              )}
              <button
                onClick={onGenerate}
                disabled={isGenerateDisabled}
                className="flex items-center gap-2 px-5 py-2.5 rounded-3xl text-[13px] font-semibold text-white transition-all disabled:opacity-30"
                style={{ background: 'var(--accent)' }}
              >
                {isSubmitBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                <span>{submitLabel}</span>
              </button>
            </div>
          </div>
      </div>
      </div>

    </div>
  );
};

export default BottomInputBar;
