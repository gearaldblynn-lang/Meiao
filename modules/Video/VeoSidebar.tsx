
import React, { useRef, useState } from 'react';
import { VideoPersistentState, VideoConfig } from '../../types';
import { useToast } from '../../components/ToastSystem';
import { safeCreateObjectURL } from '../../utils/urlUtils';

interface Props {
  state: VideoPersistentState;
  onUpdate: (updates: Partial<VideoPersistentState>) => void;
  onStart: () => void;
  isProcessing: boolean;
}

const VeoSidebar: React.FC<Props> = ({ state, onUpdate, onStart, isProcessing }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<(File | null)[]>([null, null, null]);
  const { addToast } = useToast();

  const updateConfig = (updates: Partial<VideoConfig>) => {
    onUpdate({ config: { ...state.config, ...updates } });
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const fileArray = Array.from(e.target.files);
    
    // Combine with existing images up to 3
    const currentImages = state.productImages || [];
    const availableSlots = 3 - currentImages.length;
    
    if (availableSlots <= 0) {
      addToast("最多只能上传 3 张图片作为参考素材。", 'warning');
      return;
    }

    const newImages = [...currentImages, ...fileArray.slice(0, availableSlots)];
    onUpdate({ productImages: newImages });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    const newImages = state.productImages.filter((_, i) => i !== index);
    onUpdate({ productImages: newImages });
  };

  return (
    <div className="w-[380px] bg-white border-r border-slate-200 h-full flex flex-col shrink-0 overflow-hidden relative z-30 shadow-sm">
      <header className="p-6 border-b border-slate-100 bg-indigo-50/30 flex-none">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-5 bg-indigo-600 rounded-full shadow-sm"></div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">AI 智慧剧本配置</h2>
        </div>
        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-[0.2em]">Veo 3.1 & Doubao Engine</p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll p-5 space-y-6">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-black text-slate-500 uppercase tracking-widest">
              <i className="fas fa-images text-indigo-500"></i>
              <span>参考素材 (1-3张)</span>
            </div>
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-2 py-1 rounded-lg"
            >
              + 添加图片
            </button>
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              multiple 
              className="hidden" 
              onChange={handleFiles} 
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="relative aspect-square bg-slate-50 rounded-xl border border-slate-200 overflow-hidden group">
                {state.productImages[idx] ? (
                  <>
                    <img src={safeCreateObjectURL(state.productImages[idx])} className="w-full h-full object-cover" />
                    <button 
                      onClick={() => removeImage(idx)} 
                      className="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <i className="fas fa-times text-[10px]"></i>
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300" onClick={() => fileInputRef.current?.click()}>
                    <i className="fas fa-plus text-lg"></i>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-5 pt-4 border-t border-slate-100">
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">视频比例</span>
                <select 
                  value={state.config.aspectRatio || 'portrait'} 
                  onChange={(e) => updateConfig({ aspectRatio: e.target.value as any })} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
                >
                   <option value="portrait">竖屏 9:16 (默认)</option>
                   <option value="landscape">横屏 16:9</option>
                </select>
             </div>
             <div className="space-y-1">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">目标时长</span>
                <select 
                  value={state.config.duration || '16'} 
                  onChange={(e) => updateConfig({ duration: e.target.value as any })} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
                >
                  <option value="8">8秒 (1个分镜)</option>
                  <option value="16">16秒 (2个分镜)</option>
                  <option value="24">24秒 (3个分镜)</option>
                  <option value="32">32秒 (4个分镜)</option>
                  <option value="40">40秒 (5个分镜)</option>
                  <option value="48">48秒 (6个分镜)</option>
                  <option value="56">56秒 (7个分镜)</option>
                  <option value="60">60秒 (约8个分镜)</option>
                </select>
             </div>
          </div>

          <div className="space-y-1">
             <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">生成份数 (独立方案)</span>
             <select 
               value={state.config.videoCount || 1} 
               onChange={(e) => updateConfig({ videoCount: Number(e.target.value) })} 
               className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
             >
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} 套方案</option>)}
             </select>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">目标语言</span>
            <input 
              type="text" 
              value={state.config.targetLanguage || ''} 
              onChange={(e) => updateConfig({ targetLanguage: e.target.value })} 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
              placeholder="例如：简体中文 / English" 
            />
          </div>
        </section>

        <section className="space-y-4 pt-4 border-t border-slate-100">
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">核心卖点与参数</span>
            <textarea 
              value={state.config.sellingPoints || ''} 
              onChange={(e) => updateConfig({ sellingPoints: e.target.value })} 
              className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" 
              placeholder="输入产品核心卖点，AI 将基于此生成口播..." 
            />
          </div>
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">叙事逻辑/风格</span>
            <textarea 
              value={state.config.logicInfo || ''} 
              onChange={(e) => updateConfig({ logicInfo: e.target.value })} 
              className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs outline-none focus:bg-white resize-none shadow-inner" 
              placeholder="描述视频的节奏、运镜风格或叙事框架..." 
            />
          </div>
        </section>
      </div>

      <div className="p-5 border-t border-slate-100 bg-white flex-none shadow-[0_-4px_10px_rgba(0,0,0,0.02)]">
        <button 
          onClick={onStart} 
          disabled={isProcessing || state.productImages.length === 0} 
          className="w-full py-4 bg-indigo-600 text-white font-black rounded-xl shadow-lg hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-300 transition-all flex items-center justify-center gap-3"
        >
          {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic text-indigo-200"></i>}
          {isProcessing ? 'AI 正在策划剧本...' : '生成智慧剧本开启创作'}
        </button>
      </div>
    </div>
  );
};

export default VeoSidebar;
