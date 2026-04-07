import React, { useRef, useState, useEffect } from 'react';
import {
  AspectRatio,
  GenerationQuality,
  GlobalApiConfig,
  OneClickSubMode,
  OneClickReferenceDimension,
  SkuConfig,
  SkuImageItem,
  SkuImageRole,
  SkuPersistentSubState,
} from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { uploadToCos } from '../../services/tencentCosService';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../../utils/modelQuality';
import { getSafeAspectRatioForModel, getSupportedAspectRatiosForModel } from '../../utils/modelAspectRatio';
import { PopoverSelect, PrimaryActionButton, SegmentedTabs, SidebarShell } from '../../components/ui/workspacePrimitives';

interface Props {
  state: SkuPersistentSubState;
  onUpdate: (updates: Partial<SkuPersistentSubState>) => void;
  onUpdateConfig: (updater: (prev: SkuConfig) => SkuConfig) => void;
  apiConfig: GlobalApiConfig;
  disabled: boolean;
  onStart: () => void;
  onAnalyzeReference: () => void;
  analyzingReference?: boolean;
  onClearConfig?: () => void;
  currentSubMode?: OneClickSubMode;
  onSubModeChange?: (mode: OneClickSubMode) => void;
}

const LANG_PRESETS = [
  { label: '中文/Chinese', value: '中文' },
  { label: '英语/English', value: 'English' },
  { label: '日语/Japanese', value: 'Japanese' },
  { label: '德语/German', value: 'German' },
  { label: '法语/French', value: 'French' },
  { label: '西班牙语/Spanish', value: 'Spanish' },
  { label: '韩语/Korean', value: 'Korean' },
  { label: '俄语/Russian', value: 'Russian' },
  { label: '越南语/Vietnamese', value: 'Vietnamese' },
  { label: '泰语/Thai', value: 'Thai' },
];

type AssetTab = 'product' | 'gift' | 'reference';

const ALL_RATIOS = [
  { label: '1:1', value: AspectRatio.SQUARE },
  { label: '3:4', value: AspectRatio.P_3_4 },
  { label: '4:3', value: AspectRatio.L_4_3 },
  { label: '9:16', value: AspectRatio.P_9_16 },
  { label: '16:9', value: AspectRatio.L_16_9 },
  { label: '2:3', value: AspectRatio.P_2_3 },
  { label: '3:2', value: AspectRatio.L_3_2 },
  { label: '4:5', value: AspectRatio.P_4_5 },
  { label: '5:4', value: AspectRatio.L_5_4 },
];

const SkuSidebar: React.FC<Props> = ({
  state, onUpdate, onUpdateConfig, apiConfig, disabled, onStart, onClearConfig,
  onAnalyzeReference, analyzingReference = false,
  currentSubMode, onSubModeChange,
}) => {
  void onAnalyzeReference;
  const { images, config } = state;
  const productInputRef = useRef<HTMLInputElement>(null);
  const giftInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);
  const [assetTab, setAssetTab] = useState<AssetTab>('product');
  const [isCustomLanguage, setIsCustomLanguage] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>(['assets', 'combos', 'specs']);

  const productImages = images.filter((i) => i.role === 'product');
  const giftImages = images.filter((i) => i.role === 'gift').sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0));
  const designReferences = state.designReferences || [];
  const referenceDimensions = state.referenceDimensions || [];
  const totalImages = images.length;
  const nextGiftIndex = Math.max(0, ...giftImages.map((i) => i.giftIndex || 0)) + 1;
  const hasProduct = productImages.length > 0;
  const referenceDimensionOptions: Array<{ key: OneClickReferenceDimension; label: string }> = [
    { key: 'visual_style', label: '视觉风格' },
    { key: 'typography', label: '字体' },
    { key: 'color_palette', label: '色调' },
    { key: 'layout', label: '排版' },
    { key: 'copy_content', label: '文案内容' },
  ];

  const invalidateReferenceAnalysis = () => {
    return {
      referenceAnalysis: {
        status: 'idle',
        summary: '',
        error: '',
        analyzedAt: null,
      },
    } as any;
  };

  // 自动上传未上传的图片
  useEffect(() => {
    const needUpload = images.filter((i) => i.file && !i.uploadedUrl);
    if (needUpload.length === 0) return;
    let cancelled = false;
    (async () => {
      const updated = [...images];
      for (const item of needUpload) {
        if (cancelled) break;
        const idx = updated.findIndex((u) => u.id === item.id);
        if (idx >= 0 && item.file) {
          try {
            const url = await uploadToCos(item.file, apiConfig);
            updated[idx] = { ...updated[idx], uploadedUrl: url };
          } catch (err) { console.error('SKU image upload failed', err); }
        }
      }
      if (!cancelled) onUpdate({ images: updated });
    })();
    return () => { cancelled = true; };
  }, [images.map((i) => i.id).join(',')]);

  const addImages = (files: File[], role: SkuImageRole, giftIdx?: number) => {
    const remaining = 7 - totalImages;
    const toAdd = files.slice(0, remaining);
    const newItems: SkuImageItem[] = toAdd.map((file, i) => ({
      id: `sku_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      file, role,
      giftIndex: role === 'gift' ? (giftIdx ?? nextGiftIndex + i) : undefined,
      uploadedUrl: null,
    }));
    onUpdate({ images: [...images, ...newItems] });
  };

  const removeImage = (id: string) => onUpdate({ images: images.filter((i) => i.id !== id) });
  const addReferenceFiles = (files: File[]) => {
    const remaining = 8 - designReferences.length;
    const next = files.slice(0, remaining).map((file) => ({
      id: `sku_reference_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      file,
      uploadedUrl: null,
    }));
    onUpdate({ designReferences: [...designReferences, ...next] as any, ...invalidateReferenceAnalysis() });
  };
  const removeReference = (id: string) => {
    const next = designReferences.filter((item: any) => item.id !== id);
    onUpdate({
      designReferences: next as any,
      uploadedDesignReferenceUrls: next.map((item: any) => item.uploadedUrl).filter(Boolean),
      ...invalidateReferenceAnalysis(),
    } as any);
  };
  const toggleReferenceDimension = (dimension: OneClickReferenceDimension) => {
    const next = referenceDimensions.includes(dimension)
      ? referenceDimensions.filter((item: OneClickReferenceDimension) => item !== dimension)
      : [...referenceDimensions, dimension];
    onUpdate({ referenceDimensions: next, ...invalidateReferenceAnalysis() } as any);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, role: SkuImageRole, giftIdx?: number) => {
    const files = Array.from(e.target.files || []) as File[];
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length > 0) addImages(imageFiles, role, giftIdx);
    e.target.value = '';
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  const handleCountChange = (raw: string) => {
    const count = Math.max(1, Math.min(20, Number(raw) || 1));
    onUpdateConfig((prev) => {
      const combos = [...prev.combinations];
      while (combos.length < count) combos.push({ id: `combo_${combos.length + 1}`, sceneDescription: '', skuCopyText: '' });
      combos.length = count;
      return { ...prev, count, combinations: combos };
    });
  };

  const handleLanguageSelect = (val: string) => {
    if (val === 'CUSTOM') { setIsCustomLanguage(true); return; }
    setIsCustomLanguage(false);
    onUpdateConfig((prev) => ({ ...prev, language: val }));
  };

  const handleModelChange = (m: string) => {
    onUpdateConfig((prev) => ({
      ...prev, model: m as any,
      quality: getDefaultQualityForModel(m as any),
      aspectRatio: getSafeAspectRatioForModel(m as any, prev.aspectRatio || AspectRatio.SQUARE, AspectRatio.SQUARE),
    }));
  };

  const supportedRatios = getSupportedAspectRatiosForModel(config.model);
  const filteredRatios = ALL_RATIOS.filter((r) => supportedRatios.includes(r.value));
  const effectiveSubMode = currentSubMode || OneClickSubMode.SKU;

  // --- 图片缩略图渲染 ---
  const renderImageGrid = (items: SkuImageItem[], roleLabel: string) => (
    items.length > 0 ? (
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => (
          <div key={item.id} className="aspect-square relative rounded-lg border border-slate-100 overflow-hidden group">
            {item.file ? (
              <div className="w-full h-full relative">
                <img src={safeCreateObjectURL(item.file)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                {!item.uploadedUrl && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                    <i className="fas fa-spinner fa-spin text-rose-500 text-xs"></i>
                  </div>
                )}
              </div>
            ) : item.uploadedUrl ? (
              <img src={item.uploadedUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : null}
            <button onClick={() => removeImage(item.id)}
              className="absolute top-0 right-0 w-5 h-5 bg-rose-500 text-white rounded-bl-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
              <i className="fas fa-times text-[10px]"></i>
            </button>
            <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] font-bold text-center py-0.5">
              {item.role === 'product' ? '主体' : item.role === 'gift' ? `赠品${item.giftIndex}` : '风格参考'}
            </span>
          </div>
        ))}
      </div>
    ) : null
  );

  return (
    <SidebarShell
      accentClass="bg-rose-600"
      title="SKU 设置"
      subtitle="SKU 模式"
      headerContent={onSubModeChange ? (
        <SegmentedTabs
          value={effectiveSubMode}
          onChange={(next) => onSubModeChange!(next as OneClickSubMode)}
          accentClass="bg-rose-600 text-white"
          items={[
            { value: OneClickSubMode.MAIN_IMAGE, label: '主图', icon: 'fa-image' },
            { value: OneClickSubMode.DETAIL_PAGE, label: '详情', icon: 'fa-layer-group' },
            { value: OneClickSubMode.SKU, label: 'SKU', icon: 'fa-tags' },
          ]}
        />
      ) : undefined}
      actions={onClearConfig ? (
        <button onClick={onClearConfig} disabled={disabled}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-50">
          <i className="fas fa-trash-can text-xs"></i>
        </button>
      ) : undefined}
      footer={
        <div className="space-y-2">
          <PrimaryActionButton
            onClick={onStart}
            disabled={disabled || !hasProduct || config.combinations.length === 0}
            icon={disabled ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}
            label={disabled ? '策划中...' : '生成方案'}
          />
        </div>
      }
    >
      {/* 素材上传 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <button onClick={() => toggleSection('assets')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
          <span className="text-sm font-bold text-slate-700">设计素材</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400">{totalImages}/7</span>
            <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('assets') ? '' : '-rotate-90'}`}></i>
          </div>
        </button>
        {expandedSections.includes('assets') && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setAssetTab('product')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${assetTab === 'product' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}>商品主体 ({productImages.length})</button>
              <button onClick={() => setAssetTab('gift')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${assetTab === 'gift' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400'}`}>赠品 ({giftImages.length})</button>
              <button onClick={() => setAssetTab('reference')} className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${assetTab === 'reference' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>设计参考 ({designReferences.length})</button>
            </div>

            {assetTab === 'product' && (
              <div className="space-y-3">
                <div onClick={() => productInputRef.current?.click()} className="group cursor-pointer border-2 border-dashed border-slate-200 rounded-[20px] p-5 hover:border-rose-300 hover:bg-rose-50/30 transition-all text-center">
                  <i className="far fa-image text-slate-300 text-lg group-hover:text-rose-400 mb-2 block"></i>
                  <p className="text-xs font-black text-slate-600">上传商品主体图</p>
                  <p className="mt-1 text-[10px] text-slate-400">JPG、PNG、WEBP，可多选</p>
                  <input type="file" multiple ref={productInputRef} onChange={(e) => handleFileInput(e, 'product')} className="hidden" accept="image/*" />
                </div>
                {renderImageGrid(productImages, '主体')}
              </div>
            )}

            {assetTab === 'gift' && (
              <div className="space-y-3">
                <div onClick={() => giftInputRef.current?.click()} className="group cursor-pointer border-2 border-dashed border-amber-200 rounded-[20px] p-5 hover:border-amber-300 hover:bg-amber-50/30 transition-all text-center">
                  <i className="fas fa-gift text-amber-200 text-lg group-hover:text-amber-400 mb-2 block"></i>
                  <p className="text-xs font-black text-slate-600">上传赠品图 (赠品{nextGiftIndex})</p>
                  <p className="mt-1 text-[10px] text-slate-400">每次上传自动编号</p>
                  <input type="file" ref={giftInputRef} onChange={(e) => handleFileInput(e, 'gift')} className="hidden" accept="image/*" />
                </div>
                {renderImageGrid(giftImages, '赠品')}
              </div>
            )}

            {assetTab === 'reference' && (
              <div className="space-y-3">
                <div onClick={() => styleInputRef.current?.click()} className="group cursor-pointer border-2 border-dashed border-indigo-200 rounded-[20px] p-5 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all text-center">
                  <i className="fas fa-palette text-indigo-200 text-lg group-hover:text-indigo-400 mb-2 block"></i>
                  <p className="text-xs font-black text-slate-600">上传设计参考图</p>
                  <p className="mt-1 text-[10px] text-slate-400">最多 8 张，单张超 3MB 自动压缩</p>
                  <input type="file" multiple ref={styleInputRef} onChange={(e) => {
                    const files = Array.from(e.target.files || []) as File[];
                    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
                    if (imageFiles.length > 0) addReferenceFiles(imageFiles);
                    e.target.value = '';
                  }} className="hidden" accept="image/*" />
                </div>
                {designReferences.length > 0 ? (
                  <div className="grid grid-cols-4 gap-2">
                    {designReferences.map((item: any, index: number) => (
                      <div key={item.id} className="aspect-square relative rounded-lg border border-slate-100 overflow-hidden group">
                        {item.file ? (
                          <img src={safeCreateObjectURL(item.file)} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : item.uploadedUrl ? (
                          <img src={item.uploadedUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : null}
                        <button onClick={() => removeReference(item.id)} className="absolute top-0 right-0 w-5 h-5 bg-rose-500 text-white rounded-bl-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <i className="fas fa-times text-[10px]"></i>
                        </button>
                        <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] font-bold text-center py-0.5">参考{index + 1}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                  <p className="text-[11px] font-black text-slate-700">这组图需要参考的维度</p>
                  <div className="flex flex-wrap gap-2">
                    {referenceDimensionOptions.map((option) => (
                      <button key={option.key} type="button" onClick={() => toggleReferenceDimension(option.key)} className={`rounded-full px-3 py-1.5 text-[10px] font-bold transition ${referenceDimensions.includes(option.key) ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-200' : 'bg-white/60 text-slate-500 ring-1 ring-slate-200'}`}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {analyzingReference ? (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[11px] text-indigo-700">
                    正在自动分析设计参考，生成方案时会优先使用参考结论。
                  </div>
                ) : null}
                {state.referenceAnalysis?.summary ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-black text-slate-700">参考分析结论</p>
                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">{state.referenceAnalysis.summary}</p>
                  </div>
                ) : null}
              </div>
            )}

          </div>
        )}
      </div>

      {/* 产品信息 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <button onClick={() => toggleSection('info')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
          <span className="text-sm font-bold text-slate-700">产品信息</span>
          <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('info') ? '' : '-rotate-90'}`}></i>
        </button>
        {expandedSections.includes('info') && (
          <div className="px-4 pb-4">
            <textarea
              value={config.productInfo}
              onChange={(e) => onUpdateConfig((prev) => ({ ...prev, productInfo: e.target.value }))}
              disabled={disabled} rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner"
              placeholder={"1. 填写产品信息后会根据产品信息书写主标题，无产品信息则SKU文案为主标题\n2. 尽量填写产品规格，如：净含量：100g（10g*10条）"}
            />
          </div>
        )}
      </div>

      {/* SKU 组合细则 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <button onClick={() => toggleSection('combos')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
          <span className="text-sm font-bold text-slate-700">SKU 组合细则</span>
          <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('combos') ? '' : '-rotate-90'}`}></i>
        </button>
        {expandedSections.includes('combos') && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="ml-1 text-xs font-medium text-slate-400 shrink-0">SKU 数量</span>
              <input
                type="number" min={1} max={20}
                value={config.count}
                onChange={(e) => handleCountChange(e.target.value)}
                disabled={disabled}
                className="h-9 w-20 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none focus:bg-white text-center"
              />
              <span className="text-[10px] text-slate-400">上限 20</span>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {config.combinations.map((combo, idx) => (
                <div key={combo.id} className="flex items-center gap-2">
                  <span className="shrink-0 w-7 h-7 rounded-lg bg-rose-50 text-rose-600 text-[10px] font-black flex items-center justify-center">{idx + 1}</span>
                  <input
                    value={combo.skuCopyText}
                    onChange={(e) => onUpdateConfig((prev) => {
                      const combos = [...prev.combinations];
                      combos[idx] = { ...combos[idx], skuCopyText: e.target.value };
                      return { ...prev, combinations: combos };
                    })}
                    disabled={disabled}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-rose-300 outline-none text-xs font-bold text-slate-700"
                    placeholder={`SKU文案："主体X1+赠品一X1+赠品二X5"`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 画面规格控制 */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <button onClick={() => toggleSection('specs')} className="flex w-full items-center justify-between bg-white px-4 py-4 text-left text-slate-600 transition-colors hover:bg-slate-50">
          <span className="text-sm font-bold text-slate-700">画面规格控制</span>
          <i className={`fas fa-chevron-down text-[10px] transition-transform ${expandedSections.includes('specs') ? '' : '-rotate-90'}`}></i>
        </button>
        {expandedSections.includes('specs') && (
          <div className="px-4 pb-4 space-y-4">
            {/* 文案语言 */}
            <div className="space-y-1">
              <span className="ml-1 text-xs font-medium text-slate-400">目标文案语言</span>
              {isCustomLanguage ? (
                <div className="flex gap-2">
                  <input type="text" autoFocus value={config.language}
                    onChange={(e) => onUpdateConfig((prev) => ({ ...prev, language: e.target.value }))}
                    className="min-w-0 flex-1 rounded-2xl border border-rose-300 bg-slate-50 px-3 py-2 text-xs font-bold outline-none"
                    placeholder="请输入..." />
                  <button onClick={() => setIsCustomLanguage(false)} className="rounded-2xl bg-slate-100 px-3 text-[10px] font-bold text-slate-400">返回</button>
                </div>
              ) : (
                <PopoverSelect
                  value={config.language}
                  onChange={handleLanguageSelect}
                  disabled={disabled}
                  options={[...LANG_PRESETS.map((l) => ({ value: l.value, label: l.label })), { value: 'CUSTOM', label: '+ 自定义' }]}
                  buttonClassName="h-10 rounded-2xl px-4 text-xs"
                />
              )}
            </div>

            {/* 生图模型 */}
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <span className="ml-1 text-xs font-medium text-slate-400">生图模型</span>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {MODEL_OPTIONS.map((m) => (
                  <button key={m} onClick={() => handleModelChange(m)}
                    className={`flex-1 py-1.5 text-[9px] font-black rounded-lg transition-all ${config.model === m ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>
                    {getModelDisplayName(m)}
                  </button>
                ))}
              </div>
            </div>

            {/* 渲染质量 */}
            <div className="space-y-1">
              <span className="ml-1 text-xs font-medium text-slate-400">渲染质量</span>
              <div className="grid grid-cols-3 gap-2">
                {QUALITY_OPTIONS.map((q) => (
                  <button key={q.value} onClick={() => onUpdateConfig((prev) => ({ ...prev, quality: q.value as GenerationQuality }))}
                    className={`py-1.5 text-[9px] font-black rounded-lg border transition-all ${config.quality === q.value ? 'bg-rose-600 border-rose-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-rose-300'}`}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 画面比例 */}
            <div className="space-y-1">
              <span className="ml-1 text-xs font-medium text-slate-400">画面比例</span>
              <PopoverSelect
                value={config.aspectRatio || AspectRatio.SQUARE}
                onChange={(v) => onUpdateConfig((prev) => ({ ...prev, aspectRatio: v as AspectRatio }))}
                disabled={disabled}
                options={filteredRatios.map((r) => ({ value: r.value, label: r.label }))}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
            </div>

            {/* 尺寸控制 */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex bg-slate-100 p-1 rounded-xl mb-3 shadow-inner">
                <button onClick={() => onUpdateConfig((prev) => ({ ...prev, resolutionMode: 'original' }))}
                  className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${config.resolutionMode === 'original' ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>AI 自适应尺寸</button>
                <button onClick={() => onUpdateConfig((prev) => ({ ...prev, resolutionMode: 'custom' }))}
                  className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${config.resolutionMode === 'custom' ? 'bg-white text-rose-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>固定宽度</button>
              </div>
              {config.resolutionMode === 'custom' && (
                <div className="space-y-1">
                  <span className="ml-1 text-xs font-medium text-slate-400">输出宽度 (px)</span>
                  <input type="number" value={config.targetWidth || ''}
                    onChange={(e) => onUpdateConfig((prev) => ({ ...prev, targetWidth: parseInt(e.target.value) || 0, targetHeight: 0 }))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-rose-500/20" />
                </div>
              )}
              <div className="space-y-2 pt-2 mt-2 border-t border-slate-50">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-400">体积限制 (MB)</label>
                  <span className="text-[10px] font-black text-rose-600">{(config.maxFileSize || 2.0).toFixed(1)} MB</span>
                </div>
                <input type="range" min="0.1" max="10" step="0.1"
                  value={config.maxFileSize || 2.0}
                  onChange={(e) => onUpdateConfig((prev) => ({ ...prev, maxFileSize: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-rose-600" />
              </div>
            </div>
          </div>
        )}
      </div>
    </SidebarShell>
  );
};

export default SkuSidebar;
