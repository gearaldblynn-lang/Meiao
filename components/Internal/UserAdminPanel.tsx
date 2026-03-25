import React, { useEffect, useState } from 'react';
import { AuthUser } from '../../types';
import { createInternalUser, fetchInternalUsers } from '../../services/internalApi';

interface Props {
  enabled: boolean;
}

const UserAdminPanel: React.FC<Props> = ({ enabled }) => {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'staff' as 'admin' | 'staff',
  });

  const loadUsers = async () => {
    if (!enabled) return;
    setLoading(true);
    setError('');
    try {
      const result = await fetchInternalUsers();
      setUsers(result.users);
    } catch (requestError: any) {
      setError(requestError.message || '账号列表读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await createInternalUser(form);
      setForm({ username: '', displayName: '', password: '', role: 'staff' });
      await loadUsers();
    } catch (requestError: any) {
      setError(requestError.message || '创建账号失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-12">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-lg">
          <i className="fas fa-user-shield text-xl"></i>
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-800">内部账号管理</h3>
          <p className="text-xs text-slate-400">管理员创建员工账号，员工自己不注册</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[0.95fr_1.05fr] gap-8">
        <form onSubmit={handleCreate} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">登录用户名</label>
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="例如：xiaoli"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">显示名称</label>
            <input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="例如：小李"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">初始密码</label>
            <input
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
              placeholder="至少自己记得住"
            />
          </div>
          <div>
            <label className="text-[10px] font-black text-slate-500 uppercase ml-1">账号角色</label>
            <select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'staff' })}
              className="mt-1 w-full bg-white border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="staff">员工</option>
              <option value="admin">管理员</option>
            </select>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-slate-900 text-white py-3 text-sm font-black hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            {submitting ? '创建中...' : '创建新账号'}
          </button>
        </form>

        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-black text-slate-800">已有账号</h4>
              <p className="text-xs text-slate-400 mt-1">这一版先提供创建和查看，够内部使用起步</p>
            </div>
            <button onClick={() => void loadUsers()} className="text-xs font-black text-slate-500 hover:text-slate-900">
              刷新
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="px-6 py-5 text-sm font-bold text-slate-400">正在读取账号列表...</div>
            ) : users.length === 0 ? (
              <div className="px-6 py-5 text-sm font-bold text-slate-400">还没有创建其他账号</div>
            ) : (
              users.map((user) => (
                <div key={user.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-slate-800">{user.displayName || user.username}</p>
                    <p className="text-xs text-slate-400 mt-1">{user.username}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-slate-600">{user.role === 'admin' ? '管理员' : '员工'}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{user.lastLoginAt ? '已登录过' : '尚未登录'}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default UserAdminPanel;
