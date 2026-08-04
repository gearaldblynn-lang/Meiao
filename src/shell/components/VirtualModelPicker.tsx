import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { fetchVirtualModel, fetchVirtualModels, type VirtualModelSummary } from '../../services/internalApi';

type Selection = {
  virtualModelId: string;
  virtualModelVersionId: string;
  modelName?: string;
  modelCode?: string;
  versionNumber?: number;
  publishedAt?: number;
};

type Props = {
  open: boolean;
  selected: Selection | null;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
};

const STALE_SELECTION_MESSAGE = '此前选择的模特尚未发布或正在编辑草稿，请重新选择。';
const isSelectableVirtualModel = (model: VirtualModelSummary) => (
  model.status === 'published'
  && model.version?.status === 'published'
  && model.currentVersionId === model.version?.id
  && Number(model.version?.publishedAt) > 0
);

const VirtualModelPicker: React.FC<Props> = ({ open, selected, onSelect, onClose }) => {
  const [models, setModels] = useState<VirtualModelSummary[]>([]);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(selected);
  const [detailModel, setDetailModel] = useState<VirtualModelSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchVirtualModels()
      .then(({ models: nextModels }) => {
        if (cancelled) return;
        const selectableModels = nextModels.filter(isSelectableVirtualModel);
        setModels(selectableModels);
        if (selected && !selectableModels.some((model) => (
          model.id === selected.virtualModelId
          && model.currentVersionId === selected.virtualModelVersionId
        ))) {
          setPendingSelection(null);
          setDetailModel(null);
          setError(STALE_SELECTION_MESSAGE);
        } else {
          setPendingSelection(selected);
          setError('');
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load public models.');
      });
    return () => { cancelled = true; };
  }, [open, selected]);

  const tags = useMemo(() => [...new Set(models.flatMap((model) => model.tags || []))], [models]);
  const visibleModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return models.filter((model) => {
      const matchesQuery = !normalizedQuery
        || model.name.toLowerCase().includes(normalizedQuery)
        || model.code.toLowerCase().includes(normalizedQuery);
      return matchesQuery && (!selectedTag || (model.tags || []).includes(selectedTag));
    });
  }, [models, query, selectedTag]);

  const showDetail = (model: VirtualModelSummary) => {
    setError('');
    setDetailModel(model);
    void fetchVirtualModel(model.id)
      .then(({ model: detail }) => {
        if (!isSelectableVirtualModel(detail)) throw new Error(STALE_SELECTION_MESSAGE);
        setDetailModel(detail);
      })
      .catch(() => {
        setDetailModel(null);
        setPendingSelection(null);
        setError(STALE_SELECTION_MESSAGE);
      });
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[290] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.62)' }}>
      <section className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>公共模特库</h2>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>选择已发布的模特版本</p>
          </div>
          <button type="button" onClick={onClose} title="关闭" className="flex h-8 w-8 items-center justify-center rounded-md" style={{ color: 'var(--text-secondary)' }}><X size={16} /></button>
        </header>
        <div className="flex flex-wrap gap-2 border-b px-5 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或编号" className="w-full bg-transparent text-[13px] outline-none" style={{ color: 'var(--text-primary)' }} />
          </label>
          <select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} className="rounded-md border px-3 text-[13px]" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
            <option value="">全部标签</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleModels.map((model) => {
              const active = pendingSelection?.virtualModelId === model.id && pendingSelection.virtualModelVersionId === model.currentVersionId;
              const cover = model.coverUrl || model.version?.thumbnailUrl || '';
              return <button key={model.id} type="button" onClick={() => { setPendingSelection({ virtualModelId: model.id, virtualModelVersionId: model.currentVersionId, modelName: model.name, modelCode: model.code, versionNumber: model.version?.versionNumber, publishedAt: model.version?.publishedAt || undefined }); showDetail(model); }} className="w-[132px] overflow-hidden rounded-md border text-left" style={{ borderColor: active ? 'var(--accent)' : 'var(--border-subtle)' }}>
                <div className="aspect-[3/4] bg-[var(--bg-elevated)]">{cover ? <img src={cover} alt={model.name} className="h-full w-full object-cover object-top" /> : null}</div>
                <div className="p-2"><p className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{model.name}</p><p className="truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{model.code}</p></div>
              </button>;
            })}
            {!error && visibleModels.length === 0 && <p className="col-span-full py-8 text-center text-[12px]" style={{ color: 'var(--text-tertiary)' }}>没有可选模特</p>}
            {error && <p className="col-span-full py-8 text-center text-[12px] text-red-600">{error}</p>}
          </div>
          <aside className="rounded-md border p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
            {detailModel ? <><div className="aspect-[3/4] overflow-hidden rounded-sm bg-[var(--bg-surface)]">{(detailModel.coverUrl || detailModel.version?.thumbnailUrl) ? <img src={detailModel.coverUrl || detailModel.version?.thumbnailUrl} alt={detailModel.name} className="h-full w-full object-cover object-top" /> : null}</div><p className="mt-3 text-[11px] font-medium" style={{ color: 'var(--accent)' }}>已选择模特</p><p className="mt-1 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{detailModel.name}</p><p className="mt-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{detailModel.code} · 版本 {detailModel.version?.versionNumber || '-'}</p><div className="mt-3 flex flex-wrap gap-1">{(detailModel.tags || []).map((tag) => <span key={tag} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>{tag}</span>)}</div></> : <p className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>选择一个模特查看公开信息</p>}
          </aside>
        </div>
        <footer className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>取消</button>
          <button type="button" disabled={!pendingSelection} onClick={() => {
            const model = models.find((item) => item.id === pendingSelection?.virtualModelId);
            if (!model || !isSelectableVirtualModel(model)) {
              setPendingSelection(null);
              setDetailModel(null);
              setError(STALE_SELECTION_MESSAGE);
              return;
            }
            onSelect({ virtualModelId: model.id, virtualModelVersionId: model.currentVersionId, modelName: model.name, modelCode: model.code, versionNumber: model.version?.versionNumber, publishedAt: model.version?.publishedAt || undefined });
            onClose();
          }} className="flex items-center gap-1 rounded-md px-3 py-2 text-[12px] text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}><Check size={14} />确认选择</button>
        </footer>
      </section>
    </div>
  );
};

export default VirtualModelPicker;
