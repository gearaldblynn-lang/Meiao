import React, { useEffect, useMemo, useState } from 'react';
import { OneClickReferenceDimension, OneClickReferencePreset, OneClickSubMode } from '../../types';

const DIMENSION_OPTIONS: Array<{ value: OneClickReferenceDimension; label: string }> = [
  { value: 'visual_style', label: '视觉风格' },
  { value: 'typography', label: '字体' },
  { value: 'color_palette', label: '色调' },
  { value: 'layout', label: '排版' },
];

const SUBMODE_LABELS: Record<OneClickSubMode, string> = {
  [OneClickSubMode.FIRST_IMAGE]: '首图',
  [OneClickSubMode.MAIN_IMAGE]: '主图',
  [OneClickSubMode.DETAIL_PAGE]: '详情',
  [OneClickSubMode.SKU]: 'SKU',
};

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  initialValue: OneClickReferencePreset | null;
  onClose: () => void;
  onSubmit: (preset: OneClickReferencePreset) => void;
}

const ReferencePresetEditorModal: React.FC<Props> = ({ open, mode, initialValue, onClose, onSubmit }) => {
  const [draft, setDraft] = useState<OneClickReferencePreset | null>(initialValue);
  const [imageInput, setImageInput] = useState('');
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setDraft(initialValue);
    setImageInput('');
    setTagInput('');
  }, [initialValue]);

  const imageList = useMemo(() => draft?.referenceImageUrls || [], [draft]);

  if (!open || !draft) return null;

  const setField = <K extends keyof OneClickReferencePreset>(key: K, value: OneClickReferencePreset[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const addImage = () => {
    const nextUrl = imageInput.trim();
    if (!nextUrl || imageList.includes(nextUrl)) return;
    const nextImages = [...imageList, nextUrl];
    setField('referenceImageUrls', nextImages);
    if (!draft.coverImageUrl) setField('coverImageUrl', nextUrl);
    setImageInput('');
  };

  const removeImage = (url: string) => {
    const nextImages = imageList.filter((item) => item !== url);
    setField('referenceImageUrls', nextImages);
    if (draft.coverImageUrl === url) setField('coverImageUrl', nextImages[0] || '');
  };

  const toggleDimension = (value: OneClickReferenceDimension) => {
    const next = draft.referenceDimensions.includes(value)
      ? draft.referenceDimensions.filter((item) => item !== value)
      : [...draft.referenceDimensions, value];
    setField('referenceDimensions', next);
  };

  const addTag = () => {
    const nextTag = tagInput.trim();
    if (!nextTag || draft.tags.includes(nextTag)) return;
    setField('tags', [...draft.tags, nextTag]);
    setTagInput('');
  };

  const canSubmit = draft.name.trim() && draft.summary.trim() && imageList.length > 0;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/55 p-6">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-black text-slate-900">{mode === 'create' ? '新增预设' : '编辑预设'}</h3>
            <p className="mt-1 text-[11px] text-slate-400">图文一体化预设编辑</p>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <i className="fas fa-times text-xs"></i>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_0.9fr] overflow-hidden">
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-2">
                <span className="text-xs font-bold text-slate-500">预设名称</span>
                <input value={draft.name} onChange={(e) => setField('name', e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20" />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-bold text-slate-500">适用子功能</span>
                <select value={draft.subMode} onChange={(e) => setField('subMode', e.target.value as OneClickSubMode)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20">
                  {Object.entries(SUBMODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <label className="space-y-2">
              <span className="text-xs font-bold text-slate-500">摘要</span>
              <textarea value={draft.summary} onChange={(e) => setField('summary', e.target.value)} rows={3} className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20" />
            </label>

            <label className="space-y-2">
              <span className="text-xs font-bold text-slate-500">完整说明</span>
              <textarea value={draft.detail} onChange={(e) => setField('detail', e.target.value)} rows={8} className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20" />
            </label>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-500">参考图 URL</span>
              <div className="flex gap-2">
                <input value={imageInput} onChange={(e) => setImageInput(e.target.value)} placeholder="https://..." className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20" />
                <button type="button" onClick={addImage} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">添加</button>
              </div>
              <div className="space-y-2">
                {imageList.map((url) => (
                  <div key={url} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <input type="radio" checked={draft.coverImageUrl === url} onChange={() => setField('coverImageUrl', url)} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{url}</span>
                    <button type="button" onClick={() => removeImage(url)} className="text-xs font-bold text-rose-600">删除</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5 overflow-y-auto border-l border-slate-100 bg-slate-50 px-6 py-5">
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-500">封面预览</span>
              <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">
                {draft.coverImageUrl ? (
                  <img src={draft.coverImageUrl} className="aspect-square w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-xs font-bold text-slate-400">未设置封面图</div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-500">参考维度</span>
              <div className="flex flex-wrap gap-2">
                {DIMENSION_OPTIONS.map((item) => {
                  const selected = draft.referenceDimensions.includes(item.value);
                  return (
                    <button key={item.value} type="button" onClick={() => toggleDimension(item.value)} className={`rounded-full px-3 py-1.5 text-[11px] font-black ${selected ? 'bg-rose-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-500">标签</span>
              <div className="flex gap-2">
                <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20" />
                <button type="button" onClick={addTag} className="rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200">添加</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {draft.tags.map((tag) => (
                  <button key={tag} type="button" onClick={() => setField('tags', draft.tags.filter((item) => item !== tag))} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-slate-600 ring-1 ring-slate-200">
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
          <p className="text-[11px] text-slate-400">名称、摘要、至少一张参考图为必填。</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-600">取消</button>
            <button
              onClick={() => canSubmit && onSubmit({ ...draft, detail: draft.detail.trim() || draft.summary.trim() })}
              disabled={!canSubmit}
              className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReferencePresetEditorModal;
