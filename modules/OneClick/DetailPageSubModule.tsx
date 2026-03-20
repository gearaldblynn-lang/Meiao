
import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { GlobalApiConfig, AspectRatio, OneClickConfig, MainImageScheme, OneClickSubMode, OneClickPersistentState, KieAiResult } from '../../types';
import ConfigSidebar from './ConfigSidebar';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { generateMarketingSchemes } from '../../services/arkService';
import { uploadToCos } from '../../services/tencentCosService';
import { processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { resizeImage, createZipAndDownload, getImageDimensions } from '../../utils/imageUtils';
import { useToast } from '../../components/ToastSystem';

interface Props {
  apiConfig: GlobalApiConfig;
  state: OneClickPersistentState['detailPage'];
  onUpdate: (updates: Partial<OneClickPersistentState['detailPage']> | ((prev: OneClickPersistentState['detailPage']) => OneClickPersistentState['detailPage'])) => void;
  onProcessingChange: (processing: boolean) => void;
  onSyncConfig?: () => void;
  onClearConfig?: () => void;
}

const DetailPageSubModule: React.FC<Props> = ({ apiConfig, state, onUpdate, onProcessingChange, onSyncConfig, onClearConfig }) => {
  const { productImages, styleImage, schemes, config, lastStyleUrl, uploadedProductUrls } = state;
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const { addToast } = useToast();
  
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const isSubmittingAnalysisRef = useRef(false);
  const screenControllersRef = useRef<Record<string, AbortController>>({});
  const globalAbortRef = useRef<AbortController | null>(null);

  const selectedCount = schemes.filter(s => s.selected).length;
  const completedCount = schemes.filter(s => s.status === 'completed' && s.resultUrl).length;
  const isAllSelected = schemes.length > 0 && selectedCount === schemes.length;

  const schemesRef = useRef(schemes);
  schemesRef.current = schemes;

  useEffect(() => {
    const hasActiveTask = schemes.some(s => s.status === 'generating') || isAnalyzing || isGenerating;
    onProcessingChange(hasActiveTask);
  }, [schemes, isAnalyzing, isGenerating]);

  useEffect(() => {
    // 强制重置分析和生成状态，防止刷新后状态锁定
    setIsAnalyzing(false);
    setIsGenerating(false);
    onProcessingChange(false);

    // 自动恢复刷新前正在生成的任务
    if (schemes && Array.isArray(schemes)) {
      schemes.forEach(s => {
        if (s.status === 'generating' && s.taskId && !inflightIdsRef.current.has(s.id)) {
          handleRecoverScreen(s.id);
        }
      });
    }
  }, []); // 仅在组件挂载时执行一次

  useEffect(() => {
    // 当 schemes 变化时，如果 resultUrl 变为非 blob URL，重置错误状态
    setImageErrors(prev => {
      const next = { ...prev };
      let changed = false;
      schemes.forEach(s => {
        if (next[s.id] && s.resultUrl && !s.resultUrl.startsWith('blob:')) {
          delete next[s.id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [schemes]);

  const toggleSelectAll = () => { 
    if (isAnalyzing) return;
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => ({ ...s, selected: !isAllSelected })) })); 
  };
  
  const toggleSelectScheme = (id: string) => { 
    if (isAnalyzing) return;
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === id ? { ...s, selected: !s.selected } : s) })); 
  };

  const getOrUploadProductUrls = async () => {
    // 智能复用：如果本地图片为空但已有上传记录，说明是刷新后恢复的状态
    if (productImages.length === 0 && uploadedProductUrls.length > 0) {
      return uploadedProductUrls;
    }
    // 如果缓存中存在链接且数量与当前图片一致，直接使用
    if (uploadedProductUrls && uploadedProductUrls.length === productImages.length && productImages.length > 0) {
      return uploadedProductUrls;
    }
    const urls = await Promise.all(productImages.map(img => uploadToCos(img, apiConfig)));
    onUpdate({ uploadedProductUrls: urls });
    return urls;
  };

  const handleStartAnalysis = async () => {
    const hasGeneratingTask = schemesRef.current.some(s => s.status === 'generating');
    // 允许在只有上传 URL 的情况下启动分析（支持刷新后直接点击）
    if (isSubmittingAnalysisRef.current || isAnalyzing || isGenerating || hasGeneratingTask || (productImages.length === 0 && uploadedProductUrls.length === 0)) return;
    
    isSubmittingAnalysisRef.current = true;
    setIsAnalyzing(true);
    
    try {
      onUpdate({ schemes: [] }); 
      globalAbortRef.current = new AbortController();
      
      const productUrls = await getOrUploadProductUrls();
      
      let styleUrl = lastStyleUrl;
      // 仅当样式图存在且未上传时才上传
      if (styleImage && !styleUrl) { 
        styleUrl = await uploadToCos(styleImage, apiConfig); 
        onUpdate({ lastStyleUrl: styleUrl }); 
      } else if (!styleImage) {
        onUpdate({ lastStyleUrl: null });
        styleUrl = null;
      }

      if (globalAbortRef.current.signal.aborted) throw new Error("ABORTED");

      const res = await generateMarketingSchemes(productUrls, styleUrl, config, apiConfig, OneClickSubMode.DETAIL_PAGE, null, globalAbortRef.current.signal);
      
      if (res.status === 'success') {
        const initialSchemes: MainImageScheme[] = res.schemes.map((text, idx) => {
          const ratioMatch = text.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/);
          const ratio = ratioMatch ? ratioMatch[1] : undefined;

          let uiTitle = `第 ${idx + 1} 屏 - 策划方案`;
          const lines = text.split('\n');
          
          const titleLine = lines.find(l => /^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏)/.test(l.trim()));
          if (titleLine) {
             uiTitle = titleLine.trim().replace(/^(?:[-#*>\s]*)(?:屏序\/类型[：:]?)?/, '').trim();
          }

          const cleanedLines = lines.filter(line => {
             const l = line.trim();
             if (/^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏)/.test(l)) return false;
             if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false;
             return true;
          });
          
          const cleanedText = cleanedLines.join('\n').trim();

          return { 
            id: Math.random().toString(36).substr(2, 9), 
            uiTitle: uiTitle, 
            originalContent: text, 
            editedContent: cleanedText, 
            extractedRatio: ratio,
            status: 'pending', 
            selected: true 
          };
        });
        onUpdate({ schemes: initialSchemes });
      } else { 
        alert("视觉全案策划失败: " + res.message); 
      }
    } catch (e: any) { 
      if (e.name === 'AbortError' || e.message === 'ABORTED') {
        alert("策划分析超时或已取消，请检查网络或重试。");
      } else {
        alert("系统分析异常: " + e.message); 
      }
    } finally { 
      setIsAnalyzing(false); 
      isSubmittingAnalysisRef.current = false;
    }
  };

  const [isCollapsed, setIsCollapsed] = useState(false);

  const updateSingleScreen = (id: string, updates: Partial<MainImageScheme>) => {
    onUpdate(prev => ({
      ...prev,
      schemes: prev.schemes.map(s => s.id === id ? { ...s, ...updates } : s)
    }));
    if (updates.resultUrl) {
      setImageErrors(prev => ({ ...prev, [id]: false }));
    }
  };

  const deleteProject = () => {
    // 中断所有正在进行的任务
    Object.values(screenControllersRef.current).forEach((controller: AbortController) => controller.abort());
    screenControllersRef.current = {};
    
    onUpdate(prev => ({
      ...prev,
      schemes: [],
      uploadedProductUrls: []
    }));
    inflightIdsRef.current.clear();
    setIsCollapsed(false);
    addToast('项目已清空', 'success');
  };

  const deleteScreen = (id: string) => {
    // 如果正在生成，先中断
    if (screenControllersRef.current[id]) {
      screenControllersRef.current[id].abort();
      delete screenControllersRef.current[id];
    }
    onUpdate(prev => ({
      ...prev,
      schemes: prev.schemes.filter(s => s.id !== id)
    }));
    inflightIdsRef.current.delete(id);
    addToast('分屏已删除', 'success');
  };

  const handleRedoScreen = async (id: string) => {
    if (inflightIdsRef.current.has(id)) return;
    
    // 立即反馈
    updateSingleScreen(id, { status: 'generating', error: '正在准备素材...' });
    
    inflightIdsRef.current.add(id);
    try {
      const urls = await getOrUploadProductUrls();
      await generateSingleScreen(id, urls, lastStyleUrl, 'full'); 
    } catch (e: any) {
      inflightIdsRef.current.delete(id);
      updateSingleScreen(id, { status: 'error', error: '启动失败' });
      alert("任务启动失败: " + e.message);
    }
  };

  const handleRecoverScreen = async (id: string) => {
    if (inflightIdsRef.current.has(id)) return;
    
    // 立即反馈
    updateSingleScreen(id, { status: 'generating', error: '正在同步云端结果...' });
    
    inflightIdsRef.current.add(id);
    try {
      const urls = await getOrUploadProductUrls();
      await generateSingleScreen(id, urls, lastStyleUrl, 'recover');
    } catch (e: any) {
      inflightIdsRef.current.delete(id);
      updateSingleScreen(id, { status: 'error', error: '同步失败: ' + e.message });
    }
  };

  const handleInterruptScreen = (id: string) => {
    if (screenControllersRef.current[id]) {
      screenControllersRef.current[id].abort();
      delete screenControllersRef.current[id];
    }
    inflightIdsRef.current.delete(id);
    updateSingleScreen(id, { 
      status: 'error', 
      error: '已手动中断，可点击同步获取结果' 
    });
  };

  const generateSingleScreen = async (schemeId: string, productUrls: string[], styleUrl: string | null, mode: 'full' | 'recover' = 'full') => {
    if (screenControllersRef.current[schemeId]) { screenControllersRef.current[schemeId].abort(); }
    const controller = new AbortController();
    screenControllersRef.current[schemeId] = controller;
    
    updateSingleScreen(schemeId, { status: 'generating', error: undefined });
    
    try {
      let res: KieAiResult;
      const targetScheme = schemesRef.current.find(s => s.id === schemeId);
      if (!targetScheme) return;

      if (mode === 'recover' && targetScheme.taskId) {
        updateSingleScreen(schemeId, { error: '正在同步云端任务状态...' });
        res = await recoverKieAiTask(targetScheme.taskId, apiConfig, controller.signal);
      } else { 
        res = await triggerNewKieTask(targetScheme, productUrls, styleUrl, controller.signal); 
      }

      // 关键修正：只要拿到 taskId，立即存入持久化状态，防止刷新丢失
      if (res.taskId) {
        updateSingleScreen(schemeId, { taskId: res.taskId });
      }

      if (controller.signal.aborted || res.status === 'interrupted') {
        throw new Error("INTERRUPTED");
      }

      if (res.status === 'success') {
        const imgResp = await fetch(res.imageUrl, { signal: controller.signal });
        const blob = await imgResp.blob();
        const dims = await getImageDimensions(blob);

        let targetW = dims.width;
        let targetH = dims.height;

        if (config.resolutionMode === 'custom' && config.targetWidth) {
          targetW = config.targetWidth;
          targetH = Math.round(config.targetWidth / dims.ratio);
        }

        const finalBlob = await resizeImage(blob, targetW, targetH, config.maxFileSize);
        const finalUrl = safeCreateObjectURL(finalBlob);
        
        updateSingleScreen(schemeId, { status: 'completed', resultUrl: finalUrl, taskId: res.taskId });
      } else if (res.status === 'task_not_found') {
        throw new Error("任务已过期或不存在，请重新生成");
      } else { 
        throw new Error(res.message || '引擎返回异常，渲染失败'); 
      }
    } catch (err: any) {
      const isManual = err.name === 'AbortError' || err.message === 'INTERRUPTED';
      updateSingleScreen(schemeId, { 
        status: isManual ? 'interrupted' : 'error', 
        error: isManual ? '渲染已中断' : err.message 
      });
    } finally { 
      delete screenControllersRef.current[schemeId]; 
      inflightIdsRef.current.delete(schemeId);
    }
  };

  const triggerNewKieTask = async (scheme: MainImageScheme, productUrls: string[], styleUrl: string | null, signal: AbortSignal) => {
    const ratioInText = scheme.editedContent.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/);
    const finalRatio = ratioInText ? ratioInText[1] : (scheme.extractedRatio || '3:4');
    
    const cleanPrompt = scheme.editedContent
      .split('\n')
      .filter(line => {
        const l = line.trim();
        if (/^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏)/.test(l)) return false;
        if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false;
        if (/^(?:[-#*>\s]*)设计意图/.test(l)) return false;
        return true;
      })
      .join('\n')
      .trim();

    let finalPrompt = `STRICT PRODUCT CONSISTENCY: Strictly keep the product fully consistent with the source product reference images. Strictly do not change the product's appearance details, size, structure, label information, packaging information, or any visible product elements. SCENARIO & STYLE: ${cleanPrompt}. QUALITY: High-end commercial studio photography.`;
    
    // 仅使用产品图作为 image_input，不包含风格参考图
    const inputImages = [...productUrls];
    
    if (styleUrl) {
      // 用户特殊要求：明确指定参考图仅作风格参考，禁止出现参考图中的产品
      const refDisclaimer = `Reference Image URL: ${styleUrl}. This image is for style reference only. Mimic its style, lighting, and mood, but do not use the product from the style reference. Strictly keep the generated product consistent with the source product images.`;

      if (config.styleStrength === 'high') {
         finalPrompt = `STRICT PRODUCT CONSISTENCY: ${refDisclaimer} Reference style and composition while strictly keeping the product consistent with the source images.`;
      } else {
         finalPrompt += `\n${refDisclaimer}`;
         if (config.styleStrength === 'low') finalPrompt += `\nReference mood only.`;
         else if (config.styleStrength === 'medium') finalPrompt += `\nStrictly reference layout & lighting.`;
      }
    }

    // 增加生图文案语言固定指令
    finalPrompt += `\n\n生图文案语言：“${config.language || 'English'}”`;

    return await processWithKieAi(
      inputImages, 
      apiConfig, 
      { ...config, aspectRatio: finalRatio as any, targetHeight: 0, maxFileSize: config.maxFileSize || 2.0 }, 
      false, 
      signal, 
      finalPrompt
    );
  };

  const handleStartGeneration = async () => {
    if (isGenerating || isAnalyzing) return;
    const selectedSchemes = schemesRef.current.filter(s => s.selected && s.status !== 'generating' && !inflightIdsRef.current.has(s.id));
    if (selectedSchemes.length === 0) return;

    if (productImages.length === 0) {
        alert("请先在左侧上传产品图片");
        return;
    }

    setIsGenerating(true);
    
    const targetIds = selectedSchemes.map(s => s.id);
    onUpdate(prev => ({
      ...prev,
      schemes: prev.schemes.map(s => targetIds.includes(s.id) ? { ...s, status: 'generating', error: '正在上传素材...' } : s)
    }));

    try {
      // 极速复用：直接从状态中获取已上传的链接，跳过重复上传
      const productUrls = await getOrUploadProductUrls();
      
      selectedSchemes.forEach(s => inflightIdsRef.current.add(s.id));

      await Promise.all(selectedSchemes.map(s => generateSingleScreen(s.id, productUrls, lastStyleUrl)));
    } catch (e: any) { 
      console.error(e); 
      onUpdate(prev => ({
        ...prev,
        schemes: prev.schemes.map(s => targetIds.includes(s.id) ? { ...s, status: 'error', error: '素材上传失败' } : s)
      }));
      alert("批量生成启动失败: " + e.message);
    } finally { 
      setIsGenerating(false); 
    }
  };

  const handleBatchDownload = async () => {
    if (isDownloading) return;
    const completedSchemes = schemes.filter(s => s.status === 'completed' && s.resultUrl);
    if (completedSchemes.length === 0) return;
    setIsDownloading(true);
    try {
      const zipFiles = await Promise.all(completedSchemes.map(async (s, i) => {
        const resp = await fetch(s.resultUrl!);
        const blob = await resp.blob();
        return { blob, path: `detail_screen_${i + 1}.png` };
      }));
      await createZipAndDownload(zipFiles, `mayo_detail_export_${Date.now()}`);
    } catch (err) { 
      alert("批量导出失败"); 
    } finally { 
      setIsDownloading(false); 
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-50">
      <ConfigSidebar 
        subMode={OneClickSubMode.DETAIL_PAGE} 
        config={config} 
        onChange={(cfg) => onUpdate({ config: cfg })} 
        productImages={productImages} 
        setProductImages={(imgs) => onUpdate(prev => ({ 
            ...prev, 
            productImages: typeof imgs === 'function' ? imgs(prev.productImages) : imgs
        }))} 
        styleImage={styleImage} 
        setStyleImage={(img) => onUpdate(prev => ({ 
            ...prev, 
            styleImage: typeof img === 'function' ? img(prev.styleImage) : img
        }))} 
        uploadedProductUrls={uploadedProductUrls}
        uploadedStyleUrl={lastStyleUrl}
        onUploadedProductUrlsChange={(urls) => onUpdate({ uploadedProductUrls: urls })}
        onUploadedStyleUrlChange={(url) => onUpdate({ lastStyleUrl: url })}
        apiConfig={apiConfig}
        onSyncConfig={onSyncConfig}
        onClearConfig={onClearConfig}
        disabled={isAnalyzing || isGenerating || schemes.some(s => s.status === 'generating')} 
        onStart={handleStartAnalysis} 
      />
      
      <main className="flex-1 overflow-hidden relative flex flex-col">
        {schemes.length > 0 ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="bg-white/95 backdrop-blur-sm px-6 py-3 border-b border-slate-200 flex items-center justify-between z-20 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <div onClick={toggleSelectAll} className={`flex items-center gap-2 cursor-pointer group ${isAnalyzing ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center transition-all border-2 ${isAllSelected ? 'bg-rose-600 border-rose-600' : 'bg-white border-slate-300 group-hover:border-rose-400'}`}>
                           {isAllSelected && <i className="fas fa-check text-white text-[10px]"></i>}
                        </div>
                        <span className="text-xs font-bold text-slate-600">全选</span>
                    </div>
                    <div className="h-4 w-px bg-slate-200"></div>
                    <h3 className="text-sm font-black text-slate-800 tracking-tight uppercase">Sequence Editor Console <span className="text-rose-600 ml-1">({selectedCount}/{schemes.length})</span></h3>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
                        {/* 收起/展开按钮 */}
                        <button 
                          onClick={() => setIsCollapsed(!isCollapsed)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all"
                          title={isCollapsed ? "展开项目" : "收起项目"}
                        >
                          <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'} text-xs transition-transform duration-300`}></i>
                        </button>

                        {/* 删除整个项目按钮 */}
                        <button 
                          onClick={deleteProject}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white hover:shadow-sm text-rose-500 transition-all"
                          title="删除整个项目"
                        >
                          <Trash2 size={14} />
                        </button>
                    </div>

                    <div className="h-6 w-px bg-slate-200 mx-1"></div>

                    {completedCount > 0 && (
                      <button onClick={handleBatchDownload} disabled={isDownloading} className="px-4 py-2 bg-emerald-600 text-white font-black text-[10px] rounded-xl hover:bg-emerald-700 shadow-md transition-all uppercase tracking-widest">
                        {isDownloading ? '打包中...' : `导出结果 ZIP (${completedCount})`}
                      </button>
                    )}
                    <button onClick={handleStartGeneration} disabled={selectedCount === 0 || isAnalyzing || isGenerating} className="px-6 py-2 bg-rose-600 text-white font-black text-[10px] rounded-xl hover:bg-rose-700 shadow-lg transition-all uppercase tracking-widest disabled:bg-slate-300">
                      {isGenerating ? '渲染中...' : '启动最终合成作业'}
                    </button>
                </div>
            </div>

            <motion.div 
              initial={false}
              animate={{ 
                height: isCollapsed ? 0 : 'auto',
                opacity: isCollapsed ? 0 : 1,
                scale: isCollapsed ? 0.99 : 1
              }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="flex-1 overflow-hidden flex flex-col"
            >
              <div className="flex-1 overflow-y-auto scrollbar-hide bg-slate-50">
                <div className="max-w-7xl mx-auto flex flex-col">
                    {schemes.map((scheme, idx) => (
                        <div key={scheme.id} className={`flex transition-colors group ${scheme.selected ? 'bg-white' : 'bg-slate-50/30'}`}>
                            {/* 左侧：专业策划案编辑器 */}
                            <div className="w-[45%] p-8 flex flex-col border-r border-slate-100 bg-white">
                                <div className="flex items-center justify-between mb-4 shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div onClick={() => !isGenerating && !isAnalyzing && toggleSelectScheme(scheme.id)} className={`w-5 h-5 rounded flex items-center justify-center cursor-pointer transition-all border-2 ${scheme.selected ? 'bg-rose-600 border-rose-600 text-white shadow-sm' : 'bg-white border-slate-300 hover:border-rose-400'}`}>
                                            {scheme.selected && <i className="fas fa-check text-[10px]"></i>}
                                        </div>
                                        <div className="flex flex-col">
                                            {/* 此处固定展示 uiTitle 和 提取的比例，文本框中不再出现该字段 */}
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-black text-slate-800 text-sm tracking-tight">{scheme.uiTitle}</h4>
                                                {(scheme.extractedRatio || scheme.editedContent.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/)?.[1]) && (
                                                   <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-bold rounded border border-slate-200">
                                                      {scheme.extractedRatio || scheme.editedContent.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/)?.[1]}
                                                   </span>
                                                )}
                                            </div>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] italic">Typography Logic Editor</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-4">
                                        <button 
                                          disabled={scheme.status === 'generating'} 
                                          onClick={() => deleteScreen(scheme.id)} 
                                          className="text-[10px] font-black text-slate-400 hover:text-red-600 uppercase transition-colors"
                                        >
                                          删除
                                        </button>
                                        <button 
                                          disabled={scheme.status === 'generating'} 
                                          onClick={() => {
                                            if (scheme.taskId) {
                                              // 如果已有任务 ID，点击还原方案执行“恢复结果”逻辑
                                              handleRecoverScreen(scheme.id);
                                            } else {
                                              // 如果没有任务 ID，执行原始的“还原文本”逻辑
                                              const lines = scheme.originalContent.split('\n');
                                              const cleanedLines = lines.filter(line => {
                                                const l = line.trim();
                                                if (/^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏)/.test(l)) return false;
                                                if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false;
                                                return true;
                                              });
                                              onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === scheme.id ? { ...s, editedContent: cleanedLines.join('\n').trim() } : s) }));
                                            }
                                          }} 
                                          className="text-[10px] font-black text-slate-400 hover:text-rose-600 uppercase transition-colors"
                                          title={scheme.taskId ? "根据任务 ID 重新获取云端结果" : "重置文案为初始状态"}
                                        >
                                          还原方案
                                        </button>
                                        <button disabled={scheme.status === 'generating'} onClick={() => handleRedoScreen(scheme.id)} className="text-[10px] font-black text-rose-600 hover:text-rose-700 uppercase transition-colors">
                                            {scheme.resultUrl ? '重新生成' : '生成该图'}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 min-h-[400px] relative">
                                    <textarea 
                                        value={scheme.editedContent} 
                                        onChange={(e) => onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === scheme.id ? { ...s, editedContent: e.target.value } : s) }))} 
                                        disabled={scheme.status === 'generating'}
                                        className="absolute inset-0 w-full h-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-[11px] font-medium text-slate-600 resize-none outline-none focus:ring-1 focus:ring-rose-500 shadow-inner transition-all scrollbar-hide leading-relaxed"
                                        placeholder="AI 策划加载中..."
                                    />
                                </div>
                                <div className="mt-4 flex items-center justify-between opacity-60">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                        <i className="fas fa-expand-arrows-alt mr-1"></i>
                                        渲染参数: {scheme.editedContent.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/)?.[1] || scheme.extractedRatio || '3:4'}
                                    </span>
                                    {scheme.status === 'completed' && <span className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter"><i className="fas fa-check-circle mr-1"></i> 对齐渲染就绪</span>}
                                </div>
                            </div>

                            {/* 右侧：视觉渲染预览区 */}
                            <div className="flex-1 bg-slate-900 flex items-center justify-center relative overflow-hidden min-h-[500px]">
                                {scheme.status === 'generating' ? (
                                    <div className="flex flex-col items-center justify-center text-center p-12">
                                        <div className="w-12 h-12 border-2 border-white/10 border-t-rose-500 rounded-full animate-spin mb-4"></div>
                                        <p className="text-[10px] font-black uppercase text-rose-500 tracking-[0.2em] animate-pulse">正在执行流水线作业 #{idx+1}...</p>
                                        <p className="text-[9px] font-bold text-slate-500 mt-3 uppercase tracking-wider animate-pulse opacity-60">复杂图像处理，等待时间略长</p>
                                        {scheme.error && <p className="text-[9px] text-slate-500 mt-2 font-medium">{scheme.error}</p>}
                                        <button 
                                          onClick={() => handleInterruptScreen(scheme.id)} 
                                          className="mt-6 px-5 py-2 bg-white/10 text-white/60 text-[9px] font-black rounded-xl hover:bg-white/20 hover:text-white transition-all uppercase tracking-widest border border-white/5"
                                        >
                                          中断并稍后同步
                                        </button>
                                    </div>
                                ) : scheme.status === 'error' || scheme.status === 'interrupted' ? (
                                    <div className="flex flex-col items-center justify-center text-center p-12 bg-rose-950/20 w-full h-full border border-rose-500/20 animate-in fade-in duration-300">
                                        <div className="w-14 h-14 bg-rose-500/10 rounded-full flex items-center justify-center mb-4">
                                            <i className={`fas ${scheme.status === 'error' ? 'fa-exclamation-triangle' : 'fa-stop-circle'} text-rose-500 text-2xl`}></i>
                                        </div>
                                        <h4 className="text-rose-500 font-black text-sm uppercase tracking-widest mb-2">
                                            {scheme.status === 'error' ? '渲染任务失败' : '渲染已中断'}
                                        </h4>
                                        <p className="text-[10px] text-slate-400 font-medium max-w-[280px] mb-6 leading-relaxed">
                                            {scheme.error || '可能是由于网络抖动或 API 配额不足，请重试。'}
                                        </p>
                                        
                                        {scheme.error && scheme.error.includes('超时') ? (
                                          <div className="flex gap-3">
                                            <button 
                                                onClick={() => handleRecoverScreen(scheme.id)} 
                                                className="px-5 py-2.5 bg-indigo-600 text-white font-black text-[10px] rounded-xl hover:bg-indigo-700 shadow-lg uppercase tracking-widest transition-all active:scale-95"
                                            >
                                                稍后获取结果
                                            </button>
                                            <button 
                                                onClick={() => handleRedoScreen(scheme.id)} 
                                                className="px-5 py-2.5 bg-rose-600 text-white font-black text-[10px] rounded-xl hover:bg-rose-700 shadow-lg uppercase tracking-widest transition-all active:scale-95"
                                            >
                                                重新尝试生成
                                            </button>
                                          </div>
                                        ) : (
                                          <button 
                                              onClick={() => handleRedoScreen(scheme.id)} 
                                              className="px-8 py-2.5 bg-rose-600 text-white font-black text-[10px] rounded-xl hover:bg-rose-700 shadow-lg uppercase tracking-widest transition-all active:scale-95"
                                          >
                                              重新尝试生成
                                          </button>
                                        )}
                                    </div>
                                ) : scheme.resultUrl ? (
                                    <div className="relative w-full h-full group/img flex items-center justify-center animate-in fade-in duration-500">
                                        {imageErrors[scheme.id] && scheme.resultUrl.startsWith('blob:') ? (
                                          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900/50 text-slate-400 p-12 text-center">
                                            <i className="far fa-file-image text-4xl mb-4 opacity-20"></i>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">预览已失效</p>
                                            <p className="text-[9px] mt-2 opacity-40">请点击下方按钮重新生成或找回</p>
                                          </div>
                                        ) : (
                                          <img 
                                            src={scheme.resultUrl} 
                                            className="w-full block shadow-xl border border-white/10 brightness-[1.02] contrast-[1.02]" 
                                            alt={`Detail Screen ${idx+1}`} 
                                            key={scheme.resultUrl}
                                            onError={() => {
                                              if (scheme.resultUrl?.startsWith('blob:')) {
                                                setImageErrors(prev => ({ ...prev, [scheme.id]: true }));
                                              }
                                            }}
                                          />
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-6">
                                            <button onClick={() => setPreviewId(scheme.id)} className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-slate-900 hover:scale-110 transition-transform shadow-xl"><i className="fas fa-expand"></i></button>
                                            <button onClick={() => { const a = document.createElement('a'); a.href = scheme.resultUrl!; a.download = `detail_${idx+1}.png`; a.click(); }} className="w-12 h-12 bg-rose-600 rounded-full flex items-center justify-center text-white hover:scale-110 transition-transform shadow-xl"><i className="fas fa-download"></i></button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center opacity-20 text-center p-12">
                                        <i className="fas fa-wand-magic-sparkles text-white text-5xl mb-4"></i>
                                        <p className="text-[10px] font-black uppercase text-white tracking-[0.4em]">Standby for Visual Logic</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    
                    {/* 底部装饰长卷感 */}
                    <div className="bg-slate-900 py-20 text-center flex flex-col items-center">
                        <div className="flex items-center justify-center gap-6 mb-4">
                            <div className="h-px w-20 bg-slate-800"></div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.5em] italic">Continuous Narrative Flow End</span>
                            <div className="h-px w-20 bg-slate-800"></div>
                        </div>
                        <p className="text-[9px] text-slate-600 font-bold tracking-widest uppercase">Designed by Mayo AI Lab · High-Conversion Logic Sequence</p>
                    </div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-20 bg-white">
            <div className="w-32 h-32 bg-slate-50 rounded-[48px] shadow-2xl flex items-center justify-center mb-10 border border-slate-100 relative group overflow-hidden">
                <div className="absolute inset-0 bg-rose-500/5 blur-3xl rounded-full scale-150 -z-10 group-hover:bg-rose-500/15 transition-all"></div>
                <i className="fas fa-layer-group text-5xl text-rose-500 relative z-10"></i>
            </div>
            <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tight uppercase tracking-tighter">AI 详情长卷全案策划器</h2>
            <p className="text-slate-500 max-w-sm font-bold text-sm leading-relaxed px-6 italic">“上传您的产品图，豆包 AI 将为您生成逻辑严密的详情叙事方案。系统已强制实行物理参数级比例控制，每一屏都严格对齐。”</p>
          </div>
        )}

        {isAnalyzing && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-[110] flex items-center justify-center">
            <div className="bg-white p-12 rounded-[48px] shadow-2xl flex flex-col items-center text-center animate-in zoom-in duration-300">
              <div className="w-24 h-24 bg-rose-50 rounded-full flex items-center justify-center mb-8 animate-pulse border-2 border-rose-100"><i className="fas fa-brain text-5xl text-rose-600"></i></div>
              <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">全案叙事规划中...</h3>
              <p className="text-slate-400 text-[11px] font-bold uppercase tracking-[0.2em] leading-relaxed">Doubao AI is crafting your brand sequence</p>
            </div>
          </div>
        )}

        {previewId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/98 backdrop-blur-xl p-8 animate-in fade-in duration-300" onClick={() => setPreviewId(null)}>
            <div className="relative max-w-6xl max-h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setPreviewId(null)} className="absolute -top-16 right-0 text-white/40 text-4xl hover:text-rose-500 transition-colors"><i className="fas fa-times"></i></button>
              <img 
                src={schemes.find(s => s.id === previewId)?.resultUrl} 
                className="max-h-[85vh] rounded-2xl shadow-2xl border-2 border-white/5 object-contain animate-in zoom-in duration-300" 
                alt="Sequence Preview"
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default DetailPageSubModule;
