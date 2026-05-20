import React, { useEffect, useState } from 'react';
import { CheckSquare2, ChevronLeft, ChevronRight, Copy, Download, FileText, Film, ImagePlus, Maximize2, Package, Palette, RefreshCw, RotateCcw, Scissors, Sparkles, Square, Trash2, X } from 'lucide-react';
import type { GeneratedResult } from '../../ShellMigratedApp';
import type { OneClickGenerationContext, VideoStoryboardProject } from '../../types';
import type { ImageDownloadTransform } from '../../utils/imageUtils';
import ConfirmDialog from './ConfirmDialog';
import ImageLightbox from './ImageLightbox';
import PlanEditor, { type PlanItem } from './PlanEditor';
import { useToast } from './ToastSystem';

export interface Project {
  id: string;
  name: string;
  module: string;
  status: 'planning' | 'generating' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  results: GeneratedResult[];
  plans?: PlanItem[];
  selectedPlanId?: string;
  taskCount: number;
  completedCount: number;
  subFeature?: string;
  sourceType?: 'persisted' | 'job';
  planningTaskId?: string;
  generationContext?: OneClickGenerationContext;
  storyboardProjectStatus?: VideoStoryboardProject['status'];
  storyboardSourceProject?: VideoStoryboardProject;
  creditsConsumed?: number;
  error?: string;
}

interface Props {
  project: Project;
  onDeleteResult?: (resultId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRegenerate?: (resultId: string, instruction?: string) => void;
  onConfirmStoryboardImaging?: (projectId: string) => void;
  onFission?: (resultId: string, mode: 'scene' | 'palette' | 'custom', instruction: string) => void;
  onRecover?: (resultId: string) => void;
  onConfirmPlan?: (projectId: string, plan: PlanItem | PlanItem[]) => void;
  onUpdatePlans?: (projectId: string, plans: PlanItem[]) => void;
  onDeletePlan?: (projectId: string, planId: string) => void;
  onRegeneratePlans?: (projectId: string) => void;
  onCancelTask?: (taskIdOrProjectId: string) => void;
  onImportStoryboardToGeneration?: (project: VideoStoryboardProject) => void;
  pendingActionKeys?: Record<string, boolean>;
  compact?: boolean;
  showGenerationProgress?: boolean;
}

const moduleNames: Record<string, string> = {
  one_click: '一键主详', translation: '出海翻译', retouch: '产品精修',
  buyer_show: '买家秀', video: '短视频', xhs_cover: '小红书', agent_center: '智能体',
};

const subFeatureNames: Record<string, string> = {
  first_image: '首图',
  main_image: '主图',
  detail_page: '详情页',
  sku: 'SKU',
  main: '主图出海',
  detail: '详情出海',
  remove_text: '去文案',
  original: '原图精修',
  white_bg: '白底精修',
  background_replace: '背景替换',
  enhance: '智能增强',
  image: '买家秀图片',
  copy: '纯文案',
  generation: '短视频',
  storyboard: '分镜',
  diagnosis: '诊断',
  cover: '封面',
};

const normalizeSchemeText = (scheme?: string) =>
  String(scheme || '')
    .replace(/\[SCHEME_START\]/g, '')
    .replace(/\[SCHEME_END\]/g, '')
    .trim();

const renderMedia = (result: GeneratedResult, className: string) => {
  if (result.mediaType === 'video' || result.videoUrl) {
    const src = result.videoUrl || result.imageUrl;
    return src ? <video src={src} className={className} controls muted playsInline preload="metadata" /> : (
      <div className={`flex items-center justify-center text-[12px] ${className}`} style={{ color: 'var(--text-tertiary)' }}>视频结果待同步</div>
    );
  }
  if (!result.imageUrl) {
    return <div className={`flex items-center justify-center text-[12px] ${className}`} style={{ color: 'var(--text-tertiary)' }}>图片结果待同步</div>;
  }
  return <img src={result.imageUrl} alt={result.prompt} className={className} loading="lazy" decoding="async" />;
};

const getResultExtension = (result: GeneratedResult) => (result.mediaType === 'video' || result.videoUrl ? 'mp4' : 'png');

const getDownloadName = (project: Project, result: GeneratedResult, index: number) => {
  if (project.module === 'translation' && result.relativePath) {
    const base = result.relativePath.split(/[\\/]/).pop() || result.relativePath;
    const ext = getResultExtension(result);
    const baseName = base.replace(/\.[^.]+$/, '');
    return `${baseName || `translation_${index + 1}`}.${ext}`;
  }
  const ext = result.mediaType === 'video' || result.videoUrl ? 'mp4' : 'png';
  return `${project.name || 'project'}_${index + 1}_${result.id}`.replace(/[\\/:*?"<>|\s]+/g, '_') + `.${ext}`;
};

const getDownloadZipPath = (project: Project, result: GeneratedResult, index: number) => {
  const ext = getResultExtension(result);
  if (project.module === 'translation' && result.relativePath) {
    const normalized = result.relativePath.replace(/\\/g, '/');
    return normalized.replace(/\.[^.]+$/, '') + `.${ext}`;
  }
  return getDownloadName(project, result, index);
};

const toPositiveNumber = (value: unknown) => {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getResultDownloadTransform = (project: Project, result: GeneratedResult): ImageDownloadTransform | undefined => {
  if (result.mediaType === 'video' || result.videoUrl) return undefined;
  const params = project.generationContext?.params || {};
  const requestedMode = String(params.resolutionMode || params.sizeMode || '').trim();
  if (requestedMode.includes('原图') || requestedMode.toLowerCase() === 'original' || requestedMode.includes('AI 自适应')) {
    return undefined;
  }
  const targetWidth = toPositiveNumber(params.targetWidth || params.width);
  const targetHeight = toPositiveNumber(params.targetHeight || params.height);
  if (targetWidth <= 0 && targetHeight <= 0) return undefined;
  const maxFileSize = toPositiveNumber(params.maxFileSize || params.maxSize) || undefined;
  return { targetWidth, targetHeight, maxFileSize };
};

const statusStyle: Record<Project['status'], { label: string; color: string; bg: string }> = {
  planning:   { label: '待确认', color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)' },
  generating: { label: '生成中', color: 'var(--accent)',   bg: 'var(--accent-soft)' },
  completed:  { label: '已完成', color: 'var(--text-secondary)',  bg: 'var(--bg-elevated)' },
  error:      { label: '失败',   color: 'var(--error)',    bg: 'rgba(239,68,68,0.06)' },
};

const normalizeCreditsConsumed = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const formatCreditsConsumed = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
};

const getProjectCreditsConsumed = (project: Project) => {
  const rawProjectCredits = normalizeCreditsConsumed(project.creditsConsumed);
  const resultCredits = project.results.reduce((sum, result) => (
    sum + (result.status === 'completed' ? normalizeCreditsConsumed(result.creditsConsumed) : 0)
  ), 0);
  const hasPlanningUsage = Boolean(project.planningTaskId)
    || (project.module === 'one_click' && Array.isArray(project.plans) && project.plans.length > 0);
  const projectCredits = hasPlanningUsage ? rawProjectCredits : 0;
  const directTaskCredits = hasPlanningUsage ? resultCredits : (resultCredits || rawProjectCredits);
  return {
    projectCredits,
    resultCredits: directTaskCredits,
    total: projectCredits + directTaskCredits,
  };
};

const ResultActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'primary' | 'danger';
  className?: string;
  disabled?: boolean;
}> = ({ icon, label, onClick, tone = 'neutral', className = '', disabled = false }) => {
  const styleByTone = {
    neutral: {
      background: 'var(--bg-surface)',
      color: 'var(--text-secondary)',
      borderColor: 'var(--border-subtle)',
    },
    primary: {
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
      borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--border-subtle))',
    },
    danger: {
      background: 'rgba(239,68,68,0.08)',
      color: 'var(--error)',
      borderColor: 'rgba(239,68,68,0.16)',
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
      className={`flex min-h-9 min-w-0 items-center justify-center gap-1 rounded-[16px] px-2 py-2 text-[11px] font-semibold transition-all ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5'} ${className}`}
      style={styleByTone}
    >
      {icon}
      <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
    </button>
  );
};

const ProjectCard: React.FC<Props> = ({
  project, onDeleteResult, onDeleteProject, onRegenerate, onConfirmStoryboardImaging, onFission, onRecover, onConfirmPlan, onUpdatePlans, onDeletePlan, onRegeneratePlans, onCancelTask, onImportStoryboardToGeneration, pendingActionKeys, compact = false, showGenerationProgress = true,
}) => {
  const [detailOpen, setDetailOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [translationCompareOpen, setTranslationCompareOpen] = useState(false);
  const [translationCompareIndex, setTranslationCompareIndex] = useState(0);
  const [detailViewMode, setDetailViewMode] = useState<'single' | 'stack'>(
    project.subFeature === 'detail_page' || project.subFeature === 'detail' ? 'stack' : 'single',
  );
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [confirmDeleteResult, setConfirmDeleteResult] = useState<string | null>(null);
  const [fissionDialog, setFissionDialog] = useState<{
    resultId: string;
    title: string;
    mode: 'scene' | 'palette' | 'custom';
    instruction: string;
  } | null>(null);
  const [storyboardRevisionDialog, setStoryboardRevisionDialog] = useState<{
    resultId: string;
    title: string;
    instruction: string;
  } | null>(null);
  const [isPackaging, setIsPackaging] = useState(false);
  const { addToast } = useToast();
  const hasResults = project.results.length > 0;
  const hasPlans = Array.isArray(project.plans) && project.plans.length > 0;
  const visiblePlans = (project.plans || []).filter((plan) => plan.selected);
  const selectedPlanCount = visiblePlans.length;
  const allPlansSelected = Array.isArray(project.plans) && project.plans.length > 0 && visiblePlans.length === project.plans.length;
  const imageResults = project.results.filter((result) => result.imageUrl && result.mediaType !== 'video' && !result.videoUrl);
  const isCompletedMediaResult = (result: GeneratedResult) => result.status === 'completed' && Boolean(result.imageUrl || result.videoUrl);
  const hasGeneratingResult = project.results.some((result) => result.status === 'generating' && !isCompletedMediaResult(result));
  const activePlanIds = new Set([
    ...visiblePlans.map((plan) => plan.id),
    ...(project.selectedPlanId ? [project.selectedPlanId] : []),
  ]);
  const hasMissingSelectedPlanResult = hasPlans && Array.from(activePlanIds).some((planId) => !project.results.some((result) => result.planId === planId && isCompletedMediaResult(result)));
  const projectProgressIncomplete = Number(project.completedCount || 0) < Number(project.taskCount || 0);
  const isProjectActivelyGenerating = project.status === 'generating' && (
    hasGeneratingResult
    || hasMissingSelectedPlanResult
    || (!hasPlans && projectProgressIncomplete)
  );
  const displayProjectStatus: Project['status'] = project.status === 'generating' && !isProjectActivelyGenerating
    ? (hasResults ? 'completed' : 'planning')
    : project.status;
  const st = statusStyle[displayProjectStatus];
  const translationResults = project.module === 'translation' ? project.results : [];
  const isTranslationProject = project.module === 'translation';
  const failedTranslationResults = translationResults.filter((result) => result.status === 'error');
  const canRetryTranslationResult = (result: GeneratedResult) => !isTranslationProject || result.status === 'error';
  const isPendingAction = (key: string) => Boolean(pendingActionKeys?.[key]);
  const getRegenerateActionKey = (resultId: string) => `regenerate:${project.id}:${resultId}`;
  const getFissionActionKey = (resultId: string) => `fission:${project.id}:${resultId}`;
  const isRegeneratePending = (resultId: string) => isPendingAction(getRegenerateActionKey(resultId));
  const isFissionPending = (resultId: string) => isPendingAction(getFissionActionKey(resultId));
  const isConfirmPlanPending = isPendingAction(`confirm-plan:${project.id}`);
  const isStoryboardImagePending = isPendingAction(`storyboard-image:${project.id}`);
  const isLongDetailProject = !isTranslationProject && (project.subFeature === 'detail_page' || project.subFeature === 'detail');
  const allImageUrls = imageResults.map((r) => r.imageUrl);
  const isDiagnosisReport = project.module === 'video' && project.subFeature === 'diagnosis';
  const isStoryboardProject = project.module === 'video' && project.subFeature === 'storyboard';
  const isStoryboardAwaitingImageConfirmation = isStoryboardProject && project.storyboardProjectStatus === 'awaiting_image_confirmation';
  const isCopyTextReport = project.module === 'buyer_show' && project.subFeature === 'copy';
  const isTextReport = isDiagnosisReport || isCopyTextReport;
  const previewResult = project.results.find((result) => isCompletedMediaResult(result)) || project.results[0];
  const textReportResult = project.results[0];
  const textReportTitle = isDiagnosisReport ? '诊断报告' : '纯文案结果';
  const textReportCopyLabel = isDiagnosisReport ? '复制报告' : '复制文案';
  const textReportEmptyText = isDiagnosisReport
    ? (isProjectActivelyGenerating ? '视频诊断进行中' : '暂无诊断结果')
    : (isProjectActivelyGenerating ? '文案生成中' : '暂无文案结果');
  const textReportText = textReportResult?.prompt || textReportEmptyText;
  const creditSummary = getProjectCreditsConsumed(project);
  const handleCopyTaskId = async (taskId: string, event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    const value = String(taskId || '').trim();
    if (!value) return;
    await navigator.clipboard.writeText(value).catch(() => null);
    addToast('任务 ID 已复制', 'success');
  };
  const renderTaskIdChip = (taskId: string, label = '任务 ID', className = '') => (
    <span className={`inline-grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_16px] items-center gap-1 font-mono leading-4 ${className}`} style={{ color: 'var(--text-tertiary)' }} title={taskId}>
      <span className="shrink-0 font-sans">{label}</span>
      <span className="min-w-0 truncate">{taskId}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label={`复制${label}`}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors"
        style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}
        title={`复制完整${label}`}
        onClick={(event) => handleCopyTaskId(taskId, event)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          void handleCopyTaskId(taskId, event);
        }}
      >
        <Copy size={10} />
      </span>
    </span>
  );
  const renderResultUsageMeta = (result: GeneratedResult) => {
    const creditsConsumed = result.status === 'completed' ? normalizeCreditsConsumed(result.creditsConsumed) : 0;
    if (!creditsConsumed && !result.taskId) return null;
    return (
      <div className="mt-1.5 flex min-w-0 max-w-full flex-col items-start gap-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
        {creditsConsumed > 0 && (
          <span className="rounded-full px-2 py-0.5 font-semibold tabular-nums" style={{ background: 'var(--bg-surface)', color: 'var(--accent)' }}>
            本次消耗 {formatCreditsConsumed(creditsConsumed)} 积分
          </span>
        )}
        {result.taskId && (
          renderTaskIdChip(result.taskId)
        )}
      </div>
    );
  };
  const getTranslationRatioLabel = (result: GeneratedResult) =>
    String(result.matchedAspectRatio || result.aspectRatio || 'auto').trim() || 'auto';
  const getTranslationPathLabel = (result: GeneratedResult) =>
    String(result.relativePath || result.fileName || result.id || '未命名文件').trim();
  const renderPlanningTaskId = (className = '') => {
    const planningTaskId = String(project.planningTaskId || '').trim();
    if (!planningTaskId) return null;
    return (
      renderTaskIdChip(planningTaskId, '策划 ID', `text-[10px] ${className}`)
    );
  };
  const getTranslationStatusMeta = (result: GeneratedResult) => {
    if (result.status === 'completed') return { label: 'COMPLETED', color: '#059669', bg: 'rgba(16,185,129,0.10)' };
    if (result.status === 'error') return { label: 'FAILED', color: 'var(--error)', bg: 'rgba(239,68,68,0.08)' };
    return { label: 'GENERATING', color: 'var(--accent)', bg: 'var(--accent-soft)' };
  };
  const findPlanByResult = (result: GeneratedResult | null | undefined, index: number) => {
    if (!result || !Array.isArray(project.plans)) return null;
    return project.plans.find((plan) => plan.id === result.planId) || project.plans[index] || null;
  };

  const getFissionLabel = (mode: 'scene' | 'palette' | 'custom') =>
    mode === 'scene' ? '换场景' : mode === 'palette' ? '换配色' : '自定义';

  const getFissionInstruction = (mode: 'scene' | 'palette' | 'custom') =>
    mode === 'scene'
      ? '在保持当前首图结构、产品主体、卖点层级和排版细节的前提下，仅更换为新的相近场景。'
      : mode === 'palette'
        ? '在保持当前首图结构、产品主体、卖点层级和排版细节的前提下，仅更换整体配色方案和色调氛围。'
        : '';

  const openFissionDialog = (resultId: string, title: string) => {
    setFissionDialog({
      resultId,
      title,
      mode: 'scene',
      instruction: getFissionInstruction('scene'),
    });
  };

  const handleConfirmFission = () => {
    if (!fissionDialog || !onFission) return;
    if (isFissionPending(fissionDialog.resultId)) return;
    const finalInstruction = fissionDialog.instruction.trim();
    if (!finalInstruction) {
      addToast('请先填写继续裂变说明', 'warning');
      return;
    }
    onFission(fissionDialog.resultId, fissionDialog.mode, finalInstruction);
    setFissionDialog(null);
  };

  const handleConfirmStoryboardRevision = () => {
    if (!storyboardRevisionDialog || !onRegenerate) return;
    if (isRegeneratePending(storyboardRevisionDialog.resultId)) return;
    const finalInstruction = storyboardRevisionDialog.instruction.trim();
    if (!finalInstruction) {
      addToast('请先填写修改说明', 'warning');
      return;
    }
    onRegenerate(storyboardRevisionDialog.resultId, finalInstruction);
    setStoryboardRevisionDialog(null);
  };

  const openImage = (resultId: string) => {
    if (project.module === 'translation') {
      const idx = translationResults.findIndex((result) => result.id === resultId);
      if (idx >= 0) {
        setTranslationCompareIndex(idx);
        setTranslationCompareOpen(true);
      }
      return;
    }
    const idx = imageResults.findIndex((result) => result.id === resultId);
    if (idx >= 0) {
      setLightboxIndex(idx);
      setLightboxOpen(true);
    }
  };

  useEffect(() => {
    setDetailViewMode(isLongDetailProject ? 'stack' : 'single');
  }, [isLongDetailProject, project.id]);

  useEffect(() => {
    if (!detailOpen || lightboxOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailOpen(false);
        setTranslationCompareOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [detailOpen, lightboxOpen]);

  const handleCopyPrompt = async (prompt: string) => {
    const value = String(prompt || '');
    let copied = false;
    if (navigator.clipboard?.writeText) {
      copied = await navigator.clipboard.writeText(value).then(() => true).catch(() => false);
    }
    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      try {
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        textarea.remove();
      }
    }
    addToast(copied ? 'Prompt 已复制' : '复制失败，请手动选中文本复制', copied ? 'success' : 'warning');
  };

  const renderPromptCopyButton = (prompt: string, label = '复制 Prompt') => (
    <button
      type="button"
      aria-label="复制 Prompt"
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        void handleCopyPrompt(prompt);
      }}
      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-all hover:-translate-y-0.5"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', boxShadow: 'var(--shadow-soft)' }}
    >
      <Copy size={12} />
    </button>
  );

  const handleDownloadSingle = async (result: GeneratedResult, index: number) => {
    if (!result.imageUrl && !result.videoUrl) {
      addToast('当前结果还没有可下载文件', 'warning');
      return;
    }
    try {
      const { downloadRemoteFile } = await import('../../utils/imageUtils');
      await downloadRemoteFile(
        result.videoUrl || result.imageUrl,
        getDownloadName(project, result, index),
        getResultDownloadTransform(project, result),
      );
      addToast('已开始下载', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '下载失败', 'error');
    }
  };

  const handleDownloadAll = async () => {
    const downloadable = project.results.filter((result) => result.imageUrl || result.videoUrl);
    if (downloadable.length === 0) {
      addToast('当前项目没有可下载结果', 'warning');
      return;
    }
    setIsPackaging(true);
    try {
      const { downloadRemoteFilesAsZip } = await import('../../utils/imageUtils');
      await downloadRemoteFilesAsZip(
        downloadable.map((result, index) => ({
          url: result.videoUrl || result.imageUrl,
          path: getDownloadZipPath(project, result, index),
          transform: getResultDownloadTransform(project, result),
        })),
        `${project.name || 'project'}_${Date.now()}`.replace(/[\\/:*?"<>|\s]+/g, '_'),
      );
      addToast('批量打包已开始下载', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '批量下载失败', 'error');
    } finally {
      setIsPackaging(false);
    }
  };

  const handleExportRetouchToBgSub = async (result: GeneratedResult) => {
    if (!result.imageUrl) {
      addToast('当前精修结果还没有可导出的图片', 'warning');
      return;
    }
    await navigator.clipboard.writeText(result.imageUrl).catch(() => null);
    window.open('https://zh.bgsub.com/webapp/', '_blank');
    addToast('精修图片链接已复制，可在抠图页面粘贴使用', 'success');
  };

  const handleRetryFailedTranslation = () => {
    if (!onRegenerate || failedTranslationResults.length === 0) return;
    const retryableResults = failedTranslationResults.filter((result) => !isRegeneratePending(result.id));
    if (retryableResults.length === 0) {
      addToast('失败项重试已提交，请等待当前任务完成', 'info');
      return;
    }
    retryableResults.forEach((result) => onRegenerate(result.id));
    addToast(`已提交 ${retryableResults.length} 个失败项重试`, 'success');
  };

  const handleToggleAllPlans = () => {
    if (!onUpdatePlans || !Array.isArray(project.plans) || project.plans.length === 0) return;
    onUpdatePlans(
      project.id,
      project.plans.map((plan) => ({ ...plan, selected: !allPlansSelected })),
    );
  };

  const handleStartSelectedPlans = () => {
    if (isConfirmPlanPending || isProjectActivelyGenerating) return;
    if (!onConfirmPlan || !Array.isArray(project.plans)) return;
    const selectedPlans = project.plans.filter((plan) => plan.selected);
    if (selectedPlans.length === 0) {
      addToast('请先选择要生成的方案', 'warning');
      return;
    }
    onConfirmPlan(project.id, selectedPlans);
  };

  const canDeleteProject = Boolean(onDeleteProject);
  const renderDeleteProjectButton = () => canDeleteProject ? (
    <button
      type="button"
      onClick={() => setConfirmDeleteProject(true)}
      className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium"
      style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
    >
      <Trash2 size={13} /> 删除项目
    </button>
  ) : null;

  return (
    <>
      <div
        data-project-id={project.id}
        className={`group overflow-hidden transition-transform hover:-translate-y-0.5 ${compact ? 'rounded-[24px]' : 'rounded-[28px]'}`}
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: compact ? 'none' : 'var(--shadow-card)' }}
      >
        <button
          onClick={() => setDetailOpen(true)}
          className="block w-full text-left transition-colors"
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <div className={`relative overflow-hidden ${compact ? 'aspect-[1.05/1]' : 'aspect-[4/3]'}`} style={{ background: 'var(--bg-base)' }}>
            {isTextReport ? (
              <div className="flex h-full flex-col justify-between p-4" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <FileText size={16} />
                  <span>{textReportTitle}</span>
                </div>
                <p className="line-clamp-6 whitespace-pre-wrap text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                  {textReportText}
                </p>
                <span className="text-[11px]" style={{ color: 'var(--accent)' }}>查看文字详情</span>
              </div>
            ) : hasResults ? renderMedia(previewResult, 'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]') : hasPlans ? (
              <div className="flex h-full flex-col justify-between p-4" style={{ color: 'var(--text-secondary)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      <Sparkles size={15} style={{ color: 'var(--accent)' }} />
                      <span>{isProjectActivelyGenerating ? '生成进行中' : '方案预览'}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                      {project.plans?.[0]?.title || '方案已生成，点击查看并进入生图'}
                    </p>
                  </div>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                    {project.plans?.length || 0}/{project.taskCount || 1}
                  </span>
                </div>
                {renderPlanningTaskId('mt-2')}
                <p className="mt-4 line-clamp-5 whitespace-pre-wrap rounded-[18px] bg-[var(--bg-surface)] px-3 py-2.5 text-[12px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                  {normalizeSchemeText(project.plans?.[0]?.schemeContent)
                    || project.plans?.[0]?.sceneDescription
                    || project.plans?.[0]?.styleDirection
                    || '点击进入查看并生成'}
                </p>
                <span className="text-[11px]" style={{ color: 'var(--accent)' }}>{isProjectActivelyGenerating ? '查看生成进度' : '打开确认生图'}</span>
              </div>
            ) : (
              <div
                className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[12px]"
                style={{ color: project.status === 'error' && project.error ? 'var(--error)' : 'var(--text-tertiary)' }}
              >
                {project.status === 'error' && project.error ? (
                  <>
                    <span className="font-semibold">失败原因</span>
                    <span className="line-clamp-4 whitespace-pre-wrap leading-5">{project.error}</span>
                    {renderPlanningTaskId('mt-1')}
                  </>
                ) : (
                  <>
                    <span>{isProjectActivelyGenerating || project.status === 'planning' ? '处理中' : '暂无结果'}</span>
                    {renderPlanningTaskId('mt-1')}
                  </>
                )}
              </div>
            )}
            <div className={`absolute flex items-center gap-1.5 ${compact ? 'left-2.5 top-2.5' : 'left-3 top-3'}`}>
              <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
              {project.results.length > 1 && <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'rgba(15,23,42,0.44)', color: '#fff' }}>{project.results.length} 个结果</span>}
            </div>
            {showGenerationProgress && isProjectActivelyGenerating ? (
              <div className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: 'rgba(255,255,255,0.2)' }}>
                <div className="h-full rounded-r-full transition-all duration-300" style={{ width: `${Math.max(8, Math.min(100, (project.completedCount / Math.max(project.taskCount, 1)) * 100 || 12))}%`, background: 'var(--accent)' }} />
              </div>
            ) : null}
            {!isTextReport && (
              <div className={`absolute flex items-center justify-center text-white ${compact ? 'bottom-2.5 right-2.5 h-7 w-7 rounded-[16px]' : 'bottom-3 right-3 h-8 w-8 rounded-2xl'}`} style={{ background: 'rgba(15,23,42,0.4)' }}>
                <Maximize2 size={compact ? 13 : 14} />
              </div>
            )}
          </div>

          <div className={compact ? 'p-3' : 'p-4'}>
            <div className="flex items-center gap-2.5">
              <p className={`${compact ? 'text-[13px]' : 'text-[14px]'} truncate font-semibold`} style={{ color: 'var(--text-primary)' }}>{project.name}</p>
            </div>
            <div className={`mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 ${compact ? 'text-[10px]' : ''}`}>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{moduleNames[project.module] || project.module}</span>
              {project.subFeature && (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{subFeatureNames[project.subFeature] || project.subFeature}</span>
              )}
              <span className="text-[11px]" style={{ color: 'var(--text-disabled)' }}>{project.createdAt}</span>
              {hasResults && (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {project.results.length} 个结果
                </span>
              )}
            </div>
            <div className={`flex items-center justify-between border-t ${compact ? 'mt-2 pt-2' : 'mt-3 pt-3'}`} style={{ borderColor: 'var(--border-subtle)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>任务 {project.completedCount}/{project.taskCount}</span>
              <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>{isTextReport ? (isDiagnosisReport ? '查看报告' : '查看文案') : compact ? '详情' : '查看详情'}</span>
            </div>
          </div>
        </button>
      </div>

      {detailOpen && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center p-4" style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(8px)' }} onClick={() => setDetailOpen(false)}>
          <div
            className={`flex w-full max-w-[1040px] flex-col overflow-hidden rounded-[28px] border ${isTranslationProject ? 'h-[88vh] max-h-[88vh]' : 'max-h-[88vh]'}`}
            style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 mb-3 border-b px-4 py-3 sm:px-5" style={{ borderColor: 'var(--border-subtle)', background: 'color-mix(in srgb, var(--bg-base) 94%, transparent)', backdropFilter: 'blur(16px)' }}>
              <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{project.name}</h3>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  <span>{moduleNames[project.module] || project.module}</span>
                  {project.subFeature && <span>{subFeatureNames[project.subFeature] || project.subFeature}</span>}
                  <span>{project.createdAt}</span>
                  <span>任务 {project.completedCount}/{project.taskCount}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {hasPlans && onUpdatePlans && onConfirmPlan && (
                    <>
                      <button
                        type="button"
                        onClick={handleStartSelectedPlans}
                        disabled={isConfirmPlanPending || isProjectActivelyGenerating}
                        className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        <Sparkles size={13} />
                        {isConfirmPlanPending || isProjectActivelyGenerating ? '提交中' : '开始生成'}
                      </button>
                      {!isTextReport && (
                        <button onClick={handleDownloadAll} disabled={isPackaging || !hasResults} className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          <Package size={13} /> {isPackaging ? '打包中' : '批量下载'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleToggleAllPlans}
                        className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium"
                        style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                      >
                        <CheckSquare2 size={13} />
                        {allPlansSelected ? '取消全选' : '全选'}
                      </button>
                      <span className="rounded-full px-2.5 py-1.5 text-[11px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                        已选 {selectedPlanCount}/{project.plans?.length || 0}
                      </span>
                    </>
                  )}
                  {!hasPlans && !isTextReport && (
                    <>
                      {isStoryboardAwaitingImageConfirmation && (
                        <button
                          type="button"
                          onClick={() => onConfirmStoryboardImaging?.(project.id)}
                          disabled={isStoryboardImagePending}
                          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          <Sparkles size={13} />
                          {isStoryboardImagePending ? '提交中' : '确认生图'}
                        </button>
                      )}
                      {isTranslationProject && failedTranslationResults.length > 0 && (
                        <button
                          type="button"
                          onClick={handleRetryFailedTranslation}
                          disabled={failedTranslationResults.every((result) => isRegeneratePending(result.id))}
                          className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
                        >
                          <RefreshCw size={13} />
                          重试失败 ({failedTranslationResults.length})
                        </button>
                      )}
                      <button onClick={handleDownloadAll} disabled={isPackaging || !hasResults} className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-40" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                        <Package size={13} /> {isPackaging ? '打包中' : '批量下载'}
                      </button>
                    </>
                  )}
                  {renderDeleteProjectButton()}
                </div>
                <button onClick={() => setDetailOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                  <X size={14} />
                </button>
              </div>
            </div>
            </div>

            <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
              <section className="mb-4 grid gap-2 rounded-[22px] border p-3 sm:grid-cols-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
                <div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>总积分消耗</p>
                  <p className="mt-1 text-[18px] font-semibold tabular-nums" style={{ color: creditSummary.total > 0 ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {creditSummary.total > 0 ? `${formatCreditsConsumed(creditSummary.total)} 积分` : '暂无记录'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>策划分析</p>
                  <p className="mt-1 text-[12px] font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatCreditsConsumed(creditSummary.projectCredits)} 积分
                  </p>
                  {renderPlanningTaskId('mt-1 inline-flex')}
                </div>
                <div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>成功出图任务</p>
                  <p className="mt-1 text-[12px] font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {formatCreditsConsumed(creditSummary.resultCredits)} 积分
                  </p>
                </div>
              </section>
              {isTextReport ? (
                <section className="space-y-3">
                  <div className="rounded-3xl p-4" style={{ background: 'var(--bg-elevated)' }}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                        <FileText size={16} />
                        <span>{textReportTitle}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt(textReportText)}
                        className="rounded-full px-3 py-1.5 text-[11px] font-medium"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
                      >
                        {textReportCopyLabel}
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-7" style={{ color: 'var(--text-secondary)' }}>
                      {textReportText}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{isDiagnosisReport ? '分析模型' : '生成模型'}</p>
                      <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{textReportResult?.model || '-'}</p>
                    </div>
                    <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>状态</p>
                      <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{st.label}</p>
                    </div>
                    <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                      <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>更新时间</p>
                      <p className="mt-1 text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{textReportResult?.createdAt || project.completedAt || project.createdAt}</p>
                    </div>
                  </div>
                </section>
              ) : hasPlans ? (
                <PlanEditor
                  plans={project.plans || []}
                  results={project.results}
                  projectStatus={displayProjectStatus}
                  selectedPlanId={project.selectedPlanId}
                  subFeature={project.subFeature}
                  planningTaskId={project.planningTaskId}
                  onChange={(plans) => onUpdatePlans?.(project.id, plans)}
                  onConfirm={(plan) => {
                    if (isConfirmPlanPending || isProjectActivelyGenerating) return;
                    onConfirmPlan?.(project.id, plan);
                  }}
                  onCopyPrompt={(prompt) => handleCopyPrompt(prompt)}
                  onCancelGeneration={() => onCancelTask?.(project.id)}
                  onCopyTaskId={(taskId) => void handleCopyTaskId(taskId)}
                  onDownloadResult={(result, index) => handleDownloadSingle(result, index)}
                  onPreviewResult={(resultId) => openImage(resultId)}
                  onRecoverResult={(resultId) => onRecover?.(resultId)}
                  onRequestDeleteResult={(resultId) => setConfirmDeleteResult(resultId)}
                  onDeletePlan={(planId) => onDeletePlan?.(project.id, planId)}
                  onFissionResult={(resultId) => {
                    if (isFissionPending(resultId)) return;
                    const targetResult = project.results.find((item) => item.id === resultId);
                    const targetIndex = project.results.findIndex((item) => item.id === resultId);
                    const targetPlan = findPlanByResult(targetResult, Math.max(targetIndex, 0));
                    openFissionDialog(resultId, targetPlan?.title || project.name);
                  }}
                />
              ) : project.results.length === 0 ? (
                <div
                  className="rounded-2xl border p-8 text-center text-[13px]"
                  style={{
                    borderColor: project.status === 'error' && project.error ? 'rgba(239,68,68,0.18)' : 'var(--border-subtle)',
                    color: project.status === 'error' && project.error ? 'var(--error)' : 'var(--text-tertiary)',
                    background: project.status === 'error' && project.error ? 'rgba(239,68,68,0.04)' : 'transparent',
                  }}
                >
                  {project.status === 'error' && project.error ? (
                    <div className="mx-auto max-w-2xl space-y-2">
                      <p className="text-[13px] font-semibold">失败原因</p>
                      <p className="whitespace-pre-wrap break-words text-[12px] leading-6">{project.error}</p>
                    </div>
                  ) : (
                    '当前项目暂无结果，可继续生成或稍后刷新同步。'
                  )}
                </div>
              ) : isStoryboardProject ? (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>分段任务</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        每段包含宫格分镜图、生图 Prompt 和对应动态视频脚本提示词。
                      </p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      {project.results.length} 段
                    </span>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {project.results.map((result, index) => {
                      const canOpenImage = Boolean(result.imageUrl && result.mediaType !== 'video' && !result.videoUrl);
                      const isGeneratingResult = result.status === 'generating' || (!result.imageUrl && isProjectActivelyGenerating);
                      const promptExpanded = Boolean(expandedPrompts[result.id]);
                      const scriptExpanded = Boolean(expandedPrompts[`${result.id}:script`]);
                      const displayedPrompt = normalizeSchemeText(result.prompt || '无 prompt 记录');
                      const dynamicScriptPrompt = result.dynamicScriptPrompt || '暂无动态视频脚本提示词';
                      const boardIndex = Number.isFinite(result.storyboardBoardIndex) ? Number(result.storyboardBoardIndex) : index;
                      const boardCount = result.storyboardBoardCount || project.results.length;
                      const regeneratePending = isRegeneratePending(result.id);
                      return (
                        <article
                          key={result.id}
                          className="flex min-h-0 flex-col overflow-hidden rounded-[20px] border"
                          style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                                  {result.storyboardBoardTitle || `分段 ${index + 1}`}
                                </h4>
                                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                                  {boardIndex + 1}/{boardCount}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                {result.aspectRatio || 'auto'} · {result.model || 'GPT Image 2'}
                              </p>
                              {renderResultUsageMeta(result)}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <ResultActionButton
                                icon={<ChevronLeft size={12} />}
                                label="上一张"
                                onClick={() => {
                                  if (imageResults.length > 0) {
                                    setLightboxIndex((boardIndex - 1 + imageResults.length) % imageResults.length);
                                    setLightboxOpen(true);
                                  }
                                }}
                              />
                              <ResultActionButton
                                icon={<ChevronRight size={12} />}
                                label="下一张"
                                onClick={() => {
                                  if (imageResults.length > 0) {
                                    setLightboxIndex((boardIndex + 1) % imageResults.length);
                                    setLightboxOpen(true);
                                  }
                                }}
                              />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              if (canOpenImage) openImage(result.id);
                            }}
                            className="flex h-[260px] w-full items-center justify-center"
                            style={{ background: 'var(--bg-base)' }}
                          >
                            {result.imageUrl ? (
                              renderMedia(result, 'h-full w-full object-contain')
                            ) : (
                              <div className="flex flex-col items-center gap-2 text-[11px]" style={{ color: result.status === 'error' ? 'var(--error)' : 'var(--text-tertiary)' }}>
                                <ImagePlus size={18} />
                                <span>{result.error || (isGeneratingResult ? '宫格分镜生成中' : '待生成宫格分镜')}</span>
                              </div>
                            )}
                          </button>

                          <div className="flex flex-1 flex-col gap-2.5 border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="relative overflow-hidden rounded-[16px]" style={{ background: 'var(--bg-surface)' }}>
                              <button
                                type="button"
                                onClick={() => setExpandedPrompts((prev) => ({ ...prev, [result.id]: !prev[result.id] }))}
                                className="flex w-full items-center justify-between px-3 py-2 pr-10 text-left text-[11px] font-semibold"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <span>生图 Prompt</span>
                                <span style={{ color: 'var(--accent)' }}>{promptExpanded ? '收起' : '展开'}</span>
                              </button>
                              {renderPromptCopyButton(displayedPrompt)}
                              <textarea
                                readOnly
                                value={displayedPrompt || '无 prompt 记录'}
                                rows={promptExpanded ? 9 : 4}
                                className="w-full resize-none bg-transparent px-3 pb-3 pr-9 text-[11px] leading-5 outline-none"
                                style={{ color: 'var(--text-secondary)' }}
                              />
                            </div>

                            <div className="relative overflow-hidden rounded-[16px]" style={{ background: 'var(--bg-surface)' }}>
                              <button
                                type="button"
                                onClick={() => setExpandedPrompts((prev) => ({ ...prev, [`${result.id}:script`]: !prev[`${result.id}:script`] }))}
                                className="flex w-full items-center justify-between px-3 py-2 pr-10 text-left text-[11px] font-semibold"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <span>动态视频脚本提示词</span>
                                <span style={{ color: 'var(--accent)' }}>{scriptExpanded ? '收起' : '展开'}</span>
                              </button>
                              {renderPromptCopyButton(dynamicScriptPrompt, '复制脚本')}
                              <textarea
                                readOnly
                                value={dynamicScriptPrompt}
                                rows={scriptExpanded ? 10 : 5}
                                className="w-full resize-none bg-transparent px-3 pb-3 pr-9 text-[11px] leading-5 outline-none"
                                style={{ color: 'var(--text-secondary)' }}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                              <ResultActionButton
                                icon={<Download size={12} />}
                                label="下载"
                                onClick={() => handleDownloadSingle(result, index)}
                              />
                              <ResultActionButton
                                icon={<Film size={12} />}
                                label="导入至生成"
                                tone="primary"
                                disabled={!project.storyboardSourceProject || !onImportStoryboardToGeneration}
                                onClick={() => {
                                  if (!project.storyboardSourceProject || !onImportStoryboardToGeneration) {
                                    addToast('当前分镜项目数据不完整，无法导入', 'warning');
                                    return;
                                  }
                                  onImportStoryboardToGeneration(project.storyboardSourceProject);
                                }}
                              />
                              {onRegenerate ? (
                                <ResultActionButton
                                  icon={<RefreshCw size={12} />}
                                  label={isStoryboardAwaitingImageConfirmation ? '待确认' : regeneratePending ? '提交中' : isGeneratingResult ? '生成中' : '重生成'}
                                  tone="primary"
                                  disabled={isStoryboardAwaitingImageConfirmation || regeneratePending || isGeneratingResult}
                                  onClick={() => {
                                    if (isStoryboardAwaitingImageConfirmation || regeneratePending || isGeneratingResult) return;
                                    onRegenerate(result.id);
                                  }}
                                />
                              ) : <div />}
                              {onRegenerate ? (
                                <ResultActionButton
                                  icon={<Sparkles size={12} />}
                                  label={isStoryboardAwaitingImageConfirmation ? '待确认' : regeneratePending ? '提交中' : '修改'}
                                  tone="primary"
                                  disabled={isStoryboardAwaitingImageConfirmation || regeneratePending || isGeneratingResult}
                                  onClick={() => {
                                    if (isStoryboardAwaitingImageConfirmation || regeneratePending || isGeneratingResult) return;
                                    setStoryboardRevisionDialog({
                                      resultId: result.id,
                                      title: result.storyboardBoardTitle || `分段 ${index + 1}`,
                                      instruction: '',
                                    });
                                  }}
                                />
                              ) : <div />}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : isTranslationProject ? (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>结果列表</p>
                      <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        点击查看可打开原图与生成图的大图对比，批量下载会保留文件夹结构。
                      </p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      {translationResults.length} 个文件
                    </span>
                  </div>

                  <div className="max-h-[calc(86vh-210px)] overflow-y-auto rounded-[24px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                    <div className="hidden grid-cols-[92px_minmax(0,1fr)_96px_110px_150px] gap-3 border-b px-4 py-2 text-[11px] font-semibold lg:grid" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-tertiary)' }}>
                      <span>生成对照</span>
                      <span>文件路径</span>
                      <span>画面比例</span>
                      <span>状态</span>
                      <span className="text-right">操作</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                      {translationResults.map((result, index) => {
                        const sourceUrl = result.sourcePreviewUrl || result.sourceUrl || '';
                        const pathLabel = getTranslationPathLabel(result);
                        const statusMeta = getTranslationStatusMeta(result);
                        const canPreview = Boolean(sourceUrl || result.imageUrl || result.error || result.prompt);
                        const hasOutput = Boolean(result.imageUrl || result.videoUrl);
                        const regeneratePending = isRegeneratePending(result.id);
                        return (
                          <article
                            key={result.id}
                            className="grid gap-3 px-4 py-2.5 lg:grid-cols-[92px_minmax(0,1fr)_96px_110px_150px] lg:items-center"
                          >
                            <button
                              type="button"
                              onClick={() => canPreview && openImage(result.id)}
                              className="grid h-14 w-[92px] grid-cols-2 overflow-hidden rounded-[16px] border"
                              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
                            >
                              <div className="border-r" style={{ borderColor: 'var(--border-subtle)' }}>
                                {sourceUrl ? <img src={sourceUrl} alt="原图" className="h-full w-full object-contain" /> : <div className="h-full w-full" />}
                              </div>
                              <div>
                                {result.imageUrl ? (
                                  <img src={result.imageUrl} alt="生成结果" className="h-full w-full object-contain" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                    {result.status === 'error' ? '失败' : '生成中'}
                                  </div>
                                )}
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => canPreview && openImage(result.id)}
                              className="flex min-h-14 min-w-0 flex-col justify-center text-left"
                            >
                              <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {pathLabel}
                              </p>
                              {renderResultUsageMeta(result)}
                            </button>

                            <div className="flex items-center gap-2 lg:block">
                              <span className="lg:hidden text-[11px]" style={{ color: 'var(--text-tertiary)' }}>画面比例</span>
                              <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                                {getTranslationRatioLabel(result)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 lg:block">
                              <span className="lg:hidden text-[11px]" style={{ color: 'var(--text-tertiary)' }}>状态</span>
                              <span className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: statusMeta.bg, color: statusMeta.color }}>
                                {statusMeta.label}
                              </span>
                            </div>

                            <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                              <ResultActionButton
                                icon={<Maximize2 size={12} />}
                                label="查看"
                                onClick={() => openImage(result.id)}
                              />
                              {result.status === 'completed' && hasOutput ? (
                                <ResultActionButton
                                  icon={<Download size={12} />}
                                  label="下载"
                                  tone="primary"
                                  onClick={() => handleDownloadSingle(result, index)}
                                />
                              ) : result.status === 'error' && onRegenerate ? (
                                <ResultActionButton
                                  icon={<RefreshCw size={12} />}
                                  label={regeneratePending ? '提交中' : '重试'}
                                  tone="danger"
                                  disabled={regeneratePending}
                                  onClick={() => onRegenerate(result.id)}
                                />
                              ) : (
                                <span className="inline-flex min-h-9 items-center rounded-[16px] px-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                  等待结果
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                </section>
              ) : (
                <div className="space-y-3">
                  <section>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {isLongDetailProject ? (detailViewMode === 'stack' ? '长页审阅' : '单屏对照') : '多图对照'}
                        </p>
                        {isLongDetailProject ? (
                          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                            {detailViewMode === 'stack' ? '上下拼合预览' : '多图对照'}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {isLongDetailProject && (
                          <div className="inline-flex rounded-full p-1" style={{ background: 'var(--bg-elevated)' }}>
                            {[
                              ['single', '单屏对照'],
                              ['stack', '长页审阅'],
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setDetailViewMode(value as 'single' | 'stack')}
                                className="rounded-full px-2.5 py-1.5 text-[11px] font-medium"
                                style={{
                                  background: detailViewMode === value ? 'var(--bg-surface)' : 'transparent',
                                  color: detailViewMode === value ? 'var(--accent)' : 'var(--text-secondary)',
                                  boxShadow: detailViewMode === value ? 'var(--shadow-card)' : 'none',
                                }}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                        <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                          {project.results.length} 个结果
                        </span>
                      </div>
                    </div>
                    {detailViewMode === 'stack' && isLongDetailProject ? (
                      <div className="grid max-h-[620px] gap-4 overflow-y-auto lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                        <div className="flex flex-col gap-4">
                          {project.results.map((result, index) => {
                            const hasResult = Boolean(result.imageUrl || result.videoUrl);
                            const isGeneratingResult = !hasResult && (isProjectActivelyGenerating || result.status === 'generating');
                            const promptExpanded = Boolean(expandedPrompts[result.id]);
                            const matchedPlan = findPlanByResult(result, index);
                            const displayedPrompt = normalizeSchemeText(matchedPlan?.schemeContent || result.prompt || '无 prompt 记录');
                            const resultMeta: string[] = [];
                            if (result.aspectRatio && result.aspectRatio !== 'auto') resultMeta.push(result.aspectRatio);
                            if (result.createdAt) resultMeta.push(result.createdAt);
                            const regeneratePending = isRegeneratePending(result.id);

                            return (
                              <section
                                key={result.id}
                                className="rounded-[24px] border p-4"
                                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                              >
                                <div className="mb-3 flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h4 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {matchedPlan?.title || `#${index + 1}`}
                                      </h4>
                                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                                        #{index + 1}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                      {hasResult ? '已出图' : isGeneratingResult ? '生成中' : '待生成'}
                                    </p>
                                    {renderResultUsageMeta(result)}
                                  </div>
                                  <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                                    {resultMeta[0] || 'auto'}
                                  </span>
                                </div>

                                <div className="relative overflow-hidden rounded-[18px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                                  <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                    <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>策划 Prompt</div>
                                    <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>可直接修改后再生成</div>
                                  </div>
                                  {renderPromptCopyButton(displayedPrompt)}
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPrompts((prev) => ({ ...prev, [result.id]: !prev[result.id] }))}
                                    className="flex w-full items-center justify-between px-3 py-2 pr-10 text-left text-[11px] font-medium"
                                    style={{ color: 'var(--text-secondary)' }}
                                  >
                                    <span>{promptExpanded ? '收起 Prompt' : '展开 Prompt'}</span>
                                    <span style={{ color: 'var(--accent)' }}>{promptExpanded ? '收起' : '展开'}</span>
                                  </button>
                                  <textarea
                                    readOnly
                                    value={displayedPrompt || '无 prompt 记录'}
                                    rows={promptExpanded ? 12 : 6}
                                    className="w-full resize-none bg-transparent px-3 pb-3 pr-9 text-[12px] leading-6 outline-none scrollbar-hide"
                                    style={{ color: 'var(--text-secondary)' }}
                                  />
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-1.5">
                                  <ResultActionButton
                                    icon={<Download size={12} />}
                                    label="下载"
                                    onClick={() => handleDownloadSingle(result, index)}
                                  />
                                  {isGeneratingResult && onCancelTask ? (
                                    <ResultActionButton
                                      icon={<Square size={12} />}
                                      label="中断"
                                      tone="danger"
                                      onClick={() => onCancelTask(project.id)}
                                    />
                                  ) : hasResult ? (
                                    <ResultActionButton
                                      icon={<Sparkles size={12} />}
                                      label="修改"
                                      onClick={() => {}}
                                      disabled
                                    />
                                  ) : (
                                    <ResultActionButton
                                      icon={<Square size={12} />}
                                      label="中断"
                                      onClick={() => {}}
                                      disabled
                                    />
                                  )}
                                  <ResultActionButton
                                    icon={<RotateCcw size={12} />}
                                    label="找回"
                                    onClick={() => onRecover?.(result.id)}
                                  />
                                  {onRegenerate && canRetryTranslationResult(result) ? (
                                    <ResultActionButton
                                      icon={<Sparkles size={12} />}
                                      label={regeneratePending ? '提交中' : isTranslationProject ? '重试' : (isGeneratingResult ? '生成中' : '重生成')}
                                      tone="primary"
                                      disabled={regeneratePending || isGeneratingResult}
                                      onClick={() => onRegenerate(result.id)}
                                    />
                                  ) : (
                                    <div />
                                  )}
                                </div>

                                {onDeleteResult && (
                                  <ResultActionButton
                                    icon={<Trash2 size={12} />}
                                    label="删除"
                                    tone="danger"
                                    className="mt-1 w-full"
                                    onClick={() => {
                                      if (hasResult) {
                                        setConfirmDeleteResult(result.id);
                                      }
                                    }}
                                  />
                                )}
                              </section>
                            );
                          })}
                        </div>

                        <div className="overflow-hidden rounded-[24px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
                          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div>
                              <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>右侧图片</div>
                              <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>上下图无缝衔接，按左侧顺序连续展示</div>
                            </div>
                            <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                              {project.results.length} 个结果
                            </span>
                          </div>
                          <div className="flex flex-col">
                            {project.results.map((result, index) => {
                              const hasResult = Boolean(result.imageUrl || result.videoUrl);
                              const isGeneratingResult = !hasResult && (isProjectActivelyGenerating || result.status === 'generating');
                              const canOpenImage = Boolean(result.imageUrl && result.mediaType !== 'video' && !result.videoUrl);
                              return (
                                <button
                                  key={result.id}
                                  type="button"
                                  disabled={!canOpenImage}
                                  onClick={() => {
                                    if (canOpenImage) openImage(result.id);
                                  }}
                                  className="relative flex min-h-[540px] items-center justify-center border-b last:border-b-0"
                                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
                                >
                                  <div className="absolute left-4 top-4 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white">
                                    #{index + 1}
                                  </div>
                                  <div className="absolute right-4 top-4 rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'rgba(15,23,42,0.45)', color: '#fff' }}>
                                    {hasResult ? '生成结果' : isGeneratingResult ? '生成中' : '待生成'}
                                  </div>
                                  {hasResult ? (
                                    renderMedia(result, 'max-h-[540px] w-full object-contain')
                                  ) : (
                                    <div className="flex flex-col items-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                      <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--bg-surface)' }}>
                                        <ImagePlus size={18} />
                                      </div>
                                      <span>{isGeneratingResult ? '生成中' : '待生成图'}</span>
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3">
                        {project.results.map((result, index) => {
                          const canOpenImage = isTranslationProject
                            ? Boolean(result.sourceUrl || result.sourcePreviewUrl || result.imageUrl)
                            : Boolean(result.imageUrl && result.mediaType !== 'video' && !result.videoUrl);
                          const promptExpanded = Boolean(expandedPrompts[result.id]);
                          const matchedPlan = findPlanByResult(result, index);
                          const displayedPrompt = normalizeSchemeText(matchedPlan?.schemeContent || result.prompt || '无 prompt 记录');
                          const hasResult = Boolean(result.imageUrl || result.videoUrl);
                          const isGeneratingResult = !hasResult && (result.status === 'generating' || isProjectActivelyGenerating);
                          const resultMeta: string[] = [];
                          if (result.aspectRatio && result.aspectRatio !== 'auto') resultMeta.push(result.aspectRatio);
                          if (result.createdAt) resultMeta.push(result.createdAt);
                          const regeneratePending = isRegeneratePending(result.id);
                          return (
                            <article
                              key={result.id}
                              className="flex min-h-0 flex-col overflow-hidden rounded-2xl"
                              style={{
                                background: 'var(--bg-elevated)',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (canOpenImage) openImage(result.id);
                                }}
                                className="block w-full"
                              >
                                {isTranslationProject ? (
                                  <div className="grid h-[210px] w-full grid-cols-2 overflow-hidden">
                                    <div className="relative border-r" style={{ borderColor: 'color-mix(in srgb, var(--border-subtle) 70%, transparent)', background: 'var(--bg-base)' }}>
                                      {result.sourcePreviewUrl || result.sourceUrl ? (
                                        <img
                                          src={result.sourcePreviewUrl || result.sourceUrl}
                                          alt={`${result.fileName || 'source'} original`}
                                          className="h-full w-full object-contain"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      ) : (
                                        <div className="flex h-full items-center justify-center text-[11px]" style={{ color: 'var(--text-tertiary)' }}>原图待恢复</div>
                                      )}
                                      <div className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white">原图</div>
                                    </div>
                                    <div className="relative" style={{ background: 'var(--bg-base)' }}>
                                      {renderMedia(result, 'h-full w-full object-contain')}
                                      <div className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white">结果</div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="relative">
                                    {renderMedia(result, 'h-[210px] w-full object-contain')}
                                    <div className="absolute left-3 top-3 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white">#{index + 1}</div>
                                  </div>
                                )}
                              </button>
                                <div className="flex flex-1 flex-col gap-2 border-t p-2.5" style={{ borderColor: 'color-mix(in srgb, var(--border-subtle) 70%, transparent)' }}>
                                  {resultMeta.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                                      {resultMeta.map((meta) => (
                                        <span key={meta} className="rounded-full px-2 py-1" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                                          {meta}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                  {renderResultUsageMeta(result)}
                                <div className="relative overflow-hidden rounded-[16px]" style={{ background: 'var(--bg-surface)' }}>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedPrompts((prev) => ({ ...prev, [result.id]: !prev[result.id] }))}
                                    className="flex w-full items-center justify-between px-2.5 py-1.75 pr-10 text-left text-[11px] font-semibold"
                                    style={{ color: 'var(--text-secondary)' }}
                                  >
                                    <span>生图 Prompt</span>
                                    <span style={{ color: 'var(--accent)' }}>{promptExpanded ? '收起' : '展开'}</span>
                                  </button>
                                  {renderPromptCopyButton(displayedPrompt)}
                                  <p className={`${promptExpanded ? 'max-h-36' : 'max-h-16'} overflow-y-auto whitespace-pre-wrap px-2.5 pb-2 pr-9 pt-1 text-[11px] leading-relaxed`} style={{ color: 'var(--text-secondary)' }}>
                                    {displayedPrompt || '无 prompt 记录'}
                                  </p>
                                </div>
                                <div className="space-y-1.5">
                                  <div className="grid grid-cols-4 gap-1">
                                    <ResultActionButton
                                      icon={<Download size={12} />}
                                      label="下载"
                                      onClick={() => handleDownloadSingle(result, index)}
                                    />
                                    {isGeneratingResult && onCancelTask ? (
                                      <ResultActionButton
                                        icon={<Square size={12} />}
                                        label="中断"
                                        tone="danger"
                                        onClick={() => onCancelTask(project.id)}
                                      />
                                    ) : hasResult ? (
                                      <ResultActionButton
                                        icon={<Sparkles size={12} />}
                                        label="修改"
                                        onClick={() => {}}
                                        disabled
                                      />
                                    ) : (
                                      <ResultActionButton
                                        icon={<Square size={12} />}
                                        label="中断"
                                        onClick={() => {}}
                                        disabled
                                      />
                                    )}
                                    {onRecover ? (
                                      <ResultActionButton
                                        icon={<RotateCcw size={12} />}
                                        label="找回"
                                        onClick={() => onRecover(result.id)}
                                      />
                                    ) : (
                                      <div />
                                    )}
                                  {onRegenerate && canRetryTranslationResult(result) ? (
                                    <ResultActionButton
                                      icon={<RefreshCw size={12} />}
                                      label={regeneratePending ? '提交中' : isTranslationProject ? '重试' : '重生成'}
                                      tone="primary"
                                      disabled={regeneratePending || isGeneratingResult}
                                      onClick={() => onRegenerate(result.id)}
                                    />
                                  ) : (
                                      <div />
                                    )}
                                  </div>
                                  {project.module === 'retouch' && result.status === 'completed' && result.imageUrl && (
                                    <ResultActionButton
                                      icon={<Scissors size={12} />}
                                      label="导出抠图"
                                      className="w-full"
                                      onClick={() => handleExportRetouchToBgSub(result)}
                                    />
                                  )}
                                  {onDeleteResult && (
                                    <ResultActionButton
                                      icon={<Trash2 size={12} />}
                                      label="删除"
                                      tone="danger"
                                      className="w-full"
                                      onClick={() => setConfirmDeleteResult(result.id)}
                                    />
                                  )}
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      <ImageLightbox
        open={lightboxOpen}
        images={allImageUrls}
        currentIndex={lightboxIndex}
        onDownloadCurrent={() => {
          const currentResult = imageResults[lightboxIndex];
          if (currentResult) {
            void handleDownloadSingle(currentResult, lightboxIndex);
          }
        }}
        onClose={() => setLightboxOpen(false)}
        onPrev={() => setLightboxIndex((i) => (i - 1 + allImageUrls.length) % allImageUrls.length)}
        onNext={() => setLightboxIndex((i) => (i + 1) % allImageUrls.length)}
      />

      {translationCompareOpen && translationResults.length > 0 && (() => {
        const result = translationResults[translationCompareIndex] || translationResults[0];
        const sourceUrl = result.sourcePreviewUrl || result.sourceUrl || '';
        const ratioLabel = getTranslationRatioLabel(result);
        const pathLabel = getTranslationPathLabel(result);
        return (
          <div
            className="fixed inset-0 z-[520] flex items-center justify-center px-6 py-8"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
            onClick={() => setTranslationCompareOpen(false)}
          >
            <div
              className="flex h-[86vh] max-h-[86vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[28px] border"
              style={{ background: 'var(--bg-surface)', borderColor: 'rgba(255,255,255,0.16)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      效果对比确认
                    </h3>
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                      #{translationCompareIndex + 1}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                    <span className="truncate">文件：{pathLabel}</span>
                    <span>比例：{ratioLabel}</span>
                    <span>{result.status === 'error' ? '失败可重试' : '完成后可下载'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {result.status === 'completed' && result.imageUrl ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownloadSingle(result, translationCompareIndex);
                      }}
                      className="flex h-9 items-center gap-2 rounded-[18px] px-3 text-[12px] font-medium"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Download size={16} />
                      下载
                    </button>
                  ) : result.status === 'error' && onRegenerate ? (
                    <button
                      type="button"
                      disabled={isRegeneratePending(result.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isRegeneratePending(result.id)) return;
                        onRegenerate(result.id);
                        setTranslationCompareOpen(false);
                      }}
                      className="flex h-9 items-center gap-2 rounded-[18px] px-3 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--error)' }}
                    >
                      <RefreshCw size={16} />
                      {isRegeneratePending(result.id) ? '提交中' : '重试'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setTranslationCompareOpen(false);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-[18px]"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-2">
                <section className="flex min-h-[320px] flex-col border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                    <span className="text-[12px] font-semibold">原图</span>
                    <span className="max-w-[260px] truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{pathLabel}</span>
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center p-3" style={{ background: 'var(--bg-base)' }}>
                    {sourceUrl ? (
                      <img src={sourceUrl} alt="原图" className="max-h-[68vh] w-full object-contain" />
                    ) : (
                      <div className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>原图地址缺失</div>
                    )}
                  </div>
                </section>

                <section className="flex min-h-[320px] flex-col">
                  <div className="flex items-center justify-between px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                    <span className="text-[12px] font-semibold">生成结果</span>
                    <span className="text-[11px]" style={{ color: result.status === 'error' ? 'var(--error)' : 'var(--text-tertiary)' }}>
                      {result.status === 'completed' ? '已完成' : result.status === 'error' ? '失败' : '生成中'}
                    </span>
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center p-3" style={{ background: 'var(--bg-base)' }}>
                    {result.imageUrl ? (
                      <img src={result.imageUrl} alt="生成结果" className="max-h-[68vh] w-full object-contain" />
                    ) : (
                      <div className="max-w-sm whitespace-pre-wrap text-center text-[12px] leading-6" style={{ color: result.status === 'error' ? 'var(--error)' : 'var(--text-tertiary)' }}>
                        {result.error || result.prompt || (result.status === 'error' ? '生成失败，可点击重试' : '结果生成中')}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
            {translationResults.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTranslationCompareIndex((index) => (index - 1 + translationResults.length) % translationResults.length);
                  }}
                  className="absolute left-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[18px]"
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTranslationCompareIndex((index) => (index + 1) % translationResults.length);
                  }}
                  className="absolute right-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[18px]"
                  style={{ background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                >
                  <ChevronRight size={18} />
                </button>
              </>
            ) : null}
          </div>
        );
      })()}

      {/* Confirm delete project */}
      <ConfirmDialog
        open={confirmDeleteProject}
        title="删除项目"
        message={`确定要删除「${project.name}」吗？该项目下的所有图片都会被移除，此操作不可撤销。`}
        onConfirm={() => { onDeleteProject?.(project.id); setConfirmDeleteProject(false); }}
        onCancel={() => setConfirmDeleteProject(false)}
      />

      {/* Confirm delete result */}
      <ConfirmDialog
        open={confirmDeleteResult !== null}
        title="删除图片"
        message="确定要删除这张图片吗？此操作不可撤销。"
        onConfirm={() => { if (confirmDeleteResult) onDeleteResult?.(confirmDeleteResult); setConfirmDeleteResult(null); }}
        onCancel={() => setConfirmDeleteResult(null)}
      />

      {storyboardRevisionDialog ? (
        <div
          className="fixed inset-0 z-[340] flex items-center justify-center p-5"
          style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(10px)' }}
          onClick={() => setStoryboardRevisionDialog(null)}
        >
          <div
            className="w-full max-w-[520px] overflow-hidden rounded-[28px] border"
            style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>修改分镜板</h3>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                    {storyboardRevisionDialog.title} · 会使用当前图和商品素材重新生成
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStoryboardRevisionDialog(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="px-6 py-5">
              <label className="mb-2 block text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>修改说明</label>
              <textarea
                value={storyboardRevisionDialog.instruction}
                onChange={(event) => setStoryboardRevisionDialog((prev) => prev ? { ...prev, instruction: event.target.value } : prev)}
                placeholder="例如：第三格产品角度不对，改成正面；整体光线更亮；保持人物和场景不变"
                className="h-32 w-full resize-none rounded-[18px] border px-4 py-3 text-[13px] leading-6 outline-none"
                style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setStoryboardRevisionDialog(null)}
                className="rounded-[14px] px-4 py-2 text-[12px] font-medium"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmStoryboardRevision}
                disabled={isRegeneratePending(storyboardRevisionDialog.resultId)}
                className="rounded-[14px] px-4 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {isRegeneratePending(storyboardRevisionDialog.resultId) ? '提交中' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {fissionDialog ? (
        <div
          className="fixed inset-0 z-[340] flex items-center justify-center p-5"
          style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(10px)' }}
          onClick={() => setFissionDialog(null)}
        >
          <div
            className="w-full max-w-[520px] overflow-hidden rounded-[28px] border"
            style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>确认生成裂变图</h3>
                  <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                    {fissionDialog.title} · {getFissionLabel(fissionDialog.mode)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFissionDialog(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'scene', label: '换场景', icon: <ImagePlus size={14} /> },
                  { value: 'palette', label: '换配色', icon: <Palette size={14} /> },
                  { value: 'custom', label: '自定义', icon: <Sparkles size={14} /> },
                ].map(({ value, label, icon }) => {
                  const active = fissionDialog.mode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFissionDialog((prev) => prev ? {
                        ...prev,
                        mode: value as 'scene' | 'palette' | 'custom',
                        instruction: prev.mode === value ? prev.instruction : getFissionInstruction(value as 'scene' | 'palette' | 'custom'),
                      } : prev)}
                      className="flex h-10 items-center justify-center gap-2 rounded-[14px] px-3 text-[12px] font-semibold transition-all"
                      style={{
                        background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {icon}
                      {label}
                    </button>
                  );
                })}
              </div>
              <div>
                <label className="mb-2 block text-[12px] font-semibold" style={{ color: 'var(--text-secondary)' }}>继续裂变说明</label>
                <textarea
                  value={fissionDialog.instruction}
                  onChange={(event) => setFissionDialog((prev) => prev ? { ...prev, instruction: event.target.value } : prev)}
                  placeholder="例如：换成浴室场景 / 改成冷调蓝灰配色 / 保持结构但强化洁净科技感"
                  className="h-32 w-full resize-none rounded-[18px] border px-4 py-3 text-[13px] leading-6 outline-none"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                />
                <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  会继承当前结果的产品主体、结构关系、卖点层级和排版细节，只按这里的说明继续裂变。
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setFissionDialog(null)}
                className="rounded-[14px] px-4 py-2 text-[12px] font-medium"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmFission}
                disabled={isFissionPending(fissionDialog.resultId)}
                className="rounded-[14px] px-4 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {isFissionPending(fissionDialog.resultId) ? '提交中' : '确认生成'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default ProjectCard;
