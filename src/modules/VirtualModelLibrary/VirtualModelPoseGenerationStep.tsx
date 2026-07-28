import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  cancelVirtualModelGenerationBatch,
  fetchVirtualModelGenerationBatch,
  regenerateVirtualModelDerivedPoses,
  retryVirtualModelGenerationPose,
  type VirtualModelGenerationBatch,
  type VirtualModelGenerationPoseTask,
} from '../../services/internalApi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../shell/components/ui/dialog';
import { downloadRemoteFile } from '../../utils/imageUtils';
import {
  canFinalizeVirtualModelBatch,
  canRetryVirtualModelPose,
  deriveVirtualModelBatchProgress,
  mergeVirtualModelBatchPoll,
} from './virtualModelGenerationState.mjs';

type Props = {
  batch: VirtualModelGenerationBatch;
  disabled: boolean;
  onBatchChange: (batch: VirtualModelGenerationBatch) => void;
  onFinalize: () => Promise<void>;
  onError: (message: string) => void;
};

const referenceStatusLabel = (task: VirtualModelGenerationPoseTask) => ({
  generated: '等待校验图片',
  validating: '正在校验图片',
  stabilizing: '正在保存稳定素材',
  baseline_ready: '基准图已就绪',
  reference_failed: '基准图稳定化失败',
}[task.referenceStatus || '']);

const statusLabel = (task: VirtualModelGenerationPoseTask) => (
  referenceStatusLabel(task) || ({
    pending: '等待中',
    queued: '已排队',
    running: '生成中',
    retry_waiting: '等待重试',
    succeeded: '已生成',
    persisting: '保存中',
    saved: '已保存',
    failed: '失败',
    cancelled: '已取消',
  }[task.status] || task.status)
);

const TERMINAL_BATCH_STATUSES = new Set([
  'ready_to_finalize',
  'completed',
  'cancelled',
  'failed',
  'regeneration_required',
]);
const DERIVED_POSE_IDS = new Set(['C02', 'C03', 'C04', 'C05', 'P05', 'P03']);
const BASELINE_POSE_IDS = new Set(['C01', 'P01']);

const retryLabelForTask = (task: VirtualModelGenerationPoseTask) => (
  task.referenceStatus === 'reference_failed'
    && String(task.referenceErrorCode || '').startsWith('provider_')
    ? `重试稳定化上传 ${task.label}`
    : task.status === 'succeeded' && task.referenceStatus !== 'reference_failed'
      ? `重新生成 ${task.label}`
      : `重试 ${task.label}`
);

const VirtualModelPoseGenerationStep: React.FC<Props> = ({
  batch,
  disabled,
  onBatchChange,
  onFinalize,
  onError,
}) => {
  const timerRef = useRef<number | null>(null);
  const latestBatchRef = useRef(batch);
  const stateRevisionRef = useRef(0);
  const [actionId, setActionId] = useState('');
  const [downloadingPoseId, setDownloadingPoseId] = useState('');
  const [previewPoseId, setPreviewPoseId] = useState('');
  const [regenerationConfirmOpen, setRegenerationConfirmOpen] = useState(false);
  const progress = useMemo(
    () => deriveVirtualModelBatchProgress(batch.poseTasks),
    [batch.poseTasks],
  );
  const previewTask = useMemo(
    () => batch.poseTasks.find((task) => task.poseId === previewPoseId) || null,
    [batch.poseTasks, previewPoseId],
  );
  const previewTaskIsStale = Boolean(
    batch.derivedRegenerationRequired
      && previewTask
      && DERIVED_POSE_IDS.has(previewTask.poseId),
  );

  useEffect(() => {
    latestBatchRef.current = batch;
  }, [batch]);

  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      if (controller.signal.aborted || TERMINAL_BATCH_STATUSES.has(batch.status)) return;
      const stateRevision = stateRevisionRef.current;
      try {
        const result = await fetchVirtualModelGenerationBatch(batch.id);
        if (!controller.signal.aborted && stateRevision === stateRevisionRef.current) {
          const merged = mergeVirtualModelBatchPoll(latestBatchRef.current, result.batch);
          if (merged !== latestBatchRef.current) {
            latestBatchRef.current = merged;
            stateRevisionRef.current += 1;
            onBatchChange(merged);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          onError(error instanceof Error ? error.message : '生成状态刷新失败。');
        }
      }
      if (!controller.signal.aborted) {
        timerRef.current = window.setTimeout(poll, 2500);
      }
    };
    timerRef.current = window.setTimeout(poll, 2500);
    return () => {
      controller.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [batch.id, batch.status, onBatchChange, onError]);

  const applyActionBatch = (next: VirtualModelGenerationBatch) => {
    latestBatchRef.current = next;
    stateRevisionRef.current += 1;
    onBatchChange(next);
  };

  const retry = async (task: VirtualModelGenerationPoseTask) => {
    setActionId(task.poseId);
    onError('');
    try {
      applyActionBatch((await retryVirtualModelGenerationPose(batch.id, task.poseId)).batch);
    } catch (error) {
      onError(error instanceof Error ? error.message : '重试失败。');
    } finally {
      setActionId('');
    }
  };

  const downloadPose = async (task: VirtualModelGenerationPoseTask) => {
    if (!task.resultUrl) return;
    setDownloadingPoseId(task.poseId);
    onError('');
    try {
      await downloadRemoteFile(
        task.resultUrl,
        `virtual-model-${batch.virtualModelId}-${task.poseId}-${task.label}`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : '图片下载失败。');
    } finally {
      setDownloadingPoseId('');
    }
  };

  const cancel = async () => {
    setActionId('cancel');
    onError('');
    try {
      applyActionBatch((await cancelVirtualModelGenerationBatch(batch.id)).batch);
    } catch (error) {
      onError(error instanceof Error ? error.message : '取消失败。');
    } finally {
      setActionId('');
    }
  };

  const regenerateDerived = async () => {
    setActionId('regenerate-derived');
    onError('');
    try {
      applyActionBatch((await regenerateVirtualModelDerivedPoses(batch.id)).batch);
      setRegenerationConfirmOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : '其他六张重新生成失败。');
    } finally {
      setActionId('');
    }
  };

  const baselinesReady = ['C01', 'P01'].every((poseId) => batch.poseTasks.some(
    (task) => task.poseId === poseId
      && task.status === 'succeeded'
      && task.referenceStatus === 'baseline_ready',
  ));

  return <><div className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">生成八角度素材</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {progress.completed}/{progress.total} 已完成
          {progress.failed ? `，${progress.failed} 张失败` : ''}
        </p>
      </div>
      {!TERMINAL_BATCH_STATUSES.has(batch.status) && <button
        type="button"
        disabled={disabled || actionId === 'cancel'}
        onClick={() => void cancel()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
        style={{ borderColor: 'var(--border-subtle)' }}
        aria-label="取消生成"
        title="取消生成"
      >
        <X size={15} />
      </button>}
    </div>
    <div
      className="h-1.5 overflow-hidden rounded-full"
      style={{ background: 'var(--bg-input)' }}
    >
      <div
        className="h-full transition-all"
        style={{ width: `${progress.percent}%`, background: 'var(--accent)' }}
      />
    </div>
    {batch.derivedRegenerationRequired && <div
      className="flex flex-wrap items-center gap-3 rounded-md border p-3"
      style={{ borderColor: 'var(--warning)', background: 'var(--bg-input)' }}
    >
      <AlertTriangle size={18} style={{ color: 'var(--warning)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">基准图已更新</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          现有六张角度图仍基于旧基准，需要确认后统一重新生成。
        </p>
      </div>
      {batch.status === 'regeneration_required' && <button
        type="button"
        disabled={disabled || Boolean(actionId)}
        onClick={() => setRegenerationConfirmOpen(true)}
        className="rounded-md px-3 py-2 text-sm text-white disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        重新生成六张
      </button>}
    </div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {batch.poseTasks.map((task) => {
        const isDerived = DERIVED_POSE_IDS.has(task.poseId);
        const isBaseline = BASELINE_POSE_IDS.has(task.poseId);
        const referenceFailed = task.referenceStatus === 'reference_failed';
        const referenceActive = ['generated', 'validating', 'stabilizing'].includes(
          task.referenceStatus || '',
        );
        const isStale = batch.derivedRegenerationRequired && isDerived;
        const displayStatus = isStale
          ? '需要重新生成'
          : task.status === 'pending' && isDerived && !baselinesReady
            ? '等待两张基准图稳定化'
            : statusLabel(task);
        const retryLabel = retryLabelForTask(task);
        const regeneratingWithPreviousResult = Boolean(
          task.resultUrl
            && ['pending', 'queued', 'running', 'retry_waiting'].includes(task.status),
        );
        return <div
          key={task.poseId}
          className="overflow-hidden rounded-md border"
          style={{
            borderColor: task.status === 'failed' || referenceFailed
              ? 'var(--danger)'
              : 'var(--border-subtle)',
          }}
        >
          <div className="relative aspect-[3/4]" style={{ background: 'var(--bg-base)' }}>
            {task.resultUrl
              ? <button
                type="button"
                onClick={() => setPreviewPoseId(task.poseId)}
                className="h-full w-full"
                aria-label={`查看大图 ${task.label}`}
              >
                <img src={task.resultUrl} alt={task.label} className="h-full w-full object-cover" />
              </button>
              : <div className="flex h-full items-center justify-center">
                {referenceActive || ['queued', 'running', 'retry_waiting'].includes(task.status)
                  ? <LoaderCircle
                    size={22}
                    className="animate-spin"
                    style={{ color: 'var(--accent)' }}
                  />
                  : <span
                    className="px-2 text-center text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {displayStatus}
                  </span>}
              </div>}
            {regeneratingWithPreviousResult && <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-black/70 px-2 py-2 text-xs text-white">
              <LoaderCircle size={13} className="animate-spin" />
              重新生成中
            </div>}
            {task.status === 'succeeded'
              && (!isBaseline || task.referenceStatus === 'baseline_ready')
              && <CheckCircle2
                size={18}
                className="absolute right-2 top-2"
                style={{ color: 'var(--success)' }}
              />}
          </div>
          <div className="flex min-h-12 items-center justify-between gap-2 p-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{task.label}</p>
              <p
                className="truncate text-[11px]"
                style={{
                  color: task.status === 'failed' || referenceFailed
                    ? 'var(--danger)'
                    : 'var(--text-tertiary)',
                }}
              >
                {task.referenceErrorMessage || task.errorMessage || displayStatus}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {task.resultUrl && <button
                type="button"
                disabled={downloadingPoseId === task.poseId}
                onClick={() => void downloadPose(task)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border disabled:opacity-50"
                style={{ borderColor: 'var(--border-subtle)' }}
                aria-label={`下载 ${task.label}`}
                title={`下载 ${task.label}`}
              >
                {downloadingPoseId === task.poseId
                  ? <LoaderCircle size={14} className="animate-spin" />
                  : <Download size={14} />}
              </button>}
              {canRetryVirtualModelPose(task)
                && !isStale
                && (!isDerived || baselinesReady)
                && <button
                  type="button"
                  disabled={disabled || Boolean(actionId)}
                  onClick={() => void retry(task)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  aria-label={retryLabel}
                  title={retryLabel}
                >
                  {actionId === task.poseId
                    ? <LoaderCircle size={14} className="animate-spin" />
                    : <RotateCcw size={14} />}
                </button>}
            </div>
          </div>
        </div>;
      })}
    </div>
    <button
      type="button"
      disabled={disabled || !canFinalizeVirtualModelBatch(batch)}
      onClick={() => void onFinalize()}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-medium text-white disabled:opacity-50"
      style={{ background: 'var(--accent)' }}
    >
      <CheckCircle2 size={16} />
      保存到模特草稿
    </button>
  </div><Dialog
    open={Boolean(previewTask)}
    onOpenChange={(next) => {
      if (!next) setPreviewPoseId('');
    }}
  >
    <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden">
      <DialogHeader>
        <DialogTitle>{previewTask?.label}</DialogTitle>
        <DialogDescription>{previewTask ? statusLabel(previewTask) : ''}</DialogDescription>
      </DialogHeader>
      <div
        className="flex min-h-0 items-center justify-center overflow-hidden rounded-md"
        style={{ background: 'var(--bg-base)' }}
      >
        {previewTask?.resultUrl && <img
          src={previewTask.resultUrl}
          alt={previewTask.label}
          className="max-h-[72vh] w-full object-contain"
        />}
      </div>
      {previewTask
        && canRetryVirtualModelPose(previewTask)
        && !previewTaskIsStale
        && (!DERIVED_POSE_IDS.has(previewTask.poseId) || baselinesReady)
        && <DialogFooter>
          <button
            type="button"
            disabled={disabled || Boolean(actionId)}
            onClick={() => void retry(previewTask)}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
            aria-label={retryLabelForTask(previewTask)}
          >
            <RotateCcw size={14} />
            {retryLabelForTask(previewTask)}
          </button>
        </DialogFooter>}
    </DialogContent>
  </Dialog><Dialog
    open={regenerationConfirmOpen}
    onOpenChange={setRegenerationConfirmOpen}
  >
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>重新生成其他六张？</DialogTitle>
        <DialogDescription>
          此操作将创建 6 个图片生成任务，并使用最新的正面近景和正面全身作为参考。
          旧图会保留到对应新图生成成功后。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <button
          type="button"
          disabled={Boolean(actionId)}
          onClick={() => setRegenerationConfirmOpen(false)}
          className="rounded-md border px-4 py-2 text-sm"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          取消
        </button>
        <button
          type="button"
          disabled={disabled || Boolean(actionId)}
          onClick={() => void regenerateDerived()}
          className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {actionId === 'regenerate-derived'
            && <LoaderCircle size={14} className="animate-spin" />}
          确认生成六张
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog></>;
};

export default VirtualModelPoseGenerationStep;
