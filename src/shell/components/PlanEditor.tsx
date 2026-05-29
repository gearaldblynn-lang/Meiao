import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Download, FileText, RotateCcw, Sparkles, Square, Trash2 } from 'lucide-react';
import type { GeneratedResult } from '../../ShellMigratedApp';
import { isImeComposing } from '../../utils/ime';
import ConfirmDialog from './ConfirmDialog';

export interface PlanItem {
  id: string;
  title: string;
  sellingPoints: string[];
  sceneDescription: string;
  styleDirection: string;
  colorPalette: string;
  composition: string;
  textLayout: string;
  selected: boolean;
  schemeContent?: string;
  sourceReferenceUrl?: string;
  variationMode?: 'scene' | 'palette' | 'custom';
  variationInstruction?: string;
  editInstruction?: string;
  sourceResultUrl?: string;
}

interface Props {
  plans: PlanItem[];
  results?: GeneratedResult[];
  projectStatus?: 'planning' | 'generating' | 'completed' | 'error';
  selectedPlanId?: string;
  subFeature?: string;
  planningTaskId?: string;
  onChange: (plans: PlanItem[]) => void;
  onConfirm: (plan: PlanItem | PlanItem[]) => void;
  onCopyPrompt?: (prompt: string) => void;
  onDownloadResult?: (result: GeneratedResult, index: number) => void;
  onPreviewResult?: (resultId: string) => void;
  onRecoverResult?: (resultId: string) => void;
  onRequestDeleteResult?: (resultId: string) => void;
  onDeletePlan?: (planId: string) => void;
  onEditResult?: (resultId: string) => void;
  onFissionResult?: (resultId: string) => void;
  isEditResultPending?: (resultId: string) => boolean;
  isFissionResultPending?: (resultId: string) => boolean;
  isConfirmPlanPending?: (planId: string) => boolean;
  onCopyTaskId?: (taskId: string) => void;
  onCancelGeneration?: () => void;
}

const stripSchemeMarkers = (scheme?: string) =>
  String(scheme || '')
    .replace(/\[SCHEME_START\]/g, '')
    .replace(/\[SCHEME_END\]/g, '');

const normalizeSchemeText = (scheme?: string) => stripSchemeMarkers(scheme).trim();

const PlanPromptTextarea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  rows: number;
  className: string;
  style: React.CSSProperties;
}> = ({ value, onChange, rows, className, style }) => {
  const externalValue = stripSchemeMarkers(value);
  const [draft, setDraft] = useState(externalValue);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) {
      setDraft(externalValue);
    }
  }, [externalValue]);

  return (
    <textarea
      value={draft}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        const next = event.currentTarget.value;
        setDraft(next);
        onChange(next);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (!composingRef.current && !isImeComposing(event)) {
          onChange(next);
        }
      }}
      rows={rows}
      className={className}
      style={style}
    />
  );
};

const renderMedia = (result?: GeneratedResult, className = '') => {
  if (!result) {
    return null;
  }
  if (result.mediaType === 'video' || result.videoUrl) {
    const src = result.videoUrl || result.imageUrl;
    return src ? <video src={src} className={className} controls muted playsInline preload="metadata" /> : null;
  }
  return result.imageUrl ? <img src={result.imageUrl} alt={result.prompt} className={className} loading="lazy" decoding="async" /> : null;
};

const stableResultIdentity = (result: GeneratedResult) =>
  String(result.backendJobId || result.taskId || result.id || '').trim();

const sortResultsForSinglePlanDisplay = (results: GeneratedResult[]) => {
  if (results.length <= 1) return results;
  return results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftIdentity = stableResultIdentity(left.result);
      const rightIdentity = stableResultIdentity(right.result);
      if (leftIdentity && rightIdentity && leftIdentity !== rightIdentity) {
        return leftIdentity.localeCompare(rightIdentity);
      }
      if (leftIdentity !== rightIdentity) return leftIdentity ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ result }) => result);
};

const normalizeAspectRatio = (value?: string) => {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'auto') return null;
  const match = raw.match(/(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)/);
  return match ? `${match[1]} / ${match[2]}` : null;
};

const getPlanAspectRatio = (plan: PlanItem, result?: GeneratedResult | null) => {
  const fromResult = normalizeAspectRatio(result?.aspectRatio);
  if (fromResult) return fromResult;
  const schemeText = normalizeSchemeText(plan.schemeContent);
  const fromScheme = normalizeAspectRatio(schemeText.match(/画面比例\s*[:：]\s*([^\n\r]+)/)?.[1]);
  return fromScheme || '3 / 4';
};

const resultStatusStyle: Record<'planning' | 'generating' | 'completed' | 'error', { bg: string; color: string }> = {
  planning: { bg: 'var(--bg-elevated)', color: 'var(--text-tertiary)' },
  generating: { bg: 'var(--accent-soft)', color: 'var(--accent)' },
  completed: { bg: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
  error: { bg: 'rgba(239,68,68,0.06)', color: 'var(--error)' },
};

const normalizeCreditsConsumed = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const formatCreditsConsumed = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
};

const splitTaskIds = (value?: string) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const renderTaskIdChip = (taskId: string, onCopyTaskId?: (taskId: string) => void, label = '任务 ID') => (
  <span className="inline-grid min-w-0 max-w-full grid-cols-[auto_minmax(0,1fr)_16px] items-center gap-1 font-mono leading-4" style={{ color: 'var(--text-tertiary)' }} title={taskId}>
    <span className="shrink-0 font-sans">{label}</span>
    <span className="min-w-0 truncate">{taskId}</span>
    <span
      role="button"
      tabIndex={0}
      aria-label={`复制${label}`}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}
      title={`复制完整${label}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCopyTaskId?.(taskId);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        onCopyTaskId?.(taskId);
      }}
    >
      <Copy size={10} />
    </span>
  </span>
);

const renderResultUsageMeta = (result?: GeneratedResult | null, onCopyTaskId?: (taskId: string) => void) => {
  if (!result) return null;
  const creditsConsumed = result.status === 'completed' ? normalizeCreditsConsumed(result.creditsConsumed) : 0;
  if (!creditsConsumed && !result.taskId) return null;
  return (
    <div className="mt-1.5 flex min-w-0 max-w-full flex-col items-start gap-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
      {creditsConsumed > 0 ? (
        <span className="rounded-full px-2 py-0.5 font-semibold tabular-nums" style={{ background: 'var(--bg-surface)', color: 'var(--accent)' }}>
          生图消耗 {formatCreditsConsumed(creditsConsumed)} 积分
        </span>
      ) : null}
      {result.taskId ? (
        renderTaskIdChip(result.taskId, onCopyTaskId, '生图任务 ID')
      ) : null}
    </div>
  );
};

const ActionButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'primary' | 'danger';
  disabled?: boolean;
  className?: string;
}> = ({ icon, label, onClick, tone = 'neutral', disabled = false, className = '' }) => {
  const toneStyle = {
    neutral: {
      background: 'var(--bg-surface)',
      color: 'var(--text-secondary)',
    },
    primary: {
      background: 'var(--accent-soft)',
      color: 'var(--accent)',
    },
    danger: {
      background: 'rgba(239,68,68,0.08)',
      color: 'var(--error)',
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
      className={`flex items-center justify-center gap-1 rounded-[12px] px-2 py-2 text-[11px] font-semibold transition-all ${disabled ? 'cursor-not-allowed opacity-80' : ''} ${className}`}
      style={disabled ? { ...toneStyle, opacity: 0.82 } : toneStyle}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
};

const PlanEditor: React.FC<Props> = ({
  plans,
  results,
  projectStatus = 'planning',
  subFeature,
  planningTaskId,
  onChange,
  onConfirm,
  onCopyPrompt,
  onDownloadResult,
  onPreviewResult,
  onRecoverResult,
  onRequestDeleteResult,
  onDeletePlan,
  onEditResult,
  onFissionResult,
  isEditResultPending,
  isFissionResultPending,
  isConfirmPlanPending,
  onCopyTaskId,
  onCancelGeneration,
}) => {
  const [expandedPromptIds, setExpandedPromptIds] = useState<Record<string, boolean>>({});
  const [pendingDeletePlan, setPendingDeletePlan] = useState<{ id: string; title: string } | null>(null);
  const [planningIdsExpanded, setPlanningIdsExpanded] = useState(false);
  const resultHasVisibleTaskId = (result?: GeneratedResult | null) => Boolean(String(result?.taskId || '').trim());
  const resultIsActivelyGenerating = (result?: GeneratedResult | null) => Boolean(result && result.status === 'generating' && resultHasVisibleTaskId(result));
  const activeGeneratingResult = (results || []).find((result) => result.status === 'generating' && result.planId && resultHasVisibleTaskId(result));
  const activeGeneratingPlanId = projectStatus === 'generating' ? (activeGeneratingResult?.planId || null) : null;
  const shouldShowPerPlanGenerating = Boolean(activeGeneratingPlanId);
  const isDetailProject = subFeature === 'detail_page' || subFeature === 'detail';
  const planningTaskIds = splitTaskIds(planningTaskId);

  const handleSchemeContentChange = (id: string, nextContent: string) => {
    onChange(plans.map((p) => (p.id === id ? { ...p, schemeContent: nextContent } : p)));
  };

  const renderPromptCopyButton = (prompt: string) => (
    <button
      type="button"
      aria-label="复制 Prompt"
      title="复制 Prompt"
      onClick={(event) => {
        event.stopPropagation();
        onCopyPrompt?.(prompt);
      }}
      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full transition-all hover:-translate-y-0.5"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', boxShadow: 'var(--shadow-soft)' }}
    >
      <Copy size={12} />
    </button>
  );

  const findResultsForPlan = (plan: PlanItem, index: number) => {
    if (!results || results.length === 0) return [];
    const byPlanId = results.filter((result) => result.planId === plan.id);
    if (byPlanId.length > 0) return sortResultsForSinglePlanDisplay(byPlanId);
    const hasMappedResults = results.some((result) => Boolean(result.planId));
    return hasMappedResults ? [] : (results[index] ? [results[index]] : []);
  };

  const findResult = (plan: PlanItem, index: number) => findResultsForPlan(plan, index)?.[0] || null;

  const gridPlanRows = plans.flatMap((plan, index) => {
    const matchedResults = findResultsForPlan(plan, index) || [];
    if (matchedResults.length === 0) {
      return [{ plan, index, result: null as GeneratedResult | null, resultOrdinal: 0, resultCount: 1 }];
    }
    return matchedResults.map((result, resultOrdinal) => ({
      plan,
      index,
      result,
      resultOrdinal,
      resultCount: matchedResults.length,
    }));
  });

  const renderGridPlanCard = (
    plan: PlanItem,
    index: number,
    resultOverride?: GeneratedResult | null,
    resultOrdinal = 0,
    resultCount = 1,
  ) => {
    const schemeText = normalizeSchemeText(plan.schemeContent);
    const result = resultOverride === undefined ? findResult(plan, index) : resultOverride;
    const hasResult = Boolean(result && (result.imageUrl || result.videoUrl));
    const hasErrorResult = result?.status === 'error';
    const isPlanSubmitPending = Boolean(isConfirmPlanPending?.(plan.id));
    const isGenerating = !hasResult && !hasErrorResult && (isPlanSubmitPending || resultIsActivelyGenerating(result) || activeGeneratingPlanId === plan.id);
    const isQueued = !hasResult && shouldShowPerPlanGenerating && plan.selected && activeGeneratingPlanId !== plan.id;
    const confirmLabel = hasErrorResult ? '重试' : hasResult ? '重生成' : '生成';
    const isPromptExpanded = Boolean(expandedPromptIds[plan.id]);
    const isFissionEnabled = subFeature === 'first_image';
    const statusLabel = hasResult ? '已出图' : hasErrorResult ? '生成失败' : isGenerating ? '生成中' : plan.selected ? '待生成' : '未选中';
    const canOpenPreview = Boolean(result && result.imageUrl && result.mediaType !== 'video' && !result.videoUrl);
    const canRecoverResult = Boolean(result?.id && onRecoverResult && (hasResult || result?.taskId));
    const isEditPending = Boolean(result?.id && isEditResultPending?.(result.id));
    const isFissionPending = Boolean(result?.id && isFissionResultPending?.(result.id));

    return (
      <article
        key={`${plan.id}:${result?.id || resultOrdinal}`}
        className="flex min-h-0 flex-col overflow-hidden rounded-2xl border"
        style={{
          borderColor: plan.selected ? 'var(--accent)' : 'var(--border-subtle)',
          background: 'var(--bg-elevated)',
          animation: `fade-in-up 0.3s ease ${index * 0.08}s both`,
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (canOpenPreview && result) onPreviewResult?.(result.id);
          }}
          className="block w-full text-left"
        >
          <div className="relative overflow-hidden aspect-[4/3]" style={{ background: 'var(--bg-base)' }}>
            {hasResult ? (
              <>
                {renderMedia(result || undefined, 'h-full w-full object-contain')}
                <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: resultStatusStyle.completed.bg, color: resultStatusStyle.completed.color }}>
                    {statusLabel}
                  </span>
                  {result?.aspectRatio ? (
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'rgba(15,23,42,0.44)', color: '#fff' }}>
                      {result.aspectRatio}
                    </span>
                  ) : null}
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'rgba(15,23,42,0.44)', color: '#fff' }}>
                      #{index + 1}
                    </span>
                    {resultCount > 1 ? (
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'rgba(15,23,42,0.44)', color: '#fff' }}>
                        结果 {resultOrdinal + 1}/{resultCount}
                      </span>
                    ) : null}
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--bg-surface)' }}>
                  <Square size={18} />
                </div>
                <span>{hasErrorResult ? '生成失败' : isGenerating ? '生成中' : isQueued ? '待生成' : '待生成图'}</span>
                {hasErrorResult && result?.error ? (
                  <span className="max-w-[82%] truncate" style={{ color: 'var(--error)' }}>{result.error}</span>
                ) : null}
              </div>
            )}
          </div>
        </button>

        <div className="flex flex-1 flex-col gap-2 border-t p-2.5" style={{ borderColor: 'color-mix(in srgb, var(--border-subtle) 70%, transparent)' }}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {plan.title}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {statusLabel}
              </p>
              {renderResultUsageMeta(result, onCopyTaskId)}
            </div>
            <button
              type="button"
              onClick={() => onChange(plans.map((p) => (p.id === plan.id ? { ...p, selected: !p.selected } : p)))}
              className="rounded-full px-2.5 py-1 text-[10px] font-medium"
              style={{ background: plan.selected ? 'var(--accent-soft)' : 'var(--bg-surface)', color: plan.selected ? 'var(--accent)' : 'var(--text-tertiary)' }}
            >
              {plan.selected ? '已选中' : '未选中'}
            </button>
          </div>

          <div className="relative overflow-hidden rounded-[16px]" style={{ background: 'var(--bg-surface)' }}>
            <button
              type="button"
              onClick={() => setExpandedPromptIds((prev) => ({ ...prev, [plan.id]: !prev[plan.id] }))}
              className="flex w-full items-center justify-between px-2.5 py-1.75 pr-10 text-left text-[11px] font-semibold"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span>策划 Prompt</span>
              <span style={{ color: 'var(--accent)' }}>{isPromptExpanded ? '收起' : '展开'}</span>
            </button>
            {renderPromptCopyButton(schemeText)}
            <PlanPromptTextarea
              value={plan.schemeContent || ''}
              onChange={(nextContent) => handleSchemeContentChange(plan.id, nextContent)}
              rows={isPromptExpanded ? 10 : 4}
              className={`w-full resize-none bg-transparent px-2.5 pb-2 pr-9 pt-1 text-[12px] leading-6 outline-none scrollbar-hide ${isPromptExpanded ? 'min-h-[210px]' : 'min-h-[88px]'}`}
              style={{ color: 'var(--text-secondary)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <ActionButton
              icon={<Download size={12} />}
              label="下载"
              onClick={() => result && onDownloadResult?.(result, index)}
              disabled={!hasResult}
            />
            {isGenerating && onCancelGeneration ? (
              <ActionButton
                icon={<Square size={12} />}
                label="中断"
                tone="danger"
                onClick={onCancelGeneration}
              />
            ) : hasResult ? (
              <ActionButton
                icon={<Sparkles size={12} />}
                label={isEditPending ? '提交中' : '修改'}
                onClick={() => result?.id && onEditResult?.(result.id)}
                disabled={!result?.id || !onEditResult || isEditPending}
              />
            ) : (
              <ActionButton
                icon={<Square size={12} />}
                label="中断"
                onClick={() => {}}
                disabled
              />
            )}
            <ActionButton
              icon={<RotateCcw size={12} />}
              label="找回"
              onClick={() => result?.id && onRecoverResult?.(result.id)}
              disabled={!canRecoverResult}
            />
            <ActionButton
              icon={<Sparkles size={12} />}
              label={isPlanSubmitPending ? '提交中' : isGenerating ? '生成中' : confirmLabel}
              tone="primary"
              onClick={() => onConfirm(plan)}
              disabled={isGenerating}
            />
          </div>

          {(onRequestDeleteResult || isFissionEnabled) ? (
            <div className={`grid gap-1.5 ${isFissionEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {isFissionEnabled ? (
                <ActionButton
                  icon={<Sparkles size={12} />}
                  label={isFissionPending ? '提交中' : '裂变'}
                  tone="primary"
                  onClick={() => result?.id && onFissionResult?.(result.id)}
                  disabled={!hasResult || isFissionPending}
                />
              ) : null}
              {onRequestDeleteResult ? (
                <ActionButton
                  icon={<Trash2 size={12} />}
                  label="删除"
                  tone="danger"
                  onClick={() => {
                    if (result?.id && hasResult) {
                      onRequestDeleteResult?.(result.id);
                      return;
                    }
                    setPendingDeletePlan({ id: plan.id, title: plan.title });
                  }}
                  disabled={hasResult ? !onRequestDeleteResult : !onDeletePlan}
                  className="w-full"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <div className="w-full">
      {planningTaskIds.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[18px] border px-3 py-2 text-[10px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>策划分析</span>
          {planningTaskIds.length > 1 ? (
            <div className="relative">
              <button
                type="button"
                className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}
                title="查看多个策划任务 ID"
                aria-expanded={planningIdsExpanded}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setPlanningIdsExpanded((prev) => !prev);
                }}
              >
                <FileText size={12} />
                <span>策划任务 ID</span>
                <span className="rounded-full px-1.5 py-0.5 text-[9px]" style={{ background: 'var(--bg-elevated)', color: 'var(--accent)' }}>{planningTaskIds.length}</span>
                {planningIdsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {planningIdsExpanded ? (
                <div
                  className="absolute left-0 top-full z-30 mt-2 flex w-[min(340px,calc(100vw-48px))] flex-col gap-2 rounded-[16px] border p-2 shadow-lg"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="px-1 text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                    共 {planningTaskIds.length} 个策划任务 ID
                  </div>
                  {planningTaskIds.map((taskId, index) => (
                    <div key={`${taskId}-${index}`} className="min-w-0 rounded-[12px] px-2 py-1" style={{ background: 'var(--bg-surface)' }}>
                      {renderTaskIdChip(taskId, onCopyTaskId, `策划任务 ID ${index + 1}`)}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            renderTaskIdChip(planningTaskIds[0], onCopyTaskId, '策划任务 ID')
          )}
        </div>
      ) : null}
      {isDetailProject ? (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-0">
          {plans.map((plan, index) => {
            const schemeText = normalizeSchemeText(plan.schemeContent);
            const result = findResult(plan, index);
            const hasResult = Boolean(result && (result.imageUrl || result.videoUrl));
            const hasErrorResult = result?.status === 'error';
            const isPlanSubmitPending = Boolean(isConfirmPlanPending?.(plan.id));
            const isGenerating = !hasResult && !hasErrorResult && (isPlanSubmitPending || resultIsActivelyGenerating(result) || activeGeneratingPlanId === plan.id);
            const confirmLabel = hasErrorResult ? '重试' : hasResult ? '重生成' : '生成';
            const isPromptExpanded = Boolean(expandedPromptIds[plan.id]);
            const statusLabel = hasResult ? '已出图' : hasErrorResult ? '生成失败' : isGenerating ? '生成中' : plan.selected ? '待生成' : '未选中';
            const planAspectRatio = getPlanAspectRatio(plan, result);
            const canOpenPreview = Boolean(result && result.imageUrl && result.mediaType !== 'video' && !result.videoUrl);
            const canRecoverResult = Boolean(result?.id && onRecoverResult && (hasResult || result?.taskId));
            const isEditPending = Boolean(result?.id && isEditResultPending?.(result.id));

            return (
              <section
                key={plan.id}
                className="grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]"
                style={{
                  animation: `fade-in-up 0.3s ease ${index * 0.08}s both`,
                }}
              >
                <div
                  className="flex h-full min-h-0 flex-col rounded-[22px] border p-4"
                  style={{
                    borderColor: plan.selected ? 'var(--accent)' : 'var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                  }}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {plan.title}
                        </p>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>
                          #{index + 1}
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          {planAspectRatio.replace(' / ', ':')}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {statusLabel}
                      </p>
                      {renderResultUsageMeta(result, onCopyTaskId)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onChange(plans.map((p) => (p.id === plan.id ? { ...p, selected: !p.selected } : p)))}
                      className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                      style={{
                        background: plan.selected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                        color: plan.selected ? 'var(--accent)' : 'var(--text-tertiary)',
                      }}
                    >
                      {plan.selected ? '已选中' : '未选中'}
                    </button>
                  </div>

                  <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}>
                    <div className="border-b px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>策划 Prompt</p>
                          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>可直接修改后再生成</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedPromptIds((prev) => ({ ...prev, [plan.id]: !prev[plan.id] }))}
                          className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium"
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                        >
                          {isPromptExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {isPromptExpanded ? '收起' : '展开'}
                        </button>
                      </div>
                    </div>
                    {renderPromptCopyButton(schemeText)}
                    <PlanPromptTextarea
                      value={plan.schemeContent || ''}
                      onChange={(nextContent) => handleSchemeContentChange(plan.id, nextContent)}
                      rows={isPromptExpanded ? 12 : 5}
                      className={`w-full flex-1 resize-none bg-transparent px-3 py-2 pr-9 text-[12px] leading-6 outline-none scrollbar-hide ${isPromptExpanded ? 'min-h-[250px]' : 'min-h-[110px]'}`}
                      style={{ color: 'var(--text-secondary)' }}
                    />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    <ActionButton
                      icon={<Download size={12} />}
                      label="下载"
                      onClick={() => result && onDownloadResult?.(result, index)}
                      disabled={!hasResult}
                    />
                    {isGenerating && onCancelGeneration ? (
                      <ActionButton
                        icon={<Square size={12} />}
                        label="中断"
                        tone="danger"
                        onClick={onCancelGeneration}
                      />
                    ) : hasResult ? (
                      <ActionButton
                        icon={<Sparkles size={12} />}
                        label={isEditPending ? '提交中' : '修改'}
                        onClick={() => result?.id && onEditResult?.(result.id)}
                        disabled={!result?.id || !onEditResult || isEditPending}
                      />
                    ) : (
                      <ActionButton
                        icon={<Square size={12} />}
                        label="中断"
                        onClick={() => {}}
                        disabled
                      />
                    )}
                    <ActionButton
                      icon={<RotateCcw size={12} />}
                      label="找回"
                      onClick={() => result?.id && onRecoverResult?.(result.id)}
                      disabled={!canRecoverResult}
                    />
                    <ActionButton
                      icon={<Sparkles size={12} />}
                      label={isPlanSubmitPending ? '提交中' : isGenerating ? '生成中' : confirmLabel}
                      tone="primary"
                      onClick={() => onConfirm(plan)}
                      disabled={isGenerating}
                    />
                  </div>
                  <div className="mt-1 grid grid-cols-1 gap-1.5">
                    {onRequestDeleteResult ? (
                      <ActionButton
                        icon={<Trash2 size={12} />}
                        label="删除"
                        tone="danger"
                        onClick={() => {
                          if (result?.id && hasResult) {
                            onRequestDeleteResult?.(result.id);
                            return;
                          }
                          setPendingDeletePlan({ id: plan.id, title: plan.title });
                        }}
                        disabled={hasResult ? !onRequestDeleteResult : !onDeletePlan}
                        className="w-full"
                      />
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!canOpenPreview}
                  onClick={() => {
                    if (canOpenPreview && result) onPreviewResult?.(result.id);
                  }}
                  className="relative flex h-full min-h-0 w-full items-stretch justify-stretch overflow-hidden rounded-none border-x border-b border-t-0 text-left disabled:cursor-default"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    background: 'var(--bg-base)',
                    aspectRatio: planAspectRatio,
                  }}
                >
                  {hasResult ? (
                    <>
                      {renderMedia(result || undefined, 'h-full w-full object-contain')}
                      <div className="absolute left-3 top-3 z-10 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white">
                        #{index + 1}
                      </div>
                      <div className="absolute right-3 top-3 z-10 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-medium text-white">
                        {result?.aspectRatio || planAspectRatio.replace(' / ', ':')}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full min-h-[280px] w-full flex-col items-center justify-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--bg-surface)' }}>
                        <Square size={18} />
                      </div>
                      <span>{hasErrorResult ? '生成失败' : isGenerating ? '生成中' : '待生成图'}</span>
                      {hasErrorResult && result?.error ? (
                        <span className="max-w-[82%] truncate" style={{ color: 'var(--error)' }}>{result.error}</span>
                      ) : null}
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                        {planAspectRatio.replace(' / ', ':')}
                      </span>
                    </div>
                  )}
                </button>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3">
          {gridPlanRows.map((row) => renderGridPlanCard(row.plan, row.index, row.result, row.resultOrdinal, row.resultCount))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeletePlan !== null}
        title="删除策划方案"
        message={pendingDeletePlan ? `确定要删除策划方案「${pendingDeletePlan.title}」吗？此操作不可恢复。` : '确定要删除这个策划方案吗？此操作不可恢复。'}
        onConfirm={() => {
          if (pendingDeletePlan) onDeletePlan?.(pendingDeletePlan.id);
          setPendingDeletePlan(null);
        }}
        onCancel={() => setPendingDeletePlan(null)}
      />
    </div>
  );
};

export default PlanEditor;
