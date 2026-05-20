import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Hexagon, LockKeyhole, Moon, Sparkles, Sun, UserRound, Wand2, Zap } from 'lucide-react';

interface Props {
  isSubmitting: boolean;
  error: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
}

const LoginScreen: React.FC<Props> = ({ isSubmitting, error, theme, onToggleTheme, onLogin }) => {
  const usernameRef = useRef('');
  const passwordRef = useRef('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const handleUsernameInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    usernameRef.current = e.currentTarget.value;
  }, []);

  const handlePasswordInput = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    passwordRef.current = e.currentTarget.value;
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    usernameRef.current = String(formData.get('username') || usernameRef.current).trim();
    passwordRef.current = String(formData.get('password') || passwordRef.current);
    if (!usernameRef.current.trim() || !passwordRef.current) return;
    void onLogin(usernameRef.current.trim(), passwordRef.current);
  };

  return (
    <main className="login-stage min-h-screen w-full overflow-hidden">
      <div className="login-bg-base" />
      <div className="login-bg-grid" />
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />
      <div className="login-glow login-glow-c" />

      <button
        type="button"
        onClick={onToggleTheme}
        className="login-theme-toggle"
        title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
      >
        {theme === 'dark' ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
        <span>{theme === 'dark' ? '浅色' : '深色'}</span>
      </button>

      <div className="login-layout relative z-10 mx-auto grid min-h-screen w-full grid-cols-1 gap-10 px-7 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-16 xl:px-24">
        <section className="hidden items-center lg:flex">
          <div className={`login-hero-content relative w-full transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
            <div className="login-holo-card" aria-hidden="true">
              <div className="login-holo-ring login-holo-ring-a" />
              <div className="login-holo-ring login-holo-ring-b" />
              <div className="login-holo-chip login-holo-chip-a"><Sparkles size={18} /></div>
              <div className="login-holo-chip login-holo-chip-b"><Wand2 size={18} /></div>
              <div className="login-holo-chip login-holo-chip-c"><Zap size={18} /></div>
              <div className="login-holo-line login-holo-line-a" />
              <div className="login-holo-line login-holo-line-b" />
            </div>

            <div className="mb-12 flex items-center gap-4">
              <div className="login-brand-mark">
                <Hexagon size={18} strokeWidth={1.7} />
              </div>
              <span className="text-[18px] font-semibold tracking-normal" style={{ color: 'var(--text-primary)' }}>MEIAO</span>
            </div>

            <div
              className="mb-7 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[12px] font-medium"
              style={{
                background: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-secondary)',
              }}
            >
              <Bot size={14} style={{ color: 'var(--accent)' }} />
              <span>MEIAO AI 工作台</span>
            </div>

            <h1 className="login-title font-bold leading-[1.05] tracking-normal" style={{ color: 'var(--text-primary)' }}>
              梅奥视觉
              <br />
              <span className="login-gradient-text">AI智能工作台</span>
            </h1>
            <p className="login-description mt-7 leading-[1.85]" style={{ color: 'var(--text-tertiary)' }}>
              AI 驱动的产品视觉创作平台。产品精修、出海翻译、买家秀、短视频生成，一站式完成。
            </p>

            <div className="login-capability-grid">
              {[
                { value: '最强生图模型', label: '接入' },
                { value: 'Seedance 2.0', label: '视频接入' },
                { value: '全链路工作流', label: '覆盖' },
                { value: '多模型', label: '稳定调度' },
              ].map((item) => (
                <div key={item.value} className="login-capability-chip">
                  <span className="login-capability-value">{item.value}</span>
                  <span className="login-capability-label">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:justify-end">
          <div className={`login-panel login-auth-panel w-full transition-all duration-700 delay-100 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>
            <div className="mb-9 flex items-start justify-between gap-6">
              <div>
                <p className="text-[12px] font-semibold leading-none" style={{ color: 'var(--text-secondary)' }}>登录</p>
                <h2 className="mt-4 text-[32px] font-bold leading-none tracking-normal" style={{ color: 'var(--text-primary)' }}>欢迎回来</h2>
              </div>
              <div className="login-panel-mark">
                <Hexagon size={18} strokeWidth={1.5} />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="login-field">
                <label className="block text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>账号</label>
                <div className="mt-4 flex items-center gap-3">
                  <UserRound size={17} strokeWidth={1.6} style={{ color: 'var(--text-tertiary)' }} />
                  <input
                    name="username"
                    defaultValue=""
                    onInput={handleUsernameInput}
                    placeholder="请输入账号"
                    autoComplete="username"
                    className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-[15px] font-normal outline-none placeholder:text-[var(--text-tertiary)]"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              <div className="login-field">
                <label className="block text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>密码</label>
                <div className="mt-4 flex items-center gap-3">
                  <LockKeyhole size={17} strokeWidth={1.6} style={{ color: 'var(--text-tertiary)' }} />
                  <input
                    type="password"
                    name="password"
                    defaultValue=""
                    onInput={handlePasswordInput}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-[15px] font-normal outline-none placeholder:text-[var(--text-tertiary)]"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </div>
              </div>
              {error ? (
                <div className="rounded-[14px] bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={isSubmitting}
                className="login-submit mt-7 flex h-12 w-full items-center justify-center rounded-[18px] text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
              >
                <span>{isSubmitting ? '登录中...' : '进入工作台'}</span>
                {!isSubmitting ? <ArrowRight size={16} strokeWidth={1.8} /> : null}
              </button>

              <div className="flex items-center justify-between px-1 pt-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                <span>内部登录入口</span>
                <span>安全连接</span>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
};

export default LoginScreen;
