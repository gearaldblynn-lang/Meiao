import React from 'react';
import { AuthUser } from '../../types';
import UserAdminPanel from '../../components/Internal/UserAdminPanel';

interface Props {
  currentUser?: AuthUser | null;
  internalMode?: boolean;
}

const AccountManagement: React.FC<Props> = ({ currentUser = null, internalMode = false }) => {
  return (
    <div className="h-full bg-white overflow-y-auto">
      <div className="max-w-5xl mx-auto px-12 py-12">
        <header className="mb-10">
          <h2 className="text-3xl font-black text-slate-900 mb-2">账号管理</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Account Workspace</p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-slate-50 px-8 py-7">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg">
              <i className="fas fa-user-shield text-xl"></i>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-black text-slate-800">当前登录账号</h3>
              <p className="mt-2 text-sm text-slate-600 leading-7">
                {currentUser?.displayName || currentUser?.username || '未登录'} · {currentUser?.role === 'admin' ? '管理员' : '员工'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {internalMode ? '这里负责内部账号管理。管理员可以创建员工账号。' : '当前为本地模式，账号管理仅在内部版启用。'}
              </p>
            </div>
          </div>
        </section>

        <UserAdminPanel enabled={Boolean(internalMode && currentUser?.role === 'admin')} />
      </div>
    </div>
  );
};

export default AccountManagement;
