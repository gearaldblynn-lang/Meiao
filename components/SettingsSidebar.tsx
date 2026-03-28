
import React, { useState } from 'react';
import { AspectRatio, ModuleConfig, GenerationQuality, AppModule, TranslationSubMode } from '../types';
import { getDefaultQualityForModel, getModelDisplayName, MODEL_OPTIONS, QUALITY_OPTIONS } from '../utils/modelQuality';
import { getSafeAspectRatioForModel, getSupportedAspectRatiosForModel } from '../utils/modelAspectRatio';
import { PopoverSelect, PrimaryActionButton, SectionCard, SegmentedTabs, SidebarShell } from './ui/workspacePrimitives';

interface Props {
  activeModule: AppModule;
  subMode?: TranslationSubMode;
  config: ModuleConfig;
  onChange: (config: ModuleConfig) => void;
  disabled?: boolean;
  onModeChange?: (mode: TranslationSubMode) => void;
  onStart?: () => void;
  startDisabled?: boolean;
}

const SettingsSidebar: React.FC<Props> = ({
  activeModule,
  subMode,
  config,
  onChange,
  disabled,
  onModeChange,
  onStart,
  startDisabled,
}) => {
  const isDetailMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.DETAIL;
  const isMainTranslationMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.MAIN;
  const isRemoveTextMode = activeModule === AppModule.TRANSLATION && subMode === TranslationSubMode.REMOVE_TEXT;
  const [isCustomLanguage, setIsCustomLanguage] = useState(config.targetLanguage === 'CUSTOM');
  const languageOptions = [
    { value: 'English', label: '英语' },
    { value: 'Japanese', label: '日语' },
    { value: 'German', label: '德语' },
    { value: 'French', label: '法语' },
    { value: 'Spanish', label: '西班牙语' },
    { value: 'Korean', label: '韩语' },
    { value: 'Russian', label: '俄语' },
    { value: 'Vietnamese', label: '越南语' },
    { value: 'Thai', label: '泰语' },
    { value: 'Italian', label: '意大利语' },
    { value: 'CUSTOM', label: '+ 自定义' },
  ];

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
    { label: '1:4', value: AspectRatio.P_1_4, icon: 'fa-portrait' },
    { label: '1:8', value: AspectRatio.P_1_8, icon: 'fa-portrait' },
    { label: '2:3', value: AspectRatio.P_2_3, icon: 'fa-portrait' },
    { label: '3:2', value: AspectRatio.L_3_2, icon: 'fa-image' },
    { label: '3:4', value: AspectRatio.P_3_4, icon: 'fa-portrait' },
    { label: '4:1', value: AspectRatio.L_4_1, icon: 'fa-image' },
    { label: '4:3', value: AspectRatio.L_4_3, icon: 'fa-image' },
    { label: '4:5', value: AspectRatio.P_4_5, icon: 'fa-portrait' },
    { label: '5:4', value: AspectRatio.L_5_4, icon: 'fa-image' },
    { label: '8:1', value: AspectRatio.L_8_1, icon: 'fa-image' },
    { label: '9:16', value: AspectRatio.P_9_16, icon: 'fa-mobile-alt' },
    { label: '16:9', value: AspectRatio.L_16_9, icon: 'fa-tv' },
    { label: '21:9', value: AspectRatio.L_21_9, icon: 'fa-tv' },
  ];
  const supportedRatios = getSupportedAspectRatiosForModel(config.model);
  const visibleRatioList = ratioList.filter((item) => {
    if (!supportedRatios.includes(item.value)) return false;
    if (isMainTranslationMode && item.value === AspectRatio.AUTO) return false;
    return true;
  });

  return (
    <SidebarShell
      widthClassName="w-[360px]"
      accentClass="bg-indigo-600"
      title={isDetailMode ? '详情参数' : isRemoveTextMode ? '擦除参数' : '主图参数'}
      subtitle={isRemoveTextMode ? '去文案模式' : isDetailMode ? '详情模式' : '主图模式'}
      headerContent={activeModule === AppModule.TRANSLATION && subMode && onModeChange ? (
        <SegmentedTabs
          value={subMode}
          onChange={(next) => onModeChange(next as TranslationSubMode)}
          accentClass="bg-indigo-600 text-white"
          items={[
            { value: TranslationSubMode.MAIN, label: '主图出海' },
            { value: TranslationSubMode.DETAIL, label: '详情出海' },
            { value: TranslationSubMode.REMOVE_TEXT, label: '去除文案' },
          ]}
        />
      ) : undefined}
      footer={onStart ? (
        <PrimaryActionButton
          onClick={onStart}
          disabled={Boolean(startDisabled)}
          icon={disabled ? 'fa-spinner fa-spin' : 'fa-globe'}
          label={disabled ? '处理中...' : isRemoveTextMode ? '开始去除文案' : isDetailMode ? '开始详情出海' : '开始主图出海'}
        />
      ) : undefined}
    >
          {!isRemoveTextMode && (
            <SectionCard title="目标市场语言">
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
                    className="px-3 bg-slate-100 rounded-xl text-[10px] font-bold text-slate-500"
                  >
                    返回
                  </button>
                </div>
              ) : (
                <PopoverSelect
                  value={config.targetLanguage}
                  onChange={(next) => {
                    if (next === 'CUSTOM') {
                      setIsCustomLanguage(true);
                      onChange({ ...config, targetLanguage: 'CUSTOM' });
                      return;
                    }
                    setIsCustomLanguage(false);
                    onChange({ ...config, targetLanguage: next });
                  }}
                  disabled={disabled}
                  options={languageOptions}
                  buttonClassName="h-10 rounded-2xl px-4 text-xs"
                />
              )}
            </SectionCard>
          )}

          {!isDetailMode && (
            <SectionCard title="画面构图比例">
              <PopoverSelect
                value={config.aspectRatio}
                onChange={(next) => onChange({ ...config, aspectRatio: next as AspectRatio })}
                options={visibleRatioList.map((item) => ({
                  value: item.value,
                  label: item.label,
                }))}
                buttonClassName="h-10 rounded-2xl px-4 text-xs"
              />
            </SectionCard>
          )}

          <SectionCard title="选择生图模型">
            <label className="text-[10px] font-bold uppercase tracking-[0.2em] block mb-2 text-slate-600">选择生图模型</label>
            <div className="flex gap-2">
                {MODEL_OPTIONS.map((m) => (
                  <button
                    key={m}
                    onClick={() =>
                      onChange({
                        ...config,
                        model: m,
                        quality: getDefaultQualityForModel(m),
                        aspectRatio: getSafeAspectRatioForModel(
                          m,
                          config.aspectRatio,
                          isMainTranslationMode ? AspectRatio.SQUARE : AspectRatio.AUTO
                        ),
                      })
                    }
                    className={`flex-1 py-2 text-[10px] font-bold rounded-xl border transition-all ${
                      config.model === m ? 'bg-indigo-600 border-indigo-500 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'
                    }`}
                >
                  {getModelDisplayName(m)}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="渲染引擎质量">
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
          </SectionCard>

          <SectionCard title="导出尺寸设置" className="border-indigo-100 bg-indigo-50/70">
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
          </SectionCard>
    </SidebarShell>
  );
};

export default SettingsSidebar;
