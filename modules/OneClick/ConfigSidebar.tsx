
import React, { useRef, useState, useEffect } from 'react';
import { AspectRatio, OneClickConfig, OneClickSubMode, GenerationQuality, StyleStrength, GlobalApiConfig } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { uploadToCos } from '../../services/tencentCosService';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../../utils/modelQuality';
import { getSafeAspectRatioForModel, getSupportedAspectRatiosForModel } from '../../utils/modelAspectRatio';
import { PopoverSelect, PrimaryActionButton, SegmentedTabs, SidebarShell } from '../../components/ui/workspacePrimitives';

interface Props {
  subMode?: OneClickSubMode;
  currentSubMode?: OneClickSubMode;
  onSubModeChange?: (mode: OneClickSubMode) => void;
  config: OneClickConfig;
  onChange: (config: OneClickConfig) => void;
  productImages: File[];
  setProductImages: React.Dispatch<React.SetStateAction<File[]>>;
  styleImage: File | null;
  setStyleImage: React.Dispatch<React.SetStateAction<File | null>>;
  uploadedProductUrls?: string[];
  uploadedStyleUrl?: string | null;
  onUploadedProductUrlsChange?: (urls: string[]) => void;
  onUploadedStyleUrlChange?: (url: string | null) => void;
  apiConfig: GlobalApiConfig;
  disabled?: boolean;
  onStart: () => void;
  onSyncConfig?: () => void;
  onClearConfig?: () => void;
}

const ConfigSidebar: React.FC<Props> = ({ 
  subMode = OneClickSubMode.MAIN_IMAGE,
  currentSubMode,
  onSubModeChange,
  config, 
  onChange, 
  productImages, 
  setProductImages, 
  styleImage, 
  setStyleImage, 
  uploadedProductUrls = [],
  uploadedStyleUrl = null,
  onUploadedProductUrlsChange,
  onUploadedStyleUrlChange,
  apiConfig,
  disabled, 
  onStart,
  onSyncConfig,
  onClearConfig
}) => {
  const productInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);
  const isDetail = subMode === OneClickSubMode.DETAIL_PAGE;
  
  const [expandedSections, setExpandedSections] = useState<string[]>(['platform', 'specs']);
  const [assetTab, setAssetTab] = useState<'product' | 'style'>('product');

  const [isUploadingProduct, setIsUploadingProduct] = useState<boolean[]>([]);
  const [isUploadingStyle, setIsUploadingStyle] = useState(false);
  const [isCustomPlatform, setIsCustomPlatform] = useState(config.platform === 'CUSTOM');
  // 自动上传产品图
  useEffect(() => {
    const uploadFiles = async () => {
      const newUrls = [...uploadedProductUrls];
      let hasChanged = false;
      
      for (let i = 0; i < productImages.length; i++) {
        const file = productImages[i];
        if (file && !newUrls[i]) {
          try {
            const url = await uploadToCos(file, apiConfig);
            newUrls[i] = url;
            hasChanged = true;
          } catch (err) {
            console.error('Failed to upload product image', err);
          }
        }
      }
      
      if (hasChanged && onUploadedProductUrlsChange) {
        onUploadedProductUrlsChange(newUrls);
      }
    };
    
    if (productImages.length > 0) {
      uploadFiles();
    }
  }, [productImages, apiConfig]);

  // 自动上传风格图
  useEffect(() => {
    const uploadStyle = async () => {
      if (styleImage && !uploadedStyleUrl) {
        setIsUploadingStyle(true);
        try {
          const url = await uploadToCos(styleImage, apiConfig);
          if (onUploadedStyleUrlChange) {
            onUploadedStyleUrlChange(url);
          }
        } catch (err) {
          console.error('Failed to upload style image', err);
        } finally {
          setIsUploadingStyle(false);
        }
      }
    };
    
    uploadStyle();
  }, [styleImage, apiConfig]);

  const [isCustomLanguage, setIsCustomLanguage] = useState(false);

  // 解析比例字符串为数值
  const getRatioValue = (ratioStr?: AspectRatio): number => {
    if (!ratioStr || ratioStr === AspectRatio.AUTO) return 1;
    const [w, h] = ratioStr.split(':').map(Number);
    return w / h;
  };

  // 1. 初始化逻辑 & 平台类型切换时的默认值重置
  useEffect(() => {
    const isCrossborder = config.platformType === 'crossborder';
    const isMobileFirst = config.platformType === 'domestic' || ['TikTok Shop', 'Shein', 'Shopee'].includes(config.platform);
    
    // 默认比例：国内/移动端详情建议 3:4 或 自动，主图建议 1:1 或 3:4
    let defaultW = isDetail ? 750 : 800;
    let defaultH = isDetail ? 0 : 800;
    let defaultRatio = isDetail ? AspectRatio.AUTO : (isMobileFirst ? AspectRatio.P_3_4 : AspectRatio.SQUARE);

    if (!isDetail && isCrossborder && !isMobileFirst) {
      defaultW = 1600;
      defaultH = 1600;
    }

    onChange({
      ...config,
      quality: config.quality || '2k',
      styleStrength: config.styleStrength || 'medium',
      count: isDetail ? (config.count || 7) : (config.count || 5),
      aspectRatio: config.aspectRatio || defaultRatio,
      language: config.platformType === 'domestic' ? '中文' : (config.language || 'English'),
      resolutionMode: config.resolutionMode || 'custom',
      targetWidth: defaultW,
      targetHeight: defaultH,
      maxFileSize: config.maxFileSize || 2.0
    });
  }, [isDetail, config.platformType]);

  // 2. 比例联动计算逻辑
  const handleRatioChange = (newRatio: AspectRatio) => {
    if (config.resolutionMode !== 'custom') {
      onChange({ ...config, aspectRatio: newRatio });
      return;
    }

    const isCrossborder = config.platformType === 'crossborder';
    const isMobileFirst = config.platformType === 'domestic';
    let newW = config.targetWidth || 800;
    let newH = 0;

    if (!isDetail) {
      if (newRatio === AspectRatio.P_3_4) {
        newW = 750;
        newH = 1000;
      } else if (newRatio === AspectRatio.SQUARE) {
        newW = isCrossborder && !isMobileFirst ? 1600 : 800;
        newH = isCrossborder && !isMobileFirst ? 1600 : 800;
      } else if (newRatio !== AspectRatio.AUTO) {
        const ratioValue = getRatioValue(newRatio);
        newH = Math.round(newW / ratioValue);
      } else {
        newH = newW; 
      }
    }

    onChange({ 
      ...config, 
      aspectRatio: newRatio,
      targetWidth: newW,
      targetHeight: isDetail ? 0 : newH 
    });
  };

  const handlePlatformSelect = (val: string) => {
    if (val === 'CUSTOM') {
      setIsCustomPlatform(true);
    } else {
      setIsCustomPlatform(false);
      onChange({ ...config, platform: val });
    }
  };

  const handleLanguageSelect = (val: string) => {
    if (val === 'CUSTOM') {
      setIsCustomLanguage(true);
    } else {
      setIsCustomLanguage(false);
      onChange({ ...config, language: val });
    }
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const platformPresets = {
    domestic: ['淘宝', '天猫', '京东', '拼多多', '抖音', '小红书', '得物'],
    crossborder: ['Amazon', 'Shein', 'Temu', 'AliExpress', 'TikTok Shop', 'Shopee', 'Shopify', 'Lazada']
  };

  const langPresets = [
    { label: '中文/Chinese', value: '中文' },
    { label: '英语/English', value: 'English' },
    { label: '日语/Japanese', value: 'Japanese' },
    { label: '德语/German', value: 'German' },
    { label: '法语/French', value: 'French' },
    { label: '西班牙语/Spanish', value: 'Spanish' },
    { label: '韩语/Korean', value: 'Korean' },
    { label: '俄语/Russian', value: 'Russian' },
    { label: '越南语/Vietnamese', value: 'Vietnamese' },
    { label: '泰语/Thai', value: 'Thai' }
  ];

  const ratios = [
    { label: '自动建议', value: AspectRatio.AUTO },
    { label: '1:1', value: AspectRatio.SQUARE },
    { label: '1:4', value: AspectRatio.P_1_4 },
    { label: '1:8', value: AspectRatio.P_1_8 },
    { label: '2:3', value: AspectRatio.P_2_3 },
    { label: '3:2', value: AspectRatio.L_3_2 },
    { label: '3:4', value: AspectRatio.P_3_4 },
    { label: '4:1', value: AspectRatio.L_4_1 },
    { label: '4:3', value: AspectRatio.L_4_3 },
    { label: '4:5', value: AspectRatio.P_4_5 },
    { label: '5:4', value: AspectRatio.L_5_4 },
    { label: '8:1', value: AspectRatio.L_8_1 },
    { label: '9:16', value: AspectRatio.P_9_16 },
    { label: '16:9', value: AspectRatio.L_16_9 },
    { label: '21:9', value: AspectRatio.L_21_9 },
  ];
  const supportedRatios = getSupportedAspectRatiosForModel(config.model);
  const filteredRatios = ratios.filter((ratio) => {
    if (!supportedRatios.includes(ratio.value)) return false;
    if (!isDetail && ratio.value === AspectRatio.AUTO) return false;
    return true;
  });
  const effectiveSubMode = currentSubMode || subMode;

  return (
    <SidebarShell
      accentClass="bg-rose-600"
      title={isDetail ? '详情设置' : '主图设置'}
      subtitle={isDetail ? '详情模式' : '主图模式'}
      headerContent={onSubModeChange ? (
        <SegmentedTabs
          value={effectiveSubMode}
          onChange={(next) => onSubModeChange(next as OneClickSubMode)}
          accentClass="bg-rose-600 text-white"
          items={[
            { value: OneClickSubMode.MAIN_IMAGE, label: '主图', icon: 'fa-image' },
            { value: OneClickSubMode.DETAIL_PAGE, label: '详情', icon: 'fa-layer-group' },
            { value: OneClickSubMode.SKU, label: 'SKU', icon: 'fa-tags' },
          ]}
        />
      ) : undefined}
      actions={
        <div className="flex shrink-0 items-center gap-2">
          {onSyncConfig ? (
            <div className="relative group">
              <button
                onClick={onSyncConfig}
                disabled={disabled}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-50"
              >
                <i className="fas fa-right-left text-xs"></i>
              </button>
              <div className="absolute right-0 top-14 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-white shadow-lg opacity-0 pointer-events-none transition-opacity group-hover:opacity-100">
                {isDetail ? '同步主图配置信息' : '同步详情配置信息'}
              </div>
            </div>
          ) : null}
          {onClearConfig ? (
            <div className="relative group">
              <button
                onClick={onClearConfig}
                disabled={disabled}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-all hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"
              >
                <i className="fas fa-trash-alt text-xs"></i>
              </button>
              <div className="absolute right-0 top-14 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-bold text-white shadow-lg opacity-0 pointer-events-none transition-opacity group-hover:opacity-100">
                清空当前页配置信息
              </div>
            </div>
          ) : null}
        </div>
      }
      footer={
        <PrimaryActionButton
          onClick={onStart}
          disabled={disabled || productImages.length === 0}
          icon={disabled ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}
          label={disabled
            ? (isDetail ? '正在生成详情方案...' : '正在生成主图方案...')
            : (isDetail ? '开始生成详情方案' : '开始生成主图方案')
          }
        />
      }
    >
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('assets')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
              <div>
                <span className="text-sm font-bold text-slate-700">设计素材与参考</span>
              </div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('assets') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('assets') && (
              <div className="px-4 pb-4 space-y-3">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setAssetTab('product')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${assetTab === 'product' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>产品素材 ({productImages.length})</button>
                  <button onClick={() => setAssetTab('style')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${assetTab === 'style' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>视觉风格</button>
                </div>
                {assetTab === 'product' ? (
                  <div className="space-y-4">
                    <div onClick={() => productInputRef.current?.click()} className="group cursor-pointer border-2 border-dashed border-slate-200 rounded-[20px] p-5 hover:border-rose-300 hover:bg-rose-50/30 transition-all text-center">
                      <i className="far fa-image text-slate-300 text-lg group-hover:text-rose-400 mb-2 block"></i>
                      <p className="text-xs font-black text-slate-600">上传产品原始图</p>
                      <p className="mt-1 text-[10px] text-slate-400">JPG、PNG、WEBP，最多 8 张，超 3MB 自动压缩</p>
                      <input type="file" multiple ref={productInputRef} onChange={(e) => {
                        if (e.target.files) {
                           const newFiles = Array.from(e.target.files) as File[];
                           setProductImages([...productImages, ...newFiles].slice(0, 8));
                        }
                      }} className="hidden" accept="image/*" />
                    </div>
                    { (productImages.length > 0 || uploadedProductUrls.length > 0) && (
                      <div className="grid grid-cols-4 gap-2">
                        { (productImages.length > 0 ? productImages : uploadedProductUrls).map((item, i) => {
                          const img = productImages[i];
                          const url = uploadedProductUrls[i];
                          return (
                            <div key={i} className="aspect-square relative rounded-lg border border-slate-100 overflow-hidden group">
                              {img ? (
                                <div className="w-full h-full relative">
                                  <img 
                                    src={safeCreateObjectURL(img)} 
                                    className="w-full h-full object-cover" 
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                      const parent = target.parentElement;
                                      if (parent) {
                                        const placeholder = document.createElement('div');
                                        placeholder.className = "w-full h-full flex items-center justify-center bg-slate-50 text-slate-300";
                                        placeholder.innerHTML = '<i class="fas fa-exclamation-circle text-xs"></i>';
                                        parent.appendChild(placeholder);
                                      }
                                    }}
                                  />
                                  {!url && (
                                    <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                                      <i className="fas fa-spinner fa-spin text-rose-500 text-xs"></i>
                                    </div>
                                  )}
                                </div>
                              ) : (url ? (
                                <img 
                                  src={url} 
                                  className="w-full h-full object-cover" 
                                  alt="Uploaded fallback"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300">
                                  <i className="fas fa-file-circle-exclamation text-xs"></i>
                                </div>
                              ))}
                              <button onClick={() => {
                                const newImages = productImages.filter((_, idx) => idx !== i);
                                setProductImages(newImages);
                                if (onUploadedProductUrlsChange) {
                                  onUploadedProductUrlsChange(uploadedProductUrls.filter((_, idx) => idx !== i));
                                }
                              }} className="absolute top-0 right-0 w-5 h-5 bg-rose-500 text-white rounded-bl-lg flex items-center justify-center opacity-0 group-hover:opacity-100"><i className="fas fa-times text-[10px]"></i></button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div onClick={() => styleInputRef.current?.click()} className="h-28 relative border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center text-[11px] font-bold text-slate-400 overflow-hidden group hover:border-rose-200 cursor-pointer bg-slate-50/50">
                      {styleImage ? (
                        <div className="w-full h-full relative">
                          <img 
                            src={safeCreateObjectURL(styleImage)} 
                            className="h-full w-full object-cover" 
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                const placeholder = document.createElement('div');
                                placeholder.className = "w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300";
                                placeholder.innerHTML = `
                                  <i class="far fa-file-image text-lg mb-1"></i>
                                  <span class="text-[8px] font-bold">文件已失效</span>
                                `;
                                parent.appendChild(placeholder);
                              }
                            }}
                          />
                          {isUploadingStyle && (
                            <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                              <i className="fas fa-spinner fa-spin text-rose-500 text-lg"></i>
                            </div>
                          )}
                        </div>
                      ) : (uploadedStyleUrl ? (
                        <div className="w-full h-full relative">
                          <img 
                            src={uploadedStyleUrl} 
                            className="h-full w-full object-cover" 
                            alt="Style fallback"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="text-center"><i className="fas fa-palette text-slate-200 text-xl mb-2"></i><p>上传风格参考</p><p className="text-[9px] mt-1">控制色调与构图</p></div>
                      ))}
                      <input type="file" ref={styleInputRef} onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setStyleImage(e.target.files[0]);
                        }
                      }} className="hidden" accept="image/*" />
                    </div>
                    <div className="space-y-1 rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <span className="ml-1 text-xs font-medium text-slate-400">风格强度</span>
                      <div className="flex bg-white/60 p-1 rounded-lg">
                        {(['low', 'medium', 'high'] as StyleStrength[]).map(s => (
                          <button key={s} onClick={() => onChange({...config, styleStrength: s})} className={`flex-1 py-1 text-[9px] font-black rounded-md transition-all ${config.styleStrength === s ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>{s === 'low' ? '低' : s === 'medium' ? '中' : '高'}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('marketing')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
              <div>
                <span className="text-sm font-bold text-slate-700">产品营销与叙事</span>
              </div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('marketing') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('marketing') && (
              <div className="px-4 pb-4 space-y-4">
                <div className="space-y-1">
                  <span className="ml-1 text-xs font-medium text-slate-400">产品核心特征</span>
                  <textarea value={config.description} onChange={(e) => onChange({...config, description: e.target.value})} placeholder="输入产品名称、核心卖点，用于AI生成文案..." className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" />
                </div>
                <div className="space-y-1">
                  <span className="ml-1 text-xs font-medium text-slate-400">自定义叙事逻辑</span>
                  <textarea value={config.planningLogic} onChange={(e) => onChange({...config, planningLogic: e.target.value})} placeholder="例如：可以输入自己做整套策划的逻辑，也可以建议AI使用某个逻辑模型，比如B=mat等" className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" />
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('platform')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
              <div>
                <span className="text-sm font-bold text-slate-700">投放平台适配</span>
              </div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('platform') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('platform') && (
              <div className="px-4 pb-4 space-y-4">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => onChange({...config, platformType: 'domestic', language: '中文'})} className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-all ${config.platformType === 'domestic' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>国内 (移动端为主)</button>
                  <button onClick={() => onChange({...config, platformType: 'crossborder'})} className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-all ${config.platformType === 'crossborder' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>跨境 (全球适配)</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="ml-1 text-xs font-medium text-slate-400">目标平台</span>
                    {isCustomPlatform ? (
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          autoFocus
                          value={config.platform} 
                          onChange={(e) => onChange({ ...config, platform: e.target.value })} 
                          className="min-w-0 flex-1 rounded-2xl border border-rose-300 bg-slate-50 px-3 py-2 text-xs font-bold outline-none"
                          placeholder="请输入..."
                        />
                        <button onClick={() => setIsCustomPlatform(false)} className="rounded-2xl bg-slate-100 px-3 text-[10px] font-bold text-slate-400">返回</button>
                      </div>
                    ) : (
                      <PopoverSelect
                        value={config.platform as string}
                        onChange={(next) => handlePlatformSelect(next)}
                        options={[
                          ...platformPresets[config.platformType].map((platform) => ({
                            value: platform,
                            label: platform,
                          })),
                          { value: 'CUSTOM', label: '+ 自定义' },
                        ]}
                        buttonClassName="h-10 rounded-2xl px-4 text-xs"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="ml-1 text-xs font-medium text-slate-400">目标文案语言</span>
                    {isCustomLanguage ? (
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          autoFocus
                          value={config.language} 
                          onChange={(e) => onChange({ ...config, language: e.target.value })} 
                          className="min-w-0 flex-1 rounded-2xl border border-rose-300 bg-slate-50 px-3 py-2 text-xs font-bold outline-none"
                          placeholder="请输入..."
                        />
                        <button onClick={() => setIsCustomLanguage(false)} className="rounded-2xl bg-slate-100 px-3 text-[10px] font-bold text-slate-400">返回</button>
                      </div>
                    ) : (
                      <PopoverSelect
                        disabled={config.platformType === 'domestic'}
                        value={config.language as string}
                        onChange={(next) => handleLanguageSelect(next)}
                        options={[
                          ...langPresets.map((language) => ({
                            value: language.value,
                            label: language.label,
                          })),
                          { value: 'CUSTOM', label: '+ 自定义' },
                        ]}
                        buttonClassName="h-10 rounded-2xl px-4 text-xs"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('specs')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
              <div>
                <span className="text-sm font-bold text-slate-700">画面规格控制</span>
              </div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('specs') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('specs') && (
              <div className="px-4 pb-4 space-y-4">
                <div className="space-y-1 pt-2 border-t border-slate-100">
                  <span className="ml-1 text-xs font-medium text-slate-400">生图模型</span>
                  <div className="flex bg-slate-100 p-1 rounded-xl">
                    {MODEL_OPTIONS.map(m => (
                      <button 
                        key={m} 
                        onClick={() =>
                          onChange({
                            ...config,
                            model: m,
                            quality: getDefaultQualityForModel(m),
                            aspectRatio: getSafeAspectRatioForModel(
                              m,
                              config.aspectRatio || (isDetail ? AspectRatio.AUTO : AspectRatio.SQUARE),
                              isDetail ? AspectRatio.AUTO : AspectRatio.SQUARE
                            ),
                          })
                        }
                        className={`flex-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${config.model === m ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}
                      >
                        {getModelDisplayName(m)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="ml-1 text-xs font-medium text-slate-400">渲染质量</span>
                  <div className="grid grid-cols-3 gap-2">
                    {QUALITY_OPTIONS.map(q => (
                      <button
                        key={q.value}
                        onClick={() => onChange({ ...config, quality: q.value as GenerationQuality })}
                        className={`py-1.5 text-[9px] font-black rounded-lg border transition-all ${config.quality === q.value ? 'bg-rose-600 border-rose-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-rose-300'}`}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="ml-1 text-xs font-medium text-slate-400">策划屏数</span>
                    <input type="number" min="1" max="15" value={config.count} onChange={(e) => onChange({...config, count: parseInt(e.target.value) || 1})} className="h-10 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-semibold text-slate-700 outline-none focus:bg-white" />
                  </div>
                  <div className="space-y-1">
                    <span className="ml-1 text-xs font-medium text-slate-400">全局画面比例</span>
                    <PopoverSelect
                      value={config.aspectRatio}
                      onChange={(next) => handleRatioChange(next as AspectRatio)}
                      options={filteredRatios.map((ratio) => ({
                        value: ratio.value,
                        label: ratio.label,
                      }))}
                      buttonClassName="h-10 rounded-2xl px-4 text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex bg-slate-100 p-1 rounded-xl mb-3 shadow-inner">
                    <button onClick={() => onChange({...config, resolutionMode: 'original'})} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${config.resolutionMode === 'original' ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>AI 自适应尺寸</button>
                    <button onClick={() => onChange({...config, resolutionMode: 'custom'})} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${config.resolutionMode === 'custom' ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>固定宽度</button>
                  </div>
                  {config.resolutionMode === 'custom' && (
                    <div className="space-y-1">
                       <span className="ml-1 text-xs font-medium text-slate-400">输出宽度 (px)</span>
                       <input type="number" value={config.targetWidth || ''} onChange={(e) => {
                         const newW = parseInt(e.target.value) || 0;
                         onChange({...config, targetWidth: newW, targetHeight: 0});
                       }} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-rose-500/20" />
                    </div>
                  )}

                  <div className="space-y-2 pt-2 mt-2 border-t border-slate-50">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-400">体积限制 (MB)</label>
                      <span className="text-[10px] font-black text-rose-600">{(config.maxFileSize || 2.0).toFixed(1)} MB</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="10" 
                      step="0.1" 
                      value={config.maxFileSize || 2.0} 
                      onChange={(e) => onChange({...config, maxFileSize: parseFloat(e.target.value)})}
                      className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-rose-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
    </SidebarShell>
  );
};

export default ConfigSidebar;
