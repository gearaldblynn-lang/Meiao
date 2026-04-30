import React, { useRef, useState } from 'react';
import { GlobalApiConfig, XhsCoverAspectRatio, XhsCoverFontStyle, XhsCoverPersistentState, XhsCoverStyle } from '../../types';
import { XHS_COVER_STYLES, XHS_STYLE_CATEGORIES } from './xhsCoverStyles';

interface Props {
  state: XhsCoverPersistentState;
  onUpdate: (updates: Partial<XhsCoverPersistentState>) => void;
  onStart: () => void;
  isProcessing: boolean;
  apiConfig: GlobalApiConfig;
}

const ASPECT_RATIOS: { value: XhsCoverAspectRatio; label: string }[] = [
  { value: '3:4', label: '3:4 竖版' },
  { value: '1:1', label: '1:1 方形' },
  { value: '9:16', label: '9:16 全屏' },
];

const FONT_STYLES: { value: XhsCoverFontStyle; label: string; preview: string }[] = [
  { value: 'variety', label: '综艺体', preview: '综' },
  { value: 'songti', label: '宋体', preview: '宋' },
  { value: 'rounded', label: '圆体', preview: '圆' },
  { value: 'handwriting', label: '手写体', preview: '写' },
  { value: 'calligraphy', label: '书法体', preview: '书' },
];

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs font-black tracking-wide text-slate-500 mb-2">{children}</p>
);

const XhsCoverSidebar: React.FC<Props> = ({ state, onUpdate, onStart, isProcessing }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    onUpdate({ productImages: files.slice(0, 3), uploadedProductUrls: [] });
    e.target.value = '';
  };

  const toggleStyle = (id: string) => {
    const current = state.selectedStyleIds;
    if (current.includes(id)) {
      if (current.length <= 1) return;
      onUpdate({ selectedStyleIds: current.filter((s) => s !== id) });
    } else {
      onUpdate({ selectedStyleIds: [...current, id] });
    }
  };

  const toggleCat = (label: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  const canStart = state.productImages.length > 0 || (state.uploadedProductUrls?.length ?? 0) > 0;

  return (
    <aside className="w-80 shrink-0 flex flex-col h-full border-r border-slate-100 bg-white overflow-y-auto scrollbar-hide">
      <div className="p-5 space-y-5">
        <ImageUploadSection state={state} fileInputRef={fileInputRef} onUpload={handleImageUpload} />
        <TitleSection state={state} onUpdate={onUpdate} />
        <AspectRatioSection state={state} onUpdate={onUpdate} />
        <FontStyleSection state={state} onUpdate={onUpdate} />
        <StyleSelectionSection
          state={state}
          toggleStyle={toggleStyle}
          collapsedCats={collapsedCats}
          toggleCat={toggleCat}
          onPreview={setPreviewImg}
        />
        <DecorationSection state={state} onUpdate={onUpdate} />
        <GenerateButton state={state} canStart={canStart} isProcessing={isProcessing} onStart={onStart} />
      </div>
      {previewImg && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-8"
          onClick={() => setPreviewImg(null)}
        >
          <img
            src={previewImg}
            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl border-4 border-white/10 object-contain"
            onClick={(e) => e.stopPropagation()}
            alt="style preview"
          />
        </div>
      )}
    </aside>
  );
};

export default XhsCoverSidebar;

const ImageUploadSection: React.FC<{
  state: XhsCoverPersistentState;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ state, fileInputRef, onUpload }) => (
  <div>
    <SectionLabel>上传图片</SectionLabel>
    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onUpload} />
    {state.productImages.length > 0 ? (
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {state.productImages.map((file, i) => (
            <div key={i} className="aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
              <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" alt="" />
            </div>
          ))}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-2 text-[11px] font-bold text-slate-500 border border-dashed border-slate-200 rounded-xl hover:border-rose-300 hover:text-rose-500 transition-all"
        >
          重新上传
        </button>
      </div>
    ) : (
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full py-8 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center gap-2 hover:border-rose-300 hover:bg-rose-50/30 transition-all group"
      >
        <i className="fas fa-cloud-upload-alt text-2xl text-slate-300 group-hover:text-rose-400 transition-colors" />
        <span className="text-[11px] font-bold text-slate-400 group-hover:text-rose-500">上传人像/产品图（最多3张）</span>
      </button>
    )}
  </div>
);

type UpdateFn = (updates: Partial<XhsCoverPersistentState>) => void;

const TitleSection: React.FC<{ state: XhsCoverPersistentState; onUpdate: UpdateFn }> = ({ state, onUpdate }) => (
  <div>
    <SectionLabel>封面标题</SectionLabel>
    <input
      type="text"
      value={state.title}
      onChange={(e) => onUpdate({ title: e.target.value })}
      placeholder="主标题（必填）"
      className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all"
    />
    <input
      type="text"
      value={state.subtitle}
      onChange={(e) => onUpdate({ subtitle: e.target.value })}
      placeholder="副标题（选填）"
      className="mt-2 w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all"
    />
  </div>
);

const AspectRatioSection: React.FC<{ state: XhsCoverPersistentState; onUpdate: UpdateFn }> = ({ state, onUpdate }) => (
  <div>
    <SectionLabel>封面比例</SectionLabel>
    <div className="flex gap-2">
      {ASPECT_RATIOS.map((r) => (
        <button
          key={r.value}
          onClick={() => onUpdate({ aspectRatio: r.value })}
          className={`flex-1 py-2 text-[11px] font-bold rounded-xl border transition-all ${
            state.aspectRatio === r.value
              ? 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-100'
              : 'border-slate-200 text-slate-500 hover:border-rose-300'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  </div>
);

const FontStyleSection: React.FC<{ state: XhsCoverPersistentState; onUpdate: UpdateFn }> = ({ state, onUpdate }) => (
  <div>
    <SectionLabel>字体风格</SectionLabel>
    <div className="grid grid-cols-5 gap-1.5">
      {FONT_STYLES.map((f) => {
        const active = state.fontStyle === f.value;
        return (
          <button
            key={f.value}
            onClick={() => onUpdate({ fontStyle: f.value })}
            className={`flex flex-col items-center gap-1 rounded-xl border py-2 transition-all ${
              active
                ? 'border-rose-400 bg-rose-50 text-rose-600 shadow-sm'
                : 'border-slate-200 text-slate-500 hover:border-rose-300'
            }`}
          >
            <span className={`text-lg leading-none ${
              f.value === 'songti' ? 'font-serif' :
              f.value === 'handwriting' ? 'italic' :
              f.value === 'calligraphy' ? 'font-serif font-black' : 'font-black'
            }`}>{f.preview}</span>
            <span className="text-[9px] font-bold">{f.label}</span>
          </button>
        );
      })}
    </div>
  </div>
);

const StyleSelectionSection: React.FC<{
  state: XhsCoverPersistentState;
  toggleStyle: (id: string) => void;
  collapsedCats: Set<string>;
  toggleCat: (label: string) => void;
  onPreview: (url: string) => void;
}> = ({ state, toggleStyle, collapsedCats, toggleCat, onPreview }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <SectionLabel>风格选择</SectionLabel>
      <span className="text-[11px] font-bold text-rose-500">{state.selectedStyleIds.length} 种</span>
    </div>
    <div className="space-y-3">
      {XHS_STYLE_CATEGORIES.map((cat) => {
        const collapsed = collapsedCats.has(cat.label);
        return (
          <div key={cat.label}>
            <button
              type="button"
              onClick={() => toggleCat(cat.label)}
              className="flex w-full items-center gap-1.5 mb-2 group"
            >
              <span className="w-1 h-3.5 rounded-full bg-rose-400 shrink-0" />
              <span className="text-[11px] font-black text-slate-600">{cat.label}</span>
              <span className="text-[10px] text-slate-400 ml-0.5">({cat.ids.length})</span>
              <i className={`fas fa-chevron-down text-[8px] text-slate-400 ml-auto transition-transform ${collapsed ? '-rotate-90' : ''}`} />
            </button>
            {!collapsed && (
              <div className="grid grid-cols-2 gap-2">
                {cat.ids.map((id) => {
                  const style = XHS_COVER_STYLES.find((s) => s.id === id);
                  if (!style) return null;
                  const selected = state.selectedStyleIds.includes(id);
                  return (
                    <StyleCard
                      key={id}
                      style={style}
                      selected={selected}
                      onToggle={() => toggleStyle(id)}
                      onPreview={() => onPreview(style.previewImage)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const StyleCard: React.FC<{
  style: XhsCoverStyle;
  selected: boolean;
  onToggle: () => void;
  onPreview: () => void;
}> = ({ style, selected, onToggle, onPreview }) => {
  const [previewFailed, setPreviewFailed] = useState(false);

  return (
    <div
      className={`relative rounded-2xl border-2 overflow-hidden transition-all cursor-pointer ${
        selected
          ? 'border-rose-400 shadow-sm shadow-rose-100'
          : 'border-slate-100 hover:border-rose-200'
      }`}
      onClick={onToggle}
    >
      <div className="aspect-[3/4] bg-slate-50 relative group">
        {previewFailed ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-4 text-center bg-[linear-gradient(160deg,#fff7ed_0%,#fff1f2_100%)]">
            <span className="text-3xl">{style.previewEmoji}</span>
            <span className="text-xs font-black tracking-wide text-slate-700">{style.name}</span>
            <span className="text-[10px] font-bold text-slate-500">{style.category}风格预览</span>
          </div>
        ) : (
          <img
            src={style.previewImage}
            className="w-full h-full object-cover"
            alt={style.name}
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity text-[9px]"
          title="放大预览"
        >
          <i className="fas fa-search-plus" />
        </button>
        {selected && (
          <div className="absolute top-1.5 left-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px]">
            <i className="fas fa-check" />
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 text-center">
        <span className={`text-[10px] font-bold ${selected ? 'text-rose-600' : 'text-slate-500'}`}>
          {style.name}
        </span>
      </div>
    </div>
  );
};

const DecorationSection: React.FC<{ state: XhsCoverPersistentState; onUpdate: UpdateFn }> = ({ state, onUpdate }) => (
  <>
    <div>
      <SectionLabel>装饰贴纸</SectionLabel>
      <input
        type="text"
        value={state.decoration}
        onChange={(e) => onUpdate({ decoration: e.target.value })}
        placeholder="如：星星、爱心、闪电、花朵..."
        className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all"
      />
    </div>
    <div>
      <SectionLabel>额外要求</SectionLabel>
      <textarea
        value={state.extraRequirement}
        onChange={(e) => onUpdate({ extraRequirement: e.target.value })}
        placeholder="其他生成要求或备注..."
        rows={2}
        className="w-full px-3 py-2.5 text-sm font-medium border border-slate-200 rounded-xl focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all resize-none"
      />
    </div>
  </>
);

const GenerateButton: React.FC<{
  state: XhsCoverPersistentState;
  canStart: boolean;
  isProcessing: boolean;
  onStart: () => void;
}> = ({ state, canStart, isProcessing, onStart }) => (
  <div>
    <button
      onClick={onStart}
      disabled={!canStart || isProcessing || !state.title.trim()}
      className="w-full py-3.5 bg-rose-500 text-white font-black text-sm rounded-2xl shadow-xl shadow-rose-100 hover:bg-rose-600 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none flex items-center justify-center gap-2"
    >
      {isProcessing ? (
        <><i className="fas fa-spinner fa-spin" /> 生成中...</>
      ) : (
        <><i className="fas fa-magic" /> 生成封面</>
      )}
    </button>
    {!state.title.trim() && (
      <p className="text-[11px] text-slate-400 text-center mt-2">请先填写封面标题</p>
    )}
  </div>
);
