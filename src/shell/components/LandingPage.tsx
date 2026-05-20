import React, { useContext } from 'react';
import {
  Sparkles, Globe, Users, Wand2, PlayCircle, BookOpen, Bot, ArrowRight,
  Zap, TrendingUp, Image, Video, Palette, MessageSquare
} from 'lucide-react';
import type { AppModule } from '../types';
import { AppModuleObj } from '../types';
import { ThemeContext } from '../context/ThemeContext';

/* ─── Module Card Data ─── */
const FEATURES: Array<{
  key: AppModule;
  icon: React.ReactNode;
  title: string;
  desc: string;
  gradient: [string, string];
  shadow: string;
}> = [
  {
    key: AppModuleObj.ONE_CLICK,
    icon: <Sparkles size={22} strokeWidth={1.5} />,
    title: '一键主详',
    desc: '输入产品信息，一键生成首图、主图、详情页与 SKU 图',
    gradient: ['#6366F1', '#8B5CF6'],
    shadow: '#6366F130',
  },
  {
    key: AppModuleObj.TRANSLATION,
    icon: <Globe size={22} strokeWidth={1.5} />,
    title: '出海翻译',
    desc: '多语言文案翻译与视觉本地化，主图详情一键出海',
    gradient: ['#06B6D4', '#3B82F6'],
    shadow: '#06B6D430',
  },
  {
    key: AppModuleObj.RETOUCH,
    icon: <Wand2 size={22} strokeWidth={1.5} />,
    title: '产品精修',
    desc: 'AI 智能精修产品图，白底、增强、背景替换专业级输出',
    gradient: ['#EC4899', '#F43F5E'],
    shadow: '#EC489930',
  },
  {
    key: AppModuleObj.BUYER_SHOW,
    icon: <Users size={22} strokeWidth={1.5} />,
    title: '买家秀',
    desc: '模拟真实用户场景，生成室内、户外、居家多风格买家秀',
    gradient: ['#F59E0B', '#EF4444'],
    shadow: '#F59E0B30',
  },
  {
    key: AppModuleObj.VIDEO,
    icon: <PlayCircle size={22} strokeWidth={1.5} />,
    title: '短视频生成',
    desc: '脚本分镜、视频诊断、多模型生成，助力短视频营销',
    gradient: ['#10B981', '#059669'],
    shadow: '#10B98130',
  },
  {
    key: AppModuleObj.XHS_COVER,
    icon: <BookOpen size={22} strokeWidth={1.5} />,
    title: '小红书封面',
    desc: '职场、文艺、ins 风封面设计，字体与排版一键生成',
    gradient: ['#8B5CF6', '#6366F1'],
    shadow: '#8B5CF630',
  },
];

const HIGHLIGHTS = [
  { icon: <Image size={16} />, value: '最强生图模型', label: '接入' },
  { icon: <Video size={16} />, value: 'Seedance 2.0', label: '视频接入' },
  { icon: <Zap size={16} />, value: '10x', label: '效率提升' },
  { icon: <Palette size={16} />, value: '全链路工作流', label: '覆盖' },
  { icon: <TrendingUp size={16} />, value: '多模型', label: '稳定调度' },
];

/* ─── Background Animation (CSS-only) ─── */
const AnimatedBackground: React.FC = () => {
  const { theme } = useContext(ThemeContext);
  const isDark = theme === 'dark';
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Base gradient */}
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{
          background: isDark
            ? 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(6,182,212,0.08) 0%, transparent 50%)'
            : 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.06) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(6,182,212,0.04) 0%, transparent 50%)',
        }}
      />
      {/* Floating orbs */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute rounded-full blur-3xl opacity-20"
          style={{
            width: [300, 250, 200][i],
            height: [300, 250, 200][i],
            background: ['rgba(99,102,241,0.4)', 'rgba(6,182,212,0.35)', 'rgba(236,72,153,0.3)'][i],
            left: ['10%', '60%', '40%'][i],
            top: ['20%', '50%', '70%'][i],
            animation: `float-${i} ${[12, 15, 18][i]}s ease-in-out infinite`,
          }}
        />
      ))}
      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(${isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)'} 1px, transparent 1px), linear-gradient(90deg, ${isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)'} 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
    </div>
  );
};

/* ─── Feature Card ─── */
const FeatureCard: React.FC<{
  feature: typeof FEATURES[0];
  onClick: () => void;
  index: number;
}> = ({ feature, onClick, index }) => {
  const [c1, c2] = feature.gradient;
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-start text-left p-5 rounded-3xl border transition-all duration-300 hover:-translate-y-1 surface-hover"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'var(--bg-surface)',
        animation: `fade-in-up 0.5s ease ${index * 0.08}s both`,
        boxShadow: 'none',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 8px 32px ${feature.shadow}`;
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)';
      }}
    >
      {/* Icon bubble */}
      <div
        className="flex items-center justify-center w-12 h-12 rounded-2xl mb-4 shrink-0"
        style={{
          background: `linear-gradient(135deg, ${c1}20, ${c2}15)`,
          boxShadow: `0 4px 16px ${c1}18`,
        }}
      >
        <div style={{ color: c1 }}>{feature.icon}</div>
      </div>

      <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
        {feature.title}
      </h3>
      <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--text-tertiary)' }}>
        {feature.desc}
      </p>

      <div className="mt-auto flex items-center gap-1 text-[11px] font-medium transition-all group-hover:gap-2" style={{ color: c1 }}>
        <span>开始使用</span>
        <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
};

/* ─── Main Landing Page ─── */
interface Props {
  onNavigate: (module: AppModule) => void;
}

const LandingPage: React.FC<Props> = ({ onNavigate }) => {
  return (
    <div className="relative min-h-full flex flex-col">
      <AnimatedBackground />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-6 py-10">
        {/* Hero */}
        <div className="text-center max-w-xl mx-auto mb-3" style={{ animation: 'fade-in-up 0.6s ease both' }}>
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 text-[12px] font-medium border"
            style={{
              background: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            <Bot size={14} style={{ color: 'var(--accent)' }} />
            <span>MEIAO AI 工作台</span>
          </div>

          <h1
            className="text-[32px] sm:text-[40px] font-bold tracking-[-0.03em] leading-tight mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            梅奥电商
            <br />
            <span style={{ color: 'var(--accent)' }}>AI 内容创作</span>工作台
          </h1>
          <p className="text-[14px] leading-relaxed max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
            一键生成产品主图、详情页、买家秀、短视频与小红书封面
            <br />
            让 AI 成为你内容团队的超级助手
          </p>
        </div>

        {/* Highlights bar */}
        <div
          className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center mb-10 px-4 py-3 rounded-2xl border"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
            animation: 'fade-in-up 0.6s ease 0.15s both',
          }}
        >
          {HIGHLIGHTS.map((h, i) => (
            <React.Fragment key={h.label}>
              {i > 0 && <div className="w-px h-4 mx-1 sm:mx-2" style={{ background: 'var(--border-subtle)' }} />}
              <div className="flex items-center gap-1.5 px-2">
                <span style={{ color: 'var(--accent)' }}>{h.icon}</span>
                <span className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{h.value}</span>
                <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>{h.label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Feature Grid */}
        <div className="w-full max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.key} feature={f} onClick={() => onNavigate(f.key)} index={i} />
          ))}
        </div>

        {/* Quick agent CTA */}
        <div
          className="w-full max-w-4xl mx-auto"
          style={{ animation: 'fade-in-up 0.6s ease 0.5s both' }}
        >
          <button
            onClick={() => onNavigate(AppModuleObj.AGENT_CENTER)}
            className="group flex items-center gap-4 w-full p-5 rounded-3xl border text-left transition-all surface-hover"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--bg-surface)',
            }}
          >
            <div
              className="flex items-center justify-center w-12 h-12 rounded-2xl shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))',
                boxShadow: '0 4px 16px rgba(99,102,241,0.15)',
              }}
            >
              <MessageSquare size={22} strokeWidth={1.5} style={{ color: '#6366F1' }} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                需要先聊清楚？进入智能体广场
              </h3>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                选择已发布智能体分析需求、整理策划，再一键带到主图、翻译、买家秀等功能继续生成
              </p>
            </div>
            <ArrowRight size={18} className="shrink-0 transition-transform group-hover:translate-x-1" style={{ color: 'var(--text-tertiary)' }} />
          </button>
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-0"
        style={{
          background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 100%)',
        }}
      />

      {/* CSS animations injected here */}
      <style>{`
        @keyframes float-0 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -30px) scale(1.05); }
          66% { transform: translate(-20px, 20px) scale(0.95); }
        }
        @keyframes float-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-25px, 20px) scale(1.03); }
          66% { transform: translate(20px, -15px) scale(0.97); }
        }
        @keyframes float-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(15px, -25px) scale(1.04); }
        }
      `}</style>
    </div>
  );
};

export default LandingPage;
