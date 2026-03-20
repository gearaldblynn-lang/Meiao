
import React, { useEffect, useState } from 'react';

interface Props {
  onFinish: () => void;
}

const IntroSplash: React.FC<Props> = ({ onFinish }) => {
  const [active, setActive] = useState(false);
  const [statusText, setStatusText] = useState('SYSTEM INITIALIZING...');

  useEffect(() => {
    // 延迟激活入场动画
    const t1 = setTimeout(() => setActive(true), 100);
    
    // 动态文本切换
    const texts = [
      'SYSTEM INITIALIZING...',
      'LOADING NEURAL NETWORKS...',
      'CONNECTING TO KIE.AI NANO PRO...',
      'ESTABLISHING SECURE PROTOCOLS...',
      'DOUBAO AI ANALYTICS READY.',
      'MAYO AI ENGINE ONLINE.'
    ];
    
    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i < texts.length) {
        setStatusText(texts[i]);
      }
    }, 450);

    // 自动结束开屏
    const t2 = setTimeout(() => {
      setActive(false);
      setTimeout(onFinish, 800);
    }, 3200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, [onFinish]);

  return (
    <div className={`fixed inset-0 z-[1000] bg-slate-950 flex flex-col items-center justify-center transition-opacity duration-1000 ${active ? 'opacity-100' : 'opacity-0'}`}>
      {/* 科技背景网格 */}
      <div className="absolute inset-0 tech-grid opacity-20 pointer-events-none"></div>
      
      {/* 动态扫描线 */}
      <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent shadow-[0_0_20px_#3b82f6] animate-scan opacity-40"></div>

      {/* 装饰性边角 UI */}
      <div className="absolute top-10 left-10 flex gap-4 opacity-50">
        <div className="w-1 h-8 bg-blue-500"></div>
        <div className="flex flex-col gap-1">
          <div className="w-20 h-1 bg-blue-500/30"></div>
          <div className="w-12 h-1 bg-blue-500/30"></div>
          <div className="text-[8px] font-black text-blue-500 uppercase tracking-widest mt-1">Status: Running</div>
        </div>
      </div>

      <div className="absolute bottom-10 right-10 text-right opacity-30">
        <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1 italic">Protocol 0x821-F</div>
        <div className="w-32 h-0.5 bg-blue-500/50"></div>
      </div>

      {/* 主文案 */}
      <div className="relative">
        <h1 
          className={`text-8xl md:text-9xl font-black text-white tracking-[0.4em] transition-all duration-1000 ${active ? 'blur-0 scale-100 opacity-100' : 'blur-2xl scale-110 opacity-0'}`}
          style={{ textShadow: '0 0 30px rgba(59, 130, 246, 0.5)' }}
        >
          <span className="animate-glitch">MEIAO</span>
        </h1>
        
        {/* 底部副标题 */}
        <div className={`mt-8 flex flex-col items-center gap-4 transition-all duration-1000 delay-300 ${active ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>
           <div className="flex items-center gap-3">
              <div className="w-1 h-1 bg-blue-500 rounded-full animate-ping"></div>
              <span className="text-xs font-black text-blue-400 uppercase tracking-[0.5em]">{statusText}</span>
           </div>
           
           {/* 进度条装饰 */}
           <div className="w-64 h-1 bg-slate-900 rounded-full overflow-hidden border border-white/5 shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-[3000ms] ease-out"
                style={{ width: active ? '100%' : '0%' }}
              ></div>
           </div>
        </div>
      </div>

      {/* 氛围粒子（装饰） */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-1 h-1 bg-white rounded-full animate-pulse"></div>
        <div className="absolute top-3/4 left-2/3 w-1 h-1 bg-blue-400 rounded-full animate-ping"></div>
        <div className="absolute top-1/2 right-1/4 w-1 h-1 bg-cyan-400 rounded-full animate-pulse"></div>
      </div>
    </div>
  );
};

export default IntroSplash;
