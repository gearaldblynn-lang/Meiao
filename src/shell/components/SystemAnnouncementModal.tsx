import React from 'react';
import { Bell, X } from 'lucide-react';
import type { SystemAnnouncement } from '../../types';

const emptyAnnouncement: SystemAnnouncement = {
  id: '',
  title: '暂无公告',
  content: '当前没有需要提醒的系统公告。',
  enabled: false,
  updatedAt: 0,
  updatedBy: '',
};

const SystemAnnouncementModal: React.FC<{
  open: boolean;
  announcement?: SystemAnnouncement | null;
  onClose: () => void;
  onDismissToday: () => void;
}> = ({ open, announcement, onClose, onDismissToday }) => {
  if (!open) return null;
  const current = announcement?.enabled ? announcement : emptyAnnouncement;
  return (
    <div
      className="fixed inset-0 z-[9996] flex items-center justify-center px-5 py-8"
      style={{ background: 'rgba(15,23,42,0.22)', backdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="系统公告"
    >
      <div
        className="w-full max-w-[520px] rounded-[28px] border px-6 py-6"
        style={{
          background: 'rgba(255,255,255,0.82)',
          borderColor: 'rgba(255,255,255,0.72)',
          boxShadow: '0 24px 80px rgba(15,23,42,0.18)',
          backdropFilter: 'blur(24px) saturate(1.18)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Bell size={18} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>系统公告</p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7" style={{ color: 'var(--text-primary)' }}>
                {current.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(15,23,42,0.06)', color: 'var(--text-secondary)' }}
            aria-label="关闭公告"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="mt-5 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-2xl px-4 py-4 text-[14px] leading-7"
          style={{ background: 'rgba(255,255,255,0.48)', color: 'var(--text-secondary)' }}
        >
          {current.content}
        </div>

        {current.updatedAt ? (
          <p className="mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            更新于 {new Date(current.updatedAt).toLocaleString('zh-CN', { hour12: false })}
            {current.updatedBy ? ` · ${current.updatedBy}` : ''}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border px-4 py-2.5 text-[13px] font-semibold"
            style={{ borderColor: 'var(--border-subtle)', background: 'rgba(255,255,255,0.48)', color: 'var(--text-secondary)' }}
          >
            关闭
          </button>
          {announcement?.enabled ? (
            <button
              type="button"
              onClick={onDismissToday}
              className="rounded-2xl px-4 py-2.5 text-[13px] font-semibold text-white"
              style={{ background: 'var(--accent)' }}
            >
              今日不再提醒
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default SystemAnnouncementModal;
