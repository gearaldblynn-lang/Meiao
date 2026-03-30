
import React, { useRef, useMemo } from 'react';
import { VideoPersistentState, VideoConfig, SceneItem } from '../../types';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { PopoverSelect, PrimaryActionButton, SidebarShell, UploadSurface } from '../../components/ui/workspacePrimitives';
import { hasAvailableAssetSources } from '../../utils/cloudAssetState.mjs';

interface Props {
  state: VideoPersistentState;
  onUpdate: (updates: Partial<VideoPersistentState>) => void;
  onStart: () => void;
  onPlan: () => void;
  isProcessing: boolean;
}

const VideoSidebar: React.FC<Props> = ({ state, onUpdate, onStart, onPlan, isProcessing }) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const countries = ['中国', '美国', '英国', '日本', '德国', '法国', '西班牙', '韩国', '越南', '泰国', '意大利', '自定义'];

  const updateConfig = (updates: Partial<VideoConfig>) => {
    onUpdate({ config: { ...state.config, ...updates } });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      onUpdate({ productImages: [file], uploadedProductUrls: [] });
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUpdate({ referenceVideoFile: e.target.files[0], uploadedReferenceVideoUrl: '' });
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  const totalTargetSec = parseInt(state.config.duration);
  const hasProductAssets = hasAvailableAssetSources(state.productImages, state.uploadedProductUrls);
  const currentTotalSec = useMemo(() => {
    return state.config.scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
  }, [state.config.scenes]);

  const isDurationMismatch = state.config.promptMode === 'manual' && state.config.scenes.length > 0 && Math.abs(currentTotalSec - totalTargetSec) > 0.1;
  const isEditorIncomplete = state.config.promptMode === 'manual' && (state.config.scenes.length === 0 || state.config.scenes.some(s => !s.Scene.trim()));

  const handleAddScene = () => {
    const newScene: SceneItem = { Scene: '', duration: 5 };
    updateConfig({ scenes: [...state.config.scenes, newScene] });
  };

  const handleUpdateScene = (index: number, updates: Partial<SceneItem>) => {
    const next = [...state.config.scenes];
    next[index] = { ...next[index], ...updates };
    updateConfig({ scenes: next });
  };

  const handleRemoveScene = (index: number) => {
    updateConfig({ scenes: state.config.scenes.filter((_, i) => i !== index) });
  };

  const isRenderDisabled = isProcessing || !hasProductAssets || (state.config.promptMode === 'ai' && !state.config.scenes.length) || isDurationMismatch || isEditorIncomplete;

  return (
    <SidebarShell
      accentClass="bg-fuchsia-600"
      title="短视频生成配置"
      subtitle={state.config.promptMode === 'manual' ? '分镜编辑模式' : '自动策划模式'}
      footer={
        <PrimaryActionButton
          onClick={onStart}
          disabled={isRenderDisabled}
          label={isProcessing ? '渲染引擎预热中...' : state.config.promptMode === 'ai' ? '请先策划分镜脚本' : isDurationMismatch ? '分镜时长不匹配' : isEditorIncomplete ? '分镜描述未完成' : '开始极速渲染视频'}
        />
      }
    >
        {isDurationMismatch && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <i className="fas fa-exclamation-circle text-rose-500 mt-0.5"></i>
              <div className="space-y-1">
                <p className="text-[11px] font-black text-rose-600 leading-tight">分镜时长总和异常</p>
                <p className="text-nowrap text-[10px] font-bold text-rose-400">当前累计：{currentTotalSec.toFixed(1)}s / 预设目标：{totalTargetSec}s</p>
              </div>
            </div>
          </div>
        )}

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-[11px] font-black text-slate-500 uppercase tracking-widest">
            <i className="fas fa-images text-purple-500"></i>
            <span>产品主体 (仅限1张)</span>
          </div>
          <div onClick={() => imageInputRef.current?.click()} className="cursor-pointer">
            {hasProductAssets ? (
              <div className="relative aspect-video rounded-xl overflow-hidden shadow-inner ring-1 ring-slate-100">
                {state.productImages[0] ? (
                  <img src={safeCreateObjectURL(state.productImages[0])} className="w-full h-full object-cover" />
                ) : state.uploadedProductUrls?.[0] ? (
                  <img src={state.uploadedProductUrls[0]} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300">
                    <i className="far fa-file-image text-lg mb-1"></i>
                    <span className="text-[8px] font-bold">文件已失效</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-white text-[10px] font-black uppercase">更换素材</span>
                </div>
              </div>
            ) : (
              <UploadSurface
                icon="fa-image"
                accentTextClass="text-fuchsia-500"
                title="点击上传产品主图"
                hint="用于生成分镜脚本、镜头草图和后续视频画面。"
                meta="JPG / PNG / WEBP · 超 3MB 自动压缩"
              />
            )}
            <input type="file" ref={imageInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
          </div>
        </section>

        <section className="space-y-5 pt-4 border-t border-slate-100">
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">视频时长</span>
                <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                   {['10', '15', '25'].map(d => (
                      <button key={d} onClick={() => updateConfig({ duration: d as any })} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg ${state.config.duration === d ? 'bg-white text-purple-600 shadow-sm border border-slate-200' : 'text-slate-400'}`}>{d}s</button>
                   ))}
                </div>
             </div>
             <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">画布比例</span>
                <PopoverSelect
                  value={state.config.aspectRatio}
                  onChange={(next) => updateConfig({ aspectRatio: next as any })}
                  options={[
                    { value: 'landscape', label: '横屏 16:9' },
                    { value: 'portrait', label: '竖屏 9:16' },
                  ]}
                  buttonClassName="h-10 rounded-2xl px-4 text-xs"
                />
             </div>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button onClick={() => updateConfig({ promptMode: 'ai' })} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg ${state.config.promptMode === 'ai' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-400'}`}>AI 自动策划</button>
            <button onClick={() => updateConfig({ promptMode: 'manual' })} className={`flex-1 py-1.5 text-[10px] font-black rounded-lg ${state.config.promptMode === 'manual' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-400'}`}>分镜编辑器</button>
          </div>
        </section>

        {state.config.promptMode === 'ai' ? (
           <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">目标市场 / 国家</span>
                <div className="relative">
                  {state.config.targetCountry === '自定义' ? (
                    <div className="relative">
                      <input 
                        autoFocus
                        type="text" 
                        value={state.config.customCountry || ''} 
                        onChange={(e) => updateConfig({ customCountry: e.target.value })} 
                        className="w-full bg-white border border-purple-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-purple-500 pr-10 shadow-sm"
                        placeholder="请输入国家名称..."
                      />
                      <button onClick={() => updateConfig({ targetCountry: '美国', customCountry: '' })} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-purple-600"><i className="fas fa-rotate-left text-[10px]"></i></button>
                    </div>
                  ) : (
                    <PopoverSelect
                      value={state.config.targetCountry}
                      onChange={(next) => updateConfig({ targetCountry: next, customCountry: next === '自定义' ? '' : undefined })}
                      options={countries.map((country) => ({ value: country, label: country }))}
                      buttonClassName="h-10 rounded-2xl px-4 text-xs"
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1">
                 <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">参考视频 (节奏学习)</span>
                 <div onClick={() => videoInputRef.current?.click()} className="group cursor-pointer border-2 border-dashed border-slate-200 rounded-2xl p-4 hover:border-purple-300 bg-slate-50/50">
                    {state.referenceVideoFile || state.uploadedReferenceVideoUrl ? (
                      <div className="flex items-center gap-3 px-2">
                        <i className="fas fa-video text-purple-500"></i>
                        <span className="text-[10px] font-bold text-slate-600 truncate flex-1">{state.referenceVideoFile?.name || '已保存参考视频'}</span>
                        <button onClick={(e) => { e.stopPropagation(); onUpdate({ referenceVideoFile: null, uploadedReferenceVideoUrl: '' }); }} className="text-slate-300 hover:text-rose-500"><i className="fas fa-times-circle"></i></button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1 py-1"><i className="fas fa-clapperboard text-slate-300 text-sm"></i><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">点击上传参考视频</span></div>
                    )}
                    <input type="file" ref={videoInputRef} onChange={handleVideoUpload} className="hidden" accept="video/*" />
                 </div>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">产品核心信息</span>
                <textarea value={state.config.productInfo} onChange={(e) => updateConfig({ productInfo: e.target.value })} placeholder="输入产品的名称、卖点等..." className="w-full h-24 bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">视频简单要求</span>
                <textarea value={state.config.requirements} onChange={(e) => updateConfig({ requirements: e.target.value })} placeholder="如：动感快节奏、柔美光影等..." className="w-full h-24 bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" />
              </div>
              <button onClick={onPlan} disabled={isProcessing || !hasProductAssets} className="w-full py-4 bg-purple-600 text-white font-black text-xs rounded-xl shadow-lg hover:bg-purple-700 disabled:bg-slate-200">AI 策划分镜脚本</button>
           </section>
        ) : (
           <section className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <button onClick={handleAddScene} className="w-full py-2 bg-purple-50 text-purple-600 text-[10px] font-black rounded-xl border border-purple-100 hover:bg-purple-100">+ 新增分镜场景</button>
              <div className="space-y-4">
                 {state.config.scenes.map((scene, idx) => (
                    <div key={idx} className={`bg-white border rounded-3xl p-5 space-y-4 relative shadow-sm ${isDurationMismatch ? 'border-rose-100' : 'border-slate-100'}`}>
                       <button onClick={() => handleRemoveScene(idx)} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500"><i className="fas fa-times-circle text-lg"></i></button>
                       <div className="flex items-center gap-3">
                          <span className="px-3 py-1 bg-slate-900 text-white text-[10px] font-black rounded-lg">分镜 #{idx+1}</span>
                          <div className="flex items-center gap-2">
                             <input type="number" step="0.1" value={scene.duration} onChange={(e) => handleUpdateScene(idx, { duration: parseFloat(e.target.value) || 0 })} className={`w-14 bg-slate-50 border rounded-lg px-2 py-1 text-xs font-black outline-none text-center ${isDurationMismatch ? 'border-rose-300 text-rose-600' : 'border-slate-200 text-purple-600'}`} />
                             <span className="text-[10px] font-bold text-slate-400">s</span>
                          </div>
                       </div>
                       <textarea value={scene.Scene} onChange={(e) => handleUpdateScene(idx, { Scene: e.target.value })} placeholder="输入分镜详细描述..." className="w-full h-40 bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:ring-1 focus:ring-purple-500 resize-none" />
                    </div>
                 ))}
              </div>
           </section>
        )}
    </SidebarShell>
  );
};

export default VideoSidebar;
