import React, { useState } from 'react';
import { Download, RefreshCw, Copy, Check, Trash2, MoreHorizontal } from 'lucide-react';
import type { GeneratedResult } from '../../ShellMigratedApp';
import { copyTextToClipboard } from '../../utils/clipboard.mjs';
import { formatMonthDay } from '../../utils/timeFormat.ts';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  result: GeneratedResult;
  onDelete?: (id: string) => void;
  onRegenerate?: (id: string) => void;
}

const ResultCard: React.FC<Props> = ({ result, onDelete, onRegenerate }) => {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const handleCopy = async () => {
    const copiedText = await copyTextToClipboard(result.prompt);
    if (copiedText) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="group relative rounded-3xl overflow-hidden border surface"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setMenuOpen(false); }}
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      {/* Image */}
      <div className="relative overflow-hidden" style={{
        aspectRatio:
          result.aspectRatio === '1:1' ? '1' :
          result.aspectRatio === '16:9' ? '16/9' :
          result.aspectRatio === '9:16' ? '9/16' :
          result.aspectRatio === '4:3' ? '4/3' :
          result.aspectRatio === '2:3' ? '2/3' : '3/4',
      }}>
        <img src={result.imageUrl} alt={result.prompt} className="w-full h-full object-cover" />

        {/* Hover overlay */}
        <div className="absolute inset-0 flex flex-col justify-between p-2.5 transition-opacity duration-200"
          style={{
            background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 25%, transparent 75%, rgba(0,0,0,0.5) 100%)',
            opacity: hovered ? 1 : 0,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="pill">{result.model || '未记录'}</span>
            <span className="pill">{result.aspectRatio}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onRegenerate && (
              <button
                onClick={() => {
                  if (result.status === 'generating') return;
                  onRegenerate(result.id);
                }}
                disabled={result.status === 'generating'}
                className="w-7 h-7 rounded-xl flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)' }}
                title={result.status === 'generating' ? '生成中' : '重新生成'}
              >
                <RefreshCw size={12} className="text-white" />
              </button>
            )}
            <button onClick={handleCopy} className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)' }} title={copied ? '已复制' : '复制提示词'}>
              {copied ? <Check size={12} className="text-white" /> : <Copy size={12} className="text-white" />}
            </button>
            <button className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)' }} title="下载">
              <Download size={12} className="text-white" />
            </button>
            <div className="relative ml-auto">
              <button onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(6px)' }}>
                <MoreHorizontal size={12} className="text-white" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute bottom-full right-0 mb-1 rounded-xl py-1 min-w-[120px] border z-50" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
                    <button onClick={handleCopy} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}><Copy size={13} /> 复制提示词</button>
                    {onDelete && <button onClick={() => { setConfirmDeleteOpen(true); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px]" style={{ color: 'var(--error)' }}><Trash2 size={13} /> 删除</button>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {result.status === 'generating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>生成中...</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-[12px] leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{result.prompt}</p>
        <p className="mt-1 text-[10px]" style={{ color: 'var(--text-disabled)' }}>{formatMonthDay(result.createdAt)}</p>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="删除图片"
        message="确定要删除这张结果图吗？此操作不可恢复。"
        onConfirm={() => { onDelete?.(result.id); setConfirmDeleteOpen(false); }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
};

export default ResultCard;
