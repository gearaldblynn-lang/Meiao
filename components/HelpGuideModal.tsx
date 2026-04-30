import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AppModule } from '../types';
import { GUIDE_MODULES, HELP_CONTENT } from '../config/helpGuide';
import { MODULE_META } from './layout/moduleMeta';

interface Props {
  onClose: () => void;
}

const HelpGuideModal: React.FC<Props> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<AppModule>(AppModule.AGENT_CENTER);
  const meta = MODULE_META[activeTab];
  const content = HELP_CONTENT[activeTab];

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-5xl h-[85vh] rounded-3xl overflow-hidden flex shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left sidebar */}
        <div className="w-[220px] shrink-0 border-r border-slate-100 bg-slate-50/80 flex flex-col">
          <div className="px-6 py-5 border-b border-slate-100">
            <h2 className="text-lg font-black text-slate-900">使用说明</h2>
            <p className="text-[11px] text-slate-400 font-bold mt-1">功能模块指南</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
            {GUIDE_MODULES.map((mod) => {
              const m = MODULE_META[mod];
              const active = activeTab === mod;
              return (
                <button
                  key={mod}
                  type="button"
                  onClick={() => setActiveTab(mod)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-2xl text-left transition-all ${
                    active
                      ? `${m.accentSoftClass} ${m.accentTextClass}`
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  }`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                    active ? `${m.accentClass} text-white` : 'bg-slate-200/60 text-slate-400'
                  }`}>
                    <i className={`fas ${m.icon} text-xs`}></i>
                  </div>
                  <span className="text-sm font-bold">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-8 py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 ${meta.accentSoftClass} rounded-xl flex items-center justify-center`}>
                <i className={`fas ${meta.icon} ${meta.accentTextClass}`}></i>
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800">{meta.title}</h3>
                <p className="text-[11px] text-slate-400 font-bold">{meta.subtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
            >
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-6">
            {content ? (
              <div className="flex flex-col gap-6">
                {/* 功能简介 */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">
                    <i className="fas fa-info-circle mr-2"></i>功能简介
                  </h4>
                  <p className="text-sm text-slate-600 leading-7">{content.summary}</p>
                </div>

                {/* 使用步骤 */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">
                    <i className="fas fa-list-ol mr-2"></i>使用步骤
                  </h4>
                  <div className="flex flex-col gap-2">
                    {content.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-3 rounded-xl bg-slate-50 px-4 py-3">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${meta.accentClass} text-white text-[11px] font-black`}>
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700 leading-6">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 注意事项 */}
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 mb-3">
                    <i className="fas fa-lightbulb mr-2"></i>注意事项
                  </h4>
                  <div className="flex flex-col gap-2">
                    {content.tips.map((tip, i) => (
                      <div key={i} className="flex items-start gap-3 px-4 py-2">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.accentClass}`}></span>
                        <span className="text-sm text-slate-600 leading-6">{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">暂无内容</p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HelpGuideModal;
