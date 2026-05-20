import React, { useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Film, Music2 } from 'lucide-react';
import type { Material } from '../../ShellMigratedApp';
import ImageLightbox from './ImageLightbox';

const TYPE_META: Record<string, { label: string; color: string }> = {
  product:    { label: '产品', color: '#3B82F6' },
  gift:       { label: '赠品', color: '#F59E0B' },
  logo:       { label: 'Logo', color: '#8B5CF6' },
  styleRef:   { label: '风格', color: '#EC4899' },
  atmosphere: { label: '氛围', color: '#06B6D4' },
  texture:    { label: '质感', color: '#F59E0B' },
  model:      { label: '模特', color: '#10B981' },
  scene:      { label: '场景', color: '#6366F1' },
  referenceVideo: { label: '视频', color: '#14B8A6' },
  audio:      { label: '音频', color: '#A855F7' },
  textRef:    { label: '文案', color: '#EF4444' },
  xhsPreset:  { label: '预设', color: '#EC4899' },
};

const getMediaKind = (type: string, url = '', fileName = '') => {
  const source = `${url} ${fileName}`.toLowerCase();
  if (type === 'audio' || /\.(mp3|wav|m4a|aac|ogg|flac)(?:\?|$)/.test(source)) return 'audio';
  if (type === 'referenceVideo' || /\.(mp4|mov|webm|m4v)(?:\?|$)/.test(source)) return 'video';
  return 'image';
};

interface Props {
  materials: Record<string, Material[]>;
  onRemoveMaterial: (type: string, id: string) => void;
}

const MaterialPreviewBar: React.FC<Props> = ({ materials, onRemoveMaterial }) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [selectedVideo, setSelectedVideo] = useState<{ url: string; fileName: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const groups = Object.entries(materials)
    .filter(([, list]) => list.length > 0)
    .map(([type, list]) => ({
      type,
      list: type === 'gift'
        ? [...list].sort((a, b) => (a.giftIndex || 0) - (b.giftIndex || 0))
        : list,
      meta: TYPE_META[type] || { label: type, color: '#71717A' },
    }));

  if (groups.length === 0) return null;

  const allUrls = groups.flatMap((g) =>
    g.list
      .filter((m) => getMediaKind(g.type, m.url, m.fileName) === 'image')
      .map((m) => m.url)
  );

  const toggleGroup = (type: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  const openLightbox = (url: string) => {
    const idx = allUrls.indexOf(url);
    if (idx >= 0) {
      setLightboxIndex(idx);
      setLightboxOpen(true);
    }
  };

  const openVideoPreview = (material: Material) => {
    if (!material.url) return;
    setSelectedVideo({ url: material.url, fileName: material.fileName || '视频素材' });
  };

  const totalCount = groups.reduce((sum, group) => sum + group.list.length, 0);

  return (
    <>
      <div className="mb-3 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            已上传 {totalCount} 个素材
          </span>
        </div>

        {/* Scroll row */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => scroll('left')}
            className="flex items-center justify-center w-6 h-6 rounded-xl shrink-0 transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronLeft size={14} />
          </button>

          <div
            ref={scrollRef}
            className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0"
          >
            {groups.map(({ type, list, meta }) => {
              const collapsed = collapsedGroups[type];
              const showCount = collapsed ? 1 : list.length;

              return (
                <React.Fragment key={type}>
                  {/* Group label */}
                  <button
                    onClick={() => toggleGroup(type)}
                    className="flex items-center gap-1 px-2 py-1 rounded-full shrink-0 transition-all"
                    style={{
                      background: `${meta.color}15`,
                      border: `1px solid ${meta.color}25`,
                    }}
                    title={collapsed ? '点击展开' : '点击收起'}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                    <span className="text-[10px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-[9px]" style={{ color: 'var(--text-disabled)' }}>{list.length}</span>
                  </button>

                  {/* Group images */}
                  {list.slice(0, showCount).map((m) => {
                    const mediaKind = getMediaKind(type, m.url, m.fileName);
                    return (
                      <div key={m.id} className="relative shrink-0 group">
                      <button
                        type="button"
                        onClick={() => { mediaKind === 'video' ? openVideoPreview(m) : mediaKind === 'image' ? openLightbox(m.url) : undefined; }}
                        className="block w-11 h-11 rounded-2xl overflow-hidden transition-transform"
                        style={{ border: `1.5px solid ${meta.color}30` }}
                        title={mediaKind === 'video' ? '点击播放' : mediaKind === 'image' ? '点击预览' : m.fileName}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
                      >
                        {mediaKind === 'video' ? (
                          <video src={m.url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                        ) : mediaKind === 'audio' ? (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[9px] font-semibold" style={{ background: `${meta.color}12`, color: meta.color }}>
                            <Music2 size={14} />
                            音频
                          </span>
                        ) : (
                          <img src={m.url} alt={m.fileName} className="w-full h-full object-cover" />
                        )}
                      </button>
                      {mediaKind === 'video' ? (
                        <span
                          className="absolute bottom-0.5 left-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-semibold text-white"
                          style={{ background: 'rgba(0,0,0,0.52)' }}
                        >
                          <Film size={8} className="inline" />
                        </span>
                      ) : null}
                      {type === 'gift' && m.giftIndex ? (
                        <span
                          className="absolute bottom-0.5 left-0.5 rounded-full px-1.5 py-0.5 text-[8px] font-semibold text-white"
                          style={{ background: 'rgba(0,0,0,0.52)' }}
                        >
                          赠品{m.giftIndex}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveMaterial(type, m.id);
                        }}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: 'var(--error)' }}
                      >
                        <X size={9} className="text-white" />
                      </button>
                      </div>
                    );
                  })}

                  {/* Expand hint */}
                  {collapsed && list.length > 1 && (
                    <button
                      onClick={() => toggleGroup(type)}
                      className="flex items-center justify-center w-11 h-11 rounded-2xl shrink-0 text-[10px] font-medium transition-colors"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', border: '1px solid var(--border-subtle)' }}
                    >
                      +{list.length - 1}
                    </button>
                  )}

                  {/* Group divider */}
                  <div className="w-px h-6 shrink-0" style={{ background: 'var(--border-subtle)' }} />
                </React.Fragment>
              );
            })}
          </div>

          <button
            onClick={() => scroll('right')}
            className="flex items-center justify-center w-6 h-6 rounded-xl shrink-0 transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <ImageLightbox
        open={lightboxOpen}
        images={allUrls}
        currentIndex={lightboxIndex}
        onClose={() => setLightboxOpen(false)}
        onPrev={() => setLightboxIndex((i) => (i - 1 + allUrls.length) % allUrls.length)}
        onNext={() => setLightboxIndex((i) => (i + 1) % allUrls.length)}
      />

      <ImageLightbox
        open={Boolean(selectedVideo)}
        images={[]}
        items={selectedVideo ? [{ url: selectedVideo.url, type: 'video', title: selectedVideo.fileName }] : []}
        currentIndex={0}
        onClose={() => setSelectedVideo(null)}
        onPrev={() => undefined}
        onNext={() => undefined}
      />

    </>
  );
};

export default MaterialPreviewBar;
