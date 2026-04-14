import React from 'react';
import type { FolderCard } from './ChatComposer';

interface Props {
  card: FolderCard;
  onDismiss: () => void;
  onToggleExpand: () => void;
}

const getFileIcon = (relativePath: string): string => {
  const ext = relativePath.includes('.') ? relativePath.split('.').pop()!.toLowerCase() : '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'].includes(ext)) return 'fa-image';
  if (ext === 'pdf') return 'fa-file-pdf';
  return 'fa-file-lines';
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const StatusBadge: React.FC<{ status: FolderCard['files'][number]['status'] }> = ({ status }) => {
  if (status === 'done') return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">已上传</span>
  );
  if (status === 'uploading') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-bold text-cyan-600">
      <i className="fas fa-spinner animate-spin text-[9px]" />上传中
    </span>
  );
  if (status === 'error') return (
    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600">失败</span>
  );
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">待上传</span>;
};

const FolderUploadCard: React.FC<Props> = ({ card, onDismiss, onToggleExpand }) => {
  const progressPct = card.files.length > 0
    ? Math.round((card.uploadedCount / card.files.length) * 100)
    : 0;

  return (
    <div className="mt-2 rounded-[16px] border border-slate-200/85 bg-white/96 shadow-[0_4px_14px_rgba(15,23,42,0.06)]">
      {/* 折叠态头部 */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <i className={`fas fa-folder-open text-[14px] ${card.phase === 'done' ? 'text-emerald-500' : card.phase === 'error' ? 'text-rose-400' : 'text-amber-400'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-slate-800">{card.folderName}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{card.files.length} 个文件</span>
            {card.skippedCount > 0 && (
              <span className="shrink-0 text-[11px] text-slate-400">（跳过 {card.skippedCount} 个）</span>
            )}
          </div>
          {card.phase === 'uploading' ? (
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] font-semibold text-cyan-600">
                {card.uploadedCount}/{card.files.length}
              </span>
            </div>
          ) : card.phase === 'done' ? (
            <span className="text-[11px] font-semibold text-emerald-600">已全部上传，点发送开始分析</span>
          ) : (
            <span className="text-[11px] font-semibold text-rose-500">上传出错，请重新选择</span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          title={card.expanded ? '收起' : '展开查看文件'}
        >
          <i className={`fas fa-chevron-${card.expanded ? 'up' : 'down'} text-[10px]`} />
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
          title="取消并移除"
        >
          <i className="fas fa-xmark text-[11px]" />
        </button>
      </div>

      {/* 展开态文件列表 */}
      {card.expanded && (
        <div className="max-h-[180px] overflow-y-auto border-t border-slate-100 px-3 py-2">
          {card.files.map((f, i) => (
            <div key={`${f.relativePath}-${i}`} className="flex items-center gap-2 py-1">
              <i className={`fas ${getFileIcon(f.relativePath)} w-4 shrink-0 text-center text-[11px] text-slate-400`} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600">{f.relativePath}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{formatBytes(f.sizeBytes)}</span>
              <StatusBadge status={f.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FolderUploadCard;
