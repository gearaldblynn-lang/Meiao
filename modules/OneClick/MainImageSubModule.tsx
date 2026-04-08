
import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { GlobalApiConfig, AspectRatio, OneClickConfig, MainImageScheme, OneClickSubMode, OneClickPersistentState, KieAiResult } from '../../types';
import ConfigSidebar from './ConfigSidebar';
import { safeCreateObjectURL } from '../../utils/urlUtils';
import { normalizeFetchedImageBlob } from '../../utils/imageBlobUtils.mjs';
import { analyzeOneClickReferenceSet, generateMarketingSchemes } from '../../services/arkService';
import { uploadToCos } from '../../services/tencentCosService';
import { processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { resizeImage, createZipAndDownload, downloadRemoteFile, getImageDimensions } from '../../utils/imageUtils';
import { useToast } from '../../components/ToastSystem';
import { logActionFailure, logActionInterrupted, logActionStart, logActionSuccess } from '../../services/loggingService';
import { persistGeneratedAsset } from '../../services/persistedAssetClient';

interface Props {
  apiConfig: GlobalApiConfig;
  state: OneClickPersistentState['mainImage'];
  onUpdate: (updates: Partial<OneClickPersistentState['mainImage']> | ((prev: OneClickPersistentState['mainImage']) => OneClickPersistentState['mainImage'])) => void;
  onProcessingChange: (processing: boolean) => void;
  onSyncConfig?: () => void;
  onClearConfig?: () => void;
  currentSubMode?: OneClickSubMode;
  onSubModeChange?: (mode: OneClickSubMode) => void;
}

const MainImageSubModule: React.FC<Props> = ({
  apiConfig,
  state,
  onUpdate,
  onProcessingChange,
  onSyncConfig,
  onClearConfig,
  currentSubMode,
  onSubModeChange,
}) => {
  const { productImages, logoImage, uploadedLogoUrl, styleImage, designReferences, uploadedDesignReferenceUrls, referenceDimensions, referenceAnalysis, schemes, config, lastStyleUrl, uploadedProductUrls } = state;
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingReference, setIsAnalyzingReference] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const isSubmittingAnalysisRef = useRef(false);
  const isSubmittingGenerationRef = useRef(false);
  const taskControllersRef = useRef<Record<string, AbortController>>({});
  const globalAbortRef = useRef<AbortController | null>(null);
  const { addToast } = useToast();

  const selectedCount = schemes.filter(s => s.selected).length;
  const completedCount = schemes.filter(s => s.status === 'completed' && s.resultUrl).length;
  const isAllSelected = schemes.length > 0 && selectedCount === schemes.length;
  const baseMeta = {
    subMode: 'main_image',
    model: config.model,
    quality: config.quality,
    aspectRatio: config.aspectRatio,
  };

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
          handleRecoverSingle(s.id);
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
    void logActionSuccess({
      module: 'one_click',
      action: isAllSelected ? 'deselect_all_main' : 'select_all_main',
      message: isAllSelected ? '取消全选主图方案' : '全选主图方案',
      meta: {
        ...baseMeta,
        count: schemes.length,
      },
    });
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => ({ ...s, selected: !isAllSelected })) })); 
  };
  
  const toggleSelectScheme = (id: string) => { 
    if (isAnalyzing) return;
    const scheme = schemesRef.current.find((item) => item.id === id);
    void logActionSuccess({
      module: 'one_click',
      action: scheme?.selected ? 'deselect_single_main' : 'select_single_main',
      message: scheme?.selected ? '取消选择主图方案' : '选择主图方案',
      meta: {
        ...baseMeta,
        schemeId: id,
        title: scheme?.uiTitle,
      },
    });
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

  const getOrUploadLogoUrl = async () => {
    if (!logoImage && uploadedLogoUrl) return uploadedLogoUrl;
    if (!logoImage) return null;
    if (uploadedLogoUrl) return uploadedLogoUrl;
    const url = await uploadToCos(logoImage, apiConfig);
    onUpdate({ uploadedLogoUrl: url });
    return url;
  };

  const getOrUploadReferenceUrls = async () => {
    if (designReferences.length === 0 && uploadedDesignReferenceUrls.length > 0) {
      return uploadedDesignReferenceUrls;
    }
    if (uploadedDesignReferenceUrls.length === designReferences.length && designReferences.length > 0 && uploadedDesignReferenceUrls.every(Boolean)) {
      return uploadedDesignReferenceUrls;
    }
    const nextItems = [...designReferences];
    const urls = await Promise.all(nextItems.map(async (item, index) => {
      if (item.uploadedUrl) return item.uploadedUrl;
      if (!item.file) return uploadedDesignReferenceUrls[index] || '';
      const url = await uploadToCos(item.file, apiConfig);
      nextItems[index] = { ...nextItems[index], uploadedUrl: url };
      return url;
    }));
    const normalizedUrls = urls.filter(Boolean);
    onUpdate({
      designReferences: nextItems,
      uploadedDesignReferenceUrls: normalizedUrls,
      lastStyleUrl: normalizedUrls[0] || null,
    });
    return normalizedUrls;
  };

  const handleAnalyzeReference = async () => {
    if (isAnalyzingReference || designReferences.length === 0 || referenceDimensions.length === 0) return;
    setIsAnalyzingReference(true);
    try {
      const referenceUrls = await getOrUploadReferenceUrls();
      const logoUrl = await getOrUploadLogoUrl();
      const result = await analyzeOneClickReferenceSet(referenceUrls, referenceDimensions, OneClickSubMode.MAIN_IMAGE, apiConfig, undefined, logoUrl);
      if (result.status === 'success') {
        onUpdate({
          uploadedDesignReferenceUrls: referenceUrls,
          referenceAnalysis: {
            status: 'success',
            summary: result.description,
            analyzedAt: Date.now(),
          },
        });
        addToast('设计参考分析完成', 'success');
      } else {
        onUpdate({
          referenceAnalysis: {
            status: 'error',
            summary: '',
            error: result.message || '设计参考分析失败',
            analyzedAt: null,
          },
        });
        addToast(`设计参考分析失败: ${result.message}`, 'error');
      }
    } catch (error: any) {
      onUpdate({
        referenceAnalysis: {
          status: 'error',
          summary: '',
          error: error.message,
          analyzedAt: null,
        },
      });
      addToast(`设计参考分析失败: ${error.message}`, 'error');
    } finally {
      setIsAnalyzingReference(false);
    }
  };

  const handleStartAnalysis = async () => {
    const hasGeneratingTask = schemesRef.current.some(s => s.status === 'generating');
    // 允许在只有上传 URL 的情况下启动分析（支持刷新后直接点击）
    if (isSubmittingAnalysisRef.current || isAnalyzing || isGenerating || hasGeneratingTask || (productImages.length === 0 && uploadedProductUrls.length === 0)) return;
    
    isSubmittingAnalysisRef.current = true;
    setIsAnalyzing(true);
    void logActionStart({
      module: 'one_click',
      action: 'plan_main_start',
      message: '开始主图策划',
      meta: {
        ...baseMeta,
        productImageCount: productImages.length || uploadedProductUrls.length,
        hasStyleImage: Boolean(designReferences.length || styleImage || lastStyleUrl),
      },
    });
    addToast("正在进行全案视觉策划...", 'info');
    
    try {
      onUpdate({ schemes: [] }); 
      globalAbortRef.current = new AbortController();
      
      const productUrls = await getOrUploadProductUrls();
      
      let referenceSummary = referenceAnalysis.summary;
      if (!referenceSummary && designReferences.length > 0 && referenceDimensions.length > 0) {
        const referenceUrls = await getOrUploadReferenceUrls();
        const logoUrl = await getOrUploadLogoUrl();
        const referenceResult = await analyzeOneClickReferenceSet(referenceUrls, referenceDimensions, OneClickSubMode.MAIN_IMAGE, apiConfig, globalAbortRef.current.signal, logoUrl);
        if (referenceResult.status === 'success') {
          referenceSummary = referenceResult.description;
          onUpdate({
            uploadedDesignReferenceUrls: referenceUrls,
            referenceAnalysis: {
              status: 'success',
              summary: referenceResult.description,
              analyzedAt: Date.now(),
            },
          });
        } else {
          throw new Error(referenceResult.message || '设计参考分析失败');
        }
      }

      if (globalAbortRef.current.signal.aborted) throw new Error("ABORTED");

      const logoUrl = await getOrUploadLogoUrl();
      const res = await generateMarketingSchemes(productUrls, null, config, apiConfig, OneClickSubMode.MAIN_IMAGE, null, globalAbortRef.current.signal, referenceSummary, logoUrl);
      
      if (res.status === 'success') {
        const initialSchemes: MainImageScheme[] = res.schemes.map((text, idx) => {
          // 仅用于UI显示，不用于实际生成逻辑（生成强制使用 config.aspectRatio）
          const ratioMatch = text.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/);
          const ratio = ratioMatch ? ratioMatch[1] : (config.aspectRatio || '1:1');
          
          let uiTitle = `主图 ${idx + 1} ：核心视觉`;
          const lines = text.split('\n');
          
          const titleLine = lines.find(l => /^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏|主图\d+)/.test(l.trim()));
          if (titleLine) {
             const cleanLine = titleLine.trim().replace(/^(?:[-#*>\s]*)(?:屏序\/类型[：:]?)?/, '').trim();
             uiTitle = cleanLine.replace(/^(?:主图\d+|第\d+屏)\s*[-:]?\s*/, '').trim();
             uiTitle = `主图 ${['一','二','三','四','五','六','七','八'][idx] || (idx+1)}：${uiTitle}`;
          }

          const cleanedLines = lines.filter(line => {
             const l = line.trim();
             if (/^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏|主图\d+)/.test(l)) return false;
             if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false;
             return true;
          });

          return { 
            id: Math.random().toString(36).substr(2, 9), 
            uiTitle: uiTitle,
            originalContent: text, 
            editedContent: cleanedLines.join('\n').trim(), 
            extractedRatio: ratio,
            status: 'pending', 
            selected: true 
          };
        });
        onUpdate({ schemes: initialSchemes });
        void logActionSuccess({
          module: 'one_click',
          action: 'plan_main_start',
          message: '主图策划成功',
          meta: {
            ...baseMeta,
            count: initialSchemes.length,
          },
        });
        addToast("策划方案已生成，请检查并启动渲染。", 'success');
      } else { 
        void logActionFailure({
          module: 'one_click',
          action: 'plan_main_start',
          message: '主图策划失败',
          detail: res.message,
          meta: baseMeta,
        });
        addToast("视觉策划失败: " + res.message, 'error'); 
      }
    } catch (e: any) { 
      if (e.name === 'AbortError' || e.message === 'ABORTED') {
        void logActionInterrupted({
          module: 'one_click',
          action: 'plan_main_start',
          message: '主图策划已中断',
          detail: e.message,
          meta: baseMeta,
        });
      } else {
        void logActionFailure({
          module: 'one_click',
          action: 'plan_main_start',
          message: '主图策划失败',
          detail: e.message,
          meta: baseMeta,
        });
      }
      if (e.name === 'AbortError' || e.message === 'ABORTED') {
        addToast("策划分析超时或已取消，请检查网络或重试。", 'error');
      } else {
        addToast("系统分析异常: " + e.message, 'error'); 
      }
    } finally { 
      setIsAnalyzing(false); 
      isSubmittingAnalysisRef.current = false;
    }
  };

  const [isCollapsed, setIsCollapsed] = useState(false);

  const updateSingleScheme = (id: string, updates: Partial<MainImageScheme>) => {
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
    Object.values(taskControllersRef.current).forEach((controller: AbortController) => controller.abort());
    taskControllersRef.current = {};
    
    onUpdate(prev => ({
      ...prev,
      schemes: [],
      uploadedProductUrls: []
    }));
    void logActionSuccess({
      module: 'one_click',
      action: 'clear_main_project',
      message: '清空主图项目',
      meta: {
        ...baseMeta,
        count: schemesRef.current.length,
      },
    });
    inflightIdsRef.current.clear();
    setIsCollapsed(false);
    addToast('项目已清空', 'success');
  };

  const deleteScheme = (id: string) => {
    // 如果正在生成，先中断
    if (taskControllersRef.current[id]) {
      taskControllersRef.current[id].abort();
      delete taskControllersRef.current[id];
    }
    onUpdate(prev => ({
      ...prev,
      schemes: prev.schemes.filter(s => s.id !== id)
    }));
    void logActionSuccess({
      module: 'one_click',
      action: 'delete_main_scheme',
      message: '删除主图方案',
      meta: {
        ...baseMeta,
        schemeId: id,
      },
    });
    inflightIdsRef.current.delete(id);
    addToast('方案已删除', 'success');
  };

  const generateSingleImage = async (schemeId: string, productUrls: string[], referenceSummary: string | null, mode: 'full' | 'recover' = 'full') => {
    if (taskControllersRef.current[schemeId]) { taskControllersRef.current[schemeId].abort(); }
    const controller = new AbortController();
    taskControllersRef.current[schemeId] = controller;
    
    // 生成中状态再次确认（清除上传提示）
    updateSingleScheme(
      schemeId,
      mode === 'recover'
        ? { status: 'generating', error: undefined }
        : { status: 'generating', error: undefined, taskId: undefined, resultUrl: undefined }
    );
    
    try {
      let res: KieAiResult;
      const targetScheme = schemesRef.current.find(s => s.id === schemeId);
      if (!targetScheme) return;
      void logActionStart({
        module: 'one_click',
        action: mode === 'recover' ? 'recover_main_scheme' : 'generate_main_scheme',
        message: mode === 'recover' ? '开始找回主图结果' : '开始生成主图方案',
        meta: {
          ...baseMeta,
          schemeId,
          title: targetScheme.uiTitle,
          taskId: targetScheme.taskId,
        },
      });

      if (mode === 'recover' && targetScheme.taskId) {
        updateSingleScheme(schemeId, { error: '正在重连云端任务...' });
        res = await recoverKieAiTask(targetScheme.taskId, apiConfig, controller.signal);
      } else { 
        res = await triggerNewKieTask(targetScheme, productUrls, referenceSummary, controller.signal); 
      }

      // 关键修正：只要拿到 taskId，立即存入持久化状态，防止刷新丢失
      if (res.taskId) {
        updateSingleScheme(schemeId, { taskId: res.taskId });
      }

      if (controller.signal.aborted || res.status === 'interrupted') {
        throw new Error("INTERRUPTED");
      }

      if (res.status === 'success') {
        const imgResp = await fetch(res.imageUrl, { signal: controller.signal });
        const blob = await normalizeFetchedImageBlob(await imgResp.blob(), res.imageUrl);
        const dims = await getImageDimensions(blob);

        let targetW = dims.width;
        let targetH = dims.height;

        if (config.resolutionMode === 'custom' && config.targetWidth && config.targetHeight) {
          targetW = config.targetWidth;
          targetH = config.targetHeight;
        }

        const finalBlob = await resizeImage(blob, targetW, targetH, config.maxFileSize);
        const resultUrl = await persistGeneratedAsset(finalBlob, 'one_click', `${targetScheme.uiTitle || schemeId}.png`);
        
        updateSingleScheme(schemeId, { status: 'completed', resultUrl, taskId: res.taskId });
        void logActionSuccess({
          module: 'one_click',
          action: mode === 'recover' ? 'recover_main_scheme' : 'generate_main_scheme',
          message: mode === 'recover' ? '找回主图结果成功' : '主图方案生成成功',
          meta: {
            ...baseMeta,
            schemeId,
            title: targetScheme.uiTitle,
            taskId: res.taskId,
          },
        });
      } else if (res.status === 'task_not_found') {
        throw new Error("任务已过期或不存在，请重新生成");
      } else { 
        throw new Error(res.message || '渲染失败'); 
      }
    } catch (err: any) {
      const isManual = err.name === 'AbortError' || err.message === 'INTERRUPTED';
      updateSingleScheme(schemeId, { 
        status: isManual ? 'interrupted' : 'error', 
        error: isManual ? '已手动中断' : err.message 
      });
      const targetScheme = schemesRef.current.find(s => s.id === schemeId);
      if (isManual) {
        void logActionInterrupted({
          module: 'one_click',
          action: mode === 'recover' ? 'recover_main_scheme' : 'generate_main_scheme',
          message: mode === 'recover' ? '找回主图结果已中断' : '主图方案生成已中断',
          detail: err.message,
          meta: {
            ...baseMeta,
            schemeId,
            title: targetScheme?.uiTitle,
            taskId: targetScheme?.taskId,
          },
        });
      } else {
        void logActionFailure({
          module: 'one_click',
          action: mode === 'recover' ? 'recover_main_scheme' : 'generate_main_scheme',
          message: mode === 'recover' ? '找回主图结果失败' : '主图方案生成失败',
          detail: err.message,
          meta: {
            ...baseMeta,
            schemeId,
            title: targetScheme?.uiTitle,
            taskId: targetScheme?.taskId,
          },
        });
      }
    } finally { 
      delete taskControllersRef.current[schemeId]; 
      inflightIdsRef.current.delete(schemeId);
    }
  };

  const triggerNewKieTask = async (scheme: MainImageScheme, productUrls: string[], referenceSummary: string | null, signal: AbortSignal) => {
    // 【核心变更】：一键主图模式下，强制使用全局配置的比例，忽略文本中的比例提取。
    // 确保生图比例绝对服从用户设定，而非 AI 幻觉。
    const strictRatio = config.aspectRatio || AspectRatio.SQUARE;
    
    const cleanPrompt = scheme.editedContent
      .split('\n')
      .filter(line => !line.trim().match(/^(?:[-#*>\s]*)画面比例/))
      .filter(line => !line.trim().match(/^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏|主图\d+)/))
      .join('\n')
      .trim();

    let finalPrompt = `STRICT PRODUCT CONSISTENCY: Strictly keep the product fully consistent with the source product reference images. Strictly do not change the product's appearance details, size, structure, label information, packaging information, or any visible product elements. SCENARIO & STYLE: ${cleanPrompt}. QUALITY: High-end commercial studio photography.`;
    
    // 仅使用产品图作为 image_input，不包含风格参考图
    const logoUrl = await getOrUploadLogoUrl();
    const inputImages = logoUrl ? [...productUrls, logoUrl] : [...productUrls];
    
    if (referenceSummary) {
      finalPrompt += `\n【设计参考分析结论】\n${referenceSummary}`;
      if (config.styleStrength === 'low') finalPrompt += `\n只弱参考上述结论中的氛围与色调。`;
      else if (config.styleStrength === 'medium') finalPrompt += `\n严格参考上述结论中的版式、光影与色调。`;
      else finalPrompt += `\n高强度执行上述参考结论，但主体商品仍必须完全保持产品素材一致。`;
    }
    finalPrompt += `\n若产品素材中出现竞品logo或他牌标识，最终生成图必须去除这些非我方品牌标识，禁止直接沿用。`;
    if (logoUrl) {
      finalPrompt += `\n品牌logo图：${logoUrl}。该图仅用于识别和还原我方品牌logo，不得把产品素材图或设计参考图中的其他品牌logo带入最终画面。若产品素材中出现竞品logo或他牌标识，最终生成图必须去除或替换为品牌logo图对应的我方logo。`;
      finalPrompt += `\n注意：${logoUrl} 是品牌logo图。`;
    }

    // 增加生图文案语言固定指令
    finalPrompt += `\n\n生图文案语言：“${config.language || 'English'}”`;
    finalPrompt += `\n文案文字必须为“${config.language || 'English'}”`;

    return await processWithKieAi(
      inputImages, 
      apiConfig, 
      { ...config, aspectRatio: strictRatio as any, maxFileSize: config.maxFileSize || 2.0 }, 
      false, 
      signal, 
      finalPrompt
    );
  };

  const handleStartGeneration = async () => {
    if (isSubmittingGenerationRef.current || isGenerating || isAnalyzing) return;
    const selectedSchemes = schemesRef.current.filter(s => s.selected && s.status !== 'generating' && !inflightIdsRef.current.has(s.id));
    if (selectedSchemes.length === 0) return;
    
    if (productImages.length === 0 && uploadedProductUrls.length === 0) {
        addToast("请先在左侧上传产品图片", 'warning');
        return;
    }

    isSubmittingGenerationRef.current = true;
    setIsGenerating(true);
    void logActionStart({
      module: 'one_click',
      action: 'generate_main_batch',
      message: '开始批量生成主图',
      meta: {
        ...baseMeta,
        count: selectedSchemes.length,
      },
    });
    addToast("开始批量生成任务...", 'info');
    
    const targetIds = selectedSchemes.map(s => s.id);
    onUpdate(prev => ({
      ...prev,
      schemes: prev.schemes.map(s => targetIds.includes(s.id) ? { ...s, status: 'generating', error: '正在准备素材...' } : s)
    }));

    try {
      // 极速复用：直接从状态中获取已上传的链接，跳过重复上传
      const productUrls = await getOrUploadProductUrls();
      
      selectedSchemes.forEach(s => inflightIdsRef.current.add(s.id));
      
      await Promise.all(selectedSchemes.map(s => generateSingleImage(s.id, productUrls, referenceAnalysis.summary || null)));
      void logActionSuccess({
        module: 'one_click',
        action: 'generate_main_batch',
        message: '批量生成主图完成',
        meta: {
          ...baseMeta,
          count: selectedSchemes.length,
        },
      });
      addToast("批量生成完成", 'success');
    } catch (e: any) { 
      void logActionFailure({
        module: 'one_click',
        action: 'generate_main_batch',
        message: '批量生成主图失败',
        detail: e.message,
        meta: {
          ...baseMeta,
          count: selectedSchemes.length,
        },
      });
      console.error("Batch error:", e);
      onUpdate(prev => ({
        ...prev,
        schemes: prev.schemes.map(s => targetIds.includes(s.id) ? { ...s, status: 'error', error: '素材准备失败' } : s)
      }));
      addToast("批量生成启动失败: " + e.message, 'error');
    } finally { 
      isSubmittingGenerationRef.current = false;
      setIsGenerating(false); 
    }
  };

  const handleRecoverSingle = async (schemeId: string) => {
    if (inflightIdsRef.current.has(schemeId)) return;
    void logActionStart({
      module: 'one_click',
      action: 'recover_main_click',
      message: '点击找回主图结果',
      meta: {
        ...baseMeta,
        schemeId,
      },
    });
    
    updateSingleScheme(schemeId, { status: 'generating', error: '正在同步云端结果...' });
    
    inflightIdsRef.current.add(schemeId);
    try {
      const productUrls = await getOrUploadProductUrls();
      await generateSingleImage(schemeId, productUrls, referenceAnalysis.summary || null, 'recover');
    } catch (e: any) {
      inflightIdsRef.current.delete(schemeId);
      updateSingleScheme(schemeId, { status: 'error', error: '同步失败: ' + e.message });
      addToast("恢复任务失败: " + e.message, 'error');
    }
  };

  const handleBatchDownload = async () => {
    if (isDownloading) return;
    const completedSchemes = schemes.filter(s => s.status === 'completed' && s.resultUrl);
    if (completedSchemes.length === 0) return;
    setIsDownloading(true);
    void logActionStart({
      module: 'one_click',
      action: 'download_main_batch',
      message: '开始批量导出主图',
      meta: {
        ...baseMeta,
        count: completedSchemes.length,
      },
    });
    addToast("开始打包下载...", 'info');
    try {
      const zipFiles = await Promise.all(completedSchemes.map(async (s, i) => {
        const resp = await fetch(s.resultUrl!);
        const blob = await resp.blob();
        return { blob, path: `main_image_${i + 1}.png` };
      }));
      await createZipAndDownload(zipFiles, `mayo_main_batch_${Date.now()}`);
      void logActionSuccess({
        module: 'one_click',
        action: 'download_main_batch',
        message: '批量导出主图成功',
        meta: {
          ...baseMeta,
          count: completedSchemes.length,
        },
      });
      addToast("下载完成", 'success');
    } catch (err) { 
      void logActionFailure({
        module: 'one_click',
        action: 'download_main_batch',
        message: '批量导出主图失败',
        detail: err instanceof Error ? err.message : '导出失败',
        meta: {
          ...baseMeta,
          count: completedSchemes.length,
        },
      });
      addToast("下载失败", 'error'); 
    } finally { 
      setIsDownloading(false); 
    }
  };

  const handleRedoSingle = async (schemeId: string) => {
    if (inflightIdsRef.current.has(schemeId) || isAnalyzing) return;
    void logActionStart({
      module: 'one_click',
      action: 'redo_main_scheme',
      message: '重新生成主图方案',
      meta: {
        ...baseMeta,
        schemeId,
      },
    });
    
    updateSingleScheme(schemeId, { status: 'generating', error: '正在准备素材...', taskId: undefined, resultUrl: undefined });
    
    inflightIdsRef.current.add(schemeId);
    try {
      const productUrls = await getOrUploadProductUrls();
      await generateSingleImage(schemeId, productUrls, referenceAnalysis.summary || null);
    } catch (e: any) {
      inflightIdsRef.current.delete(schemeId);
      updateSingleScheme(schemeId, { status: 'error', error: '启动失败' });
      addToast("启动任务失败: " + e.message, 'error');
    }
  };

  const handleInterruptSingle = (id: string) => {
    if (taskControllersRef.current[id]) {
      taskControllersRef.current[id].abort();
      delete taskControllersRef.current[id];
    }
    inflightIdsRef.current.delete(id);
    updateSingleScheme(id, { 
      status: 'error', 
      error: '已手动中断，可点击同步获取结果' 
    });
    void logActionInterrupted({
      module: 'one_click',
      action: 'interrupt_main_scheme',
      message: '手动中断主图方案生成',
      meta: {
        ...baseMeta,
        schemeId: id,
      },
    });
    addToast("已中断生成任务", 'info');
  };

  const completedResults = schemes.filter(s => s.status === 'completed' && s.resultUrl);
  const currentPreviewIndex = completedResults.findIndex(s => s.id === previewId);
  const nextPreview = () => { if (currentPreviewIndex < completedResults.length - 1) setPreviewId(completedResults[currentPreviewIndex + 1].id); };
  const prevPreview = () => { if (currentPreviewIndex > 0) setPreviewId(completedResults[currentPreviewIndex - 1].id); };

  return (
    <div className="h-full w-full flex overflow-hidden bg-slate-50">
      <ConfigSidebar 
        subMode={OneClickSubMode.MAIN_IMAGE}
        currentSubMode={currentSubMode}
        onSubModeChange={onSubModeChange}
        config={config} 
        onChange={(cfg) => onUpdate({ config: cfg })} 
        productImages={productImages} 
        setProductImages={(imgs) => onUpdate(prev => ({ 
            ...prev, 
            productImages: typeof imgs === 'function' ? imgs(prev.productImages) : imgs
        }))} 
        logoImage={logoImage}
        setLogoImage={(img) => onUpdate({ logoImage: img })}
        styleImage={styleImage} 
        setStyleImage={(img) => onUpdate(prev => ({ 
            ...prev, 
            styleImage: typeof img === 'function' ? img(prev.styleImage) : img
        }))} 
        designReferences={designReferences}
        onDesignReferencesChange={(items) => onUpdate({ designReferences: items })}
        uploadedDesignReferenceUrls={uploadedDesignReferenceUrls}
        onUploadedDesignReferenceUrlsChange={(urls) => onUpdate({ uploadedDesignReferenceUrls: urls, lastStyleUrl: urls[0] || null })}
        referenceDimensions={referenceDimensions}
        onReferenceDimensionsChange={(dimensions) => onUpdate({ referenceDimensions: dimensions })}
        referenceAnalysis={referenceAnalysis}
        onReferenceAnalysisReset={() => onUpdate({
          referenceAnalysis: {
            status: 'idle',
            summary: '',
            error: '',
            analyzedAt: null,
          },
        })}
        onAnalyzeReference={handleAnalyzeReference}
        analyzingReference={isAnalyzingReference}
        uploadedProductUrls={uploadedProductUrls}
        uploadedLogoUrl={uploadedLogoUrl}
        uploadedStyleUrl={lastStyleUrl}
        onUploadedProductUrlsChange={(urls) => onUpdate({ uploadedProductUrls: urls })}
        onUploadedLogoUrlChange={(url) => onUpdate({ uploadedLogoUrl: url })}
        onUploadedStyleUrlChange={(url) => onUpdate({ lastStyleUrl: url })}
        apiConfig={apiConfig}
        onSyncConfig={onSyncConfig}
        onClearConfig={onClearConfig}
        disabled={isAnalyzing || isGenerating || schemes.some(s => s.status === 'generating')} 
        onStart={handleStartAnalysis}
      />
      
      <main className="flex-1 overflow-y-auto p-8 relative scrollbar-hide">
        <div className="mx-auto mb-6 max-w-5xl rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-rose-50 text-rose-600 shadow-[0_12px_24px_rgba(225,29,72,0.10)]">
                <i className="fas fa-image text-lg"></i>
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-900">主图工作台</h2>
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs font-medium text-slate-400">当前模式</div>
              <div className="mt-1 text-sm font-bold text-slate-700">主图</div>
            </div>
          </div>
        </div>
        {schemes.length > 0 ? (
          <div className="max-w-5xl mx-auto space-y-6 pb-20">
            <div className="sticky top-0 z-20 flex items-center justify-between rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <div onClick={toggleSelectAll} className={`flex items-center gap-2 cursor-pointer group ${isAnalyzing ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center transition-all border-2 ${isAllSelected ? 'bg-rose-600 border-rose-600' : 'bg-white border-slate-300 group-hover:border-rose-400'}`}>
                           {isAllSelected && <i className="fas fa-check text-white text-[10px]"></i>}
                        </div>
                        <span className="text-sm font-medium text-slate-600">全选</span>
                    </div>
                    <div className="h-6 w-px bg-slate-200"></div>
                    <div>
                        <h3 className="text-base font-black text-slate-800">主图方案 <span className="ml-1 text-rose-600">({selectedCount}/{schemes.length})</span></h3>
                        <p className="text-xs text-slate-400">查看、编辑并生成当前主图方案。</p>
                    </div>
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

                    {completedCount > 0 && !isGenerating && !isAnalyzing && (
                      <button onClick={handleBatchDownload} disabled={isDownloading} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-emerald-700 disabled:bg-slate-300">
                        {isDownloading ? '导出中...' : `导出结果 (${completedCount})`}
                      </button>
                    )}
                    <button onClick={handleStartGeneration} disabled={selectedCount === 0 || isAnalyzing || isGenerating} className="rounded-xl bg-rose-600 px-5 py-2 text-sm font-bold text-white transition-all hover:bg-rose-700 disabled:bg-slate-300">
                      {isGenerating ? '生成中...' : '开始生成'}
                    </button>
                </div>
            </div>

            <motion.div 
              initial={false}
              animate={{ 
                height: isCollapsed ? 0 : 'auto',
                opacity: isCollapsed ? 0 : 1,
                scale: isCollapsed ? 0.98 : 1
              }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {schemes.map((scheme, idx) => (
                <div key={scheme.id} className={`bg-white rounded-2xl border transition-all overflow-hidden flex flex-col min-h-[500px] group/card ${scheme.selected ? 'border-rose-500 shadow-2xl' : 'border-slate-100 shadow-lg'}`}>
                  <div className="p-6 border-b border-slate-50 flex flex-col gap-3 relative">
                    <div onClick={() => scheme.status !== 'generating' && !isAnalyzing && toggleSelectScheme(scheme.id)} className={`absolute top-6 right-6 w-5 h-5 rounded border-2 cursor-pointer flex items-center justify-center transition-all z-10 ${scheme.selected ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-transparent hover:border-rose-400'} ${scheme.status === 'generating' || isAnalyzing ? 'opacity-50 pointer-events-none' : ''}`}>
                      <i className="fas fa-check text-[10px]"></i>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm ${scheme.selected ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{idx + 1}</span>
                        <div className="flex flex-col">
                            <h4 className="font-black text-slate-800 text-sm">{scheme.uiTitle}</h4>
                            {(scheme.extractedRatio || scheme.editedContent.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/)?.[1]) && (
                                <span className="text-[9px] font-bold text-slate-400 mt-0.5">
                                    比例: {scheme.extractedRatio || scheme.editedContent.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/)?.[1]}
                                </span>
                            )}
                        </div>
                      </div>
                      <div className="flex gap-4 mr-10">
                         <button
                            disabled={scheme.status === 'generating' || isAnalyzing}
                            onClick={() => deleteScheme(scheme.id)}
                            className="text-xs font-medium text-slate-400 transition-colors hover:text-red-600 disabled:opacity-30"
                         >
                             删除
                         </button>
                         <button 
                            disabled={scheme.status === 'generating' || isAnalyzing} 
                            onClick={() => {
                                if (scheme.taskId) {
                                    handleRecoverSingle(scheme.id);
                                } else {
                                    const lines = scheme.originalContent.split('\n');
                                    const cleanedLines = lines.filter(line => {
                                        const l = line.trim();
                                        if (/^(?:[-#*>\s]*)(?:屏序\/类型|第\s*\d+\s*屏|主图\d+)/.test(l)) return false;
                                        if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false;
                                        return true;
                                    });
                                    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === scheme.id ? { ...s, editedContent: cleanedLines.join('\n').trim() } : s) }));
                                }
                            }}
                            className="text-xs font-medium text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-30"
                         >
                             还原方案
                         </button>
                         <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => handleRedoSingle(scheme.id)} className="text-xs font-medium text-rose-600 transition-colors hover:text-rose-800 disabled:opacity-30">
                            {scheme.resultUrl ? '重新生成' : '生成该图'}
                         </button>
                      </div>
                    </div>
                    <textarea value={scheme.editedContent} onChange={(e) => onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === scheme.id ? { ...s, editedContent: e.target.value } : s) }))} disabled={scheme.status === 'generating' || isAnalyzing} className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium text-slate-700 h-40 resize-none outline-none focus:ring-1 focus:ring-rose-500 shadow-inner transition-all scrollbar-hide" />
                  </div>
                  <div className={`flex-1 p-6 flex items-center justify-center relative transition-opacity duration-300 ${scheme.selected ? 'bg-slate-50 opacity-100' : 'bg-slate-100/50 opacity-40'}`}>
                    {scheme.status === 'generating' ? (
                      <div className="text-center">
                        <div className="w-12 h-12 border-4 border-rose-100 border-t-rose-600 rounded-full animate-spin mb-3 mx-auto"></div>
                        <p className="text-sm font-semibold text-rose-600 animate-pulse">正在生成</p>
                        <p className="mt-2 text-xs text-slate-500 animate-pulse opacity-70">图像处理通常需要一些时间，请稍候。</p>
                        {scheme.error && <p className="mt-2 text-xs text-slate-400">{scheme.error}</p>}
                        <button 
                          onClick={() => handleInterruptSingle(scheme.id)} 
                          className="mt-4 rounded-lg bg-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-300"
                        >
                          中断并稍后同步
                        </button>
                      </div>
                    ) : scheme.resultUrl ? (
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden shadow-lg border border-slate-100 group/preview bg-slate-50">
                        {imageErrors[scheme.id] && scheme.resultUrl.startsWith('blob:') ? (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300">
                            <i className="far fa-file-image text-2xl mb-2"></i>
                            <span className="text-[10px] font-bold">预览已失效，请重新生成</span>
                          </div>
                        ) : (
                          <img 
                            src={scheme.resultUrl} 
                            className="w-full h-full object-cover transition-all duration-500 group-hover/preview:scale-105 brightness-[1.02] contrast-[1.02]" 
                            key={scheme.resultUrl} 
                            onError={() => {
                              if (scheme.resultUrl?.startsWith('blob:')) {
                                setImageErrors(prev => ({ ...prev, [scheme.id]: true }));
                              }
                            }}
                          />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/preview:opacity-100 transition-opacity flex items-center justify-center gap-3">
                           <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => handleRedoSingle(scheme.id)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-900 disabled:opacity-50" title="重新生成"><i className="fas fa-redo"></i></button>
                           <button onClick={() => setPreviewId(scheme.id)} className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-slate-900" title="全屏查看"><i className="fas fa-expand"></i></button>
                           <button onClick={() => { void downloadRemoteFile(scheme.resultUrl!, `main_${idx+1}.png`); }} className="w-10 h-10 bg-rose-600 rounded-full flex items-center justify-center text-white" title="下载"><i className="fas fa-download"></i></button>
                        </div>
                      </div>
                    ) : scheme.status === 'error' ? (
                      <div className="text-center p-8 bg-rose-50 rounded-[32px] border border-rose-100 w-full">
                         <i className="fas fa-exclamation-triangle text-rose-500 text-2xl mb-3"></i>
                         <p className="mb-4 px-4 text-sm font-medium leading-relaxed text-rose-600">{scheme.error || '生成失败'}</p>
                         {scheme.error && scheme.error.includes('超时') ? (
                            <div className="flex flex-col gap-2">
                                <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => handleRecoverSingle(scheme.id)} className="rounded-xl bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-700">稍后获取结果</button>
                                <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => handleRedoSingle(scheme.id)} className="rounded-xl bg-rose-600 px-6 py-2 text-sm font-medium text-white transition-all hover:bg-rose-700">重新生成</button>
                            </div>
                         ) : (
                            <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => handleRedoSingle(scheme.id)} className="rounded-xl bg-rose-600 px-6 py-2 text-sm font-medium text-white transition-all hover:bg-rose-700">重新生成</button>
                         )}
                      </div>
                    ) : (
                      <div className="text-center opacity-30 flex flex-col items-center gap-4">
                        <i className="fas fa-magic text-2xl text-slate-300"></i>
                        <p className="text-sm text-slate-400">等待生成</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500">
            <div className="mb-10 flex h-32 w-32 items-center justify-center rounded-[48px] border border-slate-100 bg-white shadow-2xl">
              <div className="flex h-20 w-20 items-center justify-center rounded-[30px] bg-rose-50 text-rose-600">
                <i className="fas fa-image text-4xl"></i>
              </div>
            </div>
            <h2 className="mb-4 text-3xl font-black text-slate-800 tracking-tight">主图工作台</h2>
          </div>
        )}

        {isAnalyzing && (
          <div className="absolute inset-0 bg-white/72 backdrop-blur-sm z-30 flex items-center justify-center rounded-[28px]">
            <div className="bg-white p-10 rounded-[40px] shadow-2xl flex flex-col items-center text-center animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6 animate-pulse border border-rose-100"><i className="fas fa-brain text-4xl text-rose-600"></i></div>
              <h3 className="mb-2 text-xl font-black text-slate-800">正在生成主图方案...</h3>
              <p className="text-sm text-slate-400">请稍候，系统正在整理并生成当前主图方案。</p>
            </div>
          </div>
        )}

        {previewId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-8 animate-in fade-in duration-300" onClick={() => setPreviewId(null)}>
            <div className="relative w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setPreviewId(null)} className="absolute top-4 right-4 text-white text-3xl hover:text-rose-50 z-10 transition-colors"><i className="fas fa-times"></i></button>
              
              <button onClick={prevPreview} disabled={currentPreviewIndex === 0} className={`absolute left-4 w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-all ${currentPreviewIndex === 0 ? 'opacity-20 cursor-not-allowed' : 'opacity-100'}`}><i className="fas fa-chevron-left text-xl"></i></button>
              
              <img 
                src={completedResults[currentPreviewIndex]?.resultUrl} 
                className="max-w-[85vw] max-h-[85vh] rounded-2xl shadow-2xl border-4 border-white/10 object-contain animate-in zoom-in duration-300" 
              />
              
              <button onClick={nextPreview} disabled={currentPreviewIndex === completedResults.length - 1} className={`absolute right-4 w-14 h-14 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-all ${currentPreviewIndex === completedResults.length - 1 ? 'opacity-20 cursor-not-allowed' : 'opacity-100'}`}><i className="fas fa-chevron-right text-xl"></i></button>

              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/40 px-6 py-2 text-xs font-medium text-white backdrop-blur-md">
                {currentPreviewIndex + 1} / {completedResults.length}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default MainImageSubModule;
