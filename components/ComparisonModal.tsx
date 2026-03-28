
import React, { useEffect, useState } from 'react';
// Fixed: Replaced ProcessingConfig with exported ModuleConfig
import { FileItem, ModuleConfig } from '../types';
import { safeCreateObjectURL } from '../utils/urlUtils';
import { getClientSafeAssetUrl } from '../modules/Translation/translationAssetUtils.mjs';

interface Props {
  item: FileItem;
  config: ModuleConfig;
  onClose: () => void;
}

const ComparisonModal: React.FC<Props> = ({ item, config, onClose }) => {
  const [originalUrl, setOriginalUrl] = useState<string | undefined>(undefined);
  const [resultUrl, setResultUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    const originalObjectUrl = item.file ? safeCreateObjectURL(item.file) : undefined;
    const processedObjectUrl = item.resultBlob ? safeCreateObjectURL(item.resultBlob) : undefined;
    const nextOriginalUrl = item.sourcePreviewUrl
      ? getClientSafeAssetUrl(item.sourcePreviewUrl)
      : item.sourceUrl
        ? getClientSafeAssetUrl(item.sourceUrl)
        : originalObjectUrl;
    const nextResultUrl = item.resultUrl ? getClientSafeAssetUrl(item.resultUrl) : processedObjectUrl;

    setOriginalUrl(nextOriginalUrl);
    setResultUrl(nextResultUrl);

    return () => {
      if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl);
      if (processedObjectUrl) URL.revokeObjectURL(processedObjectUrl);
    };
  }, [item]);

  if (!originalUrl || !resultUrl) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-7xl h-[90vh] rounded-3xl overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
              <i className="fas fa-columns text-indigo-600"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800 leading-tight">效果对比确认</h3>
              <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider truncate max-w-md">
                文件: {item.relativePath}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex gap-4">
              <div className="text-center">
                <span className="block text-[9px] text-slate-400 uppercase font-black">目标语言</span>
                <span className="text-xs font-bold text-slate-700">{config.customLanguage || config.targetLanguage}</span>
              </div>
              <div className="text-center">
                <span className="block text-[9px] text-slate-400 uppercase font-black">输出比例</span>
                <span className="text-xs font-bold text-slate-700">{config.aspectRatio}</span>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
            >
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex divide-x divide-slate-100 bg-slate-50">
          {/* Original View */}
          <div className="flex-1 flex flex-col p-6 relative group">
            <div className="absolute top-8 left-8 z-10 px-3 py-1 bg-slate-800/80 backdrop-blur-md text-white text-[10px] font-black rounded-full uppercase tracking-widest shadow-lg">
              Original / 原图
            </div>
            <div className="flex-1 flex items-center justify-center overflow-auto rounded-2xl bg-white border border-slate-200 shadow-inner">
              {originalUrl && <img src={originalUrl} className="max-w-full max-h-full object-contain" alt="Original" />}
            </div>
          </div>

          {/* Processed View */}
          <div className="flex-1 flex flex-col p-6 relative group">
            <div className="absolute top-8 left-8 z-10 px-3 py-1 bg-indigo-600 backdrop-blur-md text-white text-[10px] font-black rounded-full uppercase tracking-widest shadow-lg">
              Processed / AI 生成
            </div>
            <div className="flex-1 flex items-center justify-center overflow-auto rounded-2xl bg-white border border-indigo-100 shadow-inner shadow-indigo-50/50">
              {resultUrl && <img src={resultUrl} className="max-w-full max-h-full object-contain" alt="Processed" />}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 bg-white border-t border-slate-100 flex items-center justify-between shrink-0">
          <p className="text-xs text-slate-400 italic">
            <i className="fas fa-info-circle mr-2 text-indigo-400"></i>
            请核对翻译准确性、去水印完整度以及构图比例是否合理。
          </p>
          <button 
            onClick={onClose}
            className="px-8 py-2.5 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            确认并返回
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComparisonModal;
