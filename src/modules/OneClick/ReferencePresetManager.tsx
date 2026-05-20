import React, { useMemo, useState } from 'react';
import { OneClickReferencePreset, OneClickSubMode } from '../../types';
import { filterReferencePresets } from './referencePresetUtils.mjs';

const SUBMODE_LABELS: Record<OneClickSubMode, string> = {
  [OneClickSubMode.FIRST_IMAGE]: '首图',
  [OneClickSubMode.MAIN_IMAGE]: '主图',
  [OneClickSubMode.DETAIL_PAGE]: '详情',
  [OneClickSubMode.SKU]: 'SKU',
};

const getPresetContentLabel = (preset: OneClickReferencePreset) =>
  preset.contentType === 'images_only' ? '仅保存参考图' : '图片 + 分析结果';

interface Props {
  open: boolean;
  title: string;
  activeSubMode: OneClickSubMode;
  presets: OneClickReferencePreset[];
  onClose: () => void;
  onApply: (preset: OneClickReferencePreset) => void;
  onEdit: (preset: OneClickReferencePreset) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onSaveCurrent?: () => void;
}

const formatTime = (value: number) => {
  if (!value) return '未知时间';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
};

const ReferencePresetManager: React.FC<Props> = ({
  open,
  title,
  activeSubMode,
  presets,
  onClose,
  onApply,
  onEdit,
  onDelete,
  onCreate,
  onSaveCurrent,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visiblePresets = useMemo(
    () => filterReferencePresets(presets, { subMode: activeSubMode, query }).sort((a, b) => b.updatedAt - a.updatedAt),
    [presets, activeSubMode, query],
  );
  const selectedPreset = visiblePresets.find((item) => item.id === selectedIds[selectedIds.length - 1]) || visiblePresets[0] || null;
  const selectedPresetSet = new Set(selectedIds);
  const handleSelect = (preset: OneClickReferencePreset) => {
    if (activeSubMode === OneClickSubMode.FIRST_IMAGE) {
      setSelectedIds((prev) =>
        prev.includes(preset.id)
          ? prev.filter((item) => item !== preset.id)
          : [...prev, preset.id]
      );
      return;
    }
    setSelectedIds([preset.id]);
  };
  const handleApplySelected = () => {
    const picked = visiblePresets.filter((preset) => selectedPresetSet.has(preset.id));
    if (picked.length === 0) return;
    if (activeSubMode !== OneClickSubMode.FIRST_IMAGE || picked.length === 1) {
      onApply(picked[0]);
      return;
    }
    const merged: OneClickReferencePreset = {
      id: `merged_first_image_${Date.now()}`,
      name: picked.map((item) => item.name).join(' / '),
      subMode: OneClickSubMode.FIRST_IMAGE,
      contentType: 'images_only',
      coverImageUrl: picked[0].coverImageUrl,
      referenceImageUrls: Array.from(new Set(picked.flatMap((item) => item.referenceImageUrls.filter(Boolean)))),
      summary: '',
      detail: '',
      referenceDimensions: Array.from(new Set(picked.flatMap((item) => item.referenceDimensions))),
      tags: Array.from(new Set(picked.flatMap((item) => item.tags))),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    onApply(merged);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-6">
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{title}</h3>
            <p className="mt-1 text-[11px] text-slate-400">卡片式图文预设管理中心</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] overflow-hidden">
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {Object.entries(SUBMODE_LABELS).map(([value, label]) => (
                <span key={value} className={`rounded-full px-3 py-1.5 text-[11px] font-black ${value === activeSubMode ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {label}
                </span>
              ))}
              <div className="ml-auto flex gap-2">
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称、参考图或分析结果" className="w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-rose-500/20" />
                <button type="button" onClick={onCreate} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">新增预设</button>
                {onSaveCurrent ? <button type="button" onClick={onSaveCurrent} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white">保存当前</button> : null}
                {activeSubMode === OneClickSubMode.FIRST_IMAGE ? <button type="button" onClick={handleApplySelected} disabled={selectedIds.length === 0} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">应用已选 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}</button> : null}
              </div>
            </div>

            {visiblePresets.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-center">
                <p className="text-sm font-black text-slate-500">当前分类还没有预设</p>
                <p className="mt-2 text-[11px] text-slate-400">可以从当前参考内容保存，或手动新增一套预设。</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {visiblePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelect(preset)}
                    className={`overflow-hidden rounded-[24px] border text-left transition ${selectedPresetSet.has(preset.id) || selectedPreset?.id === preset.id ? 'border-rose-300 bg-rose-50/40 shadow-[0_12px_32px_rgba(244,63,94,0.12)]' : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)]'}`}
                  >
                    <div className="aspect-square bg-slate-100">
                      {preset.coverImageUrl ? (
                        <img src={preset.coverImageUrl} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">待补参考图</div>
                      )}
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-black text-slate-800">{preset.name}</p>
                        <div className="flex items-center gap-2">
                          {activeSubMode === OneClickSubMode.FIRST_IMAGE ? <span className={`h-4 w-4 rounded border ${selectedPresetSet.has(preset.id) ? 'border-rose-600 bg-rose-600' : 'border-slate-300 bg-white'}`}></span> : null}
                          <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">{SUBMODE_LABELS[preset.subMode]}</span>
                        </div>
                      </div>
                      <p className="rounded-xl bg-slate-50 px-2.5 py-2 text-[10px] font-bold text-slate-500">{getPresetContentLabel(preset)}</p>
                      <p className="line-clamp-3 min-h-[54px] whitespace-pre-wrap text-[11px] leading-5 text-slate-500">{preset.summary || '该预设仅保存参考图，不录入卖点信息。'}</p>
                      <div className="flex flex-wrap gap-1">
                        {preset.referenceDimensions.slice(0, 3).map((dimension) => (
                          <span key={dimension} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-400 ring-1 ring-slate-200">{dimension}</span>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-400">{formatTime(preset.updatedAt)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col border-l border-slate-100 bg-slate-50 px-5 py-5">
            {selectedPreset ? (
              <>
                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  {selectedPreset.coverImageUrl ? (
                    <img src={selectedPreset.coverImageUrl} className="aspect-square w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-xs font-bold text-slate-400">待补参考图</div>
                  )}
                </div>
                <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-800">{selectedPreset.name}</p>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">{SUBMODE_LABELS[selectedPreset.subMode]}</span>
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">{formatTime(selectedPreset.updatedAt)}</p>
                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                    {getPresetContentLabel(selectedPreset)}
                  </div>
                  {selectedPreset.contentType === 'images_with_analysis' ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-600 whitespace-pre-wrap">
                      {selectedPreset.detail}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-500">
                      该预设只保存参考图，不录入卖点信息或分析正文。
                    </div>
                  )}
                  {selectedPreset.referenceImageUrls.length > 1 ? (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {selectedPreset.referenceImageUrls.map((url) => (
                        <div key={url} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                          <img src={url} className="aspect-square w-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => onApply(selectedPreset)} className="flex-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-black text-white">应用</button>
                  <button onClick={() => onEdit(selectedPreset)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">编辑</button>
                  <button onClick={() => { if (window.confirm('确认删除该预设？')) onDelete(selectedPreset.id); }} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-600">删除</button>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs font-bold text-slate-400">选择一张卡片查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferencePresetManager;
