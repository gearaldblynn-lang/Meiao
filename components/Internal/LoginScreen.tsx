import React, { useState } from 'react';

interface Props {
  isSubmitting: boolean;
  error: string;
  onLogin: (username: string, password: string) => Promise<void>;
}

const LoginScreen: React.FC<Props> = ({ isSubmitting, error, onLogin }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Meiao123456');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.18),_transparent_30%),linear-gradient(135deg,#fff7ed_0%,#f8fafc_45%,#eef2ff_100%)] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.2fr_0.8fr] bg-white/90 backdrop-blur rounded-[36px] shadow-2xl overflow-hidden border border-white/70">
        <section className="p-10 lg:p-14 bg-slate-950 text-white">
          <p className="text-[11px] tracking-[0.28em] uppercase font-black text-rose-300">Meiao Internal V1</p>
          <h1 className="mt-5 text-4xl font-black leading-tight">公司内部协作版已经接入登录层</h1>
          <p className="mt-5 text-sm leading-7 text-slate-300 font-medium">
            这一版先把多人登录和每人独立保存打通。你们后续在云上部署后，员工登录进去就能看到自己的工作内容，不会再和别人混在一起。
          </p>
          <div className="mt-8 grid sm:grid-cols-2 gap-4">
            <div className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <p className="text-xs font-black text-white">当前默认管理员</p>
              <p className="mt-3 text-sm text-slate-300 leading-7">用户名默认是 `admin`，密码默认是 `Meiao123456`。后面上云前建议立刻改掉。</p>
            </div>
            <div className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <p className="text-xs font-black text-white">这一步的意义</p>
              <p className="mt-3 text-sm text-slate-300 leading-7">先把“谁在用”和“谁的数据归谁”搭好，后面再继续接数据库、上云、收 API Key。</p>
            </div>
          </div>
        </section>

        <section className="p-10 lg:p-14 flex items-center">
          <form onSubmit={handleSubmit} className="w-full">
            <p className="text-[11px] font-black tracking-[0.28em] uppercase text-slate-400">登录系统</p>
            <h2 className="mt-4 text-3xl font-black text-slate-900">进入内部工作台</h2>
            <div className="mt-8 space-y-5">
              <div>
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">用户名</label>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
            </div>

            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 w-full rounded-2xl bg-slate-950 text-white py-3.5 text-sm font-black hover:bg-slate-800 transition-colors disabled:opacity-60"
            >
              {isSubmitting ? '登录中...' : '进入系统'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};

export default LoginScreen;
