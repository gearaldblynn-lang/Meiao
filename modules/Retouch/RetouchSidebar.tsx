
import React, { useRef, useState, useEffect } from 'react';
import { AspectRatio, GenerationQuality, RetouchPersistentState, RetouchTask } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { uploadToCos } from '../../services/tencentCosService';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../../utils/modelQuality';
import { getSafeAspectRatioForModel, getSupportedAspectRatiosForModel } from '../../utils/modelAspectRatio';
import { PopoverSelect, PrimaryActionButton, SidebarShell, UploadSurface } from '../../components/ui/workspacePrimitives';

interface Props {
  onAddFiles: (files: File[]) => void;
  pendingFiles: File[];
  tasks: RetouchTask[];
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
  onAddFiles, pendingFiles, tasks, onClearPending, referenceImage, uploadedReferenceUrl, setReferenceImage, onUploadedReferenceUrlChange, apiConfig, mode, setMode, aspectRatio, setAspectRatio, quality, setQuality, model, setModel, resolutionMode, setResolutionMode, targetWidth, setTargetWidth, targetHeight, setTargetHeight, onStart, isProcessing, hasTasks 
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
      if (onUploadedReferenceUrlChange) onUploadedReferenceUrlChange(null);
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
  const uploadedSourcePreviewUrls = tasks
    .map((task) => task.sourceUrl)
    .filter((task): task is string => typeof task === 'string' && task.trim().length > 0);

  const canStart = !isProcessing && (pendingFiles.length > 0 || hasTasks);

  return (
    <SidebarShell
      widthClassName="w-[360px]"
      accentClass="bg-emerald-600"
      title="精修大师配置"
      subtitle={mode === 'white_bg' ? '白底模式' : '精修模式'}
      footer={
        <PrimaryActionButton
          onClick={onStart}
          disabled={!canStart}
          icon={isProcessing ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}
          label={isProcessing ? '处理中...' : '启动大师级精修'}
        />
      }
    >
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-[11px] font-black text-slate-500 uppercase tracking-widest">
              <i className="fas fa-images text-emerald-500"></i>
              <span>导入待修原图</span>
            </div>

            <UploadSurface
              onClick={() => fileInputRef.current?.click()}
              icon="fa-image"
              accentTextClass="text-emerald-500"
              title="点击上传原图或拖拽到此处"
              hint="支持批量添加待修原图，适合统一精修或白底重建。"
              meta="JPG / PNG / WEBP · 超 3MB 自动压缩"
            >
              <input type="file" multiple ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
            </UploadSurface>

            {(pendingFiles.length > 0 || uploadedSourcePreviewUrls.length > 0) && (
              <div className="grid grid-cols-5 gap-2 p-2 bg-slate-50 rounded-2xl border border-slate-100">
                  {(pendingFiles.length > 0 ? pendingFiles : uploadedSourcePreviewUrls).map((f, i) => (
                    <div key={i} className="aspect-square bg-white rounded-lg border border-slate-200 overflow-hidden">
                      {f instanceof File ? (
                        <img src={safeCreateObjectURL(f)} className="w-full h-full object-cover" />
                      ) : (
                        <img
                          src={f}
                          className="w-full h-full object-cover"
                          alt="uploaded source preview"
                        />
                      )}
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
              <PopoverSelect
                value={aspectRatio}
                onChange={(next) => setAspectRatio(next as AspectRatio)}
                options={visibleRatios.map((ratio) => ({
                  value: ratio.value,
                  label: ratio.label,
                }))}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
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
    </SidebarShell>
  );
};

export default RetouchSidebar;
