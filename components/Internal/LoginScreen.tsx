import React, { useState } from 'react';

interface Props {
  isSubmitting: boolean;
  error: string;
  defaultUsername?: string;
  defaultPassword?: string;
  onLogin: (username: string, password: string) => Promise<void>;
}

const LoginScreen: React.FC<Props> = ({ isSubmitting, error, defaultUsername = '', defaultPassword = '', onLogin }) => {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState(defaultPassword);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onLogin(username.trim(), password);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#f5f5f7]">
      <div className="relative min-h-screen">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(148,163,184,0.16),_transparent_28%),linear-gradient(180deg,#f8f8fa_0%,#eef1f5_100%)]" />
        <div className="absolute left-1/2 top-[-18%] h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-white/80 blur-3xl" />

        <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6 py-10">
          <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1.08fr_0.92fr]">
            <section className="flex flex-col justify-between rounded-[40px] border border-white/70 bg-white/55 p-8 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur-2xl lg:p-10">
              <div>
                <div className="inline-flex items-center rounded-full border border-black/5 bg-white/80 px-4 py-1.5 text-[11px] font-semibold tracking-[0.24em] text-slate-500">
                  MEIAO OFFICIAL
                </div>
                <h1 className="mt-8 text-[40px] font-semibold leading-[1.06] tracking-[-0.04em] text-slate-950 lg:text-[52px]">
                  登录 MEIAO
                  <br />
                  内部工作台
                </h1>
                <p className="mt-5 max-w-xl text-[15px] leading-7 text-slate-500">
                  极简、稳定、清晰。登录后继续使用你的项目、任务与工作台数据。
                </p>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[28px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                  <p className="text-sm font-semibold text-slate-900">专属工作数据</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    每个账号登录后进入自己的工作空间，任务、记录与配置彼此隔离。
                  </p>
                </div>
                <div className="rounded-[28px] border border-white/80 bg-white/72 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
                  <p className="text-sm font-semibold text-slate-900">正式版登录入口</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    页面不再预填默认账号信息，适合作为本地与云端统一使用的正式登录页。
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[40px] border border-white/80 bg-white/78 p-8 shadow-[0_35px_100px_rgba(15,23,42,0.1)] backdrop-blur-2xl lg:p-10">
              <div className="mx-auto flex max-w-md flex-col">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.22em] text-slate-400">SIGN IN</p>
                    <h2 className="mt-3 text-[32px] font-semibold tracking-[-0.04em] text-slate-950">欢迎回来</h2>
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-[22px] border border-white/70 bg-white/85 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                    <span className="text-base font-semibold tracking-[0.24em] text-slate-900">M</span>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="mt-10 space-y-5">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-600">账号</label>
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="请输入账号"
                      autoComplete="username"
                      className="h-13 w-full rounded-[22px] border border-slate-200/80 bg-white/92 px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-200/60"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-600">密码</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入密码"
                      autoComplete="current-password"
                      className="h-13 w-full rounded-[22px] border border-slate-200/80 bg-white/92 px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-slate-300 focus:bg-white focus:ring-4 focus:ring-slate-200/60"
                    />
                  </div>

                  {error ? (
                    <div className="rounded-[22px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm font-medium text-rose-600">
                      {error}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="mt-2 flex h-14 w-full items-center justify-center rounded-[24px] bg-slate-950 text-[15px] font-semibold text-white shadow-[0_18px_36px_rgba(15,23,42,0.2)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? '登录中...' : '进入系统'}
                  </button>
                </form>

                <div className="mt-8 rounded-[24px] border border-white/80 bg-white/78 px-5 py-4 text-sm leading-6 text-slate-500 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                  若需注册账号请联系：将离
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
