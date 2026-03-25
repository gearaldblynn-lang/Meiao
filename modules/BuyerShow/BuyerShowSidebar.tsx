
import React, { useRef, useState, useEffect } from 'react';
import { BuyerShowPersistentState, AspectRatio, GenerationQuality } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { uploadToCos } from '../../services/tencentCosService';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../../utils/modelQuality';

interface Props {
  state: BuyerShowPersistentState;
  onUpdate: (updates: Partial<BuyerShowPersistentState>) => void;
  onStart: () => void;
  isProcessing: boolean;
  apiConfig: any;
}

const BuyerShowSidebar: React.FC<Props> = ({ state, onUpdate, onStart, isProcessing, apiConfig }) => {
  const { 
    productImages, uploadedProductUrls = [], referenceImage, uploadedReferenceUrl, subMode, referenceStrength, productName, productFeatures, userRequirement, targetCountry, customCountry, includeModel, aspectRatio, quality, model, imageCount, setCount 
  } = state;
  
  const productInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [isCustomCountry, setIsCustomCountry] = useState(state.targetCountry === 'CUSTOM');
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  useEffect(() => {
    const uploadRef = async () => {
      if (referenceImage && !uploadedReferenceUrl) {
        setIsUploadingRef(true);
        try {
          const url = await uploadToCos(referenceImage, apiConfig);
          onUpdate({ uploadedReferenceUrl: url });
        } catch (e) {
          console.error("Reference image upload failed", e);
        } finally {
          setIsUploadingRef(false);
        }
      }
    };
    uploadRef();
  }, [referenceImage, uploadedReferenceUrl, apiConfig, onUpdate]);

  useEffect(() => {
    // 确保 setCount 有默认值
    if (!state.setCount) onUpdate({ setCount: 1 });
  }, []);

  const countries = ['中国', '美国', '英国', '日本', '德国', '法国', '西班牙', '韩国', '越南', '泰国', '意大利'];

  const handleProductUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onUpdate({
        productImages: [...state.productImages, ...Array.from(e.target.files)].slice(0, 8),
        uploadedProductUrls: [],
      });
      if (productInputRef.current) productInputRef.current.value = '';
    }
  };

  const handleCountrySelect = (val: string) => {
    if (val === 'CUSTOM') {
      setIsCustomCountry(true);
      onUpdate({ targetCountry: 'CUSTOM' });
    } else {
      setIsCustomCountry(false);
      onUpdate({ targetCountry: val });
    }
  };

  return (
    <div className="w-[380px] bg-white border-r border-slate-200 h-full flex flex-col shrink-0 overflow-hidden relative z-30 shadow-sm">
      <header className="p-6 border-b border-slate-100 bg-amber-50/30 flex-none">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-5 bg-amber-500 rounded-full shadow-sm"></div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">买家秀全案配置</h2>
        </div>
        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em]">Social Proof Engine V3</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll bg-white">
        <div className="p-5 space-y-6 pb-24">
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              <i className="fas fa-camera text-amber-500"></i>
              <span>导入产品素材库</span>
            </div>

            <div 
              onClick={() => productInputRef.current?.click()}
              className="group cursor-pointer border-2 border-dashed border-slate-200 rounded-[24px] p-6 hover:border-amber-300 hover:bg-amber-50/30 transition-all text-center"
            >
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <i className="far fa-image text-slate-300 text-xl group-hover:text-amber-400"></i>
              </div>
              <p className="text-sm font-black text-slate-600 mb-1">上传产品白底或实拍图</p>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">JPG/PNG | 10MB/张 | 建议 3-8 张</p>
              <input type="file" multiple ref={productInputRef} onChange={handleProductUpload} className="hidden" accept="image/*" />
            </div>

            {productImages.length > 0 && (
              <div className="grid grid-cols-4 gap-2 p-2 bg-slate-50 rounded-2xl border border-slate-100">
                {productImages.map((f, i) => (
                  <div key={i} className="aspect-square bg-white rounded-lg border border-slate-200 overflow-hidden relative group shadow-sm">
                    {f ? (
                      <div className="w-full h-full relative">
                        <img 
                          src={safeCreateObjectURL(f)} 
                          className="w-full h-full object-cover" 
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
                      </div>
                    ) : (uploadedProductUrls[i] ? (
                      <img src={uploadedProductUrls[i]} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300">
                        <i className="far fa-file-image text-lg mb-1"></i>
                        <span className="text-[8px] font-bold">文件已失效</span>
                      </div>
                    ))}
                    <button onClick={(e) => { 
                      e.stopPropagation(); 
                      const nextImgs = productImages.filter((_, idx) => idx !== i);
                      const nextUrls = uploadedProductUrls.filter((_, idx) => idx !== i);
                      onUpdate({ productImages: nextImgs, uploadedProductUrls: nextUrls }); 
                    }} className="absolute inset-0 bg-rose-500/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><i className="fas fa-trash text-[10px]"></i></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4 pt-4 border-t border-slate-100">
            <div className="space-y-1">
               <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">产品核心信息 (名称+卖点+场景)</span>
               <textarea 
                  value={state.productFeatures} 
                  onChange={(e) => onUpdate({ productFeatures: e.target.value })} 
                  className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner transition-all focus:ring-1 focus:ring-amber-500" 
                  placeholder="请输入产品名称、核心卖点及适用场景。&#10;例如：复古真皮双肩包，防水耐磨，适合职场通勤与周末旅行，展现英伦风范..." 
               />
            </div>
          </section>

          <section className="space-y-4 pt-4 border-t border-slate-100">
            <div className="space-y-2">
                <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">视觉氛围参照 (可选)</span>
                {referenceImage ? (
                <div className="relative h-24 rounded-2xl border border-slate-200 overflow-hidden group shadow-sm">
                    <div className="w-full h-full relative">
                      <img 
                        src={safeCreateObjectURL(referenceImage)} 
                        className="w-full h-full object-cover" 
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
                      {isUploadingRef && (
                        <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                          <i className="fas fa-spinner fa-spin text-amber-500 text-lg"></i>
                        </div>
                      )}
                    </div>
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
                      <button onClick={() => refInputRef.current?.click()} className="px-4 py-1.5 bg-white text-amber-600 text-[10px] font-black rounded-lg shadow-md">更换图</button>
                      <button onClick={() => onUpdate({ referenceImage: null, uploadedReferenceUrl: null })} className="px-4 py-1.5 bg-rose-600 text-white text-[10px] font-black rounded-lg shadow-md">移除</button>
                    </div>
                </div>
                ) : (uploadedReferenceUrl ? (
                  <div className="relative h-24 rounded-2xl border border-slate-200 overflow-hidden group shadow-sm">
                    <img src={uploadedReferenceUrl} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
                      <button onClick={() => refInputRef.current?.click()} className="px-4 py-1.5 bg-white text-amber-600 text-[10px] font-black rounded-lg shadow-md">更换图</button>
                      <button onClick={() => onUpdate({ referenceImage: null, uploadedReferenceUrl: null })} className="px-4 py-1.5 bg-rose-600 text-white text-[10px] font-black rounded-lg shadow-md">移除</button>
                    </div>
                  </div>
                ) : (
                <button onClick={() => refInputRef.current?.click()} className="w-full h-24 border-2 border-dashed border-slate-200 rounded-[20px] text-[10px] font-black text-slate-400 hover:border-amber-200 hover:text-amber-500 transition-all bg-slate-50/30">
                    <i className="fas fa-plus-circle mb-2 block text-lg opacity-40"></i>
                    上传环境参考图
                </button>
                ))}
                <input type="file" ref={refInputRef} onChange={(e) => e.target.files && onUpdate({ referenceImage: e.target.files[0] })} className="hidden" accept="image/*" />
            </div>

            <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">模特呈现策略</span>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                <button onClick={() => onUpdate({ includeModel: true })} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${state.includeModel ? 'bg-white text-amber-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>包含模特</button>
                <button onClick={() => onUpdate({ includeModel: false })} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${!state.includeModel ? 'bg-white text-amber-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>仅静物</button>
                </div>
                {!state.includeModel && (
                <p className="text-[9px] text-amber-600 mt-1 pl-1 font-medium"><i className="fas fa-info-circle mr-1"></i>静物模式将自动屏蔽人脸与全身，仅保留手部/局部。</p>
                )}
            </div>

            <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">生图模型选择</span>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                    {MODEL_OPTIONS.map(m => (
                        <button key={m} onClick={() => onUpdate({ model: m, quality: getDefaultQualityForModel(m) })} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${state.model === m ? 'bg-white text-amber-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>
                            {getModelDisplayName(m)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">画面比例</span>
                <select value={state.aspectRatio} onChange={(e) => onUpdate({ aspectRatio: e.target.value as AspectRatio })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none transition-all focus:bg-white appearance-none">
                    <option value={AspectRatio.SQUARE}>1:1 社交方图</option>
                    <option value={AspectRatio.P_3_4}>3:4 标准竖图</option>
                    <option value={AspectRatio.P_9_16}>9:16 短视频比例</option>
                </select>
                </div>
                <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">渲染引擎质量</span>
                <div className="grid grid-cols-3 gap-2">
                  {QUALITY_OPTIONS.map(q => (
                    <button
                      key={q.value}
                      onClick={() => onUpdate({ quality: q.value as GenerationQuality })}
                      className={`py-2 text-[9px] font-black rounded-lg border transition-all ${state.quality === q.value ? 'bg-amber-600 border-amber-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-amber-300'}`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                </div>
            </div>
          </section>

          <section className="space-y-4 pt-4 border-t border-slate-100">
            <div className="grid grid-cols-2 gap-3">
               <div className="space-y-1">
                  <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">目标市场</span>
                  {isCustomCountry ? (
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        autoFocus
                        value={state.customCountry || ''} 
                        onChange={(e) => onUpdate({ customCountry: e.target.value })} 
                        className="flex-1 bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-amber-500 transition-all shadow-sm"
                        placeholder="请输入国家..."
                      />
                      <button onClick={() => handleCountrySelect('美国')} className="px-3 bg-slate-100 rounded-xl text-[10px] font-bold text-slate-400">返回</button>
                    </div>
                  ) : (
                    <select value={state.targetCountry} onChange={(e) => handleCountrySelect(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-amber-500 transition-all appearance-none shadow-sm">
                       {countries.map(c => <option key={c} value={c}>{c}</option>)}
                       <option value="CUSTOM">+ 自定义</option>
                    </select>
                  )}
               </div>
               <div className="space-y-1">
                  <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">方案每套图数</span>
                  <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                     {[3, 5, 8].map(n => (
                        <button key={n} onClick={() => onUpdate({ imageCount: n })} className={`flex-1 py-1 text-[10px] font-black rounded-lg transition-all ${state.imageCount === n ? 'bg-white text-amber-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>{n}张</button>
                     ))}
                  </div>
               </div>
            </div>
            
            <div className="space-y-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase ml-1 tracking-widest">生成方案套数</span>
                <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                    {[1, 2, 3, 4].map(n => (
                        <button key={n} onClick={() => onUpdate({ setCount: n })} className={`flex-1 py-1 text-[10px] font-black rounded-lg transition-all ${state.setCount === n ? 'bg-white text-amber-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>{n}套</button>
                    ))}
                </div>
                <p className="text-[8px] text-slate-400 pl-1 mt-1">设置生成的不同方案组合数量 (如：不同场景/不同模特)</p>
            </div>
          </section>
          
          <div className="pt-4 flex flex-col items-center opacity-20 group-hover:opacity-40 transition-opacity">
            <div className="w-1 h-1 bg-slate-300 rounded-full mb-1"></div>
            <div className="w-1 h-1 bg-slate-300 rounded-full mb-1"></div>
            <div className="w-1 h-1 bg-slate-300 rounded-full"></div>
          </div>
        </div>
      </div>

      <footer className="p-5 border-t border-slate-100 bg-white flex-none shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <button 
          onClick={onStart}
          disabled={isProcessing || state.productImages.length === 0}
          className="w-full py-4 bg-slate-900 text-white font-black rounded-xl shadow-lg hover:bg-slate-800 disabled:bg-slate-100 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
        >
          {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic text-amber-400"></i>}
          {isProcessing ? '全案流水线执行中...' : '启动全案买家秀生成'}
        </button>
      </footer>
    </div>
  );
};

export default BuyerShowSidebar;
