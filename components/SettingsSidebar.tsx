
import React, { useState } from 'react';
import { AspectRatio, ModuleConfig, GenerationQuality, AppModule, TranslationSubMode } from '../types';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../utils/modelQuality';

interface Props {
  activeModule: AppModule;
  subMode?: TranslationSubMode;
  config: ModuleConfig;
  onChange: (config: ModuleConfig) => void;
  disabled?: boolean;
}

const SettingsSidebar: React.FC<Props> = ({ activeModule, subMode, config, onChange, disabled }) => {
  const isDetailMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.DETAIL;
  const isRemoveTextMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.REMOVE_TEXT;
  const [isCustomLanguage, setIsCustomLanguage] = useState(config.targetLanguage === 'CUSTOM');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    // 修复：range 类型的 input 默认返回 string，需要解析为 number 避免 toFixed 报错
    let val: any = (type === 'number' || type === 'range') ? parseFloat(value) || 0 : value;
    
    if (name === 'targetLanguage' && value === 'CUSTOM') {
      setIsCustomLanguage(true);
      onChange({ ...config, targetLanguage: 'CUSTOM' });
    } else {
      onChange({ ...config, [name]: val });
    }
  };

  const ratioList = [
    { label: '自动', value: AspectRatio.AUTO, icon: 'fa-compress' },
    { label: '1:1', value: AspectRatio.SQUARE, icon: 'fa-square' },
    { label: '2:3', value: AspectRatio.P_2_3, icon: 'fa-portrait' },
    { label: '3:2', value: AspectRatio.L_3_2, icon: 'fa-image' },
    { label: '3:4', value: AspectRatio.P_3_4, icon: 'fa-portrait' },
    { label: '4:3', value: AspectRatio.L_4_3, icon: 'fa-image' },
    { label: '4:5', value: AspectRatio.P_4_5, icon: 'fa-portrait' },
    { label: '5:4', value: AspectRatio.L_5_4, icon: 'fa-image' },
    { label: '9:16', value: AspectRatio.P_9_16, icon: 'fa-mobile-alt' },
    { label: '16:9', value: AspectRatio.L_16_9, icon: 'fa-tv' },
  ];

  return (
    <div className="w-80 bg-white border-r border-gray-200 h-full flex flex-col shrink-0 overflow-hidden relative shadow-sm">
      <header className="p-6 border-b border-slate-50 flex-none bg-white">
        <h2 className="text-xl font-black text-slate-800 mb-1 tracking-tight">
          {isDetailMode ? '详情参数' : isRemoveTextMode ? '擦除参数' : '主图参数'}
        </h2>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.15em]">Parameters Control</p>
      </header>

      {/* 滚动区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
        <div className="p-6 space-y-6 pb-20">
          {!isRemoveTextMode && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 bg-indigo-600 rounded-full"></div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">目标市场语言</label>
              </div>
              {isCustomLanguage ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    autoFocus
                    name="customLanguage"
                    value={config.customLanguage}
                    onChange={handleChange}
                    disabled={disabled}
                    className="flex-1 border border-indigo-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                    placeholder="请输入语言名称..."
                  />
                  <button 
                    onClick={() => {
                      setIsCustomLanguage(false);
                      onChange({ ...config, targetLanguage: 'English' });
                    }} 
                    className="px-3 bg-slate-100 rounded-xl text-[10px] font-bold text-slate-400"
                  >
                    返回
                  </button>
                </div>
              ) : (
                <select
                  name="targetLanguage"
                  value={config.targetLanguage}
                  onChange={handleChange}
                  disabled={disabled}
                  className="w-full border border-slate-100 rounded-xl px-4 py-2.5 text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="English">英语 - English</option>
                  <option value="Japanese">日语 - 日本語</option>
                  <option value="German">德语 - Deutsch</option>
                  <option value="French">法语 - Français</option>
                  <option value="Spanish">西班牙语 - Español</option>
                  <option value="Korean">韩语 - 한국어</option>
                  <option value="Russian">俄语 - Русский</option>
                  <option value="Vietnamese">越南语 - Tiếng Việt</option>
                  <option value="Thai">泰语 - ไทย</option>
                  <option value="Italian">意大利语 - Italiano</option>
                  <option value="CUSTOM">+ 自定义</option>
                </select>
              )}
            </section>
          )}

          {!isDetailMode && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 bg-indigo-600 rounded-full"></div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">画面构图比例</label>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {ratioList.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => onChange({ ...config, aspectRatio: item.value })}
                    disabled={disabled}
                    className={`py-2 flex flex-col items-center justify-center gap-1 rounded-lg border transition-all ${
                      config.aspectRatio === item.value
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                        : 'bg-white border-slate-100 text-slate-400 hover:border-indigo-300'
                    }`}
                  >
                    <i className={`fas ${item.icon} text-[10px]`}></i>
                    <span className="text-[9px] font-bold">{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3 p-5 bg-slate-100 rounded-3xl border border-slate-200">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] block mb-2 text-slate-600">选择生图模型</label>
            <div className="flex gap-2">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => onChange({...config, model: m, quality: getDefaultQualityForModel(m)})}
                  className={`flex-1 py-2 text-[10px] font-bold rounded-xl border transition-all ${
                    config.model === m ? 'bg-indigo-600 border-indigo-500 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'
                  }`}
                >
                  {getModelDisplayName(m)}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3 p-5 bg-slate-100 rounded-3xl border border-slate-200">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] block mb-2 text-slate-600">渲染引擎质量</label>
            <div className="flex gap-2">
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q.value}
                  onClick={() => onChange({...config, quality: q.value as GenerationQuality})}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl border ${
                    config.quality === q.value ? 'bg-indigo-600 border-indigo-500 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4 p-5 bg-indigo-50 rounded-3xl border border-indigo-100">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold text-indigo-900 uppercase tracking-[0.2em]">
                导出尺寸设置
              </label>
              <div className="flex bg-white/60 p-1 rounded-xl border border-indigo-100">
                <button onClick={() => onChange({...config, resolutionMode: 'custom'})} className={`px-3 py-1 text-[9px] font-bold rounded-lg ${config.resolutionMode === 'custom' ? 'bg-indigo-600 text-white' : 'text-indigo-400'}`}>自定义</button>
                <button onClick={() => onChange({...config, resolutionMode: 'original'})} className={`px-3 py-1 text-[9px] font-bold rounded-lg ${config.resolutionMode === 'original' ? 'bg-indigo-600 text-white' : 'text-indigo-400'}`}>原图</button>
              </div>
            </div>

            {config.resolutionMode === 'custom' && (
              <div className="flex items-center gap-3 mb-4">
                <input type="number" name="targetWidth" value={config.targetWidth} onChange={handleChange} className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500" />
                {!(isDetailMode || isRemoveTextMode) && <span className="text-indigo-300">×</span>}
                {!(isDetailMode || isRemoveTextMode) && <input type="number" name="targetHeight" value={config.targetHeight} onChange={handleChange} className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm font-bold text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500" />}
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-indigo-100">
               <div className="flex items-center justify-between">
                 <label className="text-[10px] font-bold text-indigo-900 uppercase tracking-[0.2em]">体积限制 (MB)</label>
                 <span className="text-[10px] font-black text-indigo-600">{(Number(config.maxFileSize) || 0).toFixed(1)} MB</span>
               </div>
               <input 
                 type="range" 
                 name="maxFileSize"
                 min="0.1" 
                 max="10" 
                 step="0.1" 
                 value={config.maxFileSize} 
                 onChange={handleChange}
                 className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
               />
               <p className="text-[9px] text-indigo-400 font-medium italic">限制生成后图片的占用空间，不改变分辨率</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsSidebar;
