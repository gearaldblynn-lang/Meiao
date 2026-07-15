import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

import type {
  SubtitleRemovalRegion,
  SubtitleRemovalSourceDraft,
} from '../../types';
import SubtitleRegionEditor from './SubtitleRegionEditor';

export type SubtitleRemovalRegionDialogItem = {
  draft: SubtitleRemovalSourceDraft;
  region: SubtitleRemovalRegion;
};

type Props = {
  item: SubtitleRemovalRegionDialogItem | null;
  onCancel: () => void;
  onSave: (region: SubtitleRemovalRegion) => void;
};

const SubtitleRemovalRegionDialog: React.FC<Props> = ({ item, onCancel, onSave }) => {
  const [draftRegion, setDraftRegion] = useState<SubtitleRemovalRegion>(() => item?.region || {
    x: 0,
    y: 0.7,
    width: 1,
    height: 0.3,
  });

  useEffect(() => {
    if (item) setDraftRegion({ ...item.region });
  }, [item]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center bg-black/55 sm:p-5"
      style={{ backdropFilter: 'blur(12px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`调整 ${item.draft.fileName} 的字幕区域`}
      onClick={onCancel}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden border sm:h-auto sm:max-h-[92vh] sm:max-w-[1180px] sm:rounded-[30px]"
        style={{ background: 'var(--bg-base)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>调整字幕区域</h3>
            <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{item.draft.fileName}</p>
          </div>
          <button type="button" onClick={onCancel} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }} aria-label="关闭区域编辑">
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <SubtitleRegionEditor
            source={item.draft}
            region={draftRegion}
            onRegionChange={setDraftRegion}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3 sm:px-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <button type="button" onClick={onCancel} className="rounded-full px-5 py-2.5 text-[12px] font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            取消
          </button>
          <button type="button" onClick={() => onSave(draftRegion)} className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[12px] font-semibold text-white" style={{ background: 'var(--accent)' }}>
            <Check size={14} /> 保存区域
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubtitleRemovalRegionDialog;
