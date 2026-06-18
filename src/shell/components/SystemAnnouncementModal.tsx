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
      style={{ background: 'rgba(15,23,42,0.42)', backdropFilter: 'blur(10px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="系统公告"
    >
      <div
        className="w-full max-w-[520px] rounded-[28px] border px-6 py-6"
        style={{
          background: 'rgba(255,255,255,0.94)',
          borderColor: 'rgba(255,255,255,0.88)',
          boxShadow: '0 24px 80px rgba(15,23,42,0.24)',
          backdropFilter: 'blur(24px) saturate(1.18)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
            >
              <Bell size={18} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold" style={{ color: '#64748b' }}>系统公告</p>
              <h2 className="mt-1 text-[18px] font-semibold leading-7" style={{ color: '#0f172a' }}>
                {current.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'rgba(15,23,42,0.07)', color: '#64748b' }}
            aria-label="关闭公告"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="mt-5 max-h-[46vh] overflow-y-auto whitespace-pre-wrap rounded-2xl px-4 py-4 text-[14px] leading-7"
          style={{ background: 'rgba(248,250,252,0.88)', color: '#334155' }}
        >
          {current.content}
        </div>

        {current.updatedAt ? (
          <p className="mt-3 text-[11px]" style={{ color: '#64748b' }}>
            更新于 {new Date(current.updatedAt).toLocaleString('zh-CN', { hour12: false })}
            {current.updatedBy ? ` · ${current.updatedBy}` : ''}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border px-4 py-2.5 text-[13px] font-semibold"
            style={{ borderColor: 'rgba(148,163,184,0.34)', background: 'rgba(255,255,255,0.72)', color: '#334155' }}
          >
            关闭
          </button>
          {announcement?.enabled ? (
            <button
              type="button"
              onClick={onDismissToday}
              className="rounded-2xl px-4 py-2.5 text-[13px] font-semibold text-white"
              style={{ background: '#2563eb', boxShadow: '0 12px 28px rgba(37,99,235,0.24)' }}
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
