import React, { useState, useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  AspectRatio,
  GlobalApiConfig,
  KieAiResult,
  OneClickSubMode,
  SkuConfig,
  SkuPersistentSubState,
  SkuScheme,
} from '../../types';
import SkuSidebar from './SkuSidebar';
import { uploadToCos } from '../../services/tencentCosService';
import { isRecoverableKieTaskResult, processWithKieAi, recoverKieAiTask } from '../../services/kieAiService';
import { normalizeFetchedImageBlob } from '../../utils/imageBlobUtils.mjs';
import { resizeImage, getImageDimensions, createZipAndDownload } from '../../utils/imageUtils';
import { useToast } from '../../components/ToastSystem';
import { persistGeneratedAsset } from '../../services/persistedAssetClient';
import { analyzeOneClickReferenceSet, generateSkuSchemes } from '../../services/arkService';
import {
  logActionFailure, logActionInterrupted, logActionStart, logActionSuccess,
} from '../../services/loggingService';
import { buildSkuGenerationAssets } from './skuGenerationUtils.mjs';
import { normalizeCopyLayoutText } from './copyLayoutUtils.mjs';
import { appendOneClickCopyGuardrails } from './generationPromptUtils';

interface Props {
  apiConfig: GlobalApiConfig;
  state: SkuPersistentSubState;
  onUpdate: (
    updates:
      | Partial<SkuPersistentSubState>
      | ((prev: SkuPersistentSubState) => SkuPersistentSubState)
  ) => void;
  onProcessingChange: (processing: boolean) => void;
  onClearConfig?: () => void;
  currentSubMode?: OneClickSubMode;
  onSubModeChange?: (mode: OneClickSubMode) => void;
}

const SkuSubModule: React.FC<Props> = ({
  apiConfig, state, onUpdate, onProcessingChange, onClearConfig,
  currentSubMode, onSubModeChange,
}) => {
  const { images, designReferences, uploadedDesignReferenceUrls, referenceDimensions, referenceAnalysis, schemes, config } = state;
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingReference, setIsAnalyzingReference] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const schemesRef = useRef(schemes);
  schemesRef.current = schemes;
  const abortRef = useRef<AbortController | null>(null);
  const inflightIdsRef = useRef<Set<string>>(new Set());
  const isSubmittingAnalysisRef = useRef(false);
  const isSubmittingGenerationRef = useRef(false);
  const taskControllersRef = useRef<Record<string, AbortController>>({});
  const globalAbortRef = useRef<AbortController | null>(null);
  const { addToast } = useToast();

  const selectedCount = schemes.filter(s => s.selected).length;
  const completedCount = schemes.filter(s => s.status === 'completed' && s.resultUrl).length;
  const isAllSelected = schemes.length > 0 && selectedCount === schemes.length;
  const baseMeta = { subMode: 'sku', model: config.model, quality: config.quality, aspectRatio: config.aspectRatio };

  useEffect(() => {
    const hasActive = schemes.some(s => s.status === 'generating') || isAnalyzing || isGenerating;
    onProcessingChange(hasActive);
  }, [schemes, isAnalyzing, isGenerating]);

  useEffect(() => {
    setIsAnalyzing(false);
    setIsGenerating(false);
    onProcessingChange(false);
    if (schemes && Array.isArray(schemes)) {
      schemes.forEach(s => {
        if ((s.status === 'generating' || (s.status === 'error' && isRecoverableKieTaskResult(s.taskId, s.error))) && s.taskId && !inflightIdsRef.current.has(s.id)) {
          handleRecoverSingle(s.id);
        }
      });
    }
  }, []);

  // --- Selection ---
  const toggleSelectAll = () => {
    if (isAnalyzing) return;
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => ({ ...s, selected: !isAllSelected })) }));
  };
  const toggleSelectScheme = (id: string) => {
    if (isAnalyzing) return;
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === id ? { ...s, selected: !s.selected } : s) }));
  };

  // --- Scheme helpers ---
  const updateSingleScheme = (id: string, updates: Partial<SkuScheme>) => {
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === id ? { ...s, ...updates } : s) }));
    if (updates.resultUrl) setImageErrors(prev => ({ ...prev, [id]: false }));
  };
  const updateConfig = (updater: (prev: SkuConfig) => SkuConfig) => {
    onUpdate(prev => ({ ...prev, config: updater(prev.config) }));
  };

  // --- Upload helpers ---
  const ensureAllUploaded = async () => {
    const needUpload = images.filter(i => i.file && !i.uploadedUrl);
    if (needUpload.length === 0) return images;
    const updated = [...images];
    for (const item of needUpload) {
      const idx = updated.findIndex(u => u.id === item.id);
      if (idx >= 0 && item.file) {
        const url = await uploadToCos(item.file, apiConfig);
        updated[idx] = { ...updated[idx], uploadedUrl: url };
      }
    }
    onUpdate({ images: updated });
    return updated;
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
      const result = await analyzeOneClickReferenceSet(referenceUrls, referenceDimensions, OneClickSubMode.SKU, apiConfig);
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

  const getProductAndGiftUrls = (currentImages: typeof images) => {
    const productUrls = currentImages.filter(i => i.role === 'product' && i.uploadedUrl).map(i => i.uploadedUrl!);
    const giftUrls = currentImages.filter(i => i.role === 'gift' && i.uploadedUrl).map(i => i.uploadedUrl!);
    const styleRef = currentImages.find(i => i.role === 'style_ref' && i.uploadedUrl);
    return { productUrls, giftUrls, styleUrl: styleRef?.uploadedUrl || null };
  };

  // --- AI Analysis (生成方案) ---
  const handleStartAnalysis = async () => {
    const hasGenerating = schemesRef.current.some(s => s.status === 'generating');
    const productImgs = images.filter(i => i.role === 'product');
    if (isSubmittingAnalysisRef.current || isAnalyzing || isGenerating || hasGenerating || productImgs.length === 0) return;
    const validCombos = config.combinations.filter(c => c.skuCopyText.trim());
    if (validCombos.length === 0) { addToast('请至少填写一个 SKU 文案', 'warning'); return; }

    isSubmittingAnalysisRef.current = true;
    setIsAnalyzing(true);
    void logActionStart({ module: 'one_click', action: 'plan_sku_start', message: '开始SKU策划', meta: baseMeta });
    addToast('正在进行 SKU 视觉策划...', 'info');

    try {
      onUpdate({ schemes: [] });
      globalAbortRef.current = new AbortController();
      const uploaded = (await ensureAllUploaded()) || images;
      const { productUrls, giftUrls, styleUrl } = getProductAndGiftUrls(uploaded);
      let referenceSummary = referenceAnalysis.summary;
      if (!referenceSummary && designReferences.length > 0 && referenceDimensions.length > 0) {
        const referenceUrls = await getOrUploadReferenceUrls();
        const referenceResult = await analyzeOneClickReferenceSet(referenceUrls, referenceDimensions, OneClickSubMode.SKU, apiConfig, globalAbortRef.current.signal);
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

      if (globalAbortRef.current.signal.aborted) throw new Error('ABORTED');

      const res = await generateSkuSchemes(productUrls, giftUrls, styleUrl, config, apiConfig, globalAbortRef.current.signal, referenceSummary);

      if (res.status === 'success') {
        const combos = config.combinations.filter(c => c.skuCopyText.trim());
        const initialSchemes: SkuScheme[] = res.schemes.map((text, idx) => {
          const combo = combos[idx];
          const ratioMatch = text.match(/(?:-|\s|^)画面比例[：:]\s*([0-9]+:[0-9]+)/);
          const ratio = ratioMatch ? ratioMatch[1] : (config.aspectRatio || '1:1');
          let uiTitle = `SKU ${['一','二','三','四','五','六','七','八'][idx] || (idx+1)}`;
          const titleLine = text.split('\n').find(l => /^(?:[-#*>\s]*)(?:SKU\s*标识|SKU[一二三四五六七八])/.test(l.trim()));
          if (titleLine) {
            const clean = titleLine.trim().replace(/^(?:[-#*>\s]*)(?:SKU\s*标识[：:]?)?/, '').trim();
            uiTitle = clean || uiTitle;
          }
          const cleanedLines = text.split('\n').filter(line => {
            const l = line.trim();
            if (/^(?:[-#*>\s]*)(?:SKU\s*标识)/.test(l)) return false;
            if (/^(?:[-#*>\s]*)设计意图/.test(l)) return false;
            if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false;
            return true;
          });
          return {
            id: Math.random().toString(36).substr(2, 9),
            combinationId: combo?.id || '',
            uiTitle,
            originalContent: text,
            editedContent: normalizeCopyLayoutText(cleanedLines.join('\n').trim()),
            extractedRatio: ratio,
            selected: true,
            status: 'pending' as const,
          };
        });
        onUpdate({ schemes: initialSchemes });
        void logActionSuccess({ module: 'one_click', action: 'plan_sku_start', message: 'SKU策划成功', meta: { ...baseMeta, count: initialSchemes.length } });
        addToast('SKU 策划方案已生成，请检查并启动渲染。', 'success');
      } else {
        void logActionFailure({ module: 'one_click', action: 'plan_sku_start', message: 'SKU策划失败', detail: res.message, meta: baseMeta });
        addToast('SKU 策划失败: ' + res.message, 'error');
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || e.message === 'ABORTED') {
        addToast('策划已取消', 'error');
      } else {
        addToast('系统分析异常: ' + e.message, 'error');
      }
    } finally {
      setIsAnalyzing(false);
      isSubmittingAnalysisRef.current = false;
    }
  };

  // --- Build prompt from edited content ---
  const buildSkuPrompt = (scheme: SkuScheme, isFirst: boolean, currentImages: typeof images, effectiveFirstSkuResultUrl?: string | null) => {
    const resolvedFirstUrl = effectiveFirstSkuResultUrl ?? state.firstSkuResultUrl;
    const productImgs = currentImages.filter(i => i.role === 'product' && i.uploadedUrl);
    const giftImgs = currentImages.filter(i => i.role === 'gift' && i.uploadedUrl).sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0));
    const { styleRefUrl } = buildSkuGenerationAssets({
      currentImages,
      firstSkuResultUrl: resolvedFirstUrl,
      isFirst,
    });

    let manifest = '【素材清单 — 请严格区分每张图的类型】\n';
    productImgs.forEach((img, i) => { manifest += `- 商品主体图${i + 1}: ${img.uploadedUrl}\n`; });
    giftImgs.forEach(img => { manifest += `- 赠品${img.giftIndex}: ${img.uploadedUrl}\n`; });
    if (!isFirst && resolvedFirstUrl) {
      manifest += `- SKU风格基准（第一张生成结果，后续必须严格保持一致风格）: ${styleRefUrl}\n`;
    } else if (styleRefUrl) {
      manifest += `- SKU风格参考图: ${styleRefUrl}\n`;
    }

    let prompt = '【严格保持产品与赠品一致性】请严格保持所有商品与赠品和参考图一致，不得改变外观、尺寸关系、结构、标签或包装。\n\n';
    prompt += manifest + '\n';
    prompt += `【产品信息】\n${config.productInfo || '未填写'}\n\n`;
    const schemeContent = scheme.editedContent
      .replace(/【设计参考分析结论】[\s\S]*?(?=\n【|\n-\s*画面风格|$)/g, '')
      .replace(/【参考分析结论】[\s\S]*?(?=\n【|\n-\s*画面风格|$)/g, '')
      .trim();
    prompt += `【SKU 展示方案】\n${normalizeCopyLayoutText(schemeContent)}\n`;

    if (!isFirst && styleRefUrl && resolvedFirstUrl) {
      prompt += `\n风格参考图：${styleRefUrl}。严格按照该风格参考图一致的排版、字体风格、文字摆放、色调和整体设计风格制作。该图仅作为风格基准，不得替换、改写或混入主体商品本身。`;
    }
    prompt = appendOneClickCopyGuardrails(prompt, config.language || '中文');
    prompt += `\n主体商品必须最显眼，赠品只能作为辅助点缀，不能喧宾夺主。`;
    prompt += `\n赠品可以比真实比例更小，但必须保持正面陈列。`;
    prompt += `\n主体商品和赠品都必须正面、稳定、正常陈列，禁止躺放、斜放、倾倒。`;
    prompt += '\n画面质量：高端商业摄影棚拍质感。';
    return prompt;
  };

  // --- Single SKU generation ---
  const generateSingleSku = async (schemeId: string, isFirst: boolean, currentImages: typeof images, mode: 'full' | 'recover' = 'full', overrideFirstSkuResultUrl?: string | null) => {
    if (taskControllersRef.current[schemeId]) taskControllersRef.current[schemeId].abort();
    const controller = new AbortController();
    taskControllersRef.current[schemeId] = controller;
    updateSingleScheme(
      schemeId,
      mode === 'recover'
        ? { status: 'generating', error: undefined }
        : { status: 'generating', error: undefined, taskId: undefined, resultUrl: undefined }
    );

    const targetScheme = schemesRef.current.find(s => s.id === schemeId);
    if (!targetScheme) return false;
    void logActionStart({ module: 'one_click', action: mode === 'recover' ? 'recover_sku' : 'generate_sku', message: `开始${mode === 'recover' ? '找回' : '生成'} ${targetScheme.uiTitle}`, meta: { ...baseMeta, schemeId } });

    try {
      let res: KieAiResult;
      if (mode === 'recover' && targetScheme.taskId) {
        updateSingleScheme(schemeId, { error: '正在重连云端任务...' });
        res = await recoverKieAiTask(targetScheme.taskId, apiConfig, controller.signal);
      } else {
        const resolvedFirstUrl = overrideFirstSkuResultUrl ?? state.firstSkuResultUrl;
        const prompt = buildSkuPrompt(targetScheme, isFirst, currentImages, resolvedFirstUrl);
        const { generationImageUrls } = buildSkuGenerationAssets({
          currentImages,
          firstSkuResultUrl: resolvedFirstUrl,
          isFirst,
        });
        const strictRatio = config.aspectRatio || AspectRatio.SQUARE;
        res = await processWithKieAi(
          generationImageUrls, apiConfig,
          { ...config, aspectRatio: strictRatio as any, maxFileSize: config.maxFileSize || 2.0 } as any,
          false, controller.signal, prompt
        );
      }

      if (res.taskId) updateSingleScheme(schemeId, { taskId: res.taskId });
      if (controller.signal.aborted || res.status === 'interrupted') throw new Error('INTERRUPTED');

      if (res.status === 'success') {
        const imgResp = await fetch(res.imageUrl, { signal: controller.signal });
        const blob = await normalizeFetchedImageBlob(await imgResp.blob(), res.imageUrl);
        const dims = await getImageDimensions(blob);
        let tw = dims.width, th = dims.height;
        if (config.resolutionMode === 'custom' && config.targetWidth && config.targetHeight) { tw = config.targetWidth; th = config.targetHeight; }
        const finalBlob = await resizeImage(blob, tw, th, config.maxFileSize);
        const resultUrl = await persistGeneratedAsset(finalBlob, 'one_click', `${targetScheme.uiTitle}.png`);
        updateSingleScheme(schemeId, { status: 'completed', resultUrl, taskId: res.taskId });
        void logActionSuccess({ module: 'one_click', action: 'generate_sku', message: `${targetScheme.uiTitle} 生成成功`, meta: { ...baseMeta, schemeId, taskId: res.taskId } });
        return true;
      } else if (res.status === 'task_not_found') {
        throw new Error('任务已过期或不存在，请重新生成');
      }
      throw new Error(res.message || '渲染失败');
    } catch (err: any) {
      const isManual = err.name === 'AbortError' || err.message === 'INTERRUPTED';
      updateSingleScheme(schemeId, { status: isManual ? 'interrupted' : 'error', error: isManual ? '已手动中断' : err.message });
      if (isManual) {
        void logActionInterrupted({ module: 'one_click', action: 'generate_sku', message: `${targetScheme?.uiTitle} 已中断`, detail: err.message, meta: { ...baseMeta, schemeId } });
      } else {
        void logActionFailure({ module: 'one_click', action: 'generate_sku', message: `${targetScheme?.uiTitle} 生成失败`, detail: err.message, meta: { ...baseMeta, schemeId } });
      }
      return false;
    } finally {
      delete taskControllersRef.current[schemeId];
      inflightIdsRef.current.delete(schemeId);
    }
  };

  // --- Batch generation (sequential: first as benchmark) ---
  const handleStartGeneration = async () => {
    if (isSubmittingGenerationRef.current || isGenerating || isAnalyzing) return;
    const selected = schemesRef.current.filter(s => s.selected && s.status !== 'generating' && !inflightIdsRef.current.has(s.id));
    if (selected.length === 0) return;
    const productImgs = images.filter(i => i.role === 'product');
    if (productImgs.length === 0) { addToast('请先上传商品主体图', 'warning'); return; }

    isSubmittingGenerationRef.current = true;
    setIsGenerating(true);
    void logActionStart({ module: 'one_click', action: 'generate_sku_batch', message: '开始批量生成SKU', meta: { ...baseMeta, count: selected.length } });
    addToast('开始 SKU 批量生成...', 'info');

    const targetIds = selected.map(s => s.id);
    onUpdate(prev => ({
      ...prev,
      schemes: prev.schemes.map(s => targetIds.includes(s.id) ? { ...s, status: 'generating', error: '正在准备素材...' } : s),
    }));

    try {
      const uploaded = (await ensureAllUploaded()) || images;
      const currentImages = uploaded.length > 0 ? uploaded : images;
      onUpdate({ firstSkuResultUrl: null });
      let localFirstSkuResultUrl: string | null = null;

      for (let i = 0; i < selected.length; i++) {
        const isFirst = i === 0;
        inflightIdsRef.current.add(selected[i].id);
        const ok = await generateSingleSku(selected[i].id, isFirst, currentImages, 'full', localFirstSkuResultUrl);
        if (isFirst) {
          if (ok) {
            const latest = schemesRef.current.find(s => s.id === selected[0].id);
            if (latest?.resultUrl) {
              localFirstSkuResultUrl = latest.resultUrl;
              onUpdate({ firstSkuResultUrl: latest.resultUrl });
            }
          } else {
            addToast('第一张 SKU 生成失败，后续任务已暂停', 'error');
            // 首图失败：将剩余的 generating 状态重置为 error
            const remainingIds = selected.slice(1).map(s => s.id);
            if (remainingIds.length > 0) {
              onUpdate(prev => ({
                ...prev,
                schemes: prev.schemes.map(s =>
                  remainingIds.includes(s.id) && s.status === 'generating'
                    ? { ...s, status: 'error' as const, error: '首图生成失败，已暂停' }
                    : s
                ),
              }));
            }
            break;
          }
        }
      }
      void logActionSuccess({ module: 'one_click', action: 'generate_sku_batch', message: '批量生成SKU完成', meta: { ...baseMeta, count: selected.length } });
      addToast('SKU 生成完成', 'success');
    } catch (e: any) {
      addToast('SKU 生成异常: ' + e.message, 'error');
    } finally {
      isSubmittingGenerationRef.current = false;
      setIsGenerating(false);
    }
  };

  // --- Action handlers ---
  const handleRecoverSingle = async (schemeId: string) => {
    if (inflightIdsRef.current.has(schemeId)) return;
    updateSingleScheme(schemeId, { status: 'generating', error: '正在同步云端结果...' });
    inflightIdsRef.current.add(schemeId);
    try {
      const uploaded = (await ensureAllUploaded()) || images;
      await generateSingleSku(schemeId, false, uploaded, 'recover');
    } catch (e: any) {
      inflightIdsRef.current.delete(schemeId);
      updateSingleScheme(schemeId, { status: 'error', error: '同步失败: ' + e.message });
    }
  };

  const handleRedoSingle = async (schemeId: string) => {
    if (inflightIdsRef.current.has(schemeId) || isAnalyzing) return;
    updateSingleScheme(schemeId, { status: 'generating', error: '正在准备素材...', taskId: undefined, resultUrl: undefined });
    inflightIdsRef.current.add(schemeId);
    try {
      const uploaded = (await ensureAllUploaded()) || images;
      const isFirst = schemesRef.current.findIndex(s => s.id === schemeId) === 0;
      await generateSingleSku(schemeId, isFirst, uploaded);
    } catch (e: any) {
      inflightIdsRef.current.delete(schemeId);
      updateSingleScheme(schemeId, { status: 'error', error: '启动失败' });
    }
  };

  const handleInterruptSingle = (id: string) => {
    if (taskControllersRef.current[id]) {
      taskControllersRef.current[id].abort();
      delete taskControllersRef.current[id];
    }
    inflightIdsRef.current.delete(id);
    updateSingleScheme(id, { status: 'error', error: '已手动中断，可点击同步获取结果' });
    addToast('已中断生成任务', 'info');
  };

  const deleteProject = () => {
    Object.values(taskControllersRef.current).forEach((controller: AbortController) => controller.abort());
    taskControllersRef.current = {};
    onUpdate(prev => ({ ...prev, schemes: [] }));
    inflightIdsRef.current.clear();
    setIsCollapsed(false);
    addToast('项目已清空', 'success');
  };

  const deleteScheme = (id: string) => {
    if (taskControllersRef.current[id]) { taskControllersRef.current[id].abort(); delete taskControllersRef.current[id]; }
    onUpdate(prev => ({ ...prev, schemes: prev.schemes.filter(s => s.id !== id) }));
    inflightIdsRef.current.delete(id);
    addToast('方案已删除', 'success');
  };

  const handleBatchDownload = async () => {
    if (isDownloading) return;
    const completed = schemes.filter(s => s.status === 'completed' && s.resultUrl);
    if (completed.length === 0) return;
    setIsDownloading(true);
    addToast('开始打包下载...', 'info');
    try {
      const zipFiles = await Promise.all(completed.map(async (s, i) => {
        const resp = await fetch(s.resultUrl!);
        const blob = await resp.blob();
        return { blob, path: `sku_${i + 1}.png` };
      }));
      await createZipAndDownload(zipFiles, `mayo_sku_batch_${Date.now()}`);
      addToast('下载完成', 'success');
    } catch (err) {
      addToast('下载失败', 'error');
    } finally {
      setIsDownloading(false);
    }
  };

  const completedResults = schemes.filter(s => s.status === 'completed' && s.resultUrl);
  const currentPreviewIndex = completedResults.findIndex(s => s.id === previewId);
  const nextPreview = () => { if (currentPreviewIndex < completedResults.length - 1) setPreviewId(completedResults[currentPreviewIndex + 1].id); };
  const prevPreview = () => { if (currentPreviewIndex > 0) setPreviewId(completedResults[currentPreviewIndex - 1].id); };

  // --- Render ---
  return (
    <>
      <SkuSidebar
        state={state}
        onUpdate={(updates) => onUpdate(updates)}
        onUpdateConfig={updateConfig}
        apiConfig={apiConfig}
        disabled={isAnalyzing || isGenerating || schemes.some(s => s.status === 'generating')}
        onStart={handleStartAnalysis}
        onAnalyzeReference={handleAnalyzeReference}
        analyzingReference={isAnalyzingReference}
        onClearConfig={onClearConfig}
        currentSubMode={currentSubMode}
        onSubModeChange={onSubModeChange}
      />
      <main className="flex-1 overflow-y-auto p-8 relative scrollbar-hide bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)]">
        {/* Header */}
        <div className="mx-auto mb-6 max-w-5xl rounded-[28px] border border-slate-200 bg-white px-6 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-rose-50 text-rose-600 shadow-[0_12px_24px_rgba(225,29,72,0.10)]">
                <i className="fas fa-tags text-lg"></i>
              </div>
              <div>
                <h2 className="text-2xl font-black tracking-tight text-slate-900">SKU 工作台</h2>
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
              <div className="text-xs font-medium text-slate-400">当前模式</div>
              <div className="mt-1 text-sm font-bold text-slate-700">SKU</div>
            </div>
          </div>
        </div>

        {schemes.length > 0 ? (
          <div className="max-w-5xl mx-auto space-y-6 pb-20">
            {/* Toolbar */}
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
                  <h3 className="text-base font-black text-slate-800">SKU 方案 <span className="ml-1 text-rose-600">({selectedCount}/{schemes.length})</span></h3>
                  <p className="text-xs text-slate-400">查看、编辑并生成 SKU 方案。</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
                  <button onClick={() => setIsCollapsed(!isCollapsed)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white hover:shadow-sm text-slate-500 transition-all" title={isCollapsed ? '展开' : '收起'}>
                    <i className={`fas fa-chevron-${isCollapsed ? 'down' : 'up'} text-xs`}></i>
                  </button>
                  <button onClick={deleteProject} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white hover:shadow-sm text-rose-500 transition-all" title="删除整个项目">
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

            {/* Scheme Cards */}
            <motion.div initial={false} animate={{ height: isCollapsed ? 0 : 'auto', opacity: isCollapsed ? 0 : 1, scale: isCollapsed ? 0.98 : 1 }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} className="overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {schemes.map((scheme, idx) => (
                <div key={scheme.id} className={`bg-white rounded-2xl border transition-all overflow-hidden flex flex-col min-h-[500px] group/card ${scheme.selected ? 'border-rose-500 shadow-2xl' : 'border-slate-100 shadow-lg'}`}>
                  <div className="p-6 border-b border-slate-50 flex flex-col gap-3 relative">
                    {/* Checkbox */}
                    <div onClick={() => scheme.status !== 'generating' && !isAnalyzing && toggleSelectScheme(scheme.id)} className={`absolute top-6 right-6 w-5 h-5 rounded border-2 cursor-pointer flex items-center justify-center transition-all z-10 ${scheme.selected ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-300 text-transparent hover:border-rose-400'} ${scheme.status === 'generating' || isAnalyzing ? 'opacity-50 pointer-events-none' : ''}`}>
                      <i className="fas fa-check text-[10px]"></i>
                    </div>
                    {/* Title row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-sm ${scheme.selected ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{idx + 1}</span>
                        <div className="flex flex-col">
                          <h4 className="font-black text-slate-800 text-sm">{scheme.uiTitle}</h4>
                          {scheme.extractedRatio && <span className="text-[9px] font-bold text-slate-400 mt-0.5">比例: {scheme.extractedRatio}</span>}
                        </div>
                      </div>
                      <div className="flex gap-4 mr-10">
                        <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => deleteScheme(scheme.id)} className="text-xs font-medium text-slate-400 transition-colors hover:text-red-600 disabled:opacity-30">删除</button>
                        <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => {
                          if (scheme.taskId) { handleRecoverSingle(scheme.id); } else {
                            const cleanedLines = scheme.originalContent.split('\n').filter(line => { const l = line.trim(); if (/^(?:[-#*>\s]*)(?:SKU\s*标识)/.test(l)) return false; if (/^(?:[-#*>\s]*)设计意图/.test(l)) return false; if (/^(?:[-#*>\s]*)画面比例/.test(l)) return false; return true; });
                            onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === scheme.id ? { ...s, editedContent: cleanedLines.join('\n').trim() } : s) }));
                          }
                        }} className="text-xs font-medium text-slate-400 transition-colors hover:text-rose-600 disabled:opacity-30">还原方案</button>
                        <button disabled={scheme.status === 'generating' || isAnalyzing} onClick={() => handleRedoSingle(scheme.id)} className="text-xs font-medium text-rose-600 transition-colors hover:text-rose-800 disabled:opacity-30">
                          {scheme.resultUrl ? '重新生成' : '生成该图'}
                        </button>
                      </div>
                    </div>
                    {/* Editable content */}
                    <textarea value={scheme.editedContent} onChange={(e) => onUpdate(prev => ({ ...prev, schemes: prev.schemes.map(s => s.id === scheme.id ? { ...s, editedContent: e.target.value } : s) }))} disabled={scheme.status === 'generating' || isAnalyzing} className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium text-slate-700 h-40 resize-none outline-none focus:ring-1 focus:ring-rose-500 shadow-inner transition-all scrollbar-hide" />
                  </div>
                  {/* Result area */}
                  <div className={`flex-1 p-6 flex items-center justify-center relative transition-opacity duration-300 ${scheme.selected ? 'bg-slate-50 opacity-100' : 'bg-slate-100/50 opacity-40'}`}>
                    {scheme.status === 'generating' ? (
                      <div className="text-center">
                        <div className="w-12 h-12 border-4 border-rose-100 border-t-rose-600 rounded-full animate-spin mb-3 mx-auto"></div>
                        <p className="text-sm font-semibold text-rose-600 animate-pulse">正在生成</p>
                        {scheme.error && <p className="mt-2 text-xs text-slate-400">{scheme.error}</p>}
                        <button onClick={() => handleInterruptSingle(scheme.id)} className="mt-4 rounded-lg bg-slate-200 px-4 py-2 text-xs font-medium text-slate-600 transition-all hover:bg-slate-300">中断任务</button>
                      </div>
                    ) : scheme.status === 'completed' && scheme.resultUrl ? (
                      <div className="relative group/img w-full h-full flex items-center justify-center">
                        <img src={scheme.resultUrl} alt={scheme.uiTitle} className="max-w-full max-h-[320px] rounded-[20px] shadow-lg transition-transform duration-500 group-hover/img:scale-[1.02]" onError={() => { if (scheme.resultUrl?.startsWith('blob:')) setImageErrors(prev => ({ ...prev, [scheme.id]: true })); }} />
                        <div className="absolute inset-0 bg-black/40 rounded-[20px] opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button onClick={() => handleRedoSingle(scheme.id)} className="px-4 py-2 bg-white/20 hover:bg-white text-white hover:text-rose-600 backdrop-blur-md rounded-full text-xs font-bold transition-all"><i className="fas fa-redo mr-1"></i>重新生成</button>
                          <button onClick={() => setPreviewId(scheme.id)} className="px-4 py-2 bg-white/20 hover:bg-white text-white hover:text-slate-900 backdrop-blur-md rounded-full text-xs font-bold transition-all"><i className="fas fa-eye mr-1"></i>查看大图</button>
                        </div>
                      </div>
                    ) : scheme.status === 'error' || scheme.status === 'interrupted' ? (
                      <div className="text-center">
                        <i className="fas fa-exclamation-triangle text-rose-400 text-2xl mb-2"></i>
                        <p className="text-xs font-bold text-rose-500">{scheme.error || '生成失败'}</p>
                        <div className="flex gap-2 mt-3 justify-center">
                          {scheme.taskId && <button onClick={() => handleRecoverSingle(scheme.id)} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200">找回结果</button>}
                          <button onClick={() => handleRedoSingle(scheme.id)} className="px-3 py-1.5 bg-rose-50 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-100">重新生成</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center opacity-30">
                        <i className="fas fa-image text-3xl mb-2"></i>
                        <p className="text-xs font-bold">等待生成</p>
                      </div>
                    )}
                  </div>
                </div>
                ))}
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <i className="fas fa-tags text-4xl mb-4"></i>
            <p className="text-sm font-black">上传素材并填写 SKU 组合后，点击"生成方案"开始策划</p>
          </div>
        )}

        {/* Analysis Overlay */}
        {isAnalyzing && (
          <div className="absolute inset-0 bg-white/72 backdrop-blur-sm z-30 flex items-center justify-center rounded-[28px]">
            <div className="bg-white p-10 rounded-[40px] shadow-2xl flex flex-col items-center text-center animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mb-6 animate-pulse border border-rose-100"><i className="fas fa-brain text-4xl text-rose-600"></i></div>
              <h3 className="mb-2 text-xl font-black text-slate-800">正在策划 SKU 展示方案...</h3>
              <p className="text-sm text-slate-400">请稍候，系统正在整理并生成 SKU 视觉策划方案。</p>
            </div>
          </div>
        )}

        {/* Fullscreen Preview Modal */}
        {previewId && (() => {
          const previewScheme = completedResults.find(s => s.id === previewId);
          if (!previewScheme?.resultUrl) return null;
          return (
            <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setPreviewId(null)}>
              <button onClick={(e) => { e.stopPropagation(); prevPreview(); }} className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white text-xl transition-all" disabled={currentPreviewIndex <= 0}><i className="fas fa-chevron-left"></i></button>
              <img src={previewScheme.resultUrl} className="max-w-[90vw] max-h-[90vh] rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
              <button onClick={(e) => { e.stopPropagation(); nextPreview(); }} className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white text-xl transition-all" disabled={currentPreviewIndex >= completedResults.length - 1}><i className="fas fa-chevron-right"></i></button>
              <div className="absolute top-6 right-6 flex items-center gap-3">
                <span className="text-white/60 text-sm font-bold">{currentPreviewIndex + 1} / {completedResults.length}</span>
                <button onClick={() => setPreviewId(null)} className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-all"><i className="fas fa-times"></i></button>
              </div>
            </div>
          );
        })()}
      </main>
    </>
  );
};

export default SkuSubModule;
