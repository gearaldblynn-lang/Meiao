import React, { useState, useEffect } from 'react';
import { X, Plus, Bookmark, Check, Trash2, Search, Pencil } from 'lucide-react';
import type { OneClickReferencePreset } from '../../types';
import ConfirmDialog from './ConfirmDialog';

export interface Preset {
  id: string;
  name: string;
  imageUrl: string;
  tags: string[];
  type: 'style' | 'logo';
  imageKind?: 'hero' | 'main' | 'detail' | 'sku';
  createdAt: string;
}

const IMAGE_KIND_LABELS: Record<string, string> = {
  hero: '首图', main: '主图', detail: '详情页', sku: 'SKU',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (presets: Preset[]) => void;
  lockedKind?: string | null;
  oneClickPresets?: OneClickReferencePreset[];
}

const subModeToKind: Record<string, Preset['imageKind']> = {
  first_image: 'hero',
  main_image: 'main',
  detail_page: 'detail',
  sku: 'sku',
};

const mapOneClickPreset = (preset: any): Preset | null => {
  const imageUrl = preset?.coverImageUrl || preset?.referenceImageUrls?.[0];
  if (!preset?.id || !imageUrl) return null;
  return {
    id: String(preset.id),
    name: String(preset.name || '未命名预设'),
    imageUrl: String(imageUrl),
    tags: Array.isArray(preset.tags) ? preset.tags.filter(Boolean).map(String) : [],
    type: 'style',
    imageKind: subModeToKind[String(preset.subMode)] || undefined,
    createdAt: String(preset.createdAt || Date.now()),
  };
};

const PresetLibrary: React.FC<Props> = ({ open, onClose, onApply, lockedKind, oneClickPresets }) => {
  const [activeTab, setActiveTab] = useState<'style' | 'logo'>('style');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const sharedPresets = Array.isArray(oneClickPresets)
      ? oneClickPresets.map(mapOneClickPreset).filter(Boolean) as Preset[]
      : [];
    setPresets(sharedPresets);
  }, [oneClickPresets, open]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set());
      setEditingId(null);
      setSearch('');
    }
  }, [open]);

  // ESC close
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  const stylePresets = presets.filter((p) => p.type === 'style');
  const logoPresets = presets.filter((p) => p.type === 'logo');

  const filtered = (activeTab === 'style' ? stylePresets : logoPresets).filter((p) => {
    if (activeTab === 'style') {
      if (lockedKind && p.imageKind !== lockedKind) return false;
      if (!lockedKind && kindFilter !== 'all' && p.imageKind !== kindFilter) return false;
    }
    if (!search) return true;
    return p.name.includes(search) || p.tags.some((t) => t.includes(search));
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const pendingDeletePreset = pendingDeleteId ? presets.find((preset) => preset.id === pendingDeleteId) || null : null;

  const handleEditStart = (preset: Preset) => {
    setEditingId(preset.id);
    setEditName(preset.name);
  };

  const handleEditSave = () => {
    if (!editName.trim() || !editingId) return;
    setPresets((prev) => prev.map((p) => (p.id === editingId ? { ...p, name: editName.trim() } : p)));
    setEditingId(null);
  };

  const handleConfirm = () => {
    const selected = presets.filter((p) => selectedIds.has(p.id));
    onApply(selected);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      style={{ background: 'var(--overlay-bg)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] rounded-3xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-elevated)',
          maxHeight: 560,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
              <Bookmark size={15} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>预设库</h3>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {lockedKind ? `已锁定为${IMAGE_KIND_LABELS[lockedKind] || lockedKind}预设` : '选择风格预设或 Logo，可按住多选'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-2xl flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs + Kind filter + Search */}
        <div className="flex items-center gap-3 px-5 pb-3 shrink-0">
          <div className="flex items-center gap-0.5 p-0.5 rounded-2xl" style={{ background: 'var(--bg-surface)' }}>
            <button
              onClick={() => { setActiveTab('style'); setKindFilter('all'); }}
              className="px-3.5 py-1.5 rounded-xl text-[12px] font-medium transition-all"
              style={{
                background: activeTab === 'style' ? 'var(--accent-soft)' : 'transparent',
                color: activeTab === 'style' ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
            >
              风格预设
            </button>
            <button
              onClick={() => { setActiveTab('logo'); setKindFilter('all'); }}
              className="px-3.5 py-1.5 rounded-xl text-[12px] font-medium transition-all"
              style={{
                background: activeTab === 'logo' ? 'var(--accent-soft)' : 'transparent',
                color: activeTab === 'logo' ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
            >
              Logo 库
            </button>
          </div>

          {/* Kind filter — hidden when locked */}
          {activeTab === 'style' && (
            <>
              {lockedKind ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                  <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                    {IMAGE_KIND_LABELS[lockedKind] || lockedKind} 预设
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-0.5 p-0.5 rounded-2xl" style={{ background: 'var(--bg-surface)' }}>
                  {[{ key: 'all', label: '全部' }, { key: 'hero', label: '首图' }, { key: 'main', label: '主图' }, { key: 'detail', label: '详情页' }, { key: 'sku', label: 'SKU' }].map((k) => (
                    <button
                      key={k.key}
                      onClick={() => setKindFilter(k.key)}
                      className="px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all"
                      style={{
                        background: kindFilter === k.key ? 'var(--bg-elevated)' : 'transparent',
                        color: kindFilter === k.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      }}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="flex-1" />
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              className="input-field text-[12px] py-1.5 pl-7 pr-3 rounded-2xl w-32"
            />
          </div>
        </div>

        {/* Grid — scrollable, min-height keeps modal from shrinking */}
        <div className="flex-1 overflow-y-auto px-5 pb-3 scrollbar-none" style={{ minHeight: 240 }}>
          {filtered.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {filtered.map((preset) => {
                const isSelected = selectedIds.has(preset.id);
                const isEditing = editingId === preset.id;

                return (
                  <div
                    key={preset.id}
                    className="group relative rounded-2xl overflow-hidden transition-all"
                    style={{
                      background: 'var(--bg-surface)',
                      border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                      boxShadow: isSelected ? '0 0 0 3px var(--accent-soft)' : 'none',
                      cursor: 'pointer',
                    }}
                    onClick={() => { if (!isEditing) toggleSelect(preset.id); }}
                    onMouseEnter={(e) => { if (!isSelected && !isEditing) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-default)'; }}
                    onMouseLeave={(e) => { if (!isSelected && !isEditing) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'; }}
                  >
                    {/* Image */}
                    <div className="aspect-square overflow-hidden relative">
                      <img src={preset.imageUrl} alt={preset.name} className="w-full h-full object-cover" />

                      {/* Selected overlay */}
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(37,99,235,0.15)' }}>
                          <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ background: 'var(--accent)' }}>
                            <Check size={15} className="text-white" />
                          </div>
                        </div>
                      )}

                      {/* Hover actions */}
                      {!isSelected && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditStart(preset); }}
                            className="w-7 h-7 rounded-xl flex items-center justify-center transition-colors"
                            style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
                            title="编辑"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(preset.id); }}
                            className="w-7 h-7 rounded-xl flex items-center justify-center transition-colors"
                            style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
                            title="删除"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}

                      {/* Kind badge */}
                      {preset.imageKind && (
                        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[9px] font-medium" style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>
                          {IMAGE_KIND_LABELS[preset.imageKind] || preset.imageKind}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-2.5">
                      {isEditing ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="input-field text-[12px] py-1 px-2 rounded-xl flex-1"
                            onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave(); if (e.key === 'Escape') setEditingId(null); }}
                            autoFocus
                          />
                          <button onClick={handleEditSave} className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ color: 'var(--success)' }}>
                            <Check size={14} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{preset.name}</p>
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {preset.tags.map((tag) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add new */}
              <button
                className="flex flex-col items-center justify-center gap-2 aspect-square rounded-2xl border border-dashed transition-colors"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface-hover)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)'; }}
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-2xl" style={{ background: 'var(--bg-elevated)' }}>
                  <Plus size={16} style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>新建预设</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Bookmark size={24} style={{ color: 'var(--text-disabled)' }} />
              <p className="mt-2 text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>暂无预设</p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>上传风格参考图后可保存为预设</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="shrink-0 flex items-center justify-between px-5 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            已选 <span className="font-semibold" style={{ color: 'var(--accent)' }}>{selectedIds.size}</span> 个
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-2xl text-[12px] font-medium transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              清空
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
              className="px-5 py-2 rounded-2xl text-[12px] font-semibold text-white transition-all disabled:opacity-30"
              style={{ background: 'var(--accent)' }}
            >
              确认添加
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeletePreset !== null}
        title="删除预设"
        message={pendingDeletePreset ? `确定要删除预设「${pendingDeletePreset.name}」吗？此操作不可恢复。` : '确定要删除这个预设吗？此操作不可恢复。'}
        onConfirm={() => {
          if (pendingDeletePreset) handleDelete(pendingDeletePreset.id);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
};

export default PresetLibrary;
