import React, { useCallback, useEffect, useState } from 'react';
import { ImagePlus, LoaderCircle, Sparkles, Upload } from 'lucide-react';
import {
  createVirtualModel,
  createVirtualModelGenerationBatch,
  createVirtualModelVersion,
  finalizeVirtualModelGenerationBatch,
  type VirtualModelGenerationBatch,
} from '../../services/internalApi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../shell/components/ui/dialog';
import VirtualModelPoseGenerationStep from './VirtualModelPoseGenerationStep';
import VirtualModelReferenceUploadStep, {
  type VirtualModelReferenceAsset,
} from './VirtualModelReferenceUploadStep';
import { canFinalizeVirtualModelBatch } from './virtualModelGenerationState.mjs';

type Props = {
  open: boolean;
  resumeBatch: VirtualModelGenerationBatch | null;
  initialModelCode: string;
  onOpenChange: (open: boolean) => void;
  onManualCreated: (result: {
    virtualModelId: string;
    virtualModelVersionId: string;
  }) => Promise<void> | void;
  onCompleted: (result: {
    virtualModelId: string;
    virtualModelVersionId: string;
  }) => Promise<void> | void;
};

const createClientSubmissionKey = () => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `virtual-model-ui-${randomId}`
    : `virtual-model-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const VirtualModelCreateDialog: React.FC<Props> = ({
  open,
  resumeBatch,
  initialModelCode,
  onOpenChange,
  onManualCreated,
  onCompleted,
}) => {
  const [mode, setMode] = useState<'choose' | 'auto'>('choose');
  const [modelCode, setModelCode] = useState('');
  const [modelName, setModelName] = useState('');
  const [identityDescription, setIdentityDescription] = useState('');
  const [assets, setAssets] = useState<VirtualModelReferenceAsset[]>([]);
  const [primaryAssetId, setPrimaryAssetId] = useState('');
  const [preparedModelId, setPreparedModelId] = useState('');
  const [preparedVersionId, setPreparedVersionId] = useState('');
  const [clientSubmissionKey, setClientSubmissionKey] = useState('');
  const [batch, setBatch] = useState<VirtualModelGenerationBatch | null>(null);
  const [pending, setPending] = useState(false);
  const [childActionBusy, setChildActionBusy] = useState(false);
  const [error, setError] = useState('');
  const profileValid = Boolean(modelCode.trim() && modelName.trim());
  const dialogBusy = pending || childActionBusy;

  useEffect(() => {
    if (open && resumeBatch) {
      setMode('auto');
      setBatch(resumeBatch);
      setPending(false);
      setChildActionBusy(false);
      setError('');
      return;
    }
    if (open && !resumeBatch) {
      setMode('choose');
      setModelCode(initialModelCode);
      setModelName('');
      setIdentityDescription('');
      setAssets([]);
      setPrimaryAssetId('');
      setPreparedModelId('');
      setPreparedVersionId('');
      setClientSubmissionKey('');
      setBatch(null);
      setPending(false);
      setChildActionBusy(false);
      setError('');
      return;
    }
    if (!open) {
      setMode('choose');
      setModelCode('');
      setModelName('');
      setIdentityDescription('');
      setAssets([]);
      setPrimaryAssetId('');
      setPreparedModelId('');
      setPreparedVersionId('');
      setClientSubmissionKey('');
      setBatch(null);
      setPending(false);
      setChildActionBusy(false);
      setError('');
    }
  }, [initialModelCode, open, resumeBatch]);

  const prepareDraft = async () => {
    if (!profileValid) throw new Error('请填写模特编码和名称。');
    let modelId = preparedModelId;
    if (!modelId) {
      const modelResult = await createVirtualModel({
        code: modelCode.trim(),
        name: modelName.trim(),
      });
      modelId = modelResult.model.id;
      setPreparedModelId(modelId);
    }
    let versionId = preparedVersionId;
    if (!versionId) {
      const versionResult = await createVirtualModelVersion(modelId, {
        identityProfile: { description: identityDescription.trim() },
      });
      versionId = versionResult.version.id;
      setPreparedVersionId(versionId);
    }
    return { modelId, versionId };
  };

  const startGeneration = async () => {
    if (!assets.length || !primaryAssetId) {
      setError('请先上传参考图并选择主参考。');
      return;
    }
    setPending(true);
    setError('');
    try {
      const { modelId, versionId } = await prepareDraft();
      const submissionKey = clientSubmissionKey || createClientSubmissionKey();
      setClientSubmissionKey(submissionKey);
      const batchResult = await createVirtualModelGenerationBatch({
        virtualModelId: modelId,
        virtualModelVersionId: versionId,
        sourceAssetIds: assets.map((asset) => asset.assetId),
        primarySourceAssetId: primaryAssetId,
        clientSubmissionKey: submissionKey,
      });
      setBatch(batchResult.batch);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '自动生成任务创建失败。');
    } finally {
      setPending(false);
    }
  };

  const startManualUpload = async () => {
    setPending(true);
    setError('');
    try {
      const { modelId, versionId } = await prepareDraft();
      await onManualCreated({
        virtualModelId: modelId,
        virtualModelVersionId: versionId,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手动上传草稿创建失败。');
    } finally {
      setPending(false);
    }
  };

  const handleFinalize = async () => {
    if (!batch || !canFinalizeVirtualModelBatch(batch)) return;
    setPending(true);
    setError('');
    try {
      const response = await finalizeVirtualModelGenerationBatch(batch.id);
      await onCompleted({
        virtualModelId: response.result.virtualModelId,
        virtualModelVersionId: response.result.virtualModelVersionId,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模特素材保存失败。');
    } finally {
      setPending(false);
    }
  };

  const handleBatchChange = useCallback(
    (next: VirtualModelGenerationBatch) => setBatch(next),
    [],
  );
  const handleError = useCallback((message: string) => setError(message), []);
  const handleChildBusyChange = useCallback(
    (busy: boolean) => setChildActionBusy(busy),
    [],
  );

  return <Dialog
    open={open}
    onOpenChange={(next) => {
      if (!dialogBusy) onOpenChange(next);
    }}
  >
    <DialogContent
      className="max-h-[90vh] w-[94vw] sm:max-w-[1100px] overflow-y-auto"
      onPointerDownOutside={(event) => {
        if (dialogBusy) event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        if (dialogBusy) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>新建虚拟模特</DialogTitle>
        <DialogDescription>
          先填写模特资料，再选择自动生成或手动上传八张素材。
        </DialogDescription>
      </DialogHeader>
      {!batch && <div
        className="grid gap-4 border-b pb-5 sm:grid-cols-2"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <label className="grid gap-1.5 text-sm">
          模特编码
          <input
            autoFocus
            value={modelCode}
            onChange={(event) => {
              setModelCode(event.target.value);
              setError('');
            }}
            disabled={pending || Boolean(preparedModelId)}
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          模特名称
          <input
            value={modelName}
            onChange={(event) => {
              setModelName(event.target.value);
              setError('');
            }}
            disabled={pending || Boolean(preparedModelId)}
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        </label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">
          身份特征描述
          <textarea
            value={identityDescription}
            onChange={(event) => {
              setIdentityDescription(event.target.value);
              setError('');
            }}
            placeholder="例如：22-26岁东亚女性，深棕黑色长发，鹅蛋脸，自然清透妆感"
            disabled={pending || Boolean(preparedModelId)}
            className="min-h-24 rounded-md border bg-transparent p-3 text-sm"
            style={{ borderColor: 'var(--border-subtle)' }}
          />
        </label>
      </div>}
      {mode === 'choose'
        ? <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={pending || !profileValid}
            onClick={() => setMode('auto')}
            className="flex min-h-32 flex-col items-start justify-center rounded-md border p-5 text-left disabled:opacity-50"
            style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}
          >
            <Sparkles size={22} style={{ color: 'var(--accent)' }} />
            <strong className="mt-3 text-sm">自动生成素材</strong>
            <span className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              上传参考图，生成并填入固定八角度。
            </span>
          </button>
          <button
            type="button"
            disabled={pending || !profileValid}
            onClick={() => void startManualUpload()}
            className="flex min-h-32 flex-col items-start justify-center rounded-md border p-5 text-left disabled:opacity-50"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {pending
              ? <LoaderCircle size={22} className="animate-spin" />
              : <Upload size={22} />}
            <strong className="mt-3 text-sm">手动上传八张</strong>
            <span className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              创建草稿后逐槽位上传已有素材。
            </span>
          </button>
        </div>
        : batch
          ? <VirtualModelPoseGenerationStep
            batch={batch}
            disabled={pending}
            onBatchChange={handleBatchChange}
            onFinalize={handleFinalize}
            onError={handleError}
            onBusyChange={handleChildBusyChange}
          />
          : <VirtualModelReferenceUploadStep
            assets={assets}
            primaryAssetId={primaryAssetId}
            disabled={pending}
            onChange={setAssets}
            onPrimaryChange={setPrimaryAssetId}
            onError={setError}
          />}
      {error && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
        {error}
      </p>}
      {mode === 'auto' && !batch && <DialogFooter>
        <button
          type="button"
          disabled={pending}
          onClick={() => setMode('choose')}
          className="rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          返回
        </button>
        <button
          type="button"
          disabled={pending || !assets.length || !primaryAssetId}
          onClick={() => void startGeneration()}
          className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {pending
            ? <LoaderCircle size={16} className="animate-spin" />
            : <ImagePlus size={16} />}
          开始生成八张
        </button>
      </DialogFooter>}
    </DialogContent>
  </Dialog>;
};

export default VirtualModelCreateDialog;
