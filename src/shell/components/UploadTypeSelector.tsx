import React, { useRef, useEffect } from 'react';
import { Package, Palette, ImagePlus, AtSign, Shirt, FileImage, Gift, Film, Music2 } from 'lucide-react';

export type MaterialType =
  | 'product'
  | 'gift'
  | 'logo'
  | 'styleRef'
  | 'atmosphere'
  | 'texture'
  | 'model'
  | 'scene'
  | 'referenceVideo'
  | 'audio';

interface MaterialDef {
  key: MaterialType;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const ALL_MATERIALS: MaterialDef[] = [
  { key: 'product',    label: '产品素材',   desc: '产品主体照片',     icon: <Package size={16} /> },
  { key: 'gift',       label: '赠品素材',   desc: '按上传顺序编号',   icon: <Gift size={16} /> },
  { key: 'logo',       label: '品牌 Logo',  desc: '品牌标识图',       icon: <AtSign size={16} /> },
  { key: 'styleRef',   label: '风格参考',   desc: '视觉风格参考',     icon: <Palette size={16} /> },
  { key: 'atmosphere', label: '氛围参照',   desc: '环境风格与光线参考', icon: <ImagePlus size={16} /> },
  { key: 'texture',    label: '质感参照',   desc: '材质纹理参考',     icon: <FileImage size={16} /> },
  { key: 'model',      label: '模特参考',   desc: '面部与姿势参考',   icon: <Shirt size={16} /> },
  { key: 'scene',      label: '场景参考',   desc: '拍摄场景参考',     icon: <ImagePlus size={16} /> },
  { key: 'referenceVideo', label: '参考视频', desc: '爆款裂变参考', icon: <Film size={16} /> },
  { key: 'audio', label: '参考音频', desc: '音乐/节奏参考', icon: <Music2 size={16} /> },
];

const MODULE_MATERIALS: Record<string, MaterialType[]> = {
  one_click:   ['product', 'logo', 'styleRef'],
  translation: ['product'],
  retouch:     ['product', 'texture', 'styleRef'],
  everything_replace: ['product', 'logo', 'styleRef'],
  buyer_show:  ['product', 'atmosphere', 'model'],
  video:       ['product', 'scene', 'referenceVideo', 'audio'],
  xhs_cover:   ['product', 'styleRef'],
  agent_center: ['product', 'styleRef'],
};

interface Props {
  module: string;
  open: boolean;
  onClose: () => void;
  onSelect: (type: MaterialType) => void;
  onMaterialAction?: (type: MaterialType) => void;
  materialTypes?: MaterialType[];
  materialLabels?: Partial<Record<MaterialType, Partial<Omit<MaterialDef, 'key'>>>>;
  materialActionLabels?: Partial<Record<MaterialType, string>>;
}

const UploadTypeSelector: React.FC<Props> = ({ module, open, onClose, onSelect, onMaterialAction, materialTypes, materialLabels, materialActionLabels }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const types = materialTypes || MODULE_MATERIALS[module] || ['product', 'styleRef'];
  const materials = types
    .map((t) => {
      const material = ALL_MATERIALS.find((m) => m.key === t);
      return material ? { ...material, ...(materialLabels?.[t] || {}) } : null;
    })
    .filter(Boolean) as MaterialDef[];

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[180]" onClick={onClose} />
      <div
        ref={panelRef}
        className="absolute bottom-full left-0 mb-2 rounded-3xl border p-3 z-[200] min-w-[260px]"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
          boxShadow: 'var(--shadow-elevated)',
          animation: 'scale-in 0.15s ease',
        }}
      >
        <div className="grid grid-cols-2 gap-1.5">
          {materials.map((m) => (
            <div
              key={m.key}
              className="flex items-center gap-2.5 rounded-2xl p-2.5 text-left transition-all"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-surface-hover)';
                (e.currentTarget as HTMLDivElement).style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                (e.currentTarget as HTMLDivElement).style.color = 'var(--text-secondary)';
              }}
            >
              <button
                type="button"
                onClick={() => { onSelect(m.key); onClose(); }}
                className="flex items-center justify-center h-8 w-8 rounded-full shrink-0"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                title={m.label}
              >
                {m.icon}
              </button>
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => { onSelect(m.key); onClose(); }}
                  className="block text-left text-[11px] font-medium"
                  style={{ color: 'inherit' }}
                >
                  {m.label}
                </button>
                {materialActionLabels?.[m.key] ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMaterialAction?.(m.key);
                      onClose();
                    }}
                    className="mt-1 rounded-full px-2 py-0.5 text-[9px] font-medium"
                    style={{ background: 'rgba(37,99,235,0.14)', color: 'var(--accent)' }}
                  >
                    {materialActionLabels[m.key]}
                  </button>
                ) : (
                  <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{m.desc}</p>
                )}
              </div>
            </div>
          ))}

        </div>
      </div>
    </>
  );
};

export default UploadTypeSelector;
