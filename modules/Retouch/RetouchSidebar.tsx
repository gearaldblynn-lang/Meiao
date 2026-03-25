
import React, { useRef, useState, useEffect } from 'react';
import { AspectRatio, GenerationQuality, RetouchPersistentState } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { uploadToCos } from '../../services/tencentCosService';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../../utils/modelQuality';
import { getSafeAspectRatioForModel, getSupportedAspectRatiosForModel } from '../../utils/modelAspectRatio';

interface Props {
  onAddFiles: (files: File[]) => void;
  pendingFiles: File[];
  onClearPending: () => void;
  referenceImage: File | null;
  uploadedReferenceUrl?: string | null;
  setReferenceImage: (file: File | null) => void;
  onUploadedReferenceUrlChange?: (url: string | null) => void;
  apiConfig: any;
  mode: 'original' | 'white_bg';
  setMode: (mode: 'original' | 'white_bg') => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (ratio: AspectRatio) => void;
  quality: GenerationQuality;
  setQuality: (quality: GenerationQuality) => void;
  model: 'nano-banana-2' | 'nano-banana-pro';
  setModel: (model: 'nano-banana-2' | 'nano-banana-pro') => void;
  resolutionMode: 'original' | 'custom';
  setResolutionMode: (mode: 'original' | 'custom') => void;
  targetWidth: number;
  setTargetWidth: (w: number) => void;
  targetHeight: number;
  setTargetHeight: (h: number) => void;
  onStart: () => void;
  isProcessing: boolean;
  hasTasks: boolean;
}

const RetouchSidebar: React.FC<Props> = ({ 
  onAddFiles, pendingFiles, onClearPending, referenceImage, uploadedReferenceUrl, setReferenceImage, onUploadedReferenceUrlChange, apiConfig, mode, setMode, aspectRatio, setAspectRatio, quality, setQuality, model, setModel, resolutionMode, setResolutionMode, targetWidth, setTargetWidth, targetHeight, setTargetHeight, onStart, isProcessing, hasTasks 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingRef, setIsUploadingRef] = useState(false);

  useEffect(() => {
    const uploadRef = async () => {
      if (referenceImage && !uploadedReferenceUrl) {
        setIsUploadingRef(true);
        try {
          const url = await uploadToCos(referenceImage, apiConfig);
          if (onUploadedReferenceUrlChange) onUploadedReferenceUrlChange(url);
        } catch (e) {
          console.error("Reference image upload failed", e);
        } finally {
          setIsUploadingRef(false);
        }
      }
    };
    uploadRef();
  }, [referenceImage, uploadedReferenceUrl, apiConfig, onUploadedReferenceUrlChange]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onAddFiles(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRefChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setReferenceImage(e.target.files[0]);
      if (refInputRef.current) refInputRef.current.value = '';
    }
  };

  const ratios = [
    { label: '智能比例', value: AspectRatio.AUTO },
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
  const visibleRatios = ratios.filter((ratio) => getSupportedAspectRatiosForModel(model).includes(ratio.value));

  const canStart = !isProcessing && (pendingFiles.length > 0 || hasTasks);

  return (
    <div className="w-[360px] bg-white border-r border-slate-200 h-full flex flex-col shrink-0 overflow-hidden relative shadow-sm z-30">
      <header className="p-6 border-b border-slate-100 flex-none bg-white">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-5 bg-emerald-600 rounded-full"></div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">精修大师配置</h2>
        </div>
        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em]">Retouching Engine</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
        <div className="p-5 space-y-6 pb-20">
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] font-black text-slate-500 uppercase tracking-widest">
              <i className="fas fa-images text-emerald-500"></i>
              <span>导入待修原图</span>
            </div>

            <div 
              onClick={() => fileInputRef.current?.click()}
              className="group cursor-pointer border-2 border-dashed border-slate-200 rounded-[24px] p-6 hover:border-emerald-300 hover:bg-emerald-50/30 transition-all text-center"
            >
              <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                <i className="far fa-image text-slate-300 text-xl group-hover:text-emerald-400"></i>
              </div>
              <p className="text-sm font-black text-slate-600 mb-2">点击上传原图或拖拽到此处</p>
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400">支持格式：JPG, PNG, WEBP</p>
                <p className="text-[11px] font-bold text-slate-400">单图限制：10MB</p>
              </div>
              <div className="mt-4 px-6 py-2 bg-emerald-600 text-white text-[11px] font-black rounded-xl inline-block shadow-lg">批量选择图片</div>
              <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
            </div>

            {pendingFiles.length > 0 && (
              <div className="grid grid-cols-5 gap-2 p-2 bg-slate-50 rounded-2xl border border-slate-100">
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="aspect-square bg-white rounded-lg border border-slate-200 overflow-hidden">
                      {f && <img src={safeCreateObjectURL(f)} className="w-full h-full object-cover" />}
                    </div>
                  ))}
              </div>
            )}

              <div className="space-y-2 pt-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">质感参照图 (可选)</span>
                {referenceImage ? (
                  <div className="relative h-24 rounded-xl border border-slate-200 overflow-hidden group">
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
                        <i className="fas fa-spinner fa-spin text-emerald-500 text-lg"></i>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
                      <button onClick={() => refInputRef.current?.click()} className="px-3 py-1 bg-white text-[9px] font-black rounded-lg">更换</button>
                      <button onClick={() => {
                        setReferenceImage(null);
                        if (onUploadedReferenceUrlChange) onUploadedReferenceUrlChange(null);
                      }} className="px-3 py-1 bg-rose-600 text-white text-[9px] font-black rounded-lg">移除</button>
                    </div>
                  </div>
                ) : (uploadedReferenceUrl ? (
                  <div className="relative h-24 rounded-xl border border-slate-200 overflow-hidden group">
                    <img src={uploadedReferenceUrl} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-3 transition-opacity">
                      <button onClick={() => refInputRef.current?.click()} className="px-3 py-1 bg-white text-[9px] font-black rounded-lg">更换</button>
                      <button onClick={() => {
                        setReferenceImage(null);
                        if (onUploadedReferenceUrlChange) onUploadedReferenceUrlChange(null);
                      }} className="px-3 py-1 bg-rose-600 text-white text-[9px] font-black rounded-lg">移除</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => refInputRef.current?.click()} className="w-full h-24 border-2 border-dashed border-slate-200 rounded-[20px] text-[11px] font-black text-slate-400 hover:border-emerald-200 hover:text-emerald-500 transition-all bg-slate-50/30">
                    <i className="fas fa-plus-circle mb-2 block text-lg opacity-40"></i>
                    上传精修效果参考图
                  </button>
                ))}
              </div>
            <input type="file" ref={refInputRef} onChange={handleRefChange} className="hidden" accept="image/*" />
          </section>

          <section className="space-y-6 pt-4 border-t border-slate-100">
            <div className="space-y-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">修复模式</span>
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-2xl">
                <button onClick={() => setMode('original')} className={`py-2 text-[10px] font-black rounded-xl transition-all ${mode === 'original' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>原图精修</button>
                <button onClick={() => setMode('white_bg')} className={`py-2 text-[10px] font-black rounded-xl transition-all ${mode === 'white_bg' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>纯净白底</button>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">生图模型</span>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                {MODEL_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => {
                      setModel(m);
                      setQuality(getDefaultQualityForModel(m));
                      setAspectRatio(getSafeAspectRatioForModel(m, aspectRatio, AspectRatio.AUTO));
                    }}
                    className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${model === m ? 'bg-white text-emerald-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}
                  >
                    {getModelDisplayName(m)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">画面比例</span>
              <div className="grid grid-cols-3 gap-2">
                {visibleRatios.map(r => (
                  <button key={r.value} onClick={() => setAspectRatio(r.value)} className={`py-1.5 text-[9px] font-black rounded-lg border transition-all ${aspectRatio === r.value ? 'bg-emerald-50 border-emerald-600 text-emerald-600' : 'bg-white border-slate-200 text-slate-400 hover:border-emerald-300'}`}>{r.label}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">渲染品质</span>
              <div className="grid grid-cols-3 gap-2">
                {QUALITY_OPTIONS.map(q => (
                  <button key={q.value} onClick={() => setQuality(q.value)} className={`py-1.5 text-[9px] font-black rounded-lg border transition-all ${quality === q.value ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-emerald-300'}`}>{q.label}</button>
                ))}
              </div>
            </div>

            {/* 自定义分辨率设置 */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">输出尺寸设置</span>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button onClick={() => setResolutionMode('original')} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${resolutionMode === 'original' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>默认 (AI)</button>
                <button onClick={() => setResolutionMode('custom')} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg transition-all ${resolutionMode === 'custom' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>自定义</button>
              </div>
              {resolutionMode === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-slate-400 uppercase ml-1">宽度 (px)</span>
                    <input type="number" value={targetWidth || ''} onChange={(e) => setTargetWidth(parseInt(e.target.value) || 0)} placeholder="自动" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500 shadow-sm" />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[8px] font-bold text-slate-400 uppercase ml-1">高度 (px)</span>
                    <input type="number" value={targetHeight || ''} onChange={(e) => setTargetHeight(parseInt(e.target.value) || 0)} placeholder="自动" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-emerald-500 shadow-sm" />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="p-5 border-t border-slate-100 bg-white flex-none shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
        <button 
          onClick={onStart}
          disabled={!canStart}
          className="w-full py-4 bg-slate-900 text-white font-black rounded-xl shadow-lg hover:bg-slate-800 disabled:bg-slate-100 transition-all flex items-center justify-center gap-3"
        >
          {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-wand-magic-sparkles text-emerald-400"></i>}
          {isProcessing ? '处理中...' : '启动大师级精修'}
        </button>
      </footer>
    </div>
  );
};

export default RetouchSidebar;
