
import React, { useRef, useState, useEffect } from 'react';
import { AspectRatio, OneClickConfig, OneClickSubMode, GenerationQuality, StyleStrength, GlobalApiConfig } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { uploadToCos } from '../../services/tencentCosService';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../../utils/modelQuality';
import { getSafeAspectRatioForModel, getSupportedAspectRatiosForModel } from '../../utils/modelAspectRatio';

interface Props {
  subMode?: OneClickSubMode;
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
  
  const [expandedSections, setExpandedSections] = useState<string[]>(['assets', 'marketing', 'platform', 'specs']);
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
    setExpandedSections(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
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

  return (
    <div className="w-[380px] bg-white h-full border-r border-slate-200 flex flex-col shrink-0 overflow-hidden relative z-30">
      <header className="p-5 border-b border-slate-100 flex-none bg-white">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-1.5 h-5 bg-rose-600 rounded-full"></div>
            <h2 className="text-lg font-black text-slate-800 tracking-tight">{isDetail ? '详情页体系化设计' : '主图大师配置'}</h2>
          </div>
          <div className="shrink-0 flex flex-col gap-2">
            {onClearConfig && (
              <div className="relative group">
                <button
                  onClick={onClearConfig}
                  disabled={disabled}
                  className="w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-rose-600 transition-all disabled:opacity-50 flex items-center justify-center"
                >
                  <i className="fas fa-trash-alt text-xs"></i>
                </button>
                <div className="absolute right-11 top-1/2 -translate-y-1/2 whitespace-nowrap px-3 py-2 bg-slate-900 text-white text-[10px] font-bold rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
                  清空当前页配置信息
                </div>
              </div>
            )}
            {onSyncConfig && (
              <div className="relative group">
                <button
                  onClick={onSyncConfig}
                  disabled={disabled}
                  className="w-9 h-9 rounded-xl border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-all disabled:opacity-50 flex items-center justify-center"
                >
                  <i className="fas fa-right-left text-xs"></i>
                </button>
                <div className="absolute right-11 top-1/2 -translate-y-1/2 whitespace-nowrap px-3 py-2 bg-slate-900 text-white text-[10px] font-bold rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity">
                  {isDetail ? '同步主图配置信息' : '同步详情配置信息'}
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.15em]">Systematic Design Engine</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll bg-slate-50/30">
        <div className="p-4 space-y-4 pb-12">
          
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('assets')} className="w-full px-4 py-3 flex items-center justify-between text-slate-600 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3"><i className="fas fa-images text-[10px] text-rose-500"></i><span className="text-[11px] font-bold uppercase tracking-wider">设计素材与参考</span></div>
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
                      <p className="text-[9px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">JPG/PNG/WEBP | 限 8 张</p>
                      <input type="file" multiple ref={productInputRef} onChange={(e) => {
                        if (e.target.files) {
                           const newFiles = (Array.from(e.target.files) as File[]).filter(f => f.size <= 10 * 1024 * 1024);
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
                          if (e.target.files[0].size > 10 * 1024 * 1024) return alert("参考图不能超过 10MB");
                          setStyleImage(e.target.files[0]);
                        }
                      }} className="hidden" accept="image/*" />
                    </div>
                    <div className="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">全案风格强度</span>
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
            <button onClick={() => toggleSection('marketing')} className="w-full px-4 py-3 flex items-center justify-between text-slate-600 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3"><i className="fas fa-pen-nib text-[10px] text-rose-500"></i><span className="text-[11px] font-bold uppercase tracking-wider">产品营销与叙事</span></div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('marketing') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('marketing') && (
              <div className="px-4 pb-4 space-y-4">
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">产品核心特征</span>
                  <textarea value={config.description} onChange={(e) => onChange({...config, description: e.target.value})} placeholder="输入产品名称、核心卖点，用于AI生成文案..." className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" />
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">自定义叙事逻辑 (可选)</span>
                  <textarea value={config.planningLogic} onChange={(e) => onChange({...config, planningLogic: e.target.value})} placeholder="例如：可以输入自己做整套策划的逻辑，也可以建议AI使用某个逻辑模型，比如B=mat等" className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" />
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('platform')} className="w-full px-4 py-3 flex items-center justify-between text-slate-600 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3"><i className="fas fa-store text-[10px] text-rose-500"></i><span className="text-[11px] font-bold uppercase tracking-wider">投放平台适配</span></div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('platform') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('platform') && (
              <div className="px-4 pb-4 space-y-4">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => onChange({...config, platformType: 'domestic', language: '中文'})} className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-all ${config.platformType === 'domestic' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>国内 (移动端为主)</button>
                  <button onClick={() => onChange({...config, platformType: 'crossborder'})} className={`flex-1 py-1 text-[10px] font-bold rounded-lg transition-all ${config.platformType === 'crossborder' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>跨境 (全球适配)</button>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">目标平台</span>
                  {isCustomPlatform ? (
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        autoFocus
                        value={config.platform} 
                        onChange={(e) => onChange({ ...config, platform: e.target.value })} 
                        className="flex-1 bg-slate-50 border border-rose-300 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                        placeholder="请输入..."
                      />
                      <button onClick={() => setIsCustomPlatform(false)} className="px-3 bg-slate-100 rounded-xl text-[10px] font-bold text-slate-400">返回</button>
                    </div>
                  ) : (
                    <select value={config.platform} onChange={(e) => handlePlatformSelect(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-rose-500 transition-all appearance-none">
                      {platformPresets[config.platformType].map(p => <option key={p} value={p}>{p}</option>)}
                      <option value="CUSTOM">+ 自定义</option>
                    </select>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">目标文案语言</span>
                  {isCustomLanguage ? (
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        autoFocus
                        value={config.language} 
                        onChange={(e) => onChange({ ...config, language: e.target.value })} 
                        className="flex-1 bg-slate-50 border border-rose-300 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                        placeholder="请输入..."
                      />
                      <button onClick={() => setIsCustomLanguage(false)} className="px-3 bg-slate-100 rounded-xl text-[10px] font-bold text-slate-400">返回</button>
                    </div>
                  ) : (
                    <select disabled={config.platformType === 'domestic'} value={config.language} onChange={(e) => handleLanguageSelect(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition-all appearance-none ${config.platformType === 'domestic' ? 'opacity-50' : 'focus:bg-white focus:ring-1 focus:ring-rose-500'}`}>
                      {langPresets.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                      <option value="CUSTOM">+ 自定义</option>
                    </select>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
            <button onClick={() => toggleSection('specs')} className="w-full px-4 py-3 flex items-center justify-between text-slate-600 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3"><i className="fas fa-sliders-h text-[10px] text-rose-500"></i><span className="text-[11px] font-bold uppercase tracking-wider">画面规格控制</span></div>
              <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('specs') ? '' : '-rotate-90'}`}></i>
            </button>
            {expandedSections.includes('specs') && (
              <div className="px-4 pb-4 space-y-4">
                <div className="space-y-1 pt-2 border-t border-slate-100">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">生图模型选择</span>
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
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">渲染质量</span>
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
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">策划屏数</span>
                    <input type="number" min="1" max="15" value={config.count} onChange={(e) => onChange({...config, count: parseInt(e.target.value) || 1})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">全局画面比例</span>
                    <select value={config.aspectRatio} onChange={(e) => handleRatioChange(e.target.value as any)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white appearance-none">
                      {filteredRatios.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex bg-slate-100 p-1 rounded-xl mb-3 shadow-inner">
                    <button onClick={() => onChange({...config, resolutionMode: 'original'})} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${config.resolutionMode === 'original' ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>AI 自适应尺寸</button>
                    <button onClick={() => onChange({...config, resolutionMode: 'custom'})} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${config.resolutionMode === 'custom' ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>固定宽度</button>
                  </div>
                  {config.resolutionMode === 'custom' && (
                    <div className="space-y-1">
                       <span className="text-[8px] font-bold text-slate-400 uppercase ml-1">输出宽度 (px)</span>
                       <input type="number" value={config.targetWidth || ''} onChange={(e) => {
                         const newW = parseInt(e.target.value) || 0;
                         onChange({...config, targetWidth: newW, targetHeight: 0});
                       }} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-rose-500/20" />
                    </div>
                  )}

                  <div className="space-y-2 pt-2 mt-2 border-t border-slate-50">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">体积限制 (MB)</label>
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
        </div>
      </div>

      <footer className="p-5 border-t border-slate-100 bg-white flex-none shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <button onClick={onStart} disabled={disabled || productImages.length === 0} className="w-full py-4 bg-slate-900 text-white font-black rounded-xl shadow-lg hover:bg-slate-800 disabled:bg-slate-100 transition-all flex items-center justify-center gap-3 active:scale-[0.98]">
          {disabled ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-wand-magic-sparkles text-rose-400"></i>}
          {disabled 
            ? (isDetail ? '正在规划详情全案...' : '正在规划主图全案...') 
            : (isDetail ? '开启大师级详情页策划' : '开启大师级主图策划')
          }
        </button>
      </footer>
    </div>
  );
};

export default ConfigSidebar;
