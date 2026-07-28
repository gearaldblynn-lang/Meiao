import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, LoaderCircle, Plus, Save, Trash2, Upload } from 'lucide-react';
import AuthenticatedAssetImage from '../../components/AuthenticatedAssetImage';
import { createVirtualModelVersion, deleteVirtualModel, fetchAdminVirtualModels, findVirtualModelGenerationBatch, publishVirtualModel, replaceVirtualModelVersionAssets, unpublishVirtualModel, updateVirtualModel, updateVirtualModelVersion, uploadInternalAssetStream } from '../../services/internalApi';
import type { AdminVirtualModel, VirtualModelAsset, VirtualModelGenerationBatch } from '../../services/internalApi';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../shell/components/ui/dialog';
import { downloadRemoteFile } from '../../utils/imageUtils';
import { submitVirtualModelDelete } from './virtualModelDeleteSubmission.mjs';
import VirtualModelCreateDialog from './VirtualModelCreateDialog';
import { suggestNextVirtualModelCode } from './virtualModelCodeSuggestion.mjs';
import { shouldResumeVirtualModelBatch } from './virtualModelGenerationState.mjs';

const ASSET_SLOTS = [['front_close', '正面近景'], ['left_45_close', '左侧45度近景'], ['right_45_close', '右侧45度近景'], ['profile_close', '左侧面近景'], ['three_quarter_half', '右侧面近景'], ['front_half', '正面半身'], ['front_full', '正面全身'], ['three_quarter_full', '四分之三全身']] as const;
const formatTime = (value: number) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const completeness = (model: AdminVirtualModel) => model.version?.assets.length || 0;
const managementStatus = (model: AdminVirtualModel) => model.version?.status === 'draft' ? 'draft' : model.status;
const countModelsByStatus = (models: AdminVirtualModel[]) => ({
  all: models.length,
  draft: models.filter((model) => managementStatus(model) === 'draft').length,
  published: models.filter((model) => managementStatus(model) === 'published').length,
});

const VirtualModelLibraryModule: React.FC = () => {
  const [models, setModels] = useState<AdminVirtualModel[]>([]);
  const [modelCounts, setModelCounts] = useState({ all: 0, draft: 0, published: 0 });
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [downloadingAssetId, setDownloadingAssetId] = useState('');
  const [previewSlot, setPreviewSlot] = useState('');
  const [notice, setNotice] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [resumeBatch, setResumeBatch] = useState<VirtualModelGenerationBatch | null>(null);
  const [suggestedModelCode, setSuggestedModelCode] = useState('');
  const [editorMode, setEditorMode] = useState<'edit' | null>(null);
  const [editorCode, setEditorCode] = useState('');
  const [editorName, setEditorName] = useState('');
  const [editorProfile, setEditorProfile] = useState('');
  const [editorError, setEditorError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminVirtualModel | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deletePending, setDeletePending] = useState(false);
  const deletePendingRef = useRef(false);
  const selectionRequestRef = useRef(0);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const selected = useMemo(() => models.find((model) => model.id === selectedId) || null, [models, selectedId]);
  const previewEntry = ASSET_SLOTS.find(([slot]) => slot === previewSlot);
  const previewAsset = selected?.version?.assets.find((asset) => asset.slot === previewSlot);
  const previewUrl = previewAsset?.publicUrl || previewAsset?.url;
  const load = useCallback(async () => {
    setPending(true); setNotice('');
    try {
      const filteredResultPromise = fetchAdminVirtualModels(filter);
      const allResultPromise = filter === 'all' ? filteredResultPromise : fetchAdminVirtualModels('all');
      const [result, allResult] = await Promise.all([filteredResultPromise, allResultPromise]);
      const countModels = allResult.models;
      setModels(result.models);
      setModelCounts(countModelsByStatus(countModels));
      setSelectedId((id) => id && result.models.some((model) => model.id === id) ? id : result.models[0]?.id || null);
    }
    catch (error) { setNotice(error instanceof Error ? error.message : '加载失败'); } finally { setPending(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);
  const openNewGeneration = async () => {
    const requestId = ++selectionRequestRef.current;
    setPending(true); setNotice('');
    try {
      const result = await fetchAdminVirtualModels('all');
      if (requestId !== selectionRequestRef.current) return;
      setSuggestedModelCode(suggestNextVirtualModelCode(result.models));
      setResumeBatch(null); setCreateDialogOpen(true);
    } catch (error) {
      if (requestId !== selectionRequestRef.current) return;
      setNotice(error instanceof Error ? error.message : '自动编码加载失败');
    } finally {
      setPending(false);
    }
  };
  const selectModel = async (model: AdminVirtualModel) => {
    const requestId = ++selectionRequestRef.current;
    setSelectedId(model.id);
    setResumeBatch(null);
    if (managementStatus(model) !== 'draft' || !model.version) return;
    try {
      const result = await findVirtualModelGenerationBatch(model.id, model.version.id);
      if (requestId !== selectionRequestRef.current) return;
      if (shouldResumeVirtualModelBatch(result.batch)) {
        setResumeBatch(result.batch);
        setCreateDialogOpen(true);
      }
    } catch (error) {
      if (requestId !== selectionRequestRef.current) return;
      setNotice(error instanceof Error ? error.message : '生成任务恢复失败');
    }
  };
  const openEdit = () => {
    if (!selected) return;
    const description = selected.version?.identityProfile?.description;
    setEditorCode(selected.code); setEditorName(selected.name); setEditorProfile(typeof description === 'string' ? description : ''); setEditorError(''); setEditorMode('edit');
  };
  const saveEditor = async () => {
    const code = editorCode.trim(); const name = editorName.trim();
    if (!code || !name) { setEditorError('请填写模特编码和名称'); return; }
    try {
      setPending(true); setNotice(''); setEditorError('');
      if (editorMode === 'edit' && selected) {
        const identityProfile = { ...(selected.version?.identityProfile || {}), description: editorProfile.trim() };
        const profileChanged = JSON.stringify(identityProfile) !== JSON.stringify(selected.version?.identityProfile || {});
        if (profileChanged && managementStatus(selected) !== 'draft') {
          setEditorError('已发布模特的身份特征不可修改，请在左侧新建模特');
          return;
        }
        await updateVirtualModel(selected.id, { code, name });
        if (profileChanged) {
          if (selected.version) await updateVirtualModelVersion(selected.id, selected.version.id, { identityProfile });
          else if (editorProfile.trim()) await createVirtualModelVersion(selected.id, { identityProfile });
        }
      }
      setEditorMode(null);
      await load();
    } catch (error) { const message = error instanceof Error ? error.message : '保存失败'; setNotice(message); setEditorError(message); } finally { setPending(false); }
  };
  const upload = async (slot: string, file: File) => {
    if (!selected) return;
    if (managementStatus(selected) !== 'draft') { setNotice('已发布模特的固定参考素材不可修改，请在左侧新建模特'); return; }
    setPending(true); setNotice('');
    try {
      const versionId = selected.version?.id || (await createVirtualModelVersion(selected.id, { identityProfile: {} })).version.id;
      const result = await uploadInternalAssetStream({ module: 'virtual_model', file });
      const assetId = result.assetId || result.fileUrl.split('/').filter(Boolean).pop() || result.fileUrl;
      const asset: VirtualModelAsset = { assetId, publicUrl: result.fileUrl, slot, position: ASSET_SLOTS.findIndex(([id]) => id === slot) + 1, isPrimary: slot === 'front_close' };
      const assets = [...(selected.version?.assets.filter((item) => item.slot !== slot) || []), asset].map((item) => ({ ...item, validationStatus: 'passed' as const }));
      await replaceVirtualModelVersionAssets(selected.id, versionId, { assets }); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : '上传失败'); } finally { setPending(false); }
  };
  const downloadAsset = async (asset: VirtualModelAsset, slot: string, label: string) => {
    if (!selected) return;
    const sourceUrl = asset.publicUrl || asset.url;
    if (!sourceUrl) return;
    setDownloadingAssetId(asset.assetId); setNotice('');
    try {
      await downloadRemoteFile(sourceUrl, `${selected.code}-${slot}-${label}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片下载失败');
    } finally {
      setDownloadingAssetId('');
    }
  };
  const publish = async () => {
    if (!selected) return;
    setPending(true); try { if (selected.version?.status === 'draft') await publishVirtualModel(selected.id, selected.version.id); else if (selected.status === 'published') await unpublishVirtualModel(selected.id); else { setNotice('请先创建版本并上传 8 张素材'); return; } await load(); } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败'); } finally { setPending(false); }
  };
  const confirmDelete = async () => {
    await submitVirtualModelDelete({
      target: deleteTarget,
      pendingRef: deletePendingRef,
      setPending: setDeletePending,
      setNotice,
      setError: setDeleteError,
      deleteModel: deleteVirtualModel,
      close: () => setDeleteTarget(null),
      reload: load,
    });
  };
  const refreshCreatedDraft = async (virtualModelId: string, message: string) => {
    setResumeBatch(null);
    setFilter('all');
    const result = await fetchAdminVirtualModels('all');
    setModels(result.models);
    setModelCounts(countModelsByStatus(result.models));
    setSelectedId(virtualModelId);
    setNotice(message);
  };
  const handleGeneratedDraftCompleted = async ({ virtualModelId }: { virtualModelId: string; virtualModelVersionId: string }) => {
    await refreshCreatedDraft(virtualModelId, '八张素材已保存到模特草稿，请补充资料后发布。');
  };
  const handleManualDraftCreated = async ({ virtualModelId }: { virtualModelId: string; virtualModelVersionId: string }) => {
    await refreshCreatedDraft(virtualModelId, '模特草稿已创建，请手动上传八张素材。');
  };
  return <><div className="mx-auto flex h-full max-w-[1500px] gap-5 p-5" style={{ color: 'var(--text-primary)' }}>
    <section className="flex min-w-[430px] flex-1 flex-col overflow-hidden border" style={{ borderRadius: 8, background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
      <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}><div><h1 className="text-lg font-semibold">虚拟模特库</h1><p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>管理模特与固定参考素材</p></div><button type="button" disabled={pending || deletePending} onClick={() => void openNewGeneration()} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white" style={{ background: 'var(--accent)' }}><Plus size={16} />新建</button></header>
      <div className="flex gap-2 border-b px-5 py-3" style={{ borderColor: 'var(--border-subtle)' }}>{(['all', 'draft', 'published'] as const).map((value) => <button key={value} type="button" disabled={deletePending} onClick={() => setFilter(value)} className="rounded-md px-3 py-1.5 text-xs" style={{ background: filter === value ? 'var(--accent-soft)' : 'transparent', color: filter === value ? 'var(--accent)' : 'var(--text-secondary)' }}>{value === 'all' ? '全部' : value === 'draft' ? '草稿' : '已发布'} {modelCounts[value]}</button>)}</div>
      <div className="min-h-0 flex-1 overflow-auto">{models.map((model) => <button key={model.id} type="button" disabled={deletePending} onClick={() => void selectModel(model)} className="grid w-full grid-cols-[minmax(0,1fr)_68px_68px] gap-3 border-b px-5 py-4 text-left" style={{ borderColor: 'var(--border-subtle)', background: selectedId === model.id ? 'var(--accent-soft)' : 'transparent' }}><span className="min-w-0"><strong className="block truncate text-sm">{model.name}</strong><small className="block truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>{model.code} · v{model.version?.versionNumber || '-'}</small></span><span className="text-xs" style={{ color: managementStatus(model) === 'published' ? 'var(--success)' : 'var(--text-secondary)' }}>{managementStatus(model) === 'published' ? '已发布' : managementStatus(model) === 'draft' ? '草稿' : '已下架'}</span><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{completeness(model)}/8</span><small className="col-span-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>更新于 {formatTime(model.updatedAt)}</small></button>)}</div>
    </section>
    <section className="w-[560px] overflow-auto border p-5" style={{ borderRadius: 8, background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>{selected ? <><div className="mb-5 flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold">{selected.name}</h2><p className="truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>{selected.code} · 版本 {selected.version?.versionNumber || '-'}</p></div><div className="flex shrink-0 gap-2"><button type="button" disabled={pending || deletePending} onClick={() => { setDeleteError(''); setDeleteTarget(selected); }} className="inline-flex h-8 w-8 items-center justify-center rounded-md border" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }} title="删除模特" aria-label="删除模特"><Trash2 size={14} /></button><button type="button" disabled={pending || deletePending} onClick={openEdit} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-xs" style={{ borderColor: 'var(--border-subtle)' }}><Save size={14} />编辑资料</button><button type="button" disabled={pending || deletePending} onClick={() => void publish()} className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs text-white" style={{ background: selected.version?.status === 'draft' ? 'var(--accent)' : 'var(--text-secondary)' }}><Check size={14} />{selected.version?.status === 'draft' ? '发布' : selected.status === 'published' ? '下架' : '发布'}</button></div></div><p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>素材完整度 {completeness(selected)}/8</p><div className="grid grid-cols-2 gap-3">{ASSET_SLOTS.map(([slot, label]) => { const asset = selected.version?.assets.find((item) => item.slot === slot); const assetUrl = asset?.publicUrl || asset?.url; const assetEditingDisabled = pending || deletePending || managementStatus(selected) !== 'draft'; return <div key={slot} className="overflow-hidden border" style={{ borderRadius: 6, borderColor: 'var(--border-subtle)' }}>{assetUrl ? <button type="button" onClick={() => setPreviewSlot(slot)} className="block aspect-[4/3] w-full overflow-hidden" style={{ background: 'var(--bg-base)' }} aria-label={`查看大图 ${label}`}><AuthenticatedAssetImage src={assetUrl} alt={label} className="h-full w-full object-cover" /></button> : <div className="aspect-[4/3]" style={{ background: 'var(--bg-base)' }} />}<div className="flex items-center justify-between gap-2 p-2"><span className="text-xs">{label}</span><div className="flex items-center gap-1"><input ref={(node) => { inputs.current[slot] = node; }} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(slot, file); event.currentTarget.value = ''; }} />{asset && assetUrl && <button type="button" disabled={downloadingAssetId === asset.assetId} onClick={() => void downloadAsset(asset, slot, label)} className="rounded p-1" title={`下载 ${label}`} aria-label={`下载 ${label}`}>{downloadingAssetId === asset.assetId ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}</button>}<button type="button" disabled={assetEditingDisabled} onClick={() => inputs.current[slot]?.click()} className="rounded p-1" title={assetEditingDisabled ? '已发布模特的固定参考素材不可修改，请在左侧新建模特' : '上传素材'}><Upload size={15} /></button></div></div></div>; })}</div></> : <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-tertiary)' }}>选择或新建一个虚拟模特</div>}{(pending || notice) && <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: notice ? 'var(--danger)' : 'var(--text-secondary)' }}>{pending && <LoaderCircle size={15} className="animate-spin" />}{notice || '处理中'}</div>}</section>
  </div><VirtualModelCreateDialog open={createDialogOpen} resumeBatch={resumeBatch} initialModelCode={suggestedModelCode} onOpenChange={(next) => { setCreateDialogOpen(next); if (!next) setResumeBatch(null); }} onManualCreated={handleManualDraftCreated} onCompleted={handleGeneratedDraftCompleted} /><Dialog open={Boolean(previewAsset && previewUrl)} onOpenChange={(open) => { if (!open) setPreviewSlot(''); }}>
    <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden">
      <DialogHeader><DialogTitle>{previewEntry?.[1]}</DialogTitle><DialogDescription>查看完整素材图片</DialogDescription></DialogHeader>
      <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md" style={{ background: 'var(--bg-base)' }}>
        {previewUrl && previewEntry && <AuthenticatedAssetImage src={previewUrl} alt={previewEntry[1]} className="max-h-[72vh] w-full object-contain" />}
      </div>
      {previewAsset && previewEntry && <DialogFooter><button type="button" disabled={downloadingAssetId === previewAsset.assetId} onClick={() => void downloadAsset(previewAsset, previewSlot, previewEntry[1])} className="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm text-white disabled:opacity-50" style={{ background: 'var(--accent)' }} aria-label={`下载大图 ${previewEntry[1]}`}>{downloadingAssetId === previewAsset.assetId ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}下载图片</button></DialogFooter>}
    </DialogContent>
  </Dialog><Dialog open={editorMode !== null} onOpenChange={(open) => { if (!open && !pending) setEditorMode(null); }}>
    <DialogContent className="max-w-md" onPointerDownOutside={(event) => { if (pending) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>编辑模特资料</DialogTitle><DialogDescription>更新模特基本资料和身份特征描述。</DialogDescription></DialogHeader>
      <div className="grid gap-4"><label className="grid gap-1.5 text-sm">模特编码<input autoFocus value={editorCode} onChange={(event) => { setEditorCode(event.target.value); setEditorError(''); }} disabled={pending} className="h-9 rounded-md border bg-transparent px-3 text-sm" style={{ borderColor: 'var(--border-subtle)' }} /></label><label className="grid gap-1.5 text-sm">模特名称<input value={editorName} onChange={(event) => { setEditorName(event.target.value); setEditorError(''); }} disabled={pending} className="h-9 rounded-md border bg-transparent px-3 text-sm" style={{ borderColor: 'var(--border-subtle)' }} /></label>{editorMode === 'edit' && <label className="grid gap-1.5 text-sm">身份特征描述<textarea value={editorProfile} onChange={(event) => { setEditorProfile(event.target.value); setEditorError(''); }} placeholder="例如：22-26岁东亚女性，深棕黑色长发，鹅蛋脸，自然清透妆感" disabled={pending || (selected ? managementStatus(selected) !== 'draft' : true)} className="min-h-28 rounded-md border bg-transparent p-3 text-sm" style={{ borderColor: 'var(--border-subtle)' }} />{selected && managementStatus(selected) !== 'draft' && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>已发布模特的身份特征不可修改，请在左侧新建模特。</span>}</label>}</div>
      {editorError && <p className="text-sm" role="alert" style={{ color: 'var(--danger)' }}>{editorError}</p>}
      <DialogFooter><button type="button" disabled={pending} onClick={() => setEditorMode(null)} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>取消</button><button type="button" disabled={pending} onClick={() => void saveEditor()} className="rounded-md px-3 py-2 text-sm text-white" style={{ background: 'var(--accent)' }}>{pending ? '保存中' : '保存'}</button></DialogFooter>
    </DialogContent>
  </Dialog><Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deletePending) { setDeleteTarget(null); setDeleteError(''); } }}>
    <DialogContent className="max-w-md" showCloseButton={!deletePending} onPointerDownOutside={(event) => { if (deletePending) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (deletePending) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>删除模特“{deleteTarget?.name}”？</DialogTitle><DialogDescription>删除后，该模特将从模特库移除，不能再用于新任务。历史任务和已上传素材仍会保留。此操作当前无法撤销。</DialogDescription></DialogHeader>
      {deleteError && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{deleteError}</p>}
      <DialogFooter><button type="button" disabled={deletePending} onClick={() => { setDeleteTarget(null); setDeleteError(''); }} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>取消</button><button type="button" disabled={deletePending} onClick={() => void confirmDelete()} className="rounded-md px-3 py-2 text-sm text-white" style={{ background: 'var(--danger)' }}>{deletePending ? '删除中...' : '删除模特'}</button></DialogFooter>
    </DialogContent>
  </Dialog></>;
};
export default VirtualModelLibraryModule;
