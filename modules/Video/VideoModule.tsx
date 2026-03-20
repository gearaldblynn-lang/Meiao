
import React from 'react';
import { GlobalApiConfig, VideoPersistentState } from '../../types';

interface Props {
  apiConfig: GlobalApiConfig;
  persistentState: VideoPersistentState;
  onStateChange: (state: VideoPersistentState) => void;
}

const VideoModule: React.FC<Props> = ({ apiConfig, persistentState, onStateChange }) => {
  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <main className="flex-1 flex items-center justify-center p-10">
        <div className="max-w-3xl w-full bg-white border border-slate-200 rounded-[36px] shadow-xl p-12 text-center">
          <div className="w-24 h-24 mx-auto mb-8 rounded-[28px] bg-purple-50 flex items-center justify-center">
            <i className="fas fa-play-circle text-4xl text-purple-500"></i>
          </div>
          <h2 className="text-3xl font-black text-slate-900 mb-4">短视频模块重构中</h2>
          <p className="text-slate-500 font-bold leading-7 max-w-2xl mx-auto">
            旧的两个短视频子功能已经下线，避免继续在旧结构上叠加修改。
            后续会基于新的需求重新设计短视频流程、配置项和输出链路。
          </p>
          <div className="mt-8 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-50 text-purple-600 text-xs font-black uppercase tracking-widest">
            <i className="fas fa-sparkles"></i>
            Rebuilding Workflow
          </div>
        </div>
      </main>
    </div>
  );
};

export default VideoModule;
