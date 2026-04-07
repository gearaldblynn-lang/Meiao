import React from 'react';
import { createPortal } from 'react-dom';
import { APP_RELEASE_VERSION, CURRENT_RELEASE_NOTES } from '../config/releaseNotes';

interface Props {
  onClose: () => void;
}

const ReleaseNotesModal: React.FC<Props> = ({ onClose }) => {
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/58 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-white/14 bg-[linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.72))] shadow-[0_32px_90px_rgba(15,23,42,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200/80">版本更新</p>
            <h2 className="mt-2 text-2xl font-black text-white">{APP_RELEASE_VERSION}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">本次更新已整理到通知中心，之后也可以从右上角版本号再次查看。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭更新日志"
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-slate-200 transition hover:bg-white/12"
          >
            <i className="fas fa-xmark text-sm" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <div className="grid gap-4">
            {CURRENT_RELEASE_NOTES.map((section) => (
              <section
                key={section.title}
                className="rounded-[26px] border border-white/10 bg-white/6 px-5 py-4"
              >
                <h3 className="text-sm font-black text-white">{section.title}</h3>
                <div className="mt-3 space-y-2">
                  {section.items.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                      <p className="text-[13px] leading-6 text-slate-200">{item}</p>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ReleaseNotesModal;
